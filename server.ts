import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { analyzeChart } from "./src/analysis.ts";
import {
  getHTFDirection,
  validateLTFEntry,
  get1HControlState,
} from "./src/multiTimeframe.ts";
import { formatPrice } from "./src/utils/format.ts";
import { EMA, MACD, RSI } from "technicalindicators";

// --- STREAK TRACKER & QUARTER-KELLY RISK SIZING ---
let consecutiveStreak = 0; // Positive for wins, negative for losses
const STREAK_FILE_PATH = path.join(process.cwd(), "streak_state.json");

function loadStreakState() {
  try {
    if (fs.existsSync(STREAK_FILE_PATH)) {
      const data = fs.readFileSync(STREAK_FILE_PATH, "utf8");
      const obj = JSON.parse(data);
      consecutiveStreak = parseInt(obj.consecutiveStreak) || 0;
      console.log(`[Streak Tracker] Loaded consecutive streak: ${consecutiveStreak}`);
    } else {
      console.log(`[Streak Tracker] No streak state file found, initialized to 0.`);
    }
  } catch (e) {
    console.error("[Streak Tracker] Error loading streak state:", e);
  }
}

function saveStreakState() {
  try {
    fs.writeFileSync(STREAK_FILE_PATH, JSON.stringify({ consecutiveStreak }), "utf8");
  } catch (e) {
    console.error("[Streak Tracker] Error saving streak state:", e);
  }
}

function recordTradeResult(result: "WIN" | "LOSS") {
  const prevStreak = consecutiveStreak;
  if (result === "WIN") {
    if (consecutiveStreak < 0) {
      consecutiveStreak = 1;
    } else {
      consecutiveStreak++;
    }
  } else {
    if (consecutiveStreak > 0) {
      consecutiveStreak = -1;
    } else {
      consecutiveStreak--;
    }
  }
  saveStreakState();
  console.log(`[Streak Tracker] Trade outcome: ${result}. Streak shifted from ${prevStreak} to ${consecutiveStreak}`);
}

function getSizingModel() {
  const winRate = 0.584; // Backtested baseline win rate (Rank #1 top-performing parameter set)
  // Weighted expected R:R based on take profit levels:
  // TP1 (50% Volume at ~1.0 R:R), TP2 (30% Volume at ~2.0 R:R), TP3 (20% Volume at ~4.0 R:R)
  // Weighted expected reward: 0.50 * 1.0 + 0.30 * 2.0 + 0.20 * 4.0 = 1.90 R:R
  const rr = 1.90; 
  // Kelly Fraction: f* = w - (1 - w) / RR
  const fStar = winRate - (1 - winRate) / rr; 
  const quarterKelly = 0.25 * fStar; // Conservative Quarter-Kelly sizing
  
  // Streak Modifier (M_streak)
  let mStreak = 1.0;
  if (consecutiveStreak >= 0) {
    mStreak = 1.0 + Math.min(consecutiveStreak * 0.10, 0.50); // Cap boost at +50% (+0.50)
  } else {
    mStreak = 1.0 - Math.min(Math.abs(consecutiveStreak) * 0.15, 0.75); // Floor reduction at -75% (0.25)
  }
  
  const recommendedSizingPercent = Math.max(0.1, quarterKelly * mStreak * 100); // recommended % of account size
  
  return {
    consecutiveStreak,
    mStreak,
    winRate,
    rr,
    quarterKelly,
    recommendedSizingPercent
  };
}

// Load the streak state at boot
loadStreakState();

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

function getIndicatorKey() {
  const key = process.env.BINANCE_API_KEY_2 || process.env.BINANCE_API_KEY;
  return { key };
}

function getWsKey() {
  const key = process.env.BINANCE_API_KEY_3 || process.env.BINANCE_API_KEY;
  return { key };
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

async function fetchWithTimeout(url: string, options: any = {}, intent: 'INDICATOR' | 'WEBSOCKET' | 'TRADING' = 'INDICATOR') {
  const timeout = options.timeout || 10000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    // If it's a Binance request, inject a specifically targeted API key to bypass potential IP rate limits
    if (url.includes('binance.com')) {
      let creds;
      if (intent === 'WEBSOCKET') creds = getWsKey();
      else creds = getIndicatorKey();

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
    
    const contentType = response.headers.get("content-type");
    const isHtml = contentType && contentType.includes("text/html");

    // Handle Binance Geoblocks on US environments (Render, etc.), IP Bans (429), or HTML responses from Cloudflare
    if ((!response.ok && (response.status === 451 || response.status === 403 || response.status === 429 || response.status === 418)) || (response.ok && isHtml)) {
      if (url.includes('binance.com')) {
        console.log(`[Binance] Blocked by proxy/limit. Status: ${response.status}. URL: ${url}`);
        
        // If it's a klines request, fallback to Bybit to bypass IP ban instantly
        if (url.includes('/v1/klines') || url.includes('/v1/premiumIndex') || url.includes('openInterestHist')) {
          return handleBybitFallback(url, options);
        }
      } else if (response.ok && isHtml) {
        throw new Error(`Expected JSON but received HTML from ${url}`);
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
    else if (binanceUrl.includes('openInterestHist')) {
      const bybitUrl = `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=15min&limit=2`;
      const res = await fetch(bybitUrl, options);
      if (!res.headers.get("content-type")?.includes("application/json")) {
        throw new Error("Bybit HTML error");
      }
      const data = await res.json();
      if (data.retCode === 0 && data.result?.list?.length > 0) {
        const mapped = data.result.list.reverse().map((item: any) => ({
             sumOpenInterestValue: item.openInterest
        }));
        return {
          ok: true,
          status: 200,
          json: async () => mapped
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
      { timeout: 10000 },
      'INDICATOR'
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
      .slice(0, 30) // background scanner will parse the top 30 volume pairs
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

function initBinanceWs() {
  if (binanceWs) return;
  const wsOptions: WebSocket.ClientOptions = {};
  const wsCreds = getWsKey();
  if (wsCreds && wsCreds.key) {
    wsOptions.headers = {
      "X-MBX-APIKEY": wsCreds.key
    };
  }
  binanceWs = new WebSocket('wss://fstream.binance.com/stream', wsOptions);

  binanceWs.on('open', () => {
    console.log('[Binance WS] Connected for background scanner');
    if (subscribedStreams.size > 0) {
      wsSubscribeQueue.push(...Array.from(subscribedStreams));
      processWsQueue();
    }
  });

  binanceWs.on('message', (data: WebSocket.Data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.data && msg.data.e === 'kline') {
        const s = msg.data.s;
        const i = msg.data.k.i;
        const k = msg.data.k;
        
        if (!klineCache[s]) klineCache[s] = {};
        if (!klineCache[s][i]) klineCache[s][i] = [];
        
        const arr = klineCache[s][i];
        const last = arr.length > 0 ? arr[arr.length - 1] : null;
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

        let broadcastTopTrades = false;
        for (let t = 0; t < globalFrontendTrades.length; t++) {
           if (globalFrontendTrades[t].symbol === s) {
              if (globalFrontendTrades[t].lastPrice !== candleData.close) {
                 globalFrontendTrades[t].lastPrice = candleData.close;
                 broadcastTopTrades = true;
              }
           }
        }

        if (broadcastTopTrades) {
           const now = Date.now();
           if (!klineCache['LAST_TOP_TRADES_BROADCAST'] || now - (klineCache['LAST_TOP_TRADES_BROADCAST'] as any) > 200) {
              (klineCache as any)['LAST_TOP_TRADES_BROADCAST'] = now;
              if ((global as any).broadcastToClients) {
                 (global as any).broadcastToClients({ type: 'top-trades', payload: globalFrontendTrades, signals: globalFrontendTrades });
              }
           }
        }

        if (last && last.time === openTime) {
          arr[arr.length - 1] = candleData;
        } else if (last && openTime > last.time) {
          arr.push(candleData);
          if (arr.length > 1500) arr.shift();
        } else if (!last) {
          arr.push(candleData);
        }

        const subsMap = (global as any).clientSubscriptions;
        if (subsMap) {
           let emittedKey = false;
           // We can throttle indicators if we want, but letting data stream 
           // continuously is fine as market-data-update only sends 1 object.
           const now = Date.now();
           const cKey = `${s}_${i}_last_emit` as any;
           // throttle indicators calculation to every 1s to save CPU
           const shouldCalcIndicators = !(klineCache as any)[cKey] || now - (klineCache as any)[cKey] > 1000;
           let updatedAnalysis: any = null;

           subsMap.forEach((subs: any, wsClient: any) => {
              if (wsClient.readyState === 1 && subs.some((sub: any) => sub.symbol === s && sub.interval === i)) {
                 try {
                    const payload: any = { type: 'market-data-update', symbol: s, interval: i, data: candleData };
                    if (shouldCalcIndicators) {
                        if (!updatedAnalysis) updatedAnalysis = analyzeChart(arr, undefined, [], s, i);
                        payload.indicators = updatedAnalysis;
                    }
                    wsClient.send(JSON.stringify(payload));
                 } catch(e) {}
                 emittedKey = true;
              }
           });
           
           if (emittedKey && shouldCalcIndicators) {
               (klineCache as any)[cKey] = now;
           }
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
  const streamName = `${symbol.toLowerCase()}@kline_${tf}`;
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


const inflightKlines = new Map<string, Promise<any>>();
let isRateLimitedUntil = 0;

function getTfSeconds(tf: string) {
  const value = parseInt(tf);
  if (isNaN(value)) return 60;
  const unit = tf.slice(-1);
  switch (unit) {
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: return 60;
  }
}

async function fetchKlines(symbol: string, tf: string, limit: number = 200) {
  if (!binanceWs) initBinanceWs();

  if (!klineCache[symbol]) klineCache[symbol] = {};
  
  if (klineCache[symbol][tf] && klineCache[symbol][tf].length >= 50) {
    const arr = klineCache[symbol][tf];
    const last = arr[arr.length - 1];
    const tfSecs = getTfSeconds(tf);
    // A new candle should start at (last.time + tfSecs).
    // If we are more than 5 minutes past when the next candle should have opened, it is stale.
    const isStale = (Date.now() / 1000) - last.time > (tfSecs + 300);
    if (isStale) {
      console.log(`[REST API] Cache for ${symbol} ${tf} is stale by over 5 mins, clearing...`);
      delete klineCache[symbol][tf];
    }
  } else if (klineCache[symbol][tf]) {
    // If the cache length is truncated (e.g. from partial WS tick load or failed initial warmups), clear it to require full refetch
    console.log(`[REST API] Cache for ${symbol} ${tf} is empty or truncated (${klineCache[symbol][tf].length} candles), clearing to require fresh REST warmup...`);
    delete klineCache[symbol][tf];
  }

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
          { timeout: 10000 },
          'INDICATOR'
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

  // Self-ping to keep server alive (prevent sleeping on Render free tier)
  setInterval(() => {
    try {
      if (process.env.RENDER_EXTERNAL_URL) {
        // Bounce the ping through a public proxy so Render sees it as external inbound traffic!
        const targetUrl = `${process.env.RENDER_EXTERNAL_URL}/api/health`;
        const proxyBounceUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
        fetch(proxyBounceUrl).catch(() => {});
      } else {
        const pingUrl = `http://127.0.0.1:${PORT}/api/health`;
        fetch(pingUrl).catch(() => {});
      }
    } catch(e) {}
  }, 45000);

  app.get("/api/top-trades", (req, res) => {
    res.json({ signals: globalFrontendTrades });
  });

  app.get("/api/scanner-status", (req, res) => {
    res.json({
      lastScanMetrics,
      sizingModel: getSizingModel()
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
        const entryPrice = parseFloat(trade.entry);
        const slPrice = parseFloat(trade.sl);
        const tpPrice = parseFloat(trade.tp);
        
        // Compute progressive TP1, TP2, TP3 if not provided
        const tp1 = parseFloat(trade.tp1) || (trade.type === "LONG" ? entryPrice + (entryPrice - slPrice) : entryPrice - (slPrice - entryPrice));
        const tp2 = parseFloat(trade.tp2) || (trade.type === "LONG" ? entryPrice + (entryPrice - slPrice) * 2 : entryPrice - (slPrice - entryPrice) * 2);
        const tp3 = parseFloat(trade.tp3) || tpPrice;

        const alreadyActive = !!activeTrades[trade.symbol];
        const recentlySignaled = Date.now() - (lastSignalTimestamp[trade.symbol] || 0) < 15 * 60 * 1000;

        if (!alreadyActive) {
          activeTrades[trade.symbol] = {
             symbol: trade.symbol,
             direction: trade.type || trade.direction,
             entry: entryPrice,
             tp: tpPrice,
             tp1,
             tp2,
             tp3,
             sl: slPrice,
             currentSl: slPrice,
             achieved: 1, // Set to 1 (Filled / Active instantly for manual registrations)
             isLimitEntry: false,
             hasHitTp1: false,
             hasHitTp2: false,
             hasHitTp3: false,
             registeredAt: Date.now()
          };
          lastSignalTimestamp[trade.symbol] = Date.now();
          console.log(`[Backend] Registered frontend trade for monitoring: ${trade.symbol}`);
        } else {
          console.log(`[Backend] Trade for ${trade.symbol} is already active/monitored. Skipping duplicate registration state override.`);
        }

        const botToken = process.env.VITE_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.VITE_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
        if (botToken && chatId && !alreadyActive && !recentlySignaled) {
          const directionIcon = trade.type === "LONG" ? "📈" : "📉";
          const confValue = (trade.confidence || (trade.analysis && trade.analysis.confidence) || 100).toFixed(1);
          const msg = `🪙 Pair: #${trade.symbol}
${directionIcon} Direction: ${trade.type}
  Confidence: ${confValue}%
🎯 Entry Price: ${formatPrice(entryPrice)}
🎯 TP1 (50% Booking): ${formatPrice(tp1)}
🎯 TP2 (30% Booking): ${formatPrice(tp2)}
🎯 TP3 (20% Runner): ${formatPrice(tp3)}
❌ Stop Loss: ${formatPrice(slPrice)}
🛡 Trail Mode: Move SL to Break-Even at TP1`;
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

      const response = await fetchWithTimeout(targetUrl, { timeout: 10000 }, 'INDICATOR');
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

      const response = await fetchWithTimeout(targetUrl, { timeout: 10000 }, 'INDICATOR');
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

  // Background loop
  const sentSessionNotifications = new Set<string>();

  interface ActiveTrade {
    symbol: string;
    direction: "LONG" | "SHORT";
    entry: number;
    tp: number;
    tp1: number;
    tp2: number;
    tp3: number;
    sl: number;
    currentSl: number;
    achieved: number;
    isLimitEntry: boolean;
    hasHitTp1: boolean;
    hasHitTp2: boolean;
    hasHitTp3: boolean;
    registeredAt: number;
    slUpdatedTime?: number;
  }
  const activeTrades: Record<string, ActiveTrade> = {};
  const lastSignalTimestamp: Record<string, number> = {};

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
      const requiredConfidence = 45; // Rank #1 Optimized threshold (from backtest: 45)
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

      // Process symbols simultaneously but with concurrency limit (e.g. 5 at a time) to prevent network choke
      let diagnosticCounts = { total: symbols.length, htfNeutral: 0, veto1h: 0, mtfNoTrade: 0, mtfMismatch: 0, btcConflict: 0, ltfInvalid: 0, lowConfidence: 0 };
      
      const CONCURRENCY = 5;
      for (let i = 0; i < symbols.length; i += CONCURRENCY) {
        const chunk = symbols.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(async (symbol) => {
          try {
          // 1. Fetch 3M for active trade monitoring and sniper entry
                // --- ACTIVE TRADE MONITORING (24/7) ---
          const activeTrade = activeTrades[symbol];
          const klines3m = await fetchKlines(symbol, "3m");
          let tradeClosed = false;
          if (activeTrade && klines3m.length > 0) {
              // Check if the trade is pending entry (achieved === 0)
              if (activeTrade.achieved === 0) {
                const registeredAtVal = activeTrade.registeredAt || Date.now();
                const recentCandles = klines3m.filter((c) => (c.time + 180) * 1000 >= registeredAtVal);
                let entryFilled = false;
                for (const candle of recentCandles) {
                  const currentHigh = candle.high;
                  const currentLow = candle.low;

                  if (activeTrade.direction === "LONG") {
                    if (currentLow <= activeTrade.entry) {
                      entryFilled = true;
                      break;
                    }
                  } else { // SHORT
                    if (currentHigh >= activeTrade.entry) {
                      entryFilled = true;
                      break;
                    }
                  }
                }

                if (entryFilled) {
                  activeTrade.achieved = 1; // Mark as active and filled!
                  const directionIcon = activeTrade.direction === "LONG" ? "📈" : "📉";
                  const sizeModel = getSizingModel();
                  const streakSign = sizeModel.consecutiveStreak > 0 ? "+" : "";
                  const entryAlertMsg = `🪙 Pair: #${symbol}
${directionIcon} Direction: ${activeTrade.direction}
  Confidence: 100% (Pulled back to fill)
🎯 Entry Price: ${formatPrice(activeTrade.entry)}
🎯 TP1 (50% Booking): ${formatPrice(activeTrade.tp1)}
🎯 TP2 (30% Booking): ${formatPrice(activeTrade.tp2)}
🎯 TP3 (20% Runner): ${formatPrice(activeTrade.tp3)}
❌ Stop Loss: ${formatPrice(activeTrade.sl)}
🛡 Trail Mode: Move SL to Break-Even at TP1

🔥 Current Streak: <b>${streakSign}${sizeModel.consecutiveStreak}</b> consecutive ${sizeModel.consecutiveStreak > 0 ? "wins" : "losses"}
📊 Sizing Modifier: <code>${sizeModel.mStreak.toFixed(2)}x</code>
💰 Recommended Kelly Allocation: <b>${sizeModel.recommendedSizingPercent.toFixed(1)}%</b> of Portfolio (Quarter-Kelly)`;
                  
                  sendTelegramSignal(botToken, chatId, entryAlertMsg).catch(console.error);
                }
              }

              // Evaluate active trade targets if filled
              if (activeTrade.achieved >= 1) {
                const registeredAtVal = activeTrade.registeredAt || Date.now();
                const recentCandles = klines3m.filter((c) => (c.time + 180) * 1000 >= registeredAtVal);

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
                      `🚨 <b>TRADE UPDATE: SOFT EXIT</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n${activeTrade.direction === "LONG" ? "📈" : "📉"} <b>Direction:</b> ${activeTrade.direction}\n⚠️ <b>Status:</b> Soft Exit Triggered at <code>${formatPrice(currentClose)}</code>\n🧠 <b>Reason:</b> ${softExitReason}\n💰 <b>PnL:</b> ${calculatePnL(activeTrade.entry, currentClose, activeTrade.direction)}`,
                    ).catch(console.error);
                    
                    const softPnlNum = activeTrade.direction === "LONG" ? (currentClose - activeTrade.entry) : (activeTrade.entry - currentClose);
                    recordTradeResult(softPnlNum >= 0 ? "WIN" : "LOSS");
                    
                    delete activeTrades[symbol];
                    tradeClosed = true;
                    break;
                  }

                  // Lookback protection: Avoid Same-Bar / Historical Wick violation
                  const slCheckVal = (activeTrade.slUpdatedTime && (candle.time * 1000 < activeTrade.slUpdatedTime))
                    ? activeTrade.sl // Retain original protective stop loss for retro-historical wicks
                    : activeTrade.currentSl; // Apply the tightened trailing/break-even stop loss

                  if (activeTrade.direction === "LONG") {
                    if (currentLow <= slCheckVal) {
                      console.log(
                        `[DEBUG] SL Hit for ${symbol}: Low ${currentLow}, SL ${slCheckVal}`,
                      );
                      const isBE = slCheckVal === activeTrade.entry;
                      const pnlStr = isBE ? "0.00% (B/E Secured)" : calculatePnL(activeTrade.entry, slCheckVal, "LONG");
                      const titleText = isBE ? "🛡 <b>BREAK-EVEN STOP LOSS HIT</b> 🛡" : "❌ <b>STOP LOSS HIT</b> ❌";
                      const subtitleText = isBE ? "Rest of the position exited at cost." : "Position closed at protective Stop Loss.";

                      sendTelegramSignal(
                        botToken,
                        chatId,
                        `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📈 <b>Direction:</b> LONG\n${titleText}\n⚠️ <b>Status:</b> ${subtitleText} (Price: <code>${formatPrice(slCheckVal)}</code>)\n💰 <b>PnL Secured:</b> ${pnlStr}`,
                      ).catch(console.error);
                      
                      recordTradeResult(isBE ? "WIN" : "LOSS");
                      
                      delete activeTrades[symbol];
                      tradeClosed = true;
                    } else if (!activeTrade.hasHitTp1 && currentHigh >= activeTrade.tp1) {
                      activeTrade.hasHitTp1 = true;
                      activeTrade.achieved = 2;
                      activeTrade.currentSl = activeTrade.entry; // Move SL to Break-Even!
                      activeTrade.slUpdatedTime = Date.now();

                      const pnlSegment = calculatePnL(activeTrade.entry, activeTrade.tp1, "LONG");
                      sendTelegramSignal(
                        botToken,
                        chatId,
                        `🎯 <b>TAKE PROFIT 1 ACHIEVED (50% Booked)</b> 🎯\n\n🪙 <b>Pair:</b> #${symbol}\n📈 <b>Direction:</b> LONG\n✅ <b>Target 1:</b> <code>${formatPrice(activeTrade.tp1)}</code>\n💰 <b>Secured Return:</b> ${pnlSegment} (on 50% allocation)\n🛡 <b>Risk Management:</b> Stop Loss moved to Break-Even (<code>${formatPrice(activeTrade.entry)}</code>). Trade is now 100% risk-free!`,
                      ).catch(console.error);
                    } else if (activeTrade.hasHitTp1 && !activeTrade.hasHitTp2 && currentHigh >= activeTrade.tp2) {
                      activeTrade.hasHitTp2 = true;
                      activeTrade.achieved = 3;

                      const pnlSegment = calculatePnL(activeTrade.entry, activeTrade.tp2, "LONG");
                      sendTelegramSignal(
                        botToken,
                        chatId,
                        `🎯 <b>TAKE PROFIT 2 ACHIEVED (30% Booked)</b> 🎯\n\n🪙 <b>Pair:</b> #${symbol}\n📈 <b>Direction:</b> LONG\n✅ <b>Target 2:</b> <code>${formatPrice(activeTrade.tp2)}</code>\n💰 <b>Secured Return:</b> ${pnlSegment} (on 30% allocation)\n🏃‍♂️ <b>Next:</b> Remaining 20% position running risk-free to TP3 target!`,
                      ).catch(console.error);
                    } else if (activeTrade.hasHitTp2 && !activeTrade.hasHitTp3 && currentHigh >= activeTrade.tp3) {
                      activeTrade.hasHitTp3 = true;
                      activeTrade.achieved = 4;

                      const pnlSegment = calculatePnL(activeTrade.entry, activeTrade.tp3, "LONG");
                      sendTelegramSignal(
                        botToken,
                        chatId,
                        `🎉 <b>TAKE PROFIT 3 ACHIEVED (Trade Completed)</b> 🎉\n\n🪙 <b>Pair:</b> #${symbol}\n📈 <b>Direction:</b> LONG\n✅ <b>Final Target:</b> <code>${formatPrice(activeTrade.tp3)}</code>\n💰 <b>Final Secured Return:</b> ${pnlSegment} (on remaining 20% runner)\n⭐️ <b>Status:</b> Trade successfully reached ultimate target! Enjoy the profits.`,
                      ).catch(console.error);
                      
                      recordTradeResult("WIN");
                      
                      delete activeTrades[symbol];
                      tradeClosed = true;
                    }
                  } else if (activeTrade.direction === "SHORT") {
                    if (currentHigh >= slCheckVal) {
                      console.log(
                        `[DEBUG] SL Hit for ${symbol}: High ${currentHigh}, SL ${slCheckVal}`,
                      );
                      const isBE = slCheckVal === activeTrade.entry;
                      const pnlStr = isBE ? "0.00% (B/E Secured)" : calculatePnL(activeTrade.entry, slCheckVal, "SHORT");
                      const titleText = isBE ? "🛡 <b>BREAK-EVEN STOP LOSS HIT</b> 🛡" : "❌ <b>STOP LOSS HIT</b> ❌";
                      const subtitleText = isBE ? "Rest of the position exited at cost." : "Position closed at protective Stop Loss.";

                      sendTelegramSignal(
                        botToken,
                        chatId,
                        `🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📉 <b>Direction:</b> SHORT\n${titleText}\n⚠️ <b>Status:</b> ${subtitleText} (Price: <code>${formatPrice(slCheckVal)}</code>)\n💰 <b>PnL Secured:</b> ${pnlStr}`,
                      ).catch(console.error);
                      
                      recordTradeResult(isBE ? "WIN" : "LOSS");
                      
                      delete activeTrades[symbol];
                      tradeClosed = true;
                    } else if (!activeTrade.hasHitTp1 && currentLow <= activeTrade.tp1) {
                      activeTrade.hasHitTp1 = true;
                      activeTrade.achieved = 2;
                      activeTrade.currentSl = activeTrade.entry; // Move SL to Break-Even!
                      activeTrade.slUpdatedTime = Date.now();

                      const pnlSegment = calculatePnL(activeTrade.entry, activeTrade.tp1, "SHORT");
                      sendTelegramSignal(
                        botToken,
                        chatId,
                        `🎯 <b>TAKE PROFIT 1 ACHIEVED (50% Booked)</b> 🎯\n\n🪙 <b>Pair:</b> #${symbol}\n📉 <b>Direction:</b> SHORT\n✅ <b>Target 1:</b> <code>${formatPrice(activeTrade.tp1)}</code>\n💰 <b>Secured Return:</b> ${pnlSegment} (on 50% allocation)\n🛡 <b>Risk Management:</b> Stop Loss moved to Break-Even (<code>${formatPrice(activeTrade.entry)}</code>). Trade is now 100% risk-free!`,
                      ).catch(console.error);
                    } else if (activeTrade.hasHitTp1 && !activeTrade.hasHitTp2 && currentLow <= activeTrade.tp2) {
                      activeTrade.hasHitTp2 = true;
                      activeTrade.achieved = 3;

                      const pnlSegment = calculatePnL(activeTrade.entry, activeTrade.tp2, "SHORT");
                      sendTelegramSignal(
                        botToken,
                        chatId,
                        `🎯 <b>TAKE PROFIT 2 ACHIEVED (30% Booked)</b> 🎯\n\n🪙 <b>Pair:</b> #${symbol}\n📉 <b>Direction:</b> SHORT\n✅ <b>Target 2:</b> <code>${formatPrice(activeTrade.tp2)}</code>\n💰 <b>Secured Return:</b> ${pnlSegment} (on 30% allocation)\n🏃‍♂️ <b>Next:</b> Remaining 20% position running risk-free to TP3 target!`,
                      ).catch(console.error);
                    } else if (activeTrade.hasHitTp2 && !activeTrade.hasHitTp3 && currentLow <= activeTrade.tp3) {
                      activeTrade.hasHitTp3 = true;
                      activeTrade.achieved = 4;

                      const pnlSegment = calculatePnL(activeTrade.entry, activeTrade.tp3, "SHORT");
                      sendTelegramSignal(
                        botToken,
                        chatId,
                        `🎉 <b>TAKE PROFIT 3 ACHIEVED (Trade Completed)</b> 🎉\n\n🪙 <b>Pair:</b> #${symbol}\n📉 <b>Direction:</b> SHORT\n✅ <b>Final Target:</b> <code>${formatPrice(activeTrade.tp3)}</code>\n💰 <b>Final Secured Return:</b> ${pnlSegment} (on remaining 20% runner)\n⭐️ <b>Status:</b> Trade successfully reached ultimate target! Enjoy the profits.`,
                      ).catch(console.error);
                      
                      recordTradeResult("WIN");
                      
                      delete activeTrades[symbol];
                      tradeClosed = true;
                    }
                  }
                }
              }
          }
          if (activeTrade || tradeClosed) return; // Skip generating new signals if a trade is already active or just closed
          // --- END ACTIVE TRADE MONITORING ---

          // Cooldown check: Signal of a symbol won't go twice in two hours
          const lastSigTime = lastSignalTimestamp[symbol] || 0;
          if (Date.now() - lastSigTime < 2 * 60 * 60 * 1000) {
            return; // Skip generation if already generated < 2h ago
          }

            // 2. 4H Bias Alignment
            const klines4h = await fetchKlines(symbol, "4h");
            const htfDirection = getHTFDirection(klines4h);
            const strictHtfAlignment = false; // Rank #1 Optimized Setting: disabled for higher-timeframe alignment
            if (strictHtfAlignment && htfDirection === "NEUTRAL") { diagnosticCounts.htfNeutral++; return; }

            // 2.5 1H Control Layer
            const klines1h = await fetchKlines(symbol, "1h");
            const htfBiasFor1H = htfDirection === "NEUTRAL" ? "LONG" : htfDirection;
            const control1H = get1HControlState(klines1h, htfBiasFor1H);


            // 3. 15M Confirmation (Confidence/Setup)
            const klines15m = await fetchKlines(symbol, "15m");
            const mtfAnalysis = analyzeChart(
              klines15m,
              DEFAULT_RELIABILITY,
              [],
              symbol,
            );
            if (mtfAnalysis.signal === "NO TRADE") { diagnosticCounts.mtfNoTrade++; return; }
            if (strictHtfAlignment && htfDirection !== mtfAnalysis.signal) { diagnosticCounts.mtfMismatch++; return; }

            // Upgrade 1: King Filter Application
            const useBtcFilter = false; // Rank #1 Optimized Setting: disabled for altcoins
            if (useBtcFilter && symbol !== "BTCUSDT") {
              // Altcoin LONG allowed only if BTC not bearish (LONG or NEUTRAL)
              if (mtfAnalysis.signal === "LONG" && btcTrend === "SHORT") { 
                diagnosticCounts.btcConflict++; 
                console.log(`[Reject] ${symbol}: BTC Conflict (Direction: ${mtfAnalysis.signal}, BTC: ${btcTrend})`);
                return; 
              }
              // Altcoin SHORT allowed only if BTC is not strongly bullish (SHORT or NEUTRAL)
              if (mtfAnalysis.signal === "SHORT" && btcTrend === "LONG") { 
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

            // Calculate dynamic limit entry with pullback factor of 0.45 (Rank #1 Optimized Setting)
            const originalClose = closes3m[closes3m.length - 1];
            const sl = mtfAnalysis.sl || (mtfAnalysis.signal === "LONG" ? originalClose * 0.98 : originalClose * 1.02);
            const gap = Math.abs(originalClose - sl);
            const pullbackFactor = 0.45; // 45% Pullback from backtest Rank #1
            const shift = gap * pullbackFactor;
            
            mtfAnalysis.limitEntry = mtfAnalysis.signal === "LONG" ? originalClose - shift : originalClose + shift;
            mtfAnalysis.entryStrategy = "Limit (Pullback)";

            // Premium Upgrades: OI and Funding Rate
            let premiumLogicStr = "";
            try {
              if (control1H.state === "CONTINUATION") {
                const oiRes = await fetchWithTimeout(
                  `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=15m&limit=2`,
                  { timeout: 10000 },
                  'INDICATOR'
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
              } else if (control1H.state === "WAIT") {
                const frRes = await fetchWithTimeout(
                  `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`,
                  { timeout: 10000 },
                  'INDICATOR'
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

            // 5. Combine and Send
            if (mtfAnalysis.confidence >= requiredConfidence) {
              const signalKey = `${symbol}-Multi-TF (4h, 15m, 3m)`;
              
              const entryPrice = klines3m.length > 0 ? klines3m[klines3m.length - 1].close : 0;
              const tp = mtfAnalysis.tp || 0;
              const sl = mtfAnalysis.sl || 0;

              currentFrontendTrades.push({
                symbol,
                analysis: mtfAnalysis,
                lastPrice: entryPrice,
                entryDirection: 'none'
              });

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
            } else {
              diagnosticCounts.lowConfidence++;
            }
          } catch (err) {
            console.error(
              `Error processing symbol ${symbol} in background loop:`,
              err,
            );
          }
        })); // End of chunk Promise.all mappings
        
        // Add a 1-second delay between chunks to avoid Binance burst rate limting (429 Too Many Requests)
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } // End of chunk loop

      // --- SIGNAL FILTERING & SENDING ---
      if (allSignals.length > 0) {
        for (const sig of allSignals) {
          const isLimit = !!sig.analysis.limitEntry;
          const entryPrice = sig.analysis.limitEntry || sig.entryPrice;
          
          // Compute correct progressive targets relative to the target entry
          const tp1 = sig.analysis.tp1 || (sig.analysis.signal === "LONG" ? entryPrice + (entryPrice - sig.sl) : entryPrice - (sig.sl - entryPrice));
          const tp2 = sig.analysis.tp2 || (sig.analysis.signal === "LONG" ? entryPrice + (entryPrice - sig.sl) * 2 : entryPrice - (sig.sl - entryPrice) * 2);
          const tp3 = sig.analysis.tp3 || sig.tp;

          // Determine if limit is distinctly set
          const isLimitTrue = isLimit && sig.analysis.limitEntry !== sig.entryPrice;

          activeTrades[sig.symbol] = {
            symbol: sig.symbol,
            direction: sig.analysis.signal as "LONG" | "SHORT",
            entry: entryPrice,
            tp: sig.tp,
            tp1,
            tp2,
            tp3,
            sl: sig.sl,
            currentSl: sig.sl,
            achieved: isLimitTrue ? 0 : 1, // 0: Pending Fill, 1: Filled
            isLimitEntry: isLimitTrue,
            hasHitTp1: false,
            hasHitTp2: false,
            hasHitTp3: false,
            registeredAt: Date.now(),
          };
          lastSignalTimestamp[sig.symbol] = Date.now();

          const directionEmoji =
            sig.analysis.signal === "LONG" ? "🟢 LONG" : "🔴 SHORT";
          const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const strategyStr = sig.analysis.entryStrategy
            ? `\n\n📝 Strategy: ${escapeHtml(sig.analysis.entryStrategy)}`
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
              
          const logicStr = escapeHtml(logicStrRaw);

          const sizeModel = getSizingModel();
          const streakSign = sizeModel.consecutiveStreak > 0 ? "+" : "";
          const riskSizingStr = `\n\n🔥 Current Streak: <b>${streakSign}${sizeModel.consecutiveStreak}</b> consecutive ${sizeModel.consecutiveStreak > 0 ? "wins" : "losses"}\n📊 Sizing Modifier: <code>${sizeModel.mStreak.toFixed(2)}x</code>\n💰 Recommended Kelly Allocation: <b>${sizeModel.recommendedSizingPercent.toFixed(1)}%</b> of Portfolio (Quarter-Kelly)`;

          let message = "";
          const directionIcon = sig.analysis.signal === "LONG" ? "📈" : "📉";
          const confValue = (sig.analysis.confidence || 0).toFixed(1);
          if (isLimitTrue) {
            message = `🪙 Pair: #${sig.symbol}
${directionIcon} Direction: ${sig.analysis.signal}
  Confidence: ${confValue}%
🎯 Entry Price: ${formatPrice(sig.entryPrice)}
🎯 Limit Entry Price: ${formatPrice(entryPrice)}
🎯 TP1 (50% Booking): ${formatPrice(tp1)}
🎯 TP2 (30% Booking): ${formatPrice(tp2)}
🎯 TP3 (20% Runner): ${formatPrice(tp3)}
❌ Stop Loss: ${formatPrice(sig.sl)}
🛡 Trail Mode: Move SL to Break-Even at TP1${riskSizingStr}`;
          } else {
            message = `🪙 Pair: #${sig.symbol}
${directionIcon} Direction: ${sig.analysis.signal}
  Confidence: ${confValue}%
🎯 Entry Price: ${formatPrice(entryPrice)}
🎯 TP1 (50% Booking): ${formatPrice(tp1)}
🎯 TP2 (30% Booking): ${formatPrice(tp2)}
🎯 TP3 (20% Runner): ${formatPrice(tp3)}
❌ Stop Loss: ${formatPrice(sig.sl)}
🛡 Trail Mode: Move SL to Break-Even at TP1${riskSizingStr}`;
          }

          const bullishImageUrl =
            "https://quickchart.io/chart?c=" + encodeURIComponent("{type:'line',data:{labels:['1','2','3','4','5','6','7'],datasets:[{label:'Bullish',data:[10,15,13,22,18,28,35],borderColor:'rgb(16,185,129)',backgroundColor:'rgba(16,185,129,0.2)',fill:true}]},options:{legend:{display:false},scales:{xAxes:[{display:false}],yAxes:[{display:false}]}}}");
          const bearishImageUrl =
            "https://quickchart.io/chart?c=" + encodeURIComponent("{type:'line',data:{labels:['1','2','3','4','5','6','7'],datasets:[{label:'Bearish',data:[35,28,32,20,24,15,10],borderColor:'rgb(244,63,94)',backgroundColor:'rgba(244,63,94,0.2)',fill:true}]},options:{legend:{display:false},scales:{xAxes:[{display:false}],yAxes:[{display:false}]}}}");
          const imageUrl =
            sig.analysis.signal === "LONG" ? bullishImageUrl : bearishImageUrl;

          sendTelegramSignal(botToken, chatId, message, imageUrl).catch(console.error);
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
      
      const cooldowns: Record<string, number> = {};
      const nowMs = Date.now();
      for (const [sym, ts] of Object.entries(lastSignalTimestamp)) {
        const remaining = 2 * 60 * 60 * 1000 - (nowMs - ts);
        if (remaining > 0) {
          cooldowns[sym] = Math.ceil(remaining / 1000); // remaining seconds
        }
      }

      lastScanMetrics = {
          timestamp: Date.now(),
          symbolsCount: symbols.length,
          btcTrend,
          diagnosticCounts,
          signalCandidatesCount: allSignals.length,
          cooldowns
      };

      if ((global as any).broadcastToClients) {
          (global as any).broadcastToClients({ type: 'top-trades', payload: globalFrontendTrades });
          // Note: Since multiAnalysis uses the indicators from top-trades analysis, 
          // we can also extract indicators or just let frontend extract it.
      }

    } catch (err) {
      console.error("Error in background loop:", err);
    } finally {
      setTimeout(runBackgroundLoop, 60000); // Check every minute
    }
  };
  // Sequential Cache pre-warmup routine at server boot to stay 100% compliant with API Limits
  console.log("🌟 [Warmup] Initiating background pre-warmup stage for top volume coin markets...");
  (async () => {
    try {
      const topSymbols = await fetchTopSymbols();
      console.log(`[Warmup] Retrieved ${topSymbols.length} core symbols. Spreading REST api warmups to respect limits.`);
      for (let sIdx = 0; sIdx < topSymbols.length; sIdx++) {
         const symbol = topSymbols[sIdx];
         const timeframes = ["3m", "15m", "1h", "4h"];
         console.log(`[Warmup] Loading [${sIdx + 1}/${topSymbols.length}] ${symbol} indicators...`);
         for (const tf of timeframes) {
             try {
                await fetchKlines(symbol, tf);
                // Introduce 150ms sequential gap to avoid burst fatigue on API
                await new Promise((resolve) => setTimeout(resolve, 150));
             } catch (wErr: any) {
                console.error(`[Warmup Warning] Minor issue on ${symbol} ${tf}:`, wErr.message);
             }
         }
      }
      console.log("🌟 [Warmup] Sequential cache warmup completely finalized! Real-time WS handlers will hold cache hot.");
    } catch (warmupErr) {
      console.error("[Warmup Fatal] Cache pre-warm up failed:", warmupErr);
    }
  })();

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

  const httpServer = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const { WebSocketServer } = await import('ws');
  const wss = new WebSocketServer({ server: httpServer });

  const clientSubscriptions = new Map<any, { symbol: string, interval: string }[]>();

  wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket');
    
    // Send current active trades immediately
    ws.send(JSON.stringify({ type: 'top-trades', data: Object.values(activeTrades) }));

    ws.on('message', (message) => {
      try {
        const msg = JSON.parse(message.toString());
        if (msg.type === 'subscribe') {
           const subs = clientSubscriptions.get(ws) || [];
           subs.push({ symbol: msg.symbol, interval: msg.interval });
           clientSubscriptions.set(ws, subs);
           subscribeToWs(msg.symbol, msg.interval);
           
           fetchKlines(msg.symbol, msg.interval).then(klines => {
              try {
                const analysis = analyzeChart(klines, undefined, [], msg.symbol, msg.interval);
                ws.send(JSON.stringify({ type: 'market-data', symbol: msg.symbol, interval: msg.interval, data: klines, indicators: analysis }));
              } catch (e) { console.error(e) }
           });
        } else if (msg.type === 'unsubscribe') {
           let subs = clientSubscriptions.get(ws) || [];
           subs = subs.filter(s => !(s.symbol === msg.symbol && s.interval === msg.interval));
           clientSubscriptions.set(ws, subs);
        }
      } catch(e){}
    });

    ws.on('close', () => {
      clientSubscriptions.delete(ws);
      console.log('Client disconnected');
    });
  });

  (global as any).clientSubscriptions = clientSubscriptions;

  // Make wss accessible to other functions if needed, or broadcast from runBackgroundLoop
  // Oh wait, I can just export or pass it, but since it's inside startServer I'll just use a local reference
  // We can inject a lightweight broadcast function.
  (global as any).broadcastToClients = (payload: any) => {
    wss.clients.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(JSON.stringify(payload));
      }
    });
  };
}

startServer();
