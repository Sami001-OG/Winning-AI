import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { analyzeChart } from "./src/analysis";
import { Candle, Trade } from "./src/types";

const DEFAULT_RELIABILITY = { ema: 1.5, macd: 0.5, rsi: 1.5, stoch: 0.5, cci: 0.25, vol: 1.2, obv: 1.2, exception: 2.0 };

async function sendTelegramSignal(botToken: string, chatId: string, message: string) {
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

  const url = `https://api.telegram.org/bot${finalToken}/sendMessage`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: cleanChatId,
      text: message,
      parse_mode: 'HTML',
    }),
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
      .slice(0, 30)
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

function isNYSession(): boolean {
  const now = new Date();
  const nyTimeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }).format(now);

  const hour = parseInt(nyTimeStr, 10);
  return !isNaN(hour) && hour >= 8 && hour < 17;
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
  const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours cooldown

  setInterval(async () => {
    const botToken = process.env.VITE_TELEGRAM_BOT_TOKEN;
    const chatId = process.env.VITE_TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return;

    try {
      if (!isNYSession()) return; // Only send during NY session

      const symbols = await fetchTopSymbols();
      const timeframes = ['15m', '1h', '4h', '1d'];

      for (const symbol of symbols) {
        for (const tf of timeframes) {
          try {
            const klines = await fetchKlines(symbol, tf);
            const analysis = analyzeChart(klines, DEFAULT_RELIABILITY, [], symbol);
            
            if (analysis.signal !== 'NO TRADE' && analysis.confidence >= 85) {
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
                
                const entryPrice = analysis.suggestedEntry || klines[klines.length - 1].close;

                const message = `Symbol : ${symbol}
Trade Direction : ${analysis.signal === 'LONG' ? 'Long' : 'Short'}
Entry : ${entryPrice.toFixed(4)}
TP : ${analysis.tp?.toFixed(4)}
SL : ${analysis.sl?.toFixed(4)}
Confidence : ${analysis.confidence.toFixed(1)}%
Time Frame : ${tf}`;

                await sendTelegramSignal(botToken, chatId, message);
              }
            }
          } catch (err) {
            console.error(`Error processing symbol ${symbol} on ${tf} in background loop:`, err);
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
