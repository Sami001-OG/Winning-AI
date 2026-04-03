import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import crypto from "crypto";
import { analyzeChart } from "./src/analysis";
import { getHTFDirection, validateLTFEntry } from "./src/multiTimeframe";
import { formatPrice } from "./src/utils/format";

function calculatePnL(entry: number, exit: number, direction: 'LONG' | 'SHORT') {
  const pnl = direction === 'LONG' 
    ? ((exit - entry) / entry) * 100 * 10 
    : ((entry - exit) / entry) * 100 * 10;
  return pnl >= 0 ? `+${pnl.toFixed(2)}%` : `${pnl.toFixed(2)}%`;
}
import { Candle, Trade } from "./src/types";

const DEFAULT_RELIABILITY = { ema: 1.5, macd: 0.2, rsi: 1.5, vol: 1.2, obv: 1.2, exception: 2.0 };

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
        !t.symbol.includes('BEARUSDT')
      )
      .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 300) // Fetch top 300
      .slice(0, 100) // Filter to top 100
      .map((t: any) => t.symbol);
  } catch (e) {
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT'];
  }
}

let rateLimitNotified = false;

async function fetchKlines(symbol: string, tf: string) {
  try {
    const res = await fetchWithTimeout(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=1000&_t=${Date.now()}`);
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

      const symbols = await fetchTopSymbols();
      const allSignals: any[] = [];

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
            if (activeTrade && klines3m.length > 0) {
              const currentCandle = klines3m[klines3m.length - 1];
              const currentHigh = currentCandle.high;
              const currentLow = currentCandle.low;
              
              if (activeTrade.direction === 'LONG') {
                if (currentLow <= activeTrade.sl) {
                  await sendTelegramSignal(botToken, chatId, `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📈 <b>Direction:</b> LONG\n❌ <b>Status:</b> Stop Loss Hit at <code>${formatPrice(currentLow)}</code> (PnL: ${calculatePnL(activeTrade.entry, currentLow, 'LONG')})`);
                  delete activeTrades[symbol];
                } else if (activeTrade.achieved < 3 && currentHigh >= activeTrade.tp3) {
                  await sendTelegramSignal(botToken, chatId, `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📈 <b>Direction:</b> LONG\n✅ <b>Status:</b> TP3 Achieved (🎯 ${formatPrice(activeTrade.tp3)}) (PnL: ${calculatePnL(activeTrade.entry, activeTrade.tp3, 'LONG')})`);
                  delete activeTrades[symbol];
                } else if (activeTrade.achieved < 2 && currentHigh >= activeTrade.tp2) {
                  await sendTelegramSignal(botToken, chatId, `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📈 <b>Direction:</b> LONG\n✅ <b>Status:</b> TP2 Achieved (🎯 ${formatPrice(activeTrade.tp2)}) (PnL: ${calculatePnL(activeTrade.entry, activeTrade.tp2, 'LONG')})`);
                  activeTrade.achieved = 2;
                } else if (activeTrade.achieved < 1 && currentHigh >= activeTrade.tp1) {
                  await sendTelegramSignal(botToken, chatId, `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📈 <b>Direction:</b> LONG\n✅ <b>Status:</b> TP1 Achieved (🎯 ${formatPrice(activeTrade.tp1)}) (PnL: ${calculatePnL(activeTrade.entry, activeTrade.tp1, 'LONG')})`);
                  activeTrade.achieved = 1;
                }
              } else if (activeTrade.direction === 'SHORT') {
                if (currentHigh >= activeTrade.sl) {
                  await sendTelegramSignal(botToken, chatId, `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📉 <b>Direction:</b> SHORT\n❌ <b>Status:</b> Stop Loss Hit at <code>${formatPrice(currentHigh)}</code> (PnL: ${calculatePnL(activeTrade.entry, currentHigh, 'SHORT')})`);
                  delete activeTrades[symbol];
                } else if (activeTrade.achieved < 3 && currentLow <= activeTrade.tp3) {
                  await sendTelegramSignal(botToken, chatId, `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📉 <b>Direction:</b> SHORT\n✅ <b>Status:</b> TP3 Achieved (🎯 ${formatPrice(activeTrade.tp3)}) (PnL: ${calculatePnL(activeTrade.entry, activeTrade.tp3, 'SHORT')})`);
                  delete activeTrades[symbol];
                } else if (activeTrade.achieved < 2 && currentLow <= activeTrade.tp2) {
                  await sendTelegramSignal(botToken, chatId, `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📉 <b>Direction:</b> SHORT\n✅ <b>Status:</b> TP2 Achieved (🎯 ${formatPrice(activeTrade.tp2)}) (PnL: ${calculatePnL(activeTrade.entry, activeTrade.tp2, 'SHORT')})`);
                  activeTrade.achieved = 2;
                } else if (activeTrade.achieved < 1 && currentLow <= activeTrade.tp1) {
                  await sendTelegramSignal(botToken, chatId, `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📉 <b>Direction:</b> SHORT\n✅ <b>Status:</b> TP1 Achieved (🎯 ${formatPrice(activeTrade.tp1)}) (PnL: ${calculatePnL(activeTrade.entry, activeTrade.tp1, 'SHORT')})`);
                  activeTrade.achieved = 1;
                }
              }
            }
            // --- END ACTIVE TRADE MONITORING ---

            // 2. 4H Bias Alignment
            const klines4h = await fetchKlines(symbol, '4h');
            await new Promise(resolve => setTimeout(resolve, 100)); // Delay between requests
            const htfDirection = getHTFDirection(klines4h);
            if (htfDirection === 'NEUTRAL') continue;

            // 3. 15M Confirmation (Confidence/Setup)
            const klines15m = await fetchKlines(symbol, '15m');
            await new Promise(resolve => setTimeout(resolve, 100)); // Delay between requests
            const mtfAnalysis = analyzeChart(klines15m, DEFAULT_RELIABILITY, [], symbol);
            if (mtfAnalysis.signal === 'NO TRADE' || htfDirection !== mtfAnalysis.signal) continue;

            // 4. 3M Entry (already fetched klines3m)
            const ltfValidation = validateLTFEntry(klines3m, mtfAnalysis.signal as 'LONG' | 'SHORT');
            if (!ltfValidation.isValid) continue;

            // 5. Combine and Send
            if (mtfAnalysis.confidence >= 85) {
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

                lastSentSignals[signalKey] = {
                  direction: mtfAnalysis.signal,
                  timestamp: now
                };

                activeTrades[symbol] = {
                  symbol,
                  direction: mtfAnalysis.signal as 'LONG' | 'SHORT',
                  entry: entryPrice,
                  tp1, tp2, tp3, sl,
                  achieved: 0
                };

                const directionEmoji = mtfAnalysis.signal === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
                const limitEntryStr = mtfAnalysis.limitEntry ? `\n⏳ Limit (Pullback): ${formatPrice(mtfAnalysis.limitEntry)}` : '';
                const strategyStr = mtfAnalysis.entryStrategy ? `\n\n📝 Strategy: ${mtfAnalysis.entryStrategy}` : '';
                
                const logicStr = mtfAnalysis.indicators
                  .filter(i => i.signal === (mtfAnalysis.signal === 'LONG' ? 'bullish' : 'bearish'))
                  .map(i => `• ${i.name}: ${i.description}`)
                  .join('\n');

                const message = `⚡️ <b>ENDELLION TRADE</b> ⚡️

🪙 <b>Pair:</b> #${symbol}
${directionEmoji} <b>Direction:</b> ${mtfAnalysis.signal}
⏱ <b>Timeframe:</b> Multi-TF (4h, 15m, 3m)${strategyStr}

🎯 <b>Entry:</b> <code>${formatPrice(entryPrice)}</code>${limitEntryStr}
✅ <b>TP1:</b> <code>${formatPrice(tp1)}</code>
✅ <b>TP2:</b> <code>${formatPrice(tp2)}</code>
✅ <b>TP3:</b> <code>${formatPrice(tp3)}</code> (Trail Stop)
❌ <b>Stop Loss:</b> <code>${formatPrice(sl)}</code>

🧠 <b>Confidence:</b> <code>${(mtfAnalysis.confidence || 0).toFixed(1)}%</code>

💡 <b>Logic:</b>
${logicStr}`;

                const bullishImageUrl = "https://quickchart.io/chart?c={type:'line',data:{labels:['1','2','3','4','5','6','7'],datasets:[{label:'Bullish',data:[10,15,13,22,18,28,35],borderColor:'rgb(16,185,129)',backgroundColor:'rgba(16,185,129,0.2)',fill:true}]},options:{legend:{display:false},scales:{xAxes:[{display:false}],yAxes:[{display:false}]}}}";
                const bearishImageUrl = "https://quickchart.io/chart?c={type:'line',data:{labels:['1','2','3','4','5','6','7'],datasets:[{label:'Bearish',data:[35,28,32,20,24,15,10],borderColor:'rgb(244,63,94)',backgroundColor:'rgba(244,63,94,0.2)',fill:true}]},options:{legend:{display:false},scales:{xAxes:[{display:false}],yAxes:[{display:false}]}}}";
                const imageUrl = mtfAnalysis.signal === 'LONG' ? bullishImageUrl : bearishImageUrl;

                await sendTelegramSignal(botToken, chatId, message, imageUrl);
              }
            }
          } catch (err) {
            console.error(`Error processing symbol ${symbol} in background loop:`, err);
          }
        }
        
        // Delay between batches to respect Binance API rate limits (2400 weight/minute)
        await new Promise(resolve => setTimeout(resolve, 500));
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
