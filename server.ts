import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import crypto from "crypto";
import { analyzeChart } from "./src/analysis.ts";
import {
  getHTFDirection,
  validateLTFEntry,
  get1HControlState,
} from "./src/multiTimeframe.ts";
import { formatPrice } from "./src/utils/format.ts";
import { EMA, MACD, RSI } from "technicalindicators";

function calculatePnL(
  entry: number,
  exit: number,
  direction: "LONG" | "SHORT",
) {
  const pnl =
    direction === "LONG"
      ? ((exit - entry) / entry) * 100 * 10
      : ((entry - exit) / entry) * 100 * 10;
  return pnl >= 0 ? `+${pnl.toFixed(2)}%` : `${pnl.toFixed(2)}%`;
}
import { Candle, Trade } from "./src/types";

const DEFAULT_RELIABILITY = {
  ema: 1.5,
  macd: 1.0,
  rsi: 1.5,
  vol: 1.2,
  obv: 1.2,
  exception: 2.0,
};

function getBinanceSignature(queryString: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(queryString).digest("hex");
}

function getRotatingKeys() {
  const keys: {key: string, secret: string}[] = [];
  
  if (process.env.BINANCE_API_KEY && process.env.BINANCE_SECRET_KEY) {
    keys.push({ key: process.env.BINANCE_API_KEY, secret: process.env.BINANCE_SECRET_KEY });
  }
  if (process.env.BINANCE_API_KEY_2 && process.env.BINANCE_SECRET_KEY_2) {
    keys.push({ key: process.env.BINANCE_API_KEY_2, secret: process.env.BINANCE_SECRET_KEY_2 });
  }
  if (process.env.BINANCE_API_KEY_3 && process.env.BINANCE_SECRET_KEY_3) {
    keys.push({ key: process.env.BINANCE_API_KEY_3, secret: process.env.BINANCE_SECRET_KEY_3 });
  }

  if (keys.length === 0) {
    return null;
  }
  
  const randomIndex = Math.floor(Math.random() * keys.length);
  return keys[randomIndex];
}

async function binanceFuturesRequest(
  method: string,
  endpoint: string,
  params: Record<string, any> = {},
) {
  const credentials = getRotatingKeys();
  if (!credentials) {
    throw new Error("Binance API keys not configured. Set BINANCE_API_KEY and BINANCE_SECRET_KEY or use 2/3 suffixes.");
  }
  
  const { key: apiKey, secret: apiSecret } = credentials;

  params.timestamp = Date.now();
  params.recvWindow = 10000;

  const queryString = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  const signature = getBinanceSignature(queryString, apiSecret);
  const url = `https://fapi.binance.com${endpoint}?${queryString}&signature=${signature}`;

  const response = await fetch(url, {
    method,
    headers: {
      "X-MBX-APIKEY": apiKey,
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Binance API Error: ${JSON.stringify(data)}`);
  }

  return data;
}

async function sendTelegramSignal(
  botToken: string,
  chatId: string,
  message: string,
  imageUrl?: string,
  retries = 15
) {
  if (!botToken || !chatId) return false;

  const cleanToken = botToken.replace(/^["']|["']$/g, "").trim();
  let cleanChatId = chatId.replace(/^["']|["']$/g, "").trim();

  if (cleanChatId.includes("t.me/")) {
    cleanChatId = cleanChatId.split("t.me/")[1].split("/")[0].split("?")[0];
  }

  if (!/^-?\d+$/.test(cleanChatId) && !cleanChatId.startsWith("@")) {
    cleanChatId = "@" + cleanChatId;
  }

  const finalToken = cleanToken.toLowerCase().startsWith("bot")
    ? cleanToken.substring(3)
    : cleanToken;

  let url = `https://api.telegram.org/bot${finalToken}/sendMessage`;
  let body: any = {
    chat_id: cleanChatId,
    text: message,
    parse_mode: "HTML",
  };

  if (imageUrl) {
    url = `https://api.telegram.org/bot${finalToken}/sendPhoto`;
    body = {
      chat_id: cleanChatId,
      photo: imageUrl,
      caption: message,
      parse_mode: "HTML",
    };
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let response;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      response = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        timeout: 10000,
      });

      if (!response.ok && imageUrl) {
        throw new Error(`Telegram API responded with ${response.status} when sending photo`);
      }

      if (response.ok) {
        console.log(`[Telegram] Message sent successfully to ${cleanChatId}`);
        return true;
      }

      const errorText = await response.text();
      console.warn(
        `[Telegram API ERROR] Attempt ${attempt}: ${response.status} - ${errorText}`,
      );

      if (response.status === 400 && errorText.includes("parse entities")) {
        // Unrecoverable formatting error. Try once completely without HTML parsing
        if (body.parse_mode) {
          body.parse_mode = undefined;
          console.log(
            `[Telegram] Falling back to raw text (no HTML parse_mode) for Telegram...`,
          );
          const fallbackResponse = await fetchWithTimeout(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            timeout: 10000,
          });
          if (fallbackResponse.ok) {
            console.log(`[Telegram] Raw text message sent successfully.`);
            return true;
          }
          console.warn(
            `[Telegram] Raw text fallback also failed: ${await fallbackResponse.text()}`,
          );
        }
        return false;
      }

      if (response.status === 404) {
         console.warn(`[Telegram ERROR] Bot token is invalid or chat ID not found. (404 Not Found)`);
         // No point in retrying
         return false;
      }

      if (response.status === 401) {
         console.warn(`[Telegram ERROR] Unauthorized. Bot token is incorrect. (401)`);
         return false;
      }

      if (response.status === 429) {
        // Rate limited
        const data = JSON.parse(errorText);
        const retryAfter = data.parameters?.retry_after || 5;
        console.warn(`[Telegram] Rate limited. Waiting ${retryAfter} seconds...`);
        await sleep(retryAfter * 1000);
      } else {
        await sleep(attempt * 1000);
      }
    } catch (error: any) {
      console.warn(`[Telegram] Fetch error on attempt ${attempt}:`, error.message || error);
      
      // Fallback to text message if photo fails (e.g. quickchart.io is down or times out)
      if (imageUrl) {
        console.log(`[Telegram] Photo failed on attempt ${attempt}. Fallback to text...`);
        imageUrl = undefined; // Do not try photo again
        url = `https://api.telegram.org/bot${finalToken}/sendMessage`;
        body = {
          chat_id: cleanChatId,
          text: message,
          parse_mode: "HTML",
        };
      }
      
      await sleep(attempt * 1000);
    }
  }

  return false;
}

async function fetchWithTimeout(url: string, options: any = {}) {
  const timeout = options.timeout || 10000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    // If it's a Binance request, inject a rotating API key to bypass potential IP rate limits
    if (url.includes('binance.com')) {
      const creds = getRotatingKeys();
      if (creds && creds.key) {
        options.headers = {
          ...options.headers,
          "X-MBX-APIKEY": creds.key
        };
      }
    }

    let response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    
    // Handle Binance Geoblocks on US environments (Render, etc.)
    if (!response.ok && (response.status === 451 || response.status === 403) && url.includes('binance.com')) {
      console.log(`[Binance ${response.status}] Blocked by geo-restriction. Missing data for ${url}`);
      
      // If it's a klines request, fallback to Bybit to bypass IP ban instantly
      if (url.includes('/v1/klines') || url.includes('/v1/premiumIndex')) {
        return handleBybitFallback(url, options);
      }
    }

    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

async function handleBybitFallback(binanceUrl: string, options: any) {
  try {
    const urlObj = new URL(binanceUrl);
    const symbol = urlObj.searchParams.get('symbol');
    
    if (binanceUrl.includes('/v1/klines')) {
      let interval = urlObj.searchParams.get('interval');
      const limit = urlObj.searchParams.get('limit') || 200;
      
      // Map Binance interval to Bybit
      const intervalMap: Record<string, string> = {
        '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
        '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720',
        '1d': 'D', '1w': 'W', '1M': 'M'
      };
      const bybitInterval = intervalMap[interval as string] || '1';
      
      const bybitUrl = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${bybitInterval}&limit=${limit}`;
      const res = await fetch(bybitUrl, options);
      if (!res.headers.get("content-type")?.includes("application/json")) {
        throw new Error("Bybit HTML error");
      }
      const data = await res.json();
      
      if (data.retCode === 0 && data.result && data.result.list) {
        // Bybit returns list sorted DESCENDING (newest first)
        // Binance expects ASCENDING (oldest first)
        const mapped = data.result.list.reverse().map((k: any) => [
          parseInt(k[0]), // open time
          k[1], // open
          k[2], // high
          k[3], // low
          k[4], // close
          k[5], // volume
          parseInt(k[0]) + 60000, // Bybit doesn't give closeTime directly by default
          "0", "0", "0", "0", "0" // Padding to match Binance structure
        ]);
        
        // Mock a response object to match `fetch` signature
        return {
          ok: true,
          status: 200,
          json: async () => mapped
        } as Response;
      }
    } 
    else if (binanceUrl.includes('/v1/premiumIndex')) {
      // Bybit Premium Index (Funding Rate) fallback
      const bybitUrl = `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`;
      const res = await fetch(bybitUrl, options);
      if (!res.headers.get("content-type")?.includes("application/json")) {
        throw new Error("Bybit HTML error");
      }
      const data = await res.json();
      if (data.retCode === 0 && data.result?.list?.length > 0) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lastFundingRate: data.result.list[0].fundingRate
          })
        } as Response;
      }
    }
  } catch (e) {
    console.error("Bybit fallback failed:", e);
  }
  
  // Return an empty successful format if all fails to not crash the engine
  return {
    ok: true,
    status: 200,
    json: async () => []
  } as Response;
}

const MEME_COINS = new Set([
  "DOGEUSDT",
  "SHIBUSDT",
  "1000SHIBUSDT",
  "PEPEUSDT",
  "1000PEPEUSDT",
  "FLOKIUSDT",
  "1000FLOKIUSDT",
  "BONKUSDT",
  "1000BONKUSDT",
  "WIFUSDT",
  "BOMEUSDT",
  "MEMEUSDT",
  "MYROUSDT",
  "POPCATUSDT",
  "MEWUSDT",
  "BRETTUSDT",
  "NEIROUSDT",
  "PNUTUSDT",
  "TURBOUSDT",
  "MOGUSDT",
  "CATIUSDT",
  "DOGSUSDT",
  "BABYDOGEUSDT",
  "1MBABYDOGEUSDT",
  "MOODENGUSDT",
  "GOATUSDT",
  "ACTUSDT",
  "PEOPLEUSDT",
  "SLERFUSDT",
  "WENUSDT",
  "COQUSDT",
  "PORKUSDT",
  "MUMUUSDT",
  "DEGENUSDT",
  "TOSHIUSDT",
  "FOXYUSDT",
  "PONKEUSDT",
  "SUNDOGUSDT",
  "HMSTRUSDT",
  "CATUSDT",
  "SIMONCATUSDT",
  "HIPPOUSDT",
  "PENGUUSDT",
  "SATSUSDT",
  "1000SATSUSDT",
  "RATSUSDT",
  "NOTUSDT",
]);

let cachedTopSymbols: string[] = [];
let lastTopSymbolsUpdate = 0;

async function fetchTopSymbols() {
  if (Date.now() - lastTopSymbolsUpdate < 24 * 60 * 60 * 1000 && cachedTopSymbols.length > 0) {
    return cachedTopSymbols;
  }
  try {
    const res = await fetchWithTimeout(
      `https://fapi.binance.com/fapi/v1/ticker/24hr?_t=${Date.now()}`,
    );
    if (!res.headers.get("content-type")?.includes("application/json")) {
      throw new Error("Binance HTML error");
    }
    const data = await res.json();
    cachedTopSymbols = data
      .filter(
        (t: any) =>
          t.symbol.endsWith("USDT") &&
          parseFloat(t.volume) > 0 &&
          !t.symbol.includes("UPUSDT") &&
          !t.symbol.includes("DOWNUSDT") &&
          !t.symbol.includes("BULLUSDT") &&
          !t.symbol.includes("BEARUSDT") &&
          !MEME_COINS.has(t.symbol),
      )
      .sort(
        (a: any, b: any) =>
          parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume),
      )
      .slice(0, 100) // background scanner will parse the top 100 volume pairs
      .map((t: any) => t.symbol);
    lastTopSymbolsUpdate = Date.now();
    return cachedTopSymbols;
  } catch (e) {
    if (cachedTopSymbols.length > 0) return cachedTopSymbols;
    return [
      "BTCUSDT",
      "ETHUSDT",
      "SOLUSDT",
      "BNBUSDT",
      "XRPUSDT",
      "ADAUSDT",
      "AVAXUSDT",
      "LINKUSDT",
      "DOTUSDT",
    ];
  }
}

import WebSocket from "ws";

const klineCache: Record<string, Record<string, any[]>> = {};
const subscribedStreams = new Set<string>();
let binanceWs: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let rateLimitNotified = false;

function updateHTFCandle(arr: any[], candle1m: any, multiplier: number) {
  if (!arr || arr.length === 0) return;
  const htfOpenTime = Math.floor(candle1m.time / (multiplier * 60)) * (multiplier * 60);
  const lastHTF = arr[arr.length - 1];

  if (lastHTF.time === htfOpenTime) {
    lastHTF.high = Math.max(lastHTF.high, candle1m.high);
    lastHTF.low = Math.min(lastHTF.low, candle1m.low);
    lastHTF.close = candle1m.close;
    lastHTF.volume += candle1m.volume; // Simple accumulation, not perfectly exact if updates are partial but okay for indicator approximation
    // We don't bother strictly with volume reset on partials because we just want the overall direction
  } else if (htfOpenTime > lastHTF.time) {
    arr.push({
      time: htfOpenTime,
      open: candle1m.open,
      high: candle1m.high,
      low: candle1m.low,
      close: candle1m.close,
      volume: candle1m.volume,
      isFinal: false
    });
    if (arr.length > 1500) arr.shift();
  }
}

function initBinanceWs() {
  if (binanceWs) return;
  binanceWs = new WebSocket('wss://fstream.binance.com/stream');

  binanceWs.on('open', () => {
    console.log('[Binance WS] Connected for background scanner');
    fetchTopSymbols().then(symbols => {
      symbols.forEach(s => subscribedStreams.add(`${s.toLowerCase()}@kline_1m`));
      if (subscribedStreams.size > 0) {
        wsSubscribeQueue.push(...Array.from(subscribedStreams));
        processWsQueue();
      }
    });
  });

  binanceWs.on('message', (data: WebSocket.Data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.data && msg.data.e === 'kline') {
        const s = msg.data.s;
        const i = msg.data.k.i; // This will now ALWAYS be "1m" because we only subscribe to 1m
        const k = msg.data.k;
        
        if (!klineCache[s]) klineCache[s] = {};
        if (!klineCache[s][i]) klineCache[s][i] = [];
        
        const arr = klineCache[s][i];
        const last = arr[arr.length - 1];
        const openTime = Math.floor(k.t / 1000);
        
        const candleData = {
          time: openTime,
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
          isFinal: k.x
        };

        const TIMEFRAMES: Record<string, number> = {'3m': 3, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240, '1d': 1440};

        let updated = false;
        if (last && last.time === openTime) {
          // It's a partial update to the current 1m candle. 
          // Since we might accumulate volume, we should calculate volume delta
          const volDelta = candleData.volume - last.volume;
          arr[arr.length - 1] = candleData;
          
          Object.entries(TIMEFRAMES).forEach(([tf, m]) => {
            if (klineCache[s][tf] && klineCache[s][tf].length > 0) {
              const htfArr = klineCache[s][tf];
              const htfLast = htfArr[htfArr.length - 1];
              if (htfLast.time === Math.floor(candleData.time / (m * 60)) * (m * 60)) {
                htfLast.high = Math.max(htfLast.high, candleData.high);
                htfLast.low = Math.min(htfLast.low, candleData.low);
                htfLast.close = candleData.close;
                htfLast.volume += volDelta;
              }
            }
          });
        } else if (last && openTime > last.time) {
          if (openTime > last.time + 60) {
            // Gap detected! WS missed data. Invalidate cache to force REST recovery.
            console.warn(`[Binance WS] Gap detected for ${s}. Invalidating cache for recovery.`);
            delete klineCache[s];
            return;
          }

          arr.push(candleData);
          if (arr.length > 1500) arr.shift();
          
          Object.entries(TIMEFRAMES).forEach(([tf, m]) => {
            updateHTFCandle(klineCache[s][tf], candleData, m);
          });
        } else if (!last) {
          arr.push(candleData);
          Object.entries(TIMEFRAMES).forEach(([tf, m]) => {
            updateHTFCandle(klineCache[s][tf], candleData, m);
          });
        }
      }
    } catch (err) {
      // safely ignore decode errors
    }
  });

  binanceWs.on('close', () => {
    console.log('[Binance WS] Disconnected, reconnecting...');
    binanceWs = null;
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        initBinanceWs();
      }, 5000);
    }
  });

  binanceWs.on('error', (err: any) => {
    console.error('[Binance WS] Error:', err.message);
  });
}

function subscribeToWs(symbol: string, tf: string) {
  // We ONLY subscribe to 1m stream now
  const streamName = `${symbol.toLowerCase()}@kline_1m`;
  if (!subscribedStreams.has(streamName)) {
    subscribedStreams.add(streamName);
    wsSubscribeQueue.push(streamName);
    processWsQueue();
  }
}

const wsSubscribeQueue: string[] = [];
let isProcessingWsQueue = false;

function processWsQueue() {
  if (isProcessingWsQueue || wsSubscribeQueue.length === 0 || !binanceWs || binanceWs.readyState !== WebSocket.OPEN) return;
  isProcessingWsQueue = true;

  const streamsToSubscribe = wsSubscribeQueue.splice(0, 50); // Max 50 per request
  
  binanceWs.send(JSON.stringify({
    method: 'SUBSCRIBE',
    params: streamsToSubscribe,
    id: Date.now()
  }));

  setTimeout(() => {
    isProcessingWsQueue = false;
    if (wsSubscribeQueue.length > 0) {
      processWsQueue();
    }
  }, 250); // 4 messages per second (max is 5)
}

function aggregateCandles(candles1m: any[], timeframe: string): any[] {
  const multipliers: Record<string, number> = { '3m': 3, '15m': 15, '1h': 60, '4h': 240 };
  const m = multipliers[timeframe];
  if (!m) return candles1m;

  const result = [];
  for (let i = 0; i < candles1m.length; i += m) {
    const group = candles1m.slice(i, i + m);
    if (group.length < m) break; // Incomplete candle

    result.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map(c => c.high)),
      low: Math.min(...group.map(c => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
      isFinal: group[group.length - 1].isFinal
    });
  }
  return result;
}

const inflightKlines = new Map<string, Promise<any>>();
let isRateLimitedUntil = 0;

async function fetchKlines(symbol: string, tf: string, limit: number = 200) {
  if (!binanceWs) initBinanceWs();

  if (!klineCache[symbol]) klineCache[symbol] = {};
  
  if (!klineCache[symbol][tf]) {
    const cacheKey = `${symbol}_${tf}`;
    if (inflightKlines.has(cacheKey)) {
      return inflightKlines.get(cacheKey);
    }
    
    // Check if we are globally rate-limited
    if (Date.now() < isRateLimitedUntil) {
      return [];
    }

    const promise = (async () => {
      try {
        console.log(`[REST API] Fetching warm-up data for ${symbol} ${tf}`);
        const res = await fetchWithTimeout(
          `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=${limit}&_t=${Date.now()}`,
        );
        if (!res.headers.get("content-type")?.includes("application/json")) {
           throw new Error("Binance HTML error");
        }
        const data = await res.json();

        if (!Array.isArray(data)) {
          console.warn(
            `[Binance API Warning] Expected array for ${symbol} ${tf}, got:`,
            data,
          );
          if (
            data &&
            data.code === -1003 
          ) {
            isRateLimitedUntil = Date.now() + 60000; // Backoff for 1 minute
            if ((process.env.VITE_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN) &&
                (process.env.VITE_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID) &&
                !rateLimitNotified) {
              rateLimitNotified = true;
              sendTelegramSignal(
                (process.env.VITE_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN) as string,
                (process.env.VITE_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID) as string,
                "⚠️ <b>Binance API Rate Limit Hit!</b>\nScanner is temporarily missing data.",
              ).catch(console.error);
              setTimeout(() => {
                rateLimitNotified = false;
              }, 3600000); // Reset after 1 hour
            }
          }
          return [];
        }

        klineCache[symbol][tf] = data.map((d: any) => ({
          time: Math.floor(d[0] / 1000),
          open: parseFloat(d[1]),
          high: parseFloat(d[2]),
          low: parseFloat(d[3]),
          close: parseFloat(d[4]),
          volume: parseFloat(d[5]),
          isFinal: true,
        }));
        
        subscribeToWs(symbol, tf);
        return klineCache[symbol][tf].slice(-1500);
      } catch (e) {
        console.error(`Error fetching REST klines for ${symbol} ${tf}`, e);
        return [];
      } finally {
        inflightKlines.delete(cacheKey);
      }
    })();
    
    inflightKlines.set(cacheKey, promise);
    return promise;
  }
  
  return klineCache[symbol][tf].slice(-1500);
}

let globalFrontendTrades: any[] = [];
let lastScanMetrics: any = { status: "not_started" };

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json());

  // API routes FIRST
  app.use("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Self-ping to keep server alive (prevent sleeping)
  setInterval(() => {
    try {
      const pingUrl = process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL}/api/health` : `http://127.0.0.1:${PORT}/api/health`;
      fetch(pingUrl).catch(() => {});
    } catch(e) {}
  }, 45000);

  app.get("/api/top-trades", (req, res) => {
    res.json({ signals: globalFrontendTrades });
  });

  app.get("/api/scanner-status", (req, res) => {
    res.json({
      lastScanMetrics
    });
  });

  app.post("/api/telegram/send", async (req, res) => {
    try {
      let { botToken, chatId, message, imageUrl } = req.body;

      if (!botToken || !chatId) {
        botToken = process.env.VITE_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
        chatId = process.env.VITE_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
      }

      if (!botToken || !chatId) {
        return res.status(400).json({ error: "Missing botToken or chatId" });
      }

      const success = await sendTelegramSignal(botToken, chatId, message, imageUrl);

      if (!success) {
        return res.status(500).json({ error: "Failed to send message" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error sending Telegram message via proxy:", error);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  app.post("/api/trade/register-active", express.json(), async (req, res) => {
    try {
      const trade = req.body;
      if (trade && trade.symbol) {
        activeTrades[trade.symbol] = {
           symbol: trade.symbol,
           direction: trade.type || trade.direction,
           entry: trade.entry,
           tp: trade.tp,
           sl: trade.sl,
           achieved: 0
        };
        console.log(`[Backend] Registered frontend trade for monitoring: ${trade.symbol}`);

        const botToken = process.env.VITE_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.VITE_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
        if (botToken && chatId) {
          const typeIcon = trade.type === "LONG" ? "📈" : "📉";
          const msg = `🚀 <b>TRADE OPENED</b> 🚀
      
🪙 <b>Pair:</b> #${trade.symbol}
${typeIcon} <b>Direction:</b> ${trade.type}
  
🎯 <b>Entry:</b> <code>${trade.entry}</code>
✅ <b>Take Profit:</b> <code>${trade.tp}</code>
❌ <b>Stop Loss:</b> <code>${trade.sl}</code>`;
          sendTelegramSignal(botToken as string, chatId as string, msg).catch(console.error);
        }

        res.json({ success: true });
      } else {
        res.status(400).json({ error: "Invalid trade data" });
      }
    } catch (e) {
      res.status(500).json({ error: "Server error" });
    }
  });



  // Proxy endpoints for frontend to bypass CORS/Adblockers
  app.get("/api/klines", async (req, res) => {
    try {
      const symbol = req.query.symbol as string;
      const interval = req.query.interval as string;
      const limit = parseInt(req.query.limit as string) || 250;
      
      if (!symbol || !interval) return res.status(400).json({ error: "Missing symbol or interval" });

      const data = await fetchKlines(symbol, interval, limit);
      // fetchKlines returns array of our Candle objects, but the frontend expects Binance format arrays
      // Let's reconstruct or just adapt the frontend to accept our format.
      // Wait, let's keep the backend returning the format frontend expects (Binance raw format) OR
      // frontend expects `data.map(d => ...)`, we can just send it as is, but we must be careful.
      // Actually, frontend uses fetchWithRetry('.../v1/klines?symbol=...') so it expects Binance format:
      // [[time, open, high, low, close, volume, closeTime, ...]]
      
      const binanceFormat = data.map((c: any) => [
        c.time * 1000,
        c.open.toString(),
        c.high.toString(),
        c.low.toString(),
        c.close.toString(),
        c.volume.toString()
      ]);
      
      res.json(binanceFormat);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/proxy/fapi/*", async (req, res) => {
    try {
      const endpoint = req.params[0];
      const query = new URLSearchParams(req.query as any).toString();
      const targetUrl = `https://fapi.binance.com/fapi/${endpoint}${query ? "?" + query : ""}`;

      const response = await fetchWithTimeout(targetUrl);
      if (!response.ok) {
        return res
          .status(response.status)
          .json({ error: `Binance API error: ${response.statusText}` });
      }
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("Binance HTML error");
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
      const targetUrl = `https://api.binance.com/api/${endpoint}${query ? "?" + query : ""}`;

      const response = await fetchWithTimeout(targetUrl);
      if (!response.ok) {
        return res
          .status(response.status)
          .json({ error: `Binance API error: ${response.statusText}` });
      }
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("Binance HTML error");
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
      const {
        symbol,
        side,
        orderType,
        price,
        stopLoss,
        takeProfit,
        riskFraction = 1.0,
      } = req.body;

      if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_SECRET_KEY) {
        return res
          .status(400)
          .json({ error: "Binance API keys not configured in .env" });
      }

      // 1. Fetch Exchange Info (Cached)
      if (!exchangeInfoCache) {
        exchangeInfoCache = await binanceFuturesRequest(
          "GET",
          "/fapi/v1/exchangeInfo",
        );
      }
      const symbolInfo = exchangeInfoCache.symbols.find(
        (s: any) => s.symbol === symbol,
      );
      if (!symbolInfo) throw new Error(`Symbol ${symbol} not found`);

      const qtyPrecision = symbolInfo.quantityPrecision;
      const pricePrecision = symbolInfo.pricePrecision;

      // 2. Risk Calculation Engine
      const accountInfo = await binanceFuturesRequest(
        "GET",
        "/fapi/v2/account",
      );
      const usdtBalance =
        accountInfo.assets.find((a: any) => a.asset === "USDT")
          ?.availableBalance || 0;

      const riskPercentage = 0.01 * riskFraction; // 1% risk per trade * fraction
      const riskAmount = parseFloat(usdtBalance) * riskPercentage;

      if (riskAmount <= 0)
        throw new Error("Insufficient balance for risk calculation");

      let rawQty = riskAmount / Math.abs(price - stopLoss);

      // Apply leverage (e.g., 10x)
      const leverage = 10;
      await binanceFuturesRequest("POST", "/fapi/v1/leverage", {
        symbol,
        leverage,
      });

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

      if (orderType === "LIMIT") {
        orderParams.price = formattedPrice;
        orderParams.timeInForce = "GTC";
      }

      const orderRes = await binanceFuturesRequest(
        "POST",
        "/fapi/v1/order",
        orderParams,
      );

      // 4. Place Stop Loss
      if (stopLoss) {
        await binanceFuturesRequest("POST", "/fapi/v1/order", {
          symbol,
          side: side === "BUY" ? "SELL" : "BUY",
          type: "STOP_MARKET",
          stopPrice: formattedSL,
          closePosition: true,
        });
      }

      // 5. Place Take Profit
      if (takeProfit) {
        await binanceFuturesRequest("POST", "/fapi/v1/order", {
          symbol,
          side: side === "BUY" ? "SELL" : "BUY",
          type: "TAKE_PROFIT_MARKET",
          stopPrice: formattedTP,
          closePosition: true,
        });
      }

      res.json({ success: true, order: orderRes, riskAmount, quantity });
    } catch (error: any) {
      console.error("Trade Execution Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Background loop
  const lastSentSignals: Record<
    string,
    { direction: string; timestamp: number }
  > = {};
  const sentSessionNotifications = new Set<string>();
  const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours cooldown

  interface ActiveTrade {
    symbol: string;
    direction: "LONG" | "SHORT";
    entry: number;
    tp: number;
    sl: number;
    achieved: number;
  }
  const activeTrades: Record<string, ActiveTrade> = {};

  const CORRELATION_GROUPS: Record<string, string[]> = {
    BTC: ["BTCUSDT", "BCHUSDT", "STXUSDT", "ORDIUSDT", "SATSUSDT"],
    ETH: ["ETHUSDT", "ARBUSDT", "OPUSDT", "LDOUSDT", "ETCUSDT", "ENSUSDT"],
    AI: [
      "FETUSDT",
      "AGIXUSDT",
      "OCEANUSDT",
      "RNDRUSDT",
      "TAOUSDT",
      "WLDUSDT",
      "NEARUSDT",
    ],
    MEME: [
      "DOGEUSDT",
      "SHIBUSDT",
      "PEPEUSDT",
      "FLOKIUSDT",
      "BONKUSDT",
      "WIFUSDT",
      "BOMEUSDT",
    ],
    L1: [
      "SOLUSDT",
      "AVAXUSDT",
      "ADAUSDT",
      "SUIUSDT",
      "APTUSDT",
      "SEIUSDT",
      "INJUSDT",
      "DOTUSDT",
      "LINKUSDT",
    ],
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
  let globalScanIndex = 0;

  const runBackgroundLoop = async () => {
    const botToken = process.env.VITE_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.VITE_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
    const telegramEnabled = !!(botToken && chatId);

    if (!telegramEnabled && !hasLoggedMissingTokens) {
      console.log(
        "Telegram tokens missing. Scanner will run locally but skip Telegram alerts.",
      );
      hasLoggedMissingTokens = true;
    }
    
    if (telegramEnabled) {
      hasLoggedMissingTokens = false;
    }

    if (telegramEnabled && !hasSentStartupNotification) {
      sendTelegramSignal(
        botToken,
        chatId,
        "🚀 <b>Endellion Trade Bot Started</b>\n\nScanner is now active and monitoring markets 24/7.",
      ).catch(console.error);
      hasSentStartupNotification = true;
    }

    try {
      // --- Session Notifications ---
      const now = new Date();
      const utcHour = now.getUTCHours();
      const utcMinute = now.getUTCMinutes();
      const dateStr = now.toISOString().split("T")[0];

      const sessions = [
        { name: "Asian", start: 0, end: 9 },
        { name: "London", start: 8, end: 17 },
        { name: "New York", start: 13, end: 22 },
      ];

      for (const session of sessions) {
        // Check start window (5 mins before to 5 mins after)
        let isStartWindow = false;
        if (session.start === 0) {
          isStartWindow =
            (utcHour === 23 && utcMinute >= 55) ||
            (utcHour === 0 && utcMinute <= 5);
        } else {
          isStartWindow =
            (utcHour === session.start - 1 && utcMinute >= 55) ||
            (utcHour === session.start && utcMinute <= 5);
        }

        if (isStartWindow) {
          const sessionDateStr =
            utcHour === 23
              ? new Date(now.getTime() + 86400000).toISOString().split("T")[0]
              : dateStr;
          const key = `${session.name}_START_${sessionDateStr}`;
          if (!sentSessionNotifications.has(key)) {
            const timeString = `${utcHour.toString().padStart(2, "0")}:${utcMinute.toString().padStart(2, "0")} UTC`;
            sendTelegramSignal(
              botToken,
              chatId,
              `🌐 <b>MARKET UPDATE</b>\n\n🟢 <b>${session.name} Session</b> is now OPEN.\n⏰ Time: <code>${timeString}</code>`,
            ).catch(console.error);
            sentSessionNotifications.add(key);
          }
        }

        // Check end window (5 mins before to 5 mins after)
        let isEndWindow = false;
        if (session.end === 0) {
          isEndWindow =
            (utcHour === 23 && utcMinute >= 55) ||
            (utcHour === 0 && utcMinute <= 5);
        } else {
          isEndWindow =
            (utcHour === session.end - 1 && utcMinute >= 55) ||
            (utcHour === session.end && utcMinute <= 5);
        }

        if (isEndWindow) {
          const sessionDateStr =
            utcHour === 23
              ? new Date(now.getTime() + 86400000).toISOString().split("T")[0]
              : dateStr;
          const key = `${session.name}_END_${sessionDateStr}`;
          if (!sentSessionNotifications.has(key)) {
            const timeString = `${utcHour.toString().padStart(2, "0")}:${utcMinute.toString().padStart(2, "0")} UTC`;
            sendTelegramSignal(
              botToken,
              chatId,
              `🌐 <b>MARKET UPDATE</b>\n\n🔴 <b>${session.name} Session</b> is now CLOSED.\n⏰ Time: <code>${timeString}</code>`,
            ).catch(console.error);
            sentSessionNotifications.add(key);
          }
        }
      }

      // Cleanup old session notifications to prevent memory leak
      if (sentSessionNotifications.size > 20) {
        const oldKeys = Array.from(sentSessionNotifications).slice(0, 10);
        oldKeys.forEach((k) => sentSessionNotifications.delete(k));
      }
      // -----------------------------

      // Upgrade 4: Time-of-Day / Volume Weighting
      const currentHour = new Date().getUTCHours();
      const isAsianSession = currentHour >= 21 || currentHour < 8;
      const requiredConfidence = 78;
      const sessionName = isAsianSession
        ? "Asian (Low Vol)"
        : "London/NY (High Vol)";

      const topSymbols = await fetchTopSymbols();

      const symbols = Array.from(
        new Set([...topSymbols, ...Object.keys(activeTrades)]),
      );
      const allSignals: any[] = [];
      const currentFrontendTrades: any[] = [];

      // Upgrade 1: King Filter (BTC 1H Trend)
      let btcTrend = "NEUTRAL";
      try {
        const btcKlines1h = await fetchKlines("BTCUSDT", "1h");
        if (btcKlines1h.length >= 50) {
          const btcCloses = btcKlines1h.map((k) => k.close);
          const btcEma20 = EMA.calculate({ values: btcCloses, period: 20 });
          const btcEma50 = EMA.calculate({ values: btcCloses, period: 50 });
          const lastBtcEma20 = btcEma20[btcEma20.length - 1];
          const lastBtcEma50 = btcEma50[btcEma50.length - 1];
          btcTrend =
            lastBtcEma20 > lastBtcEma50
              ? "LONG"
              : lastBtcEma20 < lastBtcEma50
                ? "SHORT"
                : "NEUTRAL";
        }
      } catch (e) {
        console.error("Failed to fetch BTC 1H trend for King Filter:", e);
      }

      // Process symbols simultaneously
      let diagnosticCounts = { total: symbols.length, htfNeutral: 0, veto1h: 0, mtfNoTrade: 0, mtfMismatch: 0, btcConflict: 0, ltfInvalid: 0, lowConfidence: 0 };
      
      await Promise.all(symbols.map(async (symbol) => {
        try {
          // 1. Fetch 3M for active trade monitoring and sniper entry
          const klines3m = await fetchKlines(symbol, "3m");

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
                let softExitReason = "";
                try {
                  const klines15mForExit = await fetchKlines(symbol, "15m");
                  if (klines15mForExit.length >= 30) {
                    const closes15m = klines15mForExit.map((k) => k.close);
                    const macd15m = MACD.calculate({
                      values: closes15m,
                      fastPeriod: 12,
                      slowPeriod: 26,
                      signalPeriod: 9,
                      SimpleMAOscillator: false,
                      SimpleMASignal: false,
                    });
                    const rsi15m = RSI.calculate({
                      values: closes15m,
                      period: 14,
                    });

                    if (macd15m.length >= 2 && rsi15m.length >= 1) {
                      const lastMacd = macd15m[macd15m.length - 1];
                      const prevMacd = macd15m[macd15m.length - 2];
                      const lastRsi = rsi15m[rsi15m.length - 1];

                      const avgVol =
                        klines15mForExit
                          .slice(-10)
                          .reduce((sum, c) => sum + c.volume, 0) / 10;
                      const lastVol =
                        klines15mForExit[klines15mForExit.length - 1].volume;
                      const lossOfVolume = lastVol < avgVol * 0.8;

                      if (activeTrade.direction === "LONG") {
                        const macdFading =
                          (lastMacd.histogram || 0) <
                            (prevMacd.histogram || 0) &&
                          (lastMacd.histogram || 0) < 0;
                        const rsiLeavingTrend = lastRsi < 45;
                        if (macdFading && rsiLeavingTrend && lossOfVolume) {
                          softExit = true;
                          softExitReason =
                            "Momentum Reversed (MACD Fading, RSI under 45, Volume Dropping)";
                        }
                      } else if (activeTrade.direction === "SHORT") {
                        const macdFading =
                          (lastMacd.histogram || 0) >
                            (prevMacd.histogram || 0) &&
                          (lastMacd.histogram || 0) > 0;
                        const rsiLeavingTrend = lastRsi > 55;
                        if (macdFading && rsiLeavingTrend && lossOfVolume) {
                          softExit = true;
                          softExitReason =
                            "Momentum Reversed (MACD Fading, RSI over 55, Volume Dropping)";
                        }
                      }
                    }
                  }
                } catch (e) {
                  console.error(`Failed to check soft exit for ${symbol}:`, e);
                }

                if (softExit) {
                  console.log(
                    `[DEBUG] Soft Exit for ${symbol}: ${softExitReason}`,
                  );
                  sendTelegramSignal(
                    botToken,
                    chatId,
                    `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n${activeTrade.direction === "LONG" ? "📈" : "📉"} <b>Direction:</b> ${activeTrade.direction}\n⚠️ <b>Status:</b> Soft Exit Triggered at <code>${formatPrice(currentClose)}</code>\n🧠 <b>Reason:</b> ${softExitReason}\n💰 <b>PnL:</b> ${calculatePnL(activeTrade.entry, currentClose, activeTrade.direction)}`,
                  ).catch(console.error);
                  delete activeTrades[symbol];
                  tradeClosed = true;
                  break;
                }

                if (activeTrade.direction === "LONG") {
                  if (currentLow <= activeTrade.sl) {
                    console.log(
                      `[DEBUG] SL Hit for ${symbol}: Low ${currentLow}, SL ${activeTrade.sl}, Achieved: ${activeTrade.achieved}`,
                    );
                    sendTelegramSignal(
                      botToken,
                      chatId,
                      `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📈 <b>Direction:</b> LONG\n❌ <b>Status:</b> Stop Loss Hit at <code>${formatPrice(currentLow)}</code> (PnL: ${calculatePnL(activeTrade.entry, activeTrade.sl, "LONG")})`,
                    ).catch(console.error);
                    delete activeTrades[symbol];
                    tradeClosed = true;
                  } else if (
                    currentHigh >= activeTrade.tp
                  ) {
                    sendTelegramSignal(
                      botToken,
                      chatId,
                      `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📈 <b>Direction:</b> LONG\n✅ <b>Status:</b> Take Profit Achieved (🎯 ${formatPrice(activeTrade.tp)}) (PnL: ${calculatePnL(activeTrade.entry, activeTrade.tp, "LONG")})`,
                    ).catch(console.error);
                    delete activeTrades[symbol];
                    tradeClosed = true;
                  }
                } else if (activeTrade.direction === "SHORT") {
                  if (currentHigh >= activeTrade.sl) {
                    console.log(
                      `[DEBUG] SL Hit for ${symbol}: High ${currentHigh}, SL ${activeTrade.sl}, Achieved: ${activeTrade.achieved}`,
                    );
                    sendTelegramSignal(
                      botToken,
                      chatId,
                      `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📉 <b>Direction:</b> SHORT\n❌ <b>Status:</b> Stop Loss Hit at <code>${formatPrice(currentHigh)}</code> (PnL: ${calculatePnL(activeTrade.entry, activeTrade.sl, "SHORT")})`,
                    ).catch(console.error);
                    delete activeTrades[symbol];
                    tradeClosed = true;
                  } else if (
                    currentLow <= activeTrade.tp
                  ) {
                    sendTelegramSignal(
                      botToken,
                      chatId,
                      `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📉 <b>Direction:</b> SHORT\n✅ <b>Status:</b> Take Profit Achieved (🎯 ${formatPrice(activeTrade.tp)}) (PnL: ${calculatePnL(activeTrade.entry, activeTrade.tp, "SHORT")})`,
                    ).catch(console.error);
                    delete activeTrades[symbol];
                    tradeClosed = true;
                  }
                }
              }
            }
            if (activeTrade || tradeClosed) return; // Skip generating new signals if a trade is already active or just closed
            // --- END ACTIVE TRADE MONITORING ---

            // 2. 4H Bias Alignment
            const klines4h = await fetchKlines(symbol, "4h");
            const htfDirection = getHTFDirection(klines4h);
            if (htfDirection === "NEUTRAL") { diagnosticCounts.htfNeutral++; return; }

            // 2.5 1H Control Layer (Veto Filter)
            const klines1h = await fetchKlines(symbol, "1h");
            const control1H = get1HControlState(klines1h, htfDirection);
            if (control1H.state === "VETO") { diagnosticCounts.veto1h++; return; }

            // 3. 15M Confirmation (Confidence/Setup)
            const klines15m = await fetchKlines(symbol, "15m");
            const mtfAnalysis = analyzeChart(
              klines15m,
              DEFAULT_RELIABILITY,
              [],
              symbol,
            );
            if (mtfAnalysis.signal === "NO TRADE") { diagnosticCounts.mtfNoTrade++; return; }
            if (htfDirection !== mtfAnalysis.signal) { diagnosticCounts.mtfMismatch++; return; }

            // Upgrade 1: King Filter Application
            if (symbol !== "BTCUSDT") {
              // Altcoin LONG allowed only if BTC not bearish (LONG or NEUTRAL)
              if (mtfAnalysis.signal === "LONG" && btcTrend === "SHORT") { 
                diagnosticCounts.btcConflict++; 
                console.log(`[Reject] ${symbol}: BTC Conflict (Direction: ${mtfAnalysis.signal}, BTC: ${btcTrend})`);
                return; 
              }
              // Altcoin SHORT allowed only if BTC weak (SHORT)
              if (mtfAnalysis.signal === "SHORT" && btcTrend !== "SHORT") { 
                diagnosticCounts.btcConflict++; 
                console.log(`[Reject] ${symbol}: BTC Conflict (Direction: ${mtfAnalysis.signal}, BTC: ${btcTrend})`);
                return; 
              }
            }

            // 4. 3M Entry (already fetched klines3m)
            const ltfValidation = validateLTFEntry(
              klines3m,
              mtfAnalysis.signal as "LONG" | "SHORT",
            );
            if (!ltfValidation.isValid) { 
              diagnosticCounts.ltfInvalid++; 
              console.log(`[Reject] ${symbol}: LTF Invalid (${ltfValidation.reason})`);
              return; 
            }

            // Upgrade 3: VWAP & Liquidity Sniping (Limit Entry)
            const closes3m = klines3m.map((k) => k.close);
            const ema20_3m = EMA.calculate({ values: closes3m, period: 20 });
            const lastEma20_3m =
              ema20_3m[ema20_3m.length - 1] || closes3m[closes3m.length - 1];

            let cumulativeTypicalVolume = 0;
            let cumulativeVolume = 0;
            // Calculate rolling VWAP over last 100 3m candles (5 hours)
            for (const candle of klines3m.slice(-100)) {
              const typicalPrice =
                (candle.high + candle.low + candle.close) / 3;
              cumulativeTypicalVolume += typicalPrice * candle.volume;
              cumulativeVolume += candle.volume;
            }
            const vwap3m =
              cumulativeVolume > 0
                ? cumulativeTypicalVolume / cumulativeVolume
                : closes3m[closes3m.length - 1];

            if (mtfAnalysis.signal === "LONG") {
              mtfAnalysis.limitEntry = Math.min(lastEma20_3m, vwap3m);
            } else {
              mtfAnalysis.limitEntry = Math.max(lastEma20_3m, vwap3m);
            }
            mtfAnalysis.entryStrategy = "Limit (Pullback)";

            // Premium Upgrades: OI and Funding Rate
            let premiumLogicStr = "";
            try {
              if (control1H.state === "CONTINUATION") {
                const oiRes = await fetchWithTimeout(
                  `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=15m&limit=2`,
                );
                if (!oiRes.headers.get("content-type")?.includes("application/json")) {
                  throw new Error("Binance HTML error");
                }
                const oiData = await oiRes.json();
                if (Array.isArray(oiData) && oiData.length === 2) {
                  const prev = parseFloat(oiData[0].sumOpenInterestValue);
                  const curr = parseFloat(oiData[1].sumOpenInterestValue);
                  if (prev > 0) {
                    const oiChange = (curr - prev) / prev;
                    if (oiChange > 0.001) {
                      // > 0.1% increase in 15m
                      // mtfAnalysis.confidence += 5;
                      premiumLogicStr += `\n• 🔥 Trend Fuel: OI Rising`;
                    }
                  }
                }
              } else if (control1H.state === "EXHAUSTION") {
                const frRes = await fetchWithTimeout(
                  `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`,
                );
                if (!frRes.headers.get("content-type")?.includes("application/json")) {
                  throw new Error("Binance HTML error");
                }
                const frData = await frRes.json();
                const fundingRate = parseFloat(frData.lastFundingRate);

                if (mtfAnalysis.signal === "LONG" && fundingRate < -0.0001) {
                  // mtfAnalysis.confidence += 8;
                  premiumLogicStr += `\n• 💥 Squeeze Hunter: Negative Funding Rate`;
                } else if (
                  mtfAnalysis.signal === "SHORT" &&
                  fundingRate > 0.0005
                ) {
                  // mtfAnalysis.confidence += 8;
                  premiumLogicStr += `\n• 💥 Squeeze Hunter: High Positive Funding Rate`;
                }
              }
            } catch (e) {
              console.error(`Failed to fetch premium data for ${symbol}:`, e);
            }
            (mtfAnalysis as any).premiumLogicStr = premiumLogicStr;

            // Cap confidence at 100 after premium upgrades
            mtfAnalysis.confidence = Math.min(100, mtfAnalysis.confidence);

            currentFrontendTrades.push({
              symbol,
              analysis: mtfAnalysis,
              lastPrice: klines3m.length > 0 ? klines3m[klines3m.length - 1].close : 0,
              entryDirection: 'none'
            });

            // 5. Combine and Send
            if (mtfAnalysis.confidence >= requiredConfidence) {
              const now = Date.now();
              const signalKey = `${symbol}-Multi-TF (4h, 15m, 3m)`;
              const lastSent = lastSentSignals[signalKey];

              if (
                !lastSent ||
                lastSent.direction !== mtfAnalysis.signal ||
                now - lastSent.timestamp > COOLDOWN_MS
              ) {
                const entryPrice =
                  klines3m.length > 0 ? klines3m[klines3m.length - 1].close : 0;
                const tp = mtfAnalysis.tp || 0;
                const sl = mtfAnalysis.sl || 0;

                // --- STALE SIGNAL PREVENTION ---
                // If the current 3m price has already hit TP or SL (calculated from 15m), it's a stale signal.
                let isStale = false;

                // 1. Current Price Check & R:R Check
                const risk = Math.abs(entryPrice - sl);
                const rewardToTp = Math.abs(tp - entryPrice);

                if (mtfAnalysis.signal === "LONG") {
                  if (entryPrice >= tp || entryPrice <= sl) isStale = true;
                  if (rewardToTp < risk * 0.5) isStale = true; // Price already moved too far up
                } else if (mtfAnalysis.signal === "SHORT") {
                  if (entryPrice <= tp || entryPrice >= sl) isStale = true;
                  if (rewardToTp < risk * 0.5) isStale = true; // Price already moved too far down
                }

                // 2. Extended Wick Check (Last 45 minutes)
                // If the price has already wicked to TP or SL recently, the move is over.
                const recentCandles = klines3m.slice(-15);
                for (const c of recentCandles) {
                  if (mtfAnalysis.signal === "LONG") {
                    if (c.high >= tp || c.low <= sl) isStale = true;
                  } else if (mtfAnalysis.signal === "SHORT") {
                    if (c.low <= tp || c.high >= sl) isStale = true;
                  }
                }

                if (isStale) {
                  console.log(
                    `Skipped stale signal for ${symbol} (${mtfAnalysis.signal}). Entry: ${entryPrice}, TP: ${tp}, SL: ${sl}`,
                  );
                  return;
                }
                // -------------------------------

                allSignals.push({
                  symbol,
                  signalKey,
                  analysis: mtfAnalysis,
                  entryPrice,
                  tp,
                  sl,
                  control1H,
                  sessionName,
                });
              }
            } else {
              diagnosticCounts.lowConfidence++;
            }
          } catch (err) {
            console.error(
              `Error processing symbol ${symbol} in background loop:`,
              err,
            );
          }
        })); // End of Promise.all mappings

      // --- SIGNAL FILTERING & SENDING ---
      if (allSignals.length > 0) {
        // 1. Dynamic Threshold: if too many signals, raise threshold
        if (allSignals.length > 3) {
          allSignals.sort(
            (a, b) => b.analysis.confidence - a.analysis.confidence,
          );
          allSignals.splice(3); // Keep only top 3
        }

        // 2. Correlation Grouping
        const groupBestSignal = new Map<string, any>();
        for (const sig of allSignals) {
          const group = getCorrelationGroup(sig.symbol);
          if (
            !groupBestSignal.has(group) ||
            groupBestSignal.get(group).analysis.confidence <
              sig.analysis.confidence
          ) {
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


          const now = Date.now();
          lastSentSignals[sig.signalKey] = {
            direction: sig.analysis.signal,
            timestamp: now,
          };

          activeTrades[sig.symbol] = {
            symbol: sig.symbol,
            direction: sig.analysis.signal as "LONG" | "SHORT",
            entry: sig.entryPrice,
            tp: sig.tp,
            sl: sig.sl,
            achieved: 0,
          };

          const directionEmoji =
            sig.analysis.signal === "LONG" ? "🟢 LONG" : "🔴 SHORT";
          const limitEntryStr = sig.analysis.limitEntry
            ? `\n⏳ Limit (Pullback): ${formatPrice(sig.analysis.limitEntry)}`
            : "";
          const strategyStr = sig.analysis.entryStrategy
            ? `\n\n📝 Strategy: ${sig.analysis.entryStrategy}`
            : "";

          const logicStrRaw =
            sig.analysis.indicators
              .filter(
                (i: any) =>
                  i.signal ===
                  (sig.analysis.signal === "LONG" ? "bullish" : "bearish"),
              )
              .map((i: any) => `• ${i.name}: ${i.description}`)
              .join("\n") + ((sig.analysis as any).premiumLogicStr || "");
              
          const logicStr = logicStrRaw.replace(/</g, "&lt;").replace(/>/g, "&gt;");

          const message = `⚡️ <b>ENDELLION TRADE</b> ⚡️

🪙 <b>Pair:</b> #${sig.symbol}
${directionEmoji} <b>Direction:</b> ${sig.analysis.signal}
⏱ <b>Timeframe:</b> Multi-TF (4h, 1h, 15m, 3m)${strategyStr}
🛡 <b>1H State:</b> ${sig.control1H.state} (${sig.control1H.reason})
👑 <b>BTC Trend:</b> ${btcTrend}
🕒 <b>Session:</b> ${sig.sessionName}

🎯 <b>Entry:</b> <code>${formatPrice(sig.entryPrice)}</code>${limitEntryStr}
✅ <b>Target:</b> <code>${formatPrice(sig.tp)}</code>
❌ <b>Stop Loss:</b> <code>${formatPrice(sig.sl)}</code>

🧠 <b>Confidence:</b> <code>${(sig.analysis.confidence || 0).toFixed(1)}%</code>

💡 <b>Logic:</b>
${logicStr}`;

          const bullishImageUrl =
            "https://quickchart.io/chart?c={type:'line',data:{labels:['1','2','3','4','5','6','7'],datasets:[{label:'Bullish',data:[10,15,13,22,18,28,35],borderColor:'rgb(16,185,129)',backgroundColor:'rgba(16,185,129,0.2)',fill:true}]},options:{legend:{display:false},scales:{xAxes:[{display:false}],yAxes:[{display:false}]}}}";
          const bearishImageUrl =
            "https://quickchart.io/chart?c={type:'line',data:{labels:['1','2','3','4','5','6','7'],datasets:[{label:'Bearish',data:[35,28,32,20,24,15,10],borderColor:'rgb(244,63,94)',backgroundColor:'rgba(244,63,94,0.2)',fill:true}]},options:{legend:{display:false},scales:{xAxes:[{display:false}],yAxes:[{display:false}]}}}";
          const imageUrl =
            sig.analysis.signal === "LONG" ? bullishImageUrl : bearishImageUrl;

          sendTelegramSignal(botToken, chatId, message, imageUrl).catch(console.error);
          // dailySignalCount++;
        }
      }

      // Update frontend table
      const frontendTradesMap = new Map<string, any>();
      for (const t of globalFrontendTrades) {
        frontendTradesMap.set(t.symbol, t);
      }
      for (const t of currentFrontendTrades) {
        frontendTradesMap.set(t.symbol, t);
      }
      const newGlobalTrades = Array.from(frontendTradesMap.values());
      newGlobalTrades.sort((a, b) => b.analysis.confidence - a.analysis.confidence);
      globalFrontendTrades = newGlobalTrades.slice(0, 15);
      
      lastScanMetrics = {
          timestamp: Date.now(),
          symbolsCount: symbols.length,
          btcTrend,
          diagnosticCounts,
          signalCandidatesCount: allSignals.length
      };

    } catch (err) {
      console.error("Error in background loop:", err);
    } finally {
      setTimeout(runBackgroundLoop, 60000); // Check every minute
    }
  };
  runBackgroundLoop(); // Enable 24/7 background Telegram scanning

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // initBinanceWs() is disabled since frontend now handles it
  });
}

startServer();
