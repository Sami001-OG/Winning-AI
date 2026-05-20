import fetch from "node-fetch";
import { analyzeChart } from "./analysis.ts";
import { getHTFDirection, get1HControlState, validateLTFEntry } from "./multiTimeframe.ts";
import { Candle, Trade, AnalysisResult } from "./types.ts";
import { EMA } from "technicalindicators";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT"];

interface BacktestConfig {
  name: string;
  confidenceThreshold: number;
  useBtcFilter: boolean;
  strictHtfAlignment: boolean;
  use1HControlState: boolean;
  pullbackFactor: number; // 0 = market entry (close price), 0.3 = buy pullback 30% closer to Stop Loss, etc.
}

interface BacktestTrade {
  symbol: string;
  direction: "LONG" | "SHORT";
  entryTime: number;
  entryPrice: number;
  tp: number;
  tp1: number;
  tp2: number;
  tp3: number;
  sl: number;
  exitTime?: number;
  exitPrice?: number;
  pnlPercentage: number;
  status: "PENDING" | "SUCCESS" | "FAILED" | "TIMED_OUT";
  reason: string;
  confidence: number;
  hasHitTp1: boolean;
  hasHitTp2: boolean;
  currentSl: number;
}

async function fetchKlinesWithRetry(symbol: string, interval: string, limit: number = 1000): Promise<Candle[]> {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (res.status === 429 || res.status === 418) {
        await sleep(attempt * 2000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const data = await res.json() as any[];
      return data.map((d) => ({
        time: Math.floor(d[0] / 1000),
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5]),
        isFinal: true
      }));
    } catch {
      await sleep(1000);
    }
  }
  return [];
}

function getBtcTrend(btc15m: Candle[]): "LONG" | "SHORT" | "NEUTRAL" {
  if (btc15m.length < 50) return "NEUTRAL";
  const closes = btc15m.map(c => c.close);
  const ema20 = EMA.calculate({ values: closes, period: 20 });
  const ema50 = EMA.calculate({ values: closes, period: 50 });
  const lastEma20 = ema20[ema20.length - 1] || 0;
  const lastEma50 = ema50[ema50.length - 1] || 0;
  const lastClose = closes[closes.length - 1];
  
  if (lastClose > lastEma20 && lastEma20 > lastEma50) return "LONG";
  if (lastClose < lastEma20 && lastEma20 < lastEma50) return "SHORT";
  return "NEUTRAL";
}

async function runBacktestSuite() {
  console.log("================================================================================");
  console.log("🔥 STARTING AUTOMATED HIGH-PRECISION STRATEGY OPTIMIZATION ENGINE 🔥");
  console.log("================================================================================");
  
  console.log("📥 Loading real cryptocurrency candle datasets (1,000 candles per interval)...");
  
  const dataStore: Record<string, {
    "4h": Candle[];
    "1h": Candle[];
    "15m": Candle[];
    "3m": Candle[];
  }> = {};
  
  for (const symbol of SYMBOLS) {
    process.stdout.write(`  📥 loading ${symbol}... `);
    try {
      const k4h = await fetchKlinesWithRetry(symbol, "4h", 600);
      const k1h = await fetchKlinesWithRetry(symbol, "1h", 1000);
      const k15m = await fetchKlinesWithRetry(symbol, "15m", 1000);
      const k3m = await fetchKlinesWithRetry(symbol, "3m", 1200);
      
      dataStore[symbol] = { "4h": k4h, "1h": k1h, "15m": k15m, "3m": k3m };
      console.log(`OK [4H:${k4h.length}, 1H:${k1h.length}, 15M:${k15m.length}, 3M:${k3m.length}]`);
      await new Promise(r => setTimeout(r, 100));
    } catch {
      console.log("FAILED to fetch. Skipping...");
    }
  }
  
  const BTC_SYMBOL = "BTCUSDT";
  if (!dataStore[BTC_SYMBOL]) {
    console.error("Critical error: BTCUSDT data missing. Re-try execution.");
    return;
  }

  // Define 12 robust optimization settings representing different dimensional priorities
  const OPTIMIZATION_GRID: BacktestConfig[] = [
    { name: "Config #1 (Standard Default)", confidenceThreshold: 60, useBtcFilter: true, strictHtfAlignment: true, use1HControlState: true, pullbackFactor: 0.0 },
    { name: "Config #2 (Default + 25% Pullback)", confidenceThreshold: 60, useBtcFilter: true, strictHtfAlignment: true, use1HControlState: true, pullbackFactor: 0.25 },
    { name: "Config #3 (Default + 40% Pullback)", confidenceThreshold: 60, useBtcFilter: true, strictHtfAlignment: true, use1HControlState: true, pullbackFactor: 0.40 },
    { name: "Config #4 (Relaxed Filter - Conf 55)", confidenceThreshold: 55, useBtcFilter: true, strictHtfAlignment: true, use1HControlState: true, pullbackFactor: 0.0 },
    { name: "Config #5 (Relaxed Filter + 30% Pullback)", confidenceThreshold: 55, useBtcFilter: true, strictHtfAlignment: true, use1HControlState: true, pullbackFactor: 0.30 },
    { name: "Config #6 (No BTC Filter)", confidenceThreshold: 60, useBtcFilter: false, strictHtfAlignment: true, use1HControlState: true, pullbackFactor: 0.0 },
    { name: "Config #7 (No BTC Filter + 25% Pullback)", confidenceThreshold: 60, useBtcFilter: false, strictHtfAlignment: true, use1HControlState: true, pullbackFactor: 0.25 },
    { name: "Config #8 (No BTC Filter + 40% Pullback)", confidenceThreshold: 60, useBtcFilter: false, strictHtfAlignment: true, use1HControlState: true, pullbackFactor: 0.40 },
    { name: "Config #9 (Hyper-Yield - Conf 50 + No BTC Filter)", confidenceThreshold: 50, useBtcFilter: false, strictHtfAlignment: true, use1HControlState: true, pullbackFactor: 0.0 },
    { name: "Config #10 (Hyper-Yield + 30% Pullback Entry)", confidenceThreshold: 50, useBtcFilter: false, strictHtfAlignment: true, use1HControlState: true, pullbackFactor: 0.30 },
    { name: "Config #11 (Hyper-Yield + 50% Extreme Pullback)", confidenceThreshold: 50, useBtcFilter: false, strictHtfAlignment: true, use1HControlState: true, pullbackFactor: 0.50 },
    { name: "Config #12 (Ultra-Conservative - Conf 65 + 30% Pullback)", confidenceThreshold: 65, useBtcFilter: true, strictHtfAlignment: true, use1HControlState: true, pullbackFactor: 0.30 }
  ];

  const results: Array<{
    configName: string;
    trades: number;
    winRate: number;
    pnl: number;
    profitFactor: number;
    freq: number;
  }> = [];

  for (const config of OPTIMIZATION_GRID) {
    let totalExecutedTrades = 0;
    let successfulTrades = 0;
    let failedTrades = 0;
    let totalPnl = 0;
    let totalProfits = 0;
    let totalLosses = 0;
    
    // Step through each coin
    for (const symbol of Object.keys(dataStore)) {
      const { "4h": all4h, "1h": all1h, "15m": all15m, "3m": all3m } = dataStore[symbol];
      let pendingTrade: BacktestTrade | null = null;
      
      const startIdx = 200;
      const endIdx = all15m.length - 1;
      
      for (let i = startIdx; i < endIdx; i++) {
        const current15mCandle = all15m[i];
        const currentTime = current15mCandle.time;
        
        if (pendingTrade) {
          const outcomeLow = current15mCandle.low;
          const outcomeHigh = current15mCandle.high;
          
          if (pendingTrade.direction === "LONG") {
            // Check TP1
            if (!pendingTrade.hasHitTp1 && outcomeHigh >= pendingTrade.tp1) {
              pendingTrade.hasHitTp1 = true;
              pendingTrade.pnlPercentage += ((pendingTrade.tp1 - pendingTrade.entryPrice) / pendingTrade.entryPrice) * 100 * 10 * 0.5;
              pendingTrade.currentSl = pendingTrade.entryPrice; // Save trade with Breakeven
            }
            // Check TP2
            if (pendingTrade.hasHitTp1 && !pendingTrade.hasHitTp2 && outcomeHigh >= pendingTrade.tp2) {
              pendingTrade.hasHitTp2 = true;
              pendingTrade.pnlPercentage += ((pendingTrade.tp2 - pendingTrade.entryPrice) / pendingTrade.entryPrice) * 100 * 10 * 0.3;
            }
            // Check SL
            if (outcomeLow <= pendingTrade.currentSl) {
              pendingTrade.exitTime = currentTime;
              pendingTrade.exitPrice = pendingTrade.currentSl;
              if (!pendingTrade.hasHitTp1) {
                pendingTrade.status = "FAILED";
                pendingTrade.pnlPercentage = ((pendingTrade.currentSl - pendingTrade.entryPrice) / pendingTrade.entryPrice) * 100 * 10;
              } else {
                pendingTrade.status = "SUCCESS";
              }
              if (pendingTrade.pnlPercentage > 0) {
                successfulTrades++;
                totalProfits += pendingTrade.pnlPercentage;
              } else {
                failedTrades++;
                totalLosses += Math.abs(pendingTrade.pnlPercentage);
              }
              totalPnl += pendingTrade.pnlPercentage;
              pendingTrade = null;
            }
            // Check TP3
            else if (outcomeHigh >= pendingTrade.tp3) {
              pendingTrade.status = "SUCCESS";
              pendingTrade.exitTime = currentTime;
              pendingTrade.exitPrice = pendingTrade.tp3;
              const remainingWeight = 1.0 - (pendingTrade.hasHitTp1 ? 0.5 : 0) - (pendingTrade.hasHitTp2 ? 0.3 : 0);
              pendingTrade.pnlPercentage += ((pendingTrade.tp3 - pendingTrade.entryPrice) / pendingTrade.entryPrice) * 100 * 10 * remainingWeight;
              successfulTrades++;
              totalProfits += pendingTrade.pnlPercentage;
              totalPnl += pendingTrade.pnlPercentage;
              pendingTrade = null;
            }
            // 24H Timeout
            else if (currentTime - pendingTrade.entryTime > 24 * 3600) {
              pendingTrade.status = "TIMED_OUT";
              pendingTrade.exitTime = currentTime;
              pendingTrade.exitPrice = current15mCandle.close;
              const remainingWeight = 1.0 - (pendingTrade.hasHitTp1 ? 0.5 : 0) - (pendingTrade.hasHitTp2 ? 0.3 : 0);
              pendingTrade.pnlPercentage += ((current15mCandle.close - pendingTrade.entryPrice) / pendingTrade.entryPrice) * 100 * 10 * remainingWeight;
              if (pendingTrade.pnlPercentage > 0) {
                successfulTrades++;
                totalProfits += pendingTrade.pnlPercentage;
              } else {
                failedTrades++;
                totalLosses += Math.abs(pendingTrade.pnlPercentage);
              }
              totalPnl += pendingTrade.pnlPercentage;
              pendingTrade = null;
            }
          } else { // SHORT
            // Check TP1
            if (!pendingTrade.hasHitTp1 && outcomeLow <= pendingTrade.tp1) {
              pendingTrade.hasHitTp1 = true;
              pendingTrade.pnlPercentage += ((pendingTrade.entryPrice - pendingTrade.tp1) / pendingTrade.entryPrice) * 100 * 10 * 0.5;
              pendingTrade.currentSl = pendingTrade.entryPrice;
            }
            // Check TP2
            if (pendingTrade.hasHitTp1 && !pendingTrade.hasHitTp2 && outcomeLow <= pendingTrade.tp2) {
              pendingTrade.hasHitTp2 = true;
              pendingTrade.pnlPercentage += ((pendingTrade.entryPrice - pendingTrade.tp2) / pendingTrade.entryPrice) * 100 * 10 * 0.3;
            }
            // Check SL
            if (outcomeHigh >= pendingTrade.currentSl) {
              pendingTrade.exitTime = currentTime;
              pendingTrade.exitPrice = pendingTrade.currentSl;
              if (!pendingTrade.hasHitTp1) {
                pendingTrade.status = "FAILED";
                pendingTrade.pnlPercentage = ((pendingTrade.entryPrice - pendingTrade.currentSl) / pendingTrade.entryPrice) * 100 * 10;
              } else {
                pendingTrade.status = "SUCCESS";
              }
              if (pendingTrade.pnlPercentage > 0) {
                successfulTrades++;
                totalProfits += pendingTrade.pnlPercentage;
              } else {
                failedTrades++;
                totalLosses += Math.abs(pendingTrade.pnlPercentage);
              }
              totalPnl += pendingTrade.pnlPercentage;
              pendingTrade = null;
            }
            // Check TP3
            else if (outcomeLow <= pendingTrade.tp3) {
              pendingTrade.status = "SUCCESS";
              pendingTrade.exitTime = currentTime;
              pendingTrade.exitPrice = pendingTrade.tp3;
              const remainingWeight = 1.0 - (pendingTrade.hasHitTp1 ? 0.5 : 0) - (pendingTrade.hasHitTp2 ? 0.3 : 0);
              pendingTrade.pnlPercentage += ((pendingTrade.entryPrice - pendingTrade.tp3) / pendingTrade.entryPrice) * 100 * 10 * remainingWeight;
              successfulTrades++;
              totalProfits += pendingTrade.pnlPercentage;
              totalPnl += pendingTrade.pnlPercentage;
              pendingTrade = null;
            }
            // 24H Timeout
            else if (currentTime - pendingTrade.entryTime > 24 * 3600) {
              pendingTrade.status = "TIMED_OUT";
              pendingTrade.exitTime = currentTime;
              pendingTrade.exitPrice = current15mCandle.close;
              const remainingWeight = 1.0 - (pendingTrade.hasHitTp1 ? 0.5 : 0) - (pendingTrade.hasHitTp2 ? 0.3 : 0);
              pendingTrade.pnlPercentage += ((pendingTrade.entryPrice - current15mCandle.close) / pendingTrade.entryPrice) * 100 * 10 * remainingWeight;
              if (pendingTrade.pnlPercentage > 0) {
                successfulTrades++;
                totalProfits += pendingTrade.pnlPercentage;
              } else {
                failedTrades++;
                totalLosses += Math.abs(pendingTrade.pnlPercentage);
              }
              totalPnl += pendingTrade.pnlPercentage;
              pendingTrade = null;
            }
          }
        }
        
        if (pendingTrade) continue;
        
        const limit15m = all15m.slice(0, i + 1);
        const limit4h = all4h.filter(k => k.time <= currentTime);
        const limit1h = all1h.filter(k => k.time <= currentTime);
        const limit3m = all3m.filter(k => k.time <= currentTime);
        
        if (limit4h.length < 50 || limit1h.length < 50 || limit15m.length < 50 || limit3m.length < 50) continue;
        
        const htfDirection = getHTFDirection(limit4h);
        if (config.strictHtfAlignment && htfDirection === "NEUTRAL") continue;
        
        const htfBiasFor1H = htfDirection === "NEUTRAL" ? "LONG" : htfDirection;
        const control1H = get1HControlState(limit1h, htfBiasFor1H);
        if (config.use1HControlState && control1H.state === "WAIT") continue;
        
        const mtfAnalysis = analyzeChart(
          limit15m,
          { ema: 1.5, macd: 0.5, rsi: 1.5, stoch: 0.5, cci: 0.25, vol: 1.2, obv: 1.2 },
          [],
          symbol,
        );
        
        if (mtfAnalysis.signal === "NO TRADE") continue;
        if (config.strictHtfAlignment && htfDirection !== mtfAnalysis.signal) continue;
        
        // Asymmetric King Filter
        if (config.useBtcFilter && symbol !== BTC_SYMBOL) {
          const btc15m_at_currentTime = dataStore[BTC_SYMBOL]["15m"].filter(k => k.time <= currentTime);
          const btcTrend = getBtcTrend(btc15m_at_currentTime);
          
          if (mtfAnalysis.signal === "LONG" && btcTrend === "SHORT") continue;
          if (mtfAnalysis.signal === "SHORT" && btcTrend === "LONG") continue;
        }
        
        const ltfValidation = validateLTFEntry(limit3m, mtfAnalysis.signal as "LONG" | "SHORT");
        if (!ltfValidation.isValid) continue;
        
        // Entry Trigger and Pullback Logic
        const originalClose = current15mCandle.close;
        const sl = mtfAnalysis.sl || (mtfAnalysis.signal === "LONG" ? originalClose * 0.98 : originalClose * 1.02);
        
        // Calculate dynamic entry with pullback buffer
        let entryPrice = originalClose;
        if (config.pullbackFactor > 0) {
          // LONG: entry is lower than current close (closer to stop loss)
          // SHORT: entry is higher than current close (closer to stop loss)
          const gap = Math.abs(originalClose - sl);
          const shift = gap * config.pullbackFactor;
          entryPrice = mtfAnalysis.signal === "LONG" ? originalClose - shift : originalClose + shift;
        }
        
        const confidence = mtfAnalysis.confidence;
        if (confidence < config.confidenceThreshold) continue;
        
        const tp = mtfAnalysis.tp || (mtfAnalysis.signal === "LONG" ? entryPrice * 1.05 : entryPrice * 0.95);
        const tp1 = mtfAnalysis.tp1 || (mtfAnalysis.signal === "LONG" ? entryPrice + (entryPrice - sl) : entryPrice - (sl - entryPrice));
        const tp2 = mtfAnalysis.tp2 || (mtfAnalysis.signal === "LONG" ? entryPrice + (entryPrice - sl) * 2 : entryPrice - (sl - entryPrice) * 2);
        const tp3 = mtfAnalysis.tp3 || tp;
        
        pendingTrade = {
          symbol,
          direction: mtfAnalysis.signal as "LONG" | "SHORT",
          entryTime: currentTime,
          entryPrice,
          tp,
          tp1,
          tp2,
          tp3,
          sl,
          pnlPercentage: 0,
          status: "PENDING",
          reason: mtfAnalysis.confluences?.supporting.join(", ") || "",
          confidence,
          hasHitTp1: false,
          hasHitTp2: false,
          currentSl: sl
        };
        
        totalExecutedTrades++;
      }
    }
    
    const winRate = totalExecutedTrades > 0 ? (successfulTrades / totalExecutedTrades) * 100 : 0;
    const profitFactor = totalLosses > 0 ? totalProfits / totalLosses : totalProfits;
    const days = 10.4;
    const signalsPerDay = totalExecutedTrades / days;

    results.push({
      configName: config.name,
      trades: totalExecutedTrades,
      winRate,
      pnl: totalPnl,
      profitFactor,
      freq: signalsPerDay
    });
  }

  // Sort and print optimization grid ranking
  console.log("\n================================================================================");
  console.log("🏁 OPTIMIZATION GRID SEARCH COMPLETED - WINNER RANKINGS (SORTED BY NET PNL) 🏁");
  console.log("================================================================================");
  results.sort((a, b) => b.pnl - a.pnl);

  results.forEach((r, idx) => {
    const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "  ";
    console.log(`${medal} Rank #${idx+1}: ${r.configName}`);
    console.log(`     ├─ PnL (Leveraged): ${r.pnl >= 0 ? "+" : ""}${r.pnl.toFixed(2)}% (10x Leverage)`);
    console.log(`     ├─ Win Rate:        ${r.winRate.toFixed(1)}%`);
    console.log(`     ├─ Total Signals:   ${r.trades} (${r.freq.toFixed(2)} signals/day)`);
    console.log(`     └─ Profit Factor:   ${r.profitFactor.toFixed(2)}`);
  });
}

import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename || process.argv[1]?.endsWith("backtest.ts")) {
  runBacktestSuite().catch(console.error);
}
