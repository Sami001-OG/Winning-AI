import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { analyzeChart } from "./src/analysis";
import { Candle, Trade } from "./src/types";

const DEFAULT_RELIABILITY = { ema: 1.5, macd: 0.2, rsi: 1.5, vol: 1.2, obv: 1.2, exception: 2.0 };

async function sendTelegramSignal(botToken: string, chatId: string, message: string, imageUrl?: string) {
  const cleanToken = botToken.replace(/^["']|["']$/g, '').trim();
  let cleanChatId = chatId.replace(/^["']|["']$/g, '').trim();
  
  if (cleanChatId.includes('t.me/')) {
    cleanChatId = cleanChatId.split('t.me/')[1].split('/')[0].split('?')[0];
  }
  
  if (!/^-?\d+$/.test(cleanChatId) && !cleanChatId.startsWith('@')) {
    cleanChatId = '@' + cleanChatId;
  }
  
  const finalToken = cleanToken.toLowerCase().startsWith('bot') 
    ? cleanToken.substring(3) 
    : cleanToken;

  let url = `https://api.telegram.org/bot${finalToken}/sendMessage`;
  let body: any = {
    chat_id: cleanChatId,
    text: message,
    parse_mode: 'HTML',
  };

  if (imageUrl) {
    url = `https://api.telegram.org/bot${finalToken}/sendPhoto`;
    body = {
      chat_id: cleanChatId,
      photo: imageUrl,
      caption: message,
      parse_mode: 'HTML',
    };
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  
  return response.ok;
}

async function fetchTopSymbols() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    const data = await res.json();
    return data
      .filter((t: any) => t.symbol.endsWith('USDT') && parseFloat(t.volume) > 0)
      .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 50)
      .map((t: any) => t.symbol);
  } catch (e) {
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT'];
  }
}

async function fetchKlines(symbol: string, tf: string) {
  const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=250`);
  const data = await res.json();
  return data.map((d: any) => ({
    time: Math.floor(d[0] / 1000),
    open: parseFloat(d[1]),
    high: parseFloat(d[2]),
    low: parseFloat(d[3]),
    close: parseFloat(d[4]),
    volume: parseFloat(d[5]),
    isFinal: true
  }));
}


async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/telegram/send", async (req, res) => {
    try {
      const { botToken, chatId, message } = req.body;
      
      if (!botToken || !chatId) {
        return res.status(400).json({ error: "Missing botToken or chatId" });
      }

      const success = await sendTelegramSignal(botToken, chatId, message);
      
      if (!success) {
        return res.status(500).json({ error: "Failed to send message" });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error sending Telegram message via proxy:', error);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  // ... (debug endpoint remains the same)
  app.post("/api/telegram/debug", async (req, res) => {
    try {
      const { botToken } = req.body;
      if (!botToken) {
        return res.status(400).json({ error: "Missing botToken" });
      }

      const cleanToken = botToken.replace(/^["']|["']$/g, '').trim();
      const finalToken = cleanToken.toLowerCase().startsWith('bot') 
        ? cleanToken.substring(3) 
        : cleanToken;

      const updatesUrl = `https://api.telegram.org/bot${finalToken}/getUpdates`;
      const updatesResponse = await fetch(updatesUrl);
      
      if (!updatesResponse.ok) {
        const errorText = await updatesResponse.text();
        return res.status(updatesResponse.status).json({ error: "Failed to fetch updates from Telegram", details: errorText });
      }

      const updatesData = await updatesResponse.json();
      
      if (!updatesData.ok) {
        return res.status(400).json({ error: "Telegram API returned not ok", details: updatesData });
      }

      const recentChats = new Set();
      const rawChats: any[] = [];
      
      if (updatesData.result && updatesData.result.length > 0) {
        updatesData.result.forEach((update: any) => {
          let chat = null;
          if (update.message && update.message.chat) chat = update.message.chat;
          else if (update.channel_post && update.channel_post.chat) chat = update.channel_post.chat;
          else if (update.my_chat_member && update.my_chat_member.chat) chat = update.my_chat_member.chat;
          
          if (chat) {
            recentChats.add(`${chat.title || chat.username || chat.first_name || 'Unknown'}: ${chat.id} (Type: ${chat.type})`);
            rawChats.push(chat);
          }
        });
      }
      
      res.json({ 
        success: true, 
        message: "Successfully fetched recent activity",
        foundChats: Array.from(recentChats),
        rawUpdatesCount: updatesData.result ? updatesData.result.length : 0,
        rawChats
      });
    } catch (error) {
      console.error('Error in debug endpoint:', error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Background loop
  const lastSentSignals: Record<string, { direction: string, timestamp: number }> = {};
  const sentSessionNotifications = new Set<string>();
  const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours cooldown

  console.log("Initializing 24/7 Telegram Alert Scanner...");
  let hasLoggedMissingTokens = false;

  setInterval(async () => {
    const botToken = process.env.VITE_TELEGRAM_BOT_TOKEN;
    const chatId = process.env.VITE_TELEGRAM_CHAT_ID;
    
    if (!botToken || !chatId) {
      if (!hasLoggedMissingTokens) {
        console.log("Telegram Scanner skipped: Missing VITE_TELEGRAM_BOT_TOKEN or VITE_TELEGRAM_CHAT_ID in environment variables.");
        hasLoggedMissingTokens = true;
      }
      return;
    }
    hasLoggedMissingTokens = false; // Reset if tokens are added later

    try {
      // --- Session Notifications ---
      const now = new Date();
      const utcHour = now.getUTCHours();
      const utcMinute = now.getUTCMinutes();
      const dateStr = now.toISOString().split('T')[0];

      const sessions = [
        { name: 'Asian', start: 0, end: 6 },
        { name: 'London', start: 7, end: 10 },
        { name: 'New York', start: 13, end: 16 }
      ];

      for (const session of sessions) {
        // Check start window (5 mins before to 5 mins after)
        let isStartWindow = false;
        if (session.start === 0) {
          isStartWindow = (utcHour === 23 && utcMinute >= 55) || (utcHour === 0 && utcMinute <= 5);
        } else {
          isStartWindow = (utcHour === session.start - 1 && utcMinute >= 55) || (utcHour === session.start && utcMinute <= 5);
        }

        if (isStartWindow) {
          const sessionDateStr = (utcHour === 23) ? new Date(now.getTime() + 86400000).toISOString().split('T')[0] : dateStr;
          const key = `${session.name}_START_${sessionDateStr}`;
          if (!sentSessionNotifications.has(key)) {
            await sendTelegramSignal(botToken, chatId, `🌐 <b>MARKET UPDATE</b>\n🟢 <b>${session.name} Session</b> is now OPEN.`);
            sentSessionNotifications.add(key);
          }
        }

        // Check end window (5 mins before to 5 mins after)
        let isEndWindow = false;
        if (session.end === 0) {
          isEndWindow = (utcHour === 23 && utcMinute >= 55) || (utcHour === 0 && utcMinute <= 5);
        } else {
          isEndWindow = (utcHour === session.end - 1 && utcMinute >= 55) || (utcHour === session.end && utcMinute <= 5);
        }

        if (isEndWindow) {
          const sessionDateStr = (utcHour === 23) ? new Date(now.getTime() + 86400000).toISOString().split('T')[0] : dateStr;
          const key = `${session.name}_END_${sessionDateStr}`;
          if (!sentSessionNotifications.has(key)) {
            await sendTelegramSignal(botToken, chatId, `🌐 <b>MARKET UPDATE</b>\n🔴 <b>${session.name} Session</b> is now CLOSED.`);
            sentSessionNotifications.add(key);
          }
        }
      }

      // Cleanup old session notifications to prevent memory leak
      if (sentSessionNotifications.size > 20) {
        const oldKeys = Array.from(sentSessionNotifications).slice(0, 10);
        oldKeys.forEach(k => sentSessionNotifications.delete(k));
      }
      // -----------------------------

      const symbols = await fetchTopSymbols();
      const timeframes = ['15m', '1h', '4h', '1d'];
      const allSignals: any[] = [];

      for (const symbol of symbols) {
        for (const tf of timeframes) {
          try {
            const klines = await fetchKlines(symbol, tf);
            const analysis = analyzeChart(klines, DEFAULT_RELIABILITY, [], symbol);
            
            if (analysis.signal !== 'NO TRADE' && analysis.confidence >= 75) {
              allSignals.push({ symbol, tf, analysis, klines });
            }
            
            // Add a small delay to respect Binance API rate limits (1200 requests/minute)
            await new Promise(resolve => setTimeout(resolve, 50));
          } catch (err) {
            console.error(`Error processing symbol ${symbol} on ${tf} in background loop:`, err);
          }
        }
      }

      // Sort by highest confidence
      allSignals.sort((a, b) => b.analysis.confidence - a.analysis.confidence);

      // Find the absolute best signal that isn't continuous spam
      for (const sig of allSignals) {
        const { symbol, tf, analysis, klines } = sig;
        
        // Check if the previous candles also had the same signal to prevent continuous spam
        const prevKlines1 = klines.slice(0, -1);
        const prevAnalysis1 = analyzeChart(prevKlines1, DEFAULT_RELIABILITY, [], symbol);
        
        const prevKlines2 = klines.slice(0, -2);
        const prevAnalysis2 = analyzeChart(prevKlines2, DEFAULT_RELIABILITY, [], symbol);

        const prevKlines3 = klines.slice(0, -3);
        const prevAnalysis3 = analyzeChart(prevKlines3, DEFAULT_RELIABILITY, [], symbol);
        
        const isContinuous = 
          (prevAnalysis1.signal === analysis.signal && prevAnalysis1.confidence >= 70) ||
          (prevAnalysis2.signal === analysis.signal && prevAnalysis2.confidence >= 70) ||
          (prevAnalysis3.signal === analysis.signal && prevAnalysis3.confidence >= 70);

        if (!isContinuous) {
          const now = Date.now();
          const signalKey = `${symbol}-${tf}`;
          const lastSent = lastSentSignals[signalKey];
          
          // Check if we should send:
          // 1. Never sent before
          // 2. Direction changed
          // 3. Cooldown period passed
          if (!lastSent || lastSent.direction !== analysis.signal || (now - lastSent.timestamp) > COOLDOWN_MS) {
            lastSentSignals[signalKey] = {
              direction: analysis.signal,
              timestamp: now
            };
            
            const entryPrice = analysis.suggestedEntry || (klines.length > 0 ? klines[klines.length - 1].close : 0);
            const directionEmoji = analysis.signal === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
            const message = `⚡️ <b>ENDELLION TRADE</b> ⚡️\n\n🪙 <b>Pair:</b> #${symbol}\n${analysis.signal === 'LONG' ? '📈' : '📉'} <b>Direction:</b> ${directionEmoji}\n⏱ <b>Timeframe:</b> ${tf}\n\n🎯 <b>Entry:</b> ${(entryPrice || 0).toFixed(4)}\n✅ <b>Take Profit:</b> ${analysis.tp?.toFixed(4) || 'N/A'}\n❌ <b>Stop Loss:</b> ${analysis.sl?.toFixed(4) || 'N/A'}\n\n🧠 <b>Confidence:</b> ${(analysis.confidence || 0).toFixed(1)}%`;

            const bullishImageUrl = "https://quickchart.io/chart?c={type:'line',data:{labels:['1','2','3','4','5','6','7'],datasets:[{label:'Bullish',data:[10,15,13,22,18,28,35],borderColor:'rgb(16,185,129)',backgroundColor:'rgba(16,185,129,0.2)',fill:true}]},options:{legend:{display:false},scales:{xAxes:[{display:false}],yAxes:[{display:false}]}}}";
            const bearishImageUrl = "https://quickchart.io/chart?c={type:'line',data:{labels:['1','2','3','4','5','6','7'],datasets:[{label:'Bearish',data:[35,28,32,20,24,15,10],borderColor:'rgb(244,63,94)',backgroundColor:'rgba(244,63,94,0.2)',fill:true}]},options:{legend:{display:false},scales:{xAxes:[{display:false}],yAxes:[{display:false}]}}}";
            const imageUrl = analysis.signal === 'LONG' ? bullishImageUrl : bearishImageUrl;

            await sendTelegramSignal(botToken, chatId, message, imageUrl);
            break; // ONLY SEND THE BEST ONE PER CYCLE
          }
        }
      }
    } catch (err) {
      console.error('Error in background loop:', err);
    }
  }, 60000); // Check every minute

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
