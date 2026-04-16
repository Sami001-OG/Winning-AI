import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import crypto from "crypto";
import { analyzeChart } from "./src/analysis.ts";
import { getHTFDirection, validateLTFEntry, get1HControlState } from "./src/multiTimeframe.ts";
import { formatPrice } from "./src/utils/format.ts";
import { EMA, MACD, RSI } from "technicalindicators";

function calculatePnL(entry: number, exit: number, direction: 'LONG' | 'SHORT') {
  const pnl = direction === 'LONG' 
    ? ((exit - entry) / entry) * 100 * 10 
    : ((entry - exit) / entry) * 100 * 10;
  return pnl >= 0 ? `+${pnl.toFixed(2)}%` : `${pnl.toFixed(2)}%`;
}
import { Candle, Trade } from "./src/types";

const DEFAULT_RELIABILITY = { ema: 1.5, macd: 1.0, rsi: 1.5, vol: 1.2, obv: 1.2, exception: 2.0 };

function getBinanceSignature(queryString: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

async function binanceFuturesRequest(method: string, endpoint: string, params: Record<string, any> = {}) {
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_SECRET_KEY;
  
  if (!apiKey || !apiSecret) {
    throw new Error('Binance API keys not configured');
  }

  params.timestamp = Date.now();
  params.recvWindow = 10000;
  
  const queryString = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
    
  const signature = getBinanceSignature(queryString, apiSecret);
  const url = `https://fapi.binance.com${endpoint}?${queryString}&signature=${signature}`;
  
  const response = await fetch(url, {
    method,
    headers: {
      'X-MBX-APIKEY': apiKey,
      'Content-Type': 'application/json'
    }
  });
  
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Binance API Error: ${JSON.stringify(data)}`);
  }
  
  return data;
}

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
  
  let response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  
  if (!response.ok && imageUrl) {
    // Fallback to text message if photo fails (e.g. quickchart.io is down)
    url = `https://api.telegram.org/bot${finalToken}/sendMessage`;
    body = {
      chat_id: cleanChatId,
      text: message,
      parse_mode: 'HTML',
    };
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }
  
  return response.ok;
}

async function fetchWithTimeout(url: string, options: any = {}) {
  const timeout = options.timeout || 10000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

const MEME_COINS = new Set([
  'DOGEUSDT', 'SHIBUSDT', '1000SHIBUSDT', 'PEPEUSDT', '1000PEPEUSDT', 
  'FLOKIUSDT', '1000FLOKIUSDT', 'BONKUSDT', '1000BONKUSDT', 'WIFUSDT', 
  'BOMEUSDT', 'MEMEUSDT', 'MYROUSDT', 'POPCATUSDT', 'MEWUSDT', 
  'BRETTUSDT', 'NEIROUSDT', 'PNUTUSDT', 'TURBOUSDT', 'MOGUSDT', 
  'CATIUSDT', 'DOGSUSDT', 'BABYDOGEUSDT', '1MBABYDOGEUSDT',
  'MOODENGUSDT', 'GOATUSDT', 'ACTUSDT', 'PEOPLEUSDT', 'SLERFUSDT',
  'WENUSDT', 'COQUSDT', 'PORKUSDT', 'MUMUUSDT', 'DEGENUSDT', 'TOSHIUSDT',
  'FOXYUSDT', 'PONKEUSDT', 'SUNDOGUSDT', 'HMSTRUSDT', 'CATUSDT', 
  'SIMONCATUSDT', 'HIPPOUSDT', 'PENGUUSDT', 'SATSUSDT', '1000SATSUSDT', 
  'RATSUSDT', 'NOTUSDT'
]);

async function fetchTopSymbols() {
  try {
    const res = await fetchWithTimeout(`https://fapi.binance.com/fapi/v1/ticker/24hr?_t=${Date.now()}`);
    const data = await res.json();
    return data
      .filter((t: any) => 
        t.symbol.endsWith('USDT') && 
        parseFloat(t.volume) > 0 &&
        !t.symbol.includes('UPUSDT') &&
        !t.symbol.includes('DOWNUSDT') &&
        !t.symbol.includes('BULLUSDT') &&
        !t.symbol.includes('BEARUSDT') &&
        !MEME_COINS.has(t.symbol)
      )
      .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 300) // Fetch top 300
      .slice(0, 150) // Upgrade 1: Expanded universe to top 150
      .map((t: any) => t.symbol);
  } catch (e) {
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT'];
  }
}

let rateLimitNotified = false;

async function fetchKlines(symbol: string, tf: string, limit: number = 250) {
  try {
    const res = await fetchWithTimeout(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=${limit}&_t=${Date.now()}`);
    const data = await res.json();
    
    if (!Array.isArray(data)) {
      console.warn(`[Binance API Warning] Expected array for ${symbol} ${tf}, got:`, data);
      if (data && data.code === -1003 && process.env.VITE_TELEGRAM_BOT_TOKEN && process.env.VITE_TELEGRAM_CHAT_ID && !rateLimitNotified) {
         rateLimitNotified = true;
         sendTelegramSignal(process.env.VITE_TELEGRAM_BOT_TOKEN, process.env.VITE_TELEGRAM_CHAT_ID, "⚠️ <b>Binance API Rate Limit Hit!</b>\nScanner is temporarily missing data.").catch(console.error);
         setTimeout(() => { rateLimitNotified = false; }, 3600000); // Reset after 1 hour
      }
      return [];
    }

    return data.map((d: any) => ({
      time: Math.floor(d[0] / 1000),
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5]),
      isFinal: true
    }));
  } catch (error) {
    console.error(`[Binance API Error] Failed to fetch klines for ${symbol} ${tf}:`, error);
    return [];
  }
}


async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

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

  // Proxy endpoints for frontend to bypass CORS/Adblockers
  app.get("/api/proxy/fapi/*", async (req, res) => {
    try {
      const endpoint = req.params[0];
      const query = new URLSearchParams(req.query as any).toString();
      const targetUrl = `https://fapi.binance.com/fapi/${endpoint}${query ? '?' + query : ''}`;
      
      const response = await fetch(targetUrl);
      if (!response.ok) {
        return res.status(response.status).json({ error: `Binance API error: ${response.statusText}` });
      }
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/proxy/api/*", async (req, res) => {
    try {
      const endpoint = req.params[0];
      const query = new URLSearchParams(req.query as any).toString();
      const targetUrl = `https://api.binance.com/api/${endpoint}${query ? '?' + query : ''}`;
      
      const response = await fetch(targetUrl);
      if (!response.ok) {
        return res.status(response.status).json({ error: `Binance API error: ${response.statusText}` });
      }
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  let exchangeInfoCache: any = null;

  app.post("/api/trade/execute", async (req, res) => {
    try {
      const { symbol, side, orderType, price, stopLoss, takeProfit, riskFraction = 1.0 } = req.body;
      
      if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_SECRET_KEY) {
        return res.status(400).json({ error: "Binance API keys not configured in .env" });
      }

      // 1. Fetch Exchange Info (Cached)
      if (!exchangeInfoCache) {
        exchangeInfoCache = await binanceFuturesRequest('GET', '/fapi/v1/exchangeInfo');
      }
      const symbolInfo = exchangeInfoCache.symbols.find((s: any) => s.symbol === symbol);
      if (!symbolInfo) throw new Error(`Symbol ${symbol} not found`);
      
      const qtyPrecision = symbolInfo.quantityPrecision;
      const pricePrecision = symbolInfo.pricePrecision;

      // 2. Risk Calculation Engine
      const accountInfo = await binanceFuturesRequest('GET', '/fapi/v2/account');
      const usdtBalance = accountInfo.assets.find((a: any) => a.asset === 'USDT')?.availableBalance || 0;
      
      const riskPercentage = 0.01 * riskFraction; // 1% risk per trade * fraction
      const riskAmount = parseFloat(usdtBalance) * riskPercentage;
      
      if (riskAmount <= 0) throw new Error("Insufficient balance for risk calculation");
      
      let rawQty = riskAmount / Math.abs(price - stopLoss);
      
      // Apply leverage (e.g., 10x)
      const leverage = 10;
      await binanceFuturesRequest('POST', '/fapi/v1/leverage', { symbol, leverage });
      
      // Format quantity and prices
      const quantity = parseFloat(rawQty.toFixed(qtyPrecision));
      const formattedPrice = parseFloat(price).toFixed(pricePrecision);
      const formattedSL = parseFloat(stopLoss).toFixed(pricePrecision);
      const formattedTP = parseFloat(takeProfit).toFixed(pricePrecision);

      if (quantity <= 0) throw new Error("Calculated quantity is too small");

      // 3. Place Main Order
      const orderParams: any = {
        symbol,
        side,
        type: orderType,
        quantity,
      };
      
      if (orderType === 'LIMIT') {
        orderParams.price = formattedPrice;
        orderParams.timeInForce = 'GTC';
      }
      
      const orderRes = await binanceFuturesRequest('POST', '/fapi/v1/order', orderParams);
      
      // 4. Place Stop Loss
      if (stopLoss) {
        await binanceFuturesRequest('POST', '/fapi/v1/order', {
          symbol,
          side: side === 'BUY' ? 'SELL' : 'BUY',
          type: 'STOP_MARKET',
          stopPrice: formattedSL,
          closePosition: true
        });
      }
      
      // 5. Place Take Profit
      if (takeProfit) {
        await binanceFuturesRequest('POST', '/fapi/v1/order', {
          symbol,
          side: side === 'BUY' ? 'SELL' : 'BUY',
          type: 'TAKE_PROFIT_MARKET',
          stopPrice: formattedTP,
          closePosition: true
        });
      }
      
      res.json({ success: true, order: orderRes, riskAmount, quantity });
    } catch (error: any) {
      console.error('Trade Execution Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Background loop
  const lastSentSignals: Record<string, { direction: string, timestamp: number }> = {};
  const sentSessionNotifications = new Set<string>();
  const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours cooldown
  
  interface ActiveTrade {
    symbol: string;
    direction: 'LONG' | 'SHORT';
    entry: number;
    tp1: number;
    tp2: number;
    tp3: number;
    sl: number;
    achieved: number;
  }
  const activeTrades: Record<string, ActiveTrade> = {};

  const CORRELATION_GROUPS: Record<string, string[]> = {
    'BTC': ['BTCUSDT', 'BCHUSDT', 'STXUSDT', 'ORDIUSDT', 'SATSUSDT'],
    'ETH': ['ETHUSDT', 'ARBUSDT', 'OPUSDT', 'LDOUSDT', 'ETCUSDT', 'ENSUSDT'],
    'AI': ['FETUSDT', 'AGIXUSDT', 'OCEANUSDT', 'RNDRUSDT', 'TAOUSDT', 'WLDUSDT', 'NEARUSDT'],
    'MEME': ['DOGEUSDT', 'SHIBUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'BONKUSDT', 'WIFUSDT', 'BOMEUSDT'],
    'L1': ['SOLUSDT', 'AVAXUSDT', 'ADAUSDT', 'SUIUSDT', 'APTUSDT', 'SEIUSDT', 'INJUSDT', 'DOTUSDT', 'LINKUSDT']
  };

  function getCorrelationGroup(symbol: string): string {
    for (const [group, coins] of Object.entries(CORRELATION_GROUPS)) {
      if (coins.includes(symbol)) return group;
    }
    return symbol; // Treat ungrouped coins as their own group
  }

  let dailySignalCount = 0;
  let currentDay = new Date().getUTCDate();
  const DAILY_LIMIT = 5;

  console.log("Initializing 24/7 Telegram Alert Scanner...");
  let hasLoggedMissingTokens = false;
  let hasSentStartupNotification = false;

  const runBackgroundLoop = async () => {
    const botToken = process.env.VITE_TELEGRAM_BOT_TOKEN;
    const chatId = process.env.VITE_TELEGRAM_CHAT_ID;
    
    if (!botToken || !chatId) {
      if (!hasLoggedMissingTokens) {
        console.log("Telegram Scanner skipped: Missing VITE_TELEGRAM_BOT_TOKEN or VITE_TELEGRAM_CHAT_ID in environment variables.");
        hasLoggedMissingTokens = true;
      }
      setTimeout(runBackgroundLoop, 60000);
      return;
    }
    hasLoggedMissingTokens = false; // Reset if tokens are added later

    if (!hasSentStartupNotification) {
      sendTelegramSignal(
        botToken, 
        chatId, 
        "🚀 <b>Endellion Trade Bot Started</b>\n\nScanner is now active and monitoring markets 24/7."
      ).catch(console.error);
      hasSentStartupNotification = true;
    }

    try {
      // --- Session Notifications ---
      const now = new Date();
      const utcHour = now.getUTCHours();
      const utcMinute = now.getUTCMinutes();
      const dateStr = now.toISOString().split('T')[0];

      const sessions = [
        { name: 'Asian', start: 0, end: 9 },
        { name: 'London', start: 8, end: 17 },
        { name: 'New York', start: 13, end: 22 }
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
            const timeString = `${utcHour.toString().padStart(2, '0')}:${utcMinute.toString().padStart(2, '0')} UTC`;
            await sendTelegramSignal(botToken, chatId, `🌐 <b>MARKET UPDATE</b>\n\n🟢 <b>${session.name} Session</b> is now OPEN.\n⏰ Time: <code>${timeString}</code>`);
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
            const timeString = `${utcHour.toString().padStart(2, '0')}:${utcMinute.toString().padStart(2, '0')} UTC`;
            await sendTelegramSignal(botToken, chatId, `🌐 <b>MARKET UPDATE</b>\n\n🔴 <b>${session.name} Session</b> is now CLOSED.\n⏰ Time: <code>${timeString}</code>`);
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

      // Upgrade 4: Time-of-Day / Volume Weighting
      const currentHour = new Date().getUTCHours();
      const isAsianSession = currentHour >= 21 || currentHour < 8;
      const requiredConfidence = isAsianSession ? 92 : 90;
      const sessionName = isAsianSession ? 'Asian (Low Vol)' : 'London/NY (High Vol)';

      const topSymbols = await fetchTopSymbols();
      const symbols = Array.from(new Set([...topSymbols, ...Object.keys(activeTrades)]));
      const allSignals: any[] = [];

      // Upgrade 1: King Filter (BTC 1H Trend)
      let btcTrend = 'NEUTRAL';
      try {
        const btcKlines1h = await fetchKlines('BTCUSDT', '1h');
        if (btcKlines1h.length >= 50) {
          const btcCloses = btcKlines1h.map(k => k.close);
          const btcEma20 = EMA.calculate({ values: btcCloses, period: 20 });
          const btcEma50 = EMA.calculate({ values: btcCloses, period: 50 });
          const lastBtcEma20 = btcEma20[btcEma20.length - 1];
          const lastBtcEma50 = btcEma50[btcEma50.length - 1];
          btcTrend = lastBtcEma20 > lastBtcEma50 ? 'LONG' : (lastBtcEma20 < lastBtcEma50 ? 'SHORT' : 'NEUTRAL');
        }
      } catch (e) {
        console.error("Failed to fetch BTC 1H trend for King Filter:", e);
      }

      // Process in batches of 10 to respect rate limits while completing faster
      const BATCH_SIZE = 10;
      for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
        const batch = symbols.slice(i, i + BATCH_SIZE);
        
        for (const symbol of batch) {
          try {
            // 1. Fetch 3M for active trade monitoring and sniper entry
            const klines3m = await fetchKlines(symbol, '3m');
            await new Promise(resolve => setTimeout(resolve, 100)); // Delay between requests
            
            // --- ACTIVE TRADE MONITORING (24/7) ---
            const activeTrade = activeTrades[symbol];
            let tradeClosed = false;
            if (activeTrade && klines3m.length > 0) {
              // Check the last 3 candles to ensure we don't miss a quick wick
              const recentCandles = klines3m.slice(-3);
              
              for (const candle of recentCandles) {
                if (tradeClosed) break;
                
                const currentHigh = candle.high;
                const currentLow = candle.low;
                const currentClose = candle.close;
                
                // Soft Exit Logic (Momentum Reversal)
                let softExit = false;
                let softExitReason = '';
                try {
                  const klines15mForExit = await fetchKlines(symbol, '15m');
                  await new Promise(resolve => setTimeout(resolve, 100));
                  if (klines15mForExit.length >= 30) {
                    const closes15m = klines15mForExit.map(k => k.close);
                    const macd15m = MACD.calculate({ values: closes15m, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
                    const rsi15m = RSI.calculate({ values: closes15m, period: 14 });
                    
                    if (macd15m.length >= 2 && rsi15m.length >= 1) {
                      const lastMacd = macd15m[macd15m.length - 1];
                      const prevMacd = macd15m[macd15m.length - 2];
                      const lastRsi = rsi15m[rsi15m.length - 1];
                      
                      const avgVol = klines15mForExit.slice(-10).reduce((sum, c) => sum + c.volume, 0) / 10;
                      const lastVol = klines15mForExit[klines15mForExit.length - 1].volume;
                      const lossOfVolume = lastVol < avgVol * 0.8;

                      if (activeTrade.direction === 'LONG') {
                        const macdFading = (lastMacd.histogram || 0) < (prevMacd.histogram || 0) && (lastMacd.histogram || 0) < 0;
                        const rsiLeavingTrend = lastRsi < 45;
                        if (macdFading && rsiLeavingTrend && lossOfVolume) {
                          softExit = true;
                          softExitReason = 'Momentum Reversed (MACD Fading, RSI < 45, Volume Dropping)';
                        }
                      } else if (activeTrade.direction === 'SHORT') {
                        const macdFading = (lastMacd.histogram || 0) > (prevMacd.histogram || 0) && (lastMacd.histogram || 0) > 0;
                        const rsiLeavingTrend = lastRsi > 55;
                        if (macdFading && rsiLeavingTrend && lossOfVolume) {
                          softExit = true;
                          softExitReason = 'Momentum Reversed (MACD Fading, RSI > 55, Volume Dropping)';
                        }
                      }
                    }
                  }
                } catch (e) {
                  console.error(`Failed to check soft exit for ${symbol}:`, e);
                }

                if (softExit) {
                  console.log(`[DEBUG] Soft Exit for ${symbol}: ${softExitReason}`);
                  await sendTelegramSignal(botToken, chatId, `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n${activeTrade.direction === 'LONG' ? '📈' : '📉'} <b>Direction:</b> ${activeTrade.direction}\n⚠️ <b>Status:</b> Soft Exit Triggered at <code>${formatPrice(currentClose)}</code>\n🧠 <b>Reason:</b> ${softExitReason}\n💰 <b>PnL:</b> ${calculatePnL(activeTrade.entry, currentClose, activeTrade.direction)}`);
                  delete activeTrades[symbol];
                  tradeClosed = true;
                  break;
                }

                if (activeTrade.direction === 'LONG') {
                  if (currentLow <= activeTrade.sl) {
                    console.log(`[DEBUG] SL Hit for ${symbol}: Low ${currentLow}, SL ${activeTrade.sl}, Achieved: ${activeTrade.achieved}`);
                    await sendTelegramSignal(botToken, chatId, `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📈 <b>Direction:</b> LONG\n❌ <b>Status:</b> Stop Loss Hit at <code>${formatPrice(currentLow)}</code> (PnL: ${calculatePnL(activeTrade.entry, activeTrade.sl, 'LONG')})`);
                    delete activeTrades[symbol];
                    tradeClosed = true;
                  } else if (activeTrade.achieved < 3 && currentHigh >= activeTrade.tp3) {
                    await sendTelegramSignal(botToken, chatId, `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📈 <b>Direction:</b> LONG\n✅ <b>Status:</b> TP3 Achieved (🎯 ${formatPrice(activeTrade.tp3)}) (PnL: ${calculatePnL(activeTrade.entry, activeTrade.tp3, 'LONG')})`);
                    delete activeTrades[symbol];
                    tradeClosed = true;
                  } else if (activeTrade.achieved < 2 && currentHigh >= activeTrade.tp2) {
                    await sendTelegramSignal(botToken, chatId, `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📈 <b>Direction:</b> LONG\n✅ <b>Status:</b> TP2 Achieved (🎯 ${formatPrice(activeTrade.tp2)}) (PnL: ${calculatePnL(activeTrade.entry, activeTrade.tp2, 'LONG')})`);
                    activeTrade.achieved = 2;
                  } else if (activeTrade.achieved < 1 && currentHigh >= activeTrade.tp1) {
                    await sendTelegramSignal(botToken, chatId, `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📈 <b>Direction:</b> LONG\n✅ <b>Status:</b> TP1 Achieved (🎯 ${formatPrice(activeTrade.tp1)}) (PnL: ${calculatePnL(activeTrade.entry, activeTrade.tp1, 'LONG')})`);
                    activeTrade.achieved = 1;
                  }
                } else if (activeTrade.direction === 'SHORT') {
                  if (currentHigh >= activeTrade.sl) {
                    console.log(`[DEBUG] SL Hit for ${symbol}: High ${currentHigh}, SL ${activeTrade.sl}, Achieved: ${activeTrade.achieved}`);
                    await sendTelegramSignal(botToken, chatId, `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📉 <b>Direction:</b> SHORT\n❌ <b>Status:</b> Stop Loss Hit at <code>${formatPrice(currentHigh)}</code> (PnL: ${calculatePnL(activeTrade.entry, activeTrade.sl, 'SHORT')})`);
                    delete activeTrades[symbol];
                    tradeClosed = true;
                  } else if (activeTrade.achieved < 3 && currentLow <= activeTrade.tp3) {
                    await sendTelegramSignal(botToken, chatId, `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📉 <b>Direction:</b> SHORT\n✅ <b>Status:</b> TP3 Achieved (🎯 ${formatPrice(activeTrade.tp3)}) (PnL: ${calculatePnL(activeTrade.entry, activeTrade.tp3, 'SHORT')})`);
                    delete activeTrades[symbol];
                    tradeClosed = true;
                  } else if (activeTrade.achieved < 2 && currentLow <= activeTrade.tp2) {
                    await sendTelegramSignal(botToken, chatId, `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📉 <b>Direction:</b> SHORT\n✅ <b>Status:</b> TP2 Achieved (🎯 ${formatPrice(activeTrade.tp2)}) (PnL: ${calculatePnL(activeTrade.entry, activeTrade.tp2, 'SHORT')})`);
                    activeTrade.achieved = 2;
                  } else if (activeTrade.achieved < 1 && currentLow <= activeTrade.tp1) {
                    await sendTelegramSignal(botToken, chatId, `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📉 <b>Direction:</b> SHORT\n✅ <b>Status:</b> TP1 Achieved (🎯 ${formatPrice(activeTrade.tp1)}) (PnL: ${calculatePnL(activeTrade.entry, activeTrade.tp1, 'SHORT')})`);
                    activeTrade.achieved = 1;
                  }
                }
              }
            }
            if (tradeClosed) continue; // Skip generating new signals if it just closed
            // --- END ACTIVE TRADE MONITORING ---

            // 2. 4H Bias Alignment
            const klines4h = await fetchKlines(symbol, '4h');
            await new Promise(resolve => setTimeout(resolve, 100)); // Delay between requests
            const htfDirection = getHTFDirection(klines4h);
            if (htfDirection === 'NEUTRAL') continue;

            // 2.5 1H Control Layer (Veto Filter)
            const klines1h = await fetchKlines(symbol, '1h');
            await new Promise(resolve => setTimeout(resolve, 100));
            const control1H = get1HControlState(klines1h, htfDirection);
            if (control1H.state === 'VETO') continue;

            // 3. 15M Confirmation (Confidence/Setup)
            const klines15m = await fetchKlines(symbol, '15m');
            await new Promise(resolve => setTimeout(resolve, 100)); // Delay between requests
            const mtfAnalysis = analyzeChart(klines15m, DEFAULT_RELIABILITY, [], symbol);
            if (mtfAnalysis.signal === 'NO TRADE' || htfDirection !== mtfAnalysis.signal) continue;

            // Upgrade 1: King Filter Application
            if (symbol !== 'BTCUSDT') {
              // Altcoin LONG allowed only if BTC not bearish (LONG or NEUTRAL)
              if (mtfAnalysis.signal === 'LONG' && btcTrend === 'SHORT') continue;
              // Altcoin SHORT allowed only if BTC weak (SHORT)
              if (mtfAnalysis.signal === 'SHORT' && btcTrend !== 'SHORT') continue;
            }

            // 4. 3M Entry (already fetched klines3m)
            const ltfValidation = validateLTFEntry(klines3m, mtfAnalysis.signal as 'LONG' | 'SHORT');
            if (!ltfValidation.isValid) continue;

            // Upgrade 3: VWAP & Liquidity Sniping (Limit Entry)
            const closes3m = klines3m.map(k => k.close);
            const ema20_3m = EMA.calculate({ values: closes3m, period: 20 });
            const lastEma20_3m = ema20_3m[ema20_3m.length - 1] || closes3m[closes3m.length - 1];
            
            let cumulativeTypicalVolume = 0;
            let cumulativeVolume = 0;
            // Calculate rolling VWAP over last 100 3m candles (5 hours)
            for (const candle of klines3m.slice(-100)) {
              const typicalPrice = (candle.high + candle.low + candle.close) / 3;
              cumulativeTypicalVolume += typicalPrice * candle.volume;
              cumulativeVolume += candle.volume;
            }
            const vwap3m = cumulativeVolume > 0 ? cumulativeTypicalVolume / cumulativeVolume : closes3m[closes3m.length - 1];

            if (mtfAnalysis.signal === 'LONG') {
              mtfAnalysis.limitEntry = Math.min(lastEma20_3m, vwap3m);
            } else {
              mtfAnalysis.limitEntry = Math.max(lastEma20_3m, vwap3m);
            }
            mtfAnalysis.entryStrategy = 'Limit (3M VWAP/EMA20 Pullback)';

            // Premium Upgrades: OI and Funding Rate
            let premiumLogicStr = '';
            try {
              if (control1H.state === 'CONTINUATION') {
                const oiRes = await fetchWithTimeout(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=15m&limit=2`);
                const oiData = await oiRes.json();
                if (Array.isArray(oiData) && oiData.length === 2) {
                  const prev = parseFloat(oiData[0].sumOpenInterestValue);
                  const curr = parseFloat(oiData[1].sumOpenInterestValue);
                  if (prev > 0) {
                    const oiChange = (curr - prev) / prev;
                    if (oiChange > 0.001) { // > 0.1% increase in 15m
                      mtfAnalysis.confidence += 10;
                      premiumLogicStr += `\n• 🔥 Trend Fuel: OI Rising (+10% Confidence)`;
                    }
                  }
                }
              } else if (control1H.state === 'EXHAUSTION') {
                const frRes = await fetchWithTimeout(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
                const frData = await frRes.json();
                const fundingRate = parseFloat(frData.lastFundingRate);
                
                if (mtfAnalysis.signal === 'LONG' && fundingRate < -0.0001) {
                  mtfAnalysis.confidence += 15;
                  premiumLogicStr += `\n• 💥 Squeeze Hunter: Negative Funding Rate (+15% Confidence)`;
                } else if (mtfAnalysis.signal === 'SHORT' && fundingRate > 0.0005) {
                  mtfAnalysis.confidence += 15;
                  premiumLogicStr += `\n• 💥 Squeeze Hunter: High Positive Funding Rate (+15% Confidence)`;
                }
              }
            } catch (e) {
              console.error(`Failed to fetch premium data for ${symbol}:`, e);
            }
            (mtfAnalysis as any).premiumLogicStr = premiumLogicStr;
            
            // Cap confidence at 100 after premium upgrades
            mtfAnalysis.confidence = Math.min(100, mtfAnalysis.confidence);

            // 5. Combine and Send
            if (mtfAnalysis.confidence >= requiredConfidence) {
              const now = Date.now();
              const signalKey = `${symbol}-Multi-TF (4h, 15m, 3m)`;
              const lastSent = lastSentSignals[signalKey];
              
              if (!lastSent || lastSent.direction !== mtfAnalysis.signal || (now - lastSent.timestamp) > COOLDOWN_MS) {
                const entryPrice = klines3m.length > 0 ? klines3m[klines3m.length - 1].close : 0;
                const tp1 = mtfAnalysis.tp1 || 0;
                const tp2 = mtfAnalysis.tp2 || 0;
                const tp3 = mtfAnalysis.tp3 || mtfAnalysis.tp || 0;
                const sl = mtfAnalysis.sl || 0;

                // --- STALE SIGNAL PREVENTION ---
                // If the current 3m price has already hit TP1 or SL (calculated from 15m), it's a stale signal.
                let isStale = false;
                
                // 1. Current Price Check & R:R Check
                const risk = Math.abs(entryPrice - sl);
                const rewardToTp1 = Math.abs(tp1 - entryPrice);

                if (mtfAnalysis.signal === 'LONG') {
                  if (entryPrice >= tp1 || entryPrice <= sl) isStale = true;
                  if (rewardToTp1 < risk * 0.5) isStale = true; // Price already moved too far up
                } else if (mtfAnalysis.signal === 'SHORT') {
                  if (entryPrice <= tp1 || entryPrice >= sl) isStale = true;
                  if (rewardToTp1 < risk * 0.5) isStale = true; // Price already moved too far down
                }

                // 2. Extended Wick Check (Last 45 minutes)
                // If the price has already wicked to TP1 or SL recently, the move is over.
                const recentCandles = klines3m.slice(-15);
                for (const c of recentCandles) {
                  if (mtfAnalysis.signal === 'LONG') {
                    if (c.high >= tp1 || c.low <= sl) isStale = true;
                  } else if (mtfAnalysis.signal === 'SHORT') {
                    if (c.low <= tp1 || c.high >= sl) isStale = true;
                  }
                }

                if (isStale) {
                  console.log(`Skipped stale signal for ${symbol} (${mtfAnalysis.signal}). Entry: ${entryPrice}, TP1: ${tp1}, SL: ${sl}`);
                  continue;
                }
                // -------------------------------

                allSignals.push({
                  symbol,
                  signalKey,
                  analysis: mtfAnalysis,
                  entryPrice,
                  tp1, tp2, tp3, sl,
                  control1H,
                  sessionName
                });
              }
            }
          } catch (err) {
            console.error(`Error processing symbol ${symbol} in background loop:`, err);
          }
        }
        
        // Delay between batches to respect Binance API rate limits (2400 weight/minute)
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // --- SIGNAL FILTERING & SENDING ---
      if (allSignals.length > 0) {
        // 1. Dynamic Threshold: if too many signals, raise threshold
        if (allSignals.length > 3) {
           allSignals.sort((a, b) => b.analysis.confidence - a.analysis.confidence);
           allSignals.splice(3); // Keep only top 3
        }

        // 2. Correlation Grouping
        const groupBestSignal = new Map<string, any>();
        for (const sig of allSignals) {
           const group = getCorrelationGroup(sig.symbol);
           if (!groupBestSignal.has(group) || groupBestSignal.get(group).analysis.confidence < sig.analysis.confidence) {
               groupBestSignal.set(group, sig);
           }
        }

        const finalSignals = Array.from(groupBestSignal.values());

        // 3. Daily Limit & Send
        const nowDay = new Date().getUTCDate();
        if (nowDay !== currentDay) {
          dailySignalCount = 0;
          currentDay = nowDay;
        }

        for (const sig of finalSignals) {
           if (dailySignalCount >= DAILY_LIMIT) {
               console.log(`Daily limit reached (${DAILY_LIMIT}). Skipping signal for ${sig.symbol}`);
               continue;
           }

           const now = Date.now();
           lastSentSignals[sig.signalKey] = {
             direction: sig.analysis.signal,
             timestamp: now
           };

           activeTrades[sig.symbol] = {
             symbol: sig.symbol,
             direction: sig.analysis.signal as 'LONG' | 'SHORT',
             entry: sig.entryPrice,
             tp1: sig.tp1, tp2: sig.tp2, tp3: sig.tp3, sl: sig.sl,
             achieved: 0
           };

           const directionEmoji = sig.analysis.signal === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
           const limitEntryStr = sig.analysis.limitEntry ? `\n⏳ Limit (Pullback): ${formatPrice(sig.analysis.limitEntry)}` : '';
           const strategyStr = sig.analysis.entryStrategy ? `\n\n📝 Strategy: ${sig.analysis.entryStrategy}` : '';
           
           const logicStr = sig.analysis.indicators
             .filter((i: any) => i.signal === (sig.analysis.signal === 'LONG' ? 'bullish' : 'bearish'))
             .map((i: any) => `• ${i.name}: ${i.description}`)
             .join('\n') + ((sig.analysis as any).premiumLogicStr || '');

           const message = `⚡️ <b>ENDELLION TRADE</b> ⚡️

🪙 <b>Pair:</b> #${sig.symbol}
${directionEmoji} <b>Direction:</b> ${sig.analysis.signal}
⏱ <b>Timeframe:</b> Multi-TF (4h, 1h, 15m, 3m)${strategyStr}
🛡 <b>1H State:</b> ${sig.control1H.state} (${sig.control1H.reason})
👑 <b>BTC Trend:</b> ${btcTrend}
🕒 <b>Session:</b> ${sig.sessionName}

🎯 <b>Entry:</b> <code>${formatPrice(sig.entryPrice)}</code>${limitEntryStr}
✅ <b>TP1:</b> <code>${formatPrice(sig.tp1)}</code>
✅ <b>TP2:</b> <code>${formatPrice(sig.tp2)}</code>
✅ <b>TP3:</b> <code>${formatPrice(sig.tp3)}</code> (Trail Stop)
❌ <b>Stop Loss:</b> <code>${formatPrice(sig.sl)}</code>

🧠 <b>Confidence:</b> <code>${(sig.analysis.confidence || 0).toFixed(1)}%</code>

💡 <b>Logic:</b>
${logicStr}`;

           const bullishImageUrl = "https://quickchart.io/chart?c={type:'line',data:{labels:['1','2','3','4','5','6','7'],datasets:[{label:'Bullish',data:[10,15,13,22,18,28,35],borderColor:'rgb(16,185,129)',backgroundColor:'rgba(16,185,129,0.2)',fill:true}]},options:{legend:{display:false},scales:{xAxes:[{display:false}],yAxes:[{display:false}]}}}";
           const bearishImageUrl = "https://quickchart.io/chart?c={type:'line',data:{labels:['1','2','3','4','5','6','7'],datasets:[{label:'Bearish',data:[35,28,32,20,24,15,10],borderColor:'rgb(244,63,94)',backgroundColor:'rgba(244,63,94,0.2)',fill:true}]},options:{legend:{display:false},scales:{xAxes:[{display:false}],yAxes:[{display:false}]}}}";
           const imageUrl = sig.analysis.signal === 'LONG' ? bullishImageUrl : bearishImageUrl;

           await sendTelegramSignal(botToken, chatId, message, imageUrl);
           dailySignalCount++;
        }
      }

    } catch (err) {
      console.error('Error in background loop:', err);
    } finally {
      setTimeout(runBackgroundLoop, 60000); // Check every minute
    }
  };
  runBackgroundLoop();

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
