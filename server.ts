import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { analyzeChart } from "./src/analysis";
import { Candle, Trade } from "./src/types";

const DEFAULT_RELIABILITY = { ema: 1, macd: 1, rsi: 1, stoch: 1, cci: 1, vol: 1, obv: 1 };

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
  setInterval(async () => {
    const botToken = process.env.VITE_TELEGRAM_BOT_TOKEN;
    const chatId = process.env.VITE_TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return;

    const symbols = await fetchTopSymbols();
    for (const symbol of symbols) {
      const klines = await fetchKlines(symbol, '15m');
      const analysis = analyzeChart(klines, DEFAULT_RELIABILITY, [], symbol);
      
      if (analysis.signal !== 'NO TRADE' && analysis.confidence > 75) {
        const message = `
<b>Symbol :</b> ${symbol}
<b>Trade Direction :</b> ${analysis.signal === 'LONG' ? 'Long' : 'Short'}
<b>TP :</b> ${analysis.tp?.toFixed(4)}
<b>SL :</b> ${analysis.sl?.toFixed(4)}
<b>Confidence :</b> ${analysis.confidence.toFixed(1)}%
<b>Time Frame :</b> 15m
        `.trim();
        await sendTelegramSignal(botToken, chatId, message);
      }
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
