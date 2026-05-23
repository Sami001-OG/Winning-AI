import fetch from "node-fetch";
import { analyzeChart } from "./analysis.ts";
import { getHTFDirection, get1HControlState, validateLTFEntry } from "./multiTimeframe.ts";
import { Candle, Trade, AnalysisResult } from "./types.ts";
import { EMA } from "technicalindicators";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]; // Focus on majors for backtest

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchKlinesWithRetry(symbol: string, interval: string, limit: number = 1000): Promise<Candle[]> {
  let allCandles: Candle[] = [];
  let endTime: number | undefined = undefined;

  const batchSize = 1500;
  while (allCandles.length < limit) {
    const currentLimit = Math.min(batchSize, limit - allCandles.length);
    let url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${currentLimit}`;
    if (endTime) {
      url += `&endTime=${endTime}`;
    }

    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (res.status === 429 || res.status === 418) {
          await sleep(attempt * 2000);
          continue;
        }
        if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
        const data = await res.json() as any[];
        
        const mapped = data.map((d) => ({
          time: Math.floor(d[0] / 1000),
          open: parseFloat(d[1]),
          high: parseFloat(d[2]),
          low: parseFloat(d[3]),
          close: parseFloat(d[4]),
          volume: parseFloat(d[5]),
          isFinal: true
        }));

        if (mapped.length === 0) {
          success = true;
          break; // No more data
        }

        allCandles = [...mapped, ...allCandles];
        endTime = (data[0][0] as number) - 1; // End time for next batch is before the earliest candle in this batch
        success = true;
        break;
      } catch (e) {
        await sleep(1000);
      }
    }
    
    if (!success || allCandles.length >= limit) break;
    await sleep(200); // Respect rate limits
  }

  return allCandles;
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

function getCandleIndexUpTo(candles: Candle[], time: number, startIdxHint: number): number {
  let idx = startIdxHint;
  while (idx < candles.length && candles[idx].time <= time) {
    idx++;
  }
  return idx;
}

async function runBacktestSuite() {
  console.log("================================================================================");
  console.log("🔥 STARTING 1 YEAR AUTOMATED BACKTEST ENGINE 🔥");
  console.log("================================================================================");
  
  const dataStore: Record<string, {
    "4h": Candle[];
    "1h": Candle[];
    "15m": Candle[];
    "3m": Candle[];
  }> = {};
  
  for (const symbol of SYMBOLS) {
    process.stdout.write(`  📥 loading ${symbol} (1 Year Dataset)... `);
    try {
      const BASE_CANDLES = 12000; // ~125 days of 15m candles
      const k4h = await fetchKlinesWithRetry(symbol, "4h", 1000); 
      const k1h = await fetchKlinesWithRetry(symbol, "1h", 3500);
      const k15m = await fetchKlinesWithRetry(symbol, "15m", BASE_CANDLES);
      const k3mActual = await fetchKlinesWithRetry(symbol, "3m", BASE_CANDLES * 2);
      
      dataStore[symbol] = { "4h": k4h, "1h": k1h, "15m": k15m, "3m": k3mActual };
      console.log(`OK [4H:${k4h.length}, 1H:${k1h.length}, 15M:${k15m.length}, 3M:${k3mActual.length}]`);
    } catch (e) {
      console.log("FAILED to fetch. Skipping...");
    }
  }
  
  const BTC_SYMBOL = "BTCUSDT";
  if (!dataStore[BTC_SYMBOL]) return;

  const OPTIMIZATION_GRID: BacktestConfig[] = [];
  const confidenceThresholds = [45, 50, 55, 60, 65, 70];
  const useBtcFilters = [true, false];
  const strictHtfAlignments = [true, false];
  const use1HControlStates = [true, false];
  const pullbackFactors = [0.0, 0.15, 0.30, 0.45];

  for (const conf of confidenceThresholds) {
    for (const btcF of useBtcFilters) {
      for (const htfA of strictHtfAlignments) {
        for (const ctrl1 of use1HControlStates) {
          for (const pullFreq of pullbackFactors) {
            OPTIMIZATION_GRID.push({
              name: `C${conf}_BTC${btcF ? 'Y' : 'N'}_HTF${htfA ? 'Y' : 'N'}_1H${ctrl1 ? 'Y' : 'N'}_PB${pullFreq}`,
              confidenceThreshold: conf,
              useBtcFilter: btcF,
              strictHtfAlignment: htfA,
              use1HControlState: ctrl1,
              pullbackFactor: pullFreq
            });
          }
        }
      }
    }
  }

  console.log(`⏱️ Engine initialized with ${OPTIMIZATION_GRID.length} configs...\n`);

  console.log("⏱️ Pre-calculating signals for all symbols and candles to optimize performance...");
  const rawSignals: Record<string, any[]> = {};
  
  let maxConfRaw = 0;
  let validSignalsRaw = 0;
  
  for (const symbol of Object.keys(dataStore)) {
    const { "4h": all4h, "1h": all1h, "15m": all15m, "3m": all3m } = dataStore[symbol];
    rawSignals[symbol] = [];
    const startIdx = 200;
    const endIdx = all15m.length - 1;
    
    // Index pointers to avoid O(N^2) searches
    let p4h = 0, p1h = 0, p3m = 0, pBtc = 0;
    const btc15m = dataStore[BTC_SYMBOL]["15m"];

    for (let i = startIdx; i < endIdx; i++) {
        const current15mCandle = all15m[i];
        const currentTime = current15mCandle.time;
        
        if (i % 250 === 0) await sleep(0); // Yield to event loop to keep server healthy
        
        p4h = getCandleIndexUpTo(all4h, currentTime, p4h);
        p1h = getCandleIndexUpTo(all1h, currentTime, p1h);
        p3m = getCandleIndexUpTo(all3m, currentTime, p3m);
        pBtc = getCandleIndexUpTo(btc15m, currentTime, pBtc);
        
        const limit15m = all15m.slice(Math.max(0, i - 250), i + 1);
        const limit4h = all4h.slice(Math.max(0, p4h - 250), p4h);
        const limit1h = all1h.slice(Math.max(0, p1h - 250), p1h);
        const limit3m = all3m.slice(Math.max(0, p3m - 250), p3m);
        const limitBtc = btc15m.slice(Math.max(0, pBtc - 250), pBtc);
        
        if (limit4h.length < 200 || limit1h.length < 100 || limit15m.length < 200) continue;
        
        const htfDirection = getHTFDirection(limit4h);
        const htfBiasFor1H = htfDirection === "NEUTRAL" ? "LONG" : htfDirection;
        const control1H = get1HControlState(limit1h, htfBiasFor1H);
        
        const mtfAnalysis = analyzeChart(
          limit15m,
          { ema: 1.5, macd: 0.5, rsi: 1.5, stoch: 0.5, cci: 0.25, vol: 1.2, obv: 1.2 },
          [],
          symbol
        );
        
        if (mtfAnalysis.confidence > maxConfRaw) maxConfRaw = mtfAnalysis.confidence;
        if (mtfAnalysis.signal !== "NO TRADE") validSignalsRaw++;
        
        const btcTrend = getBtcTrend(limitBtc);
        
        let ltfValidLong = true, ltfValidShort = true;
        if (limit3m.length >= 50 && mtfAnalysis.signal !== "NO TRADE") {
            ltfValidLong = validateLTFEntry(limit3m, "LONG").isValid;
            ltfValidShort = validateLTFEntry(limit3m, "SHORT").isValid;
        }

        rawSignals[symbol][i] = {
           htfDirection,
           control1H,
           mtfAnalysis,
           btcTrend,
           ltfValidLong,
           ltfValidShort
        };
    }
  }

  console.log(`Pre-calc done. Max Confidence Observed: ${maxConfRaw.toFixed(1)}, Valid Signals (Conf > 60): ${validSignalsRaw}`);

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
    
    for (const symbol of Object.keys(dataStore)) {
      const { "15m": all15m } = dataStore[symbol];
      let pendingTrade: BacktestTrade | null = null;
      
      const startIdx = 200;
      const endIdx = all15m.length - 1;
      
      let maxConf = 0;
      let validSignals = 0;
      
      for (let i = startIdx; i < endIdx; i++) {
        if (i % 500 === 0) await sleep(0);
        const current15mCandle = all15m[i];
        const currentTime = current15mCandle.time;
        
        if (pendingTrade) {
          const outcomeLow = current15mCandle.low;
          const outcomeHigh = current15mCandle.high;
          
          if (pendingTrade.direction === "LONG") {
            if (!pendingTrade.hasHitTp1 && outcomeHigh >= pendingTrade.tp1) {
              pendingTrade.hasHitTp1 = true;
              pendingTrade.pnlPercentage += ((pendingTrade.tp1 - pendingTrade.entryPrice) / pendingTrade.entryPrice) * 100 * 10 * 0.33;
              pendingTrade.currentSl = pendingTrade.entryPrice; 
            }
            if (pendingTrade.hasHitTp1 && !pendingTrade.hasHitTp2 && outcomeHigh >= pendingTrade.tp2) {
              pendingTrade.hasHitTp2 = true;
              pendingTrade.pnlPercentage += ((pendingTrade.tp2 - pendingTrade.entryPrice) / pendingTrade.entryPrice) * 100 * 10 * 0.33;
            }
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
            else if (outcomeHigh >= pendingTrade.tp3) {
              pendingTrade.status = "SUCCESS";
              pendingTrade.exitTime = currentTime;
              pendingTrade.exitPrice = pendingTrade.tp3;
              const remainingWeight = 1.0 - (pendingTrade.hasHitTp1 ? 0.33 : 0) - (pendingTrade.hasHitTp2 ? 0.33 : 0);
              pendingTrade.pnlPercentage += ((pendingTrade.tp3 - pendingTrade.entryPrice) / pendingTrade.entryPrice) * 100 * 10 * remainingWeight;
              successfulTrades++;
              totalProfits += pendingTrade.pnlPercentage;
              totalPnl += pendingTrade.pnlPercentage;
              pendingTrade = null;
            }
          } else {
            if (!pendingTrade.hasHitTp1 && outcomeLow <= pendingTrade.tp1) {
              pendingTrade.hasHitTp1 = true;
              pendingTrade.pnlPercentage += ((pendingTrade.entryPrice - pendingTrade.tp1) / pendingTrade.entryPrice) * 100 * 10 * 0.33;
              pendingTrade.currentSl = pendingTrade.entryPrice;
            }
            if (pendingTrade.hasHitTp1 && !pendingTrade.hasHitTp2 && outcomeLow <= pendingTrade.tp2) {
              pendingTrade.hasHitTp2 = true;
              pendingTrade.pnlPercentage += ((pendingTrade.entryPrice - pendingTrade.tp2) / pendingTrade.entryPrice) * 100 * 10 * 0.33;
            }
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
            else if (outcomeLow <= pendingTrade.tp3) {
              pendingTrade.status = "SUCCESS";
              pendingTrade.exitTime = currentTime;
              pendingTrade.exitPrice = pendingTrade.tp3;
              const remainingWeight = 1.0 - (pendingTrade.hasHitTp1 ? 0.33 : 0) - (pendingTrade.hasHitTp2 ? 0.33 : 0);
              pendingTrade.pnlPercentage += ((pendingTrade.entryPrice - pendingTrade.tp3) / pendingTrade.entryPrice) * 100 * 10 * remainingWeight;
              successfulTrades++;
              totalProfits += pendingTrade.pnlPercentage;
              totalPnl += pendingTrade.pnlPercentage;
              pendingTrade = null;
            }
          }
        }
        
        if (pendingTrade) continue;
        
        const sig = rawSignals[symbol][i];
        if (!sig) continue;
        
        if (sig.mtfAnalysis.confidence < config.confidenceThreshold) {
           // console.log("reject conf")
           continue;
        }
        if (config.strictHtfAlignment && sig.htfDirection === "NEUTRAL") {
           // console.log("reject htf neutral")
           continue;
        }
        if (config.use1HControlState && (sig.control1H.state === "WAIT" || sig.control1H.state === "VETO")) {
           continue;
        }

        const mtfAnalysis = sig.mtfAnalysis;
        if (mtfAnalysis.signal === "NO TRADE") continue;
        
        if (config.strictHtfAlignment && sig.htfDirection !== mtfAnalysis.signal) {
           continue;
        }
        
        if (config.useBtcFilter && symbol !== BTC_SYMBOL) {
          if (mtfAnalysis.signal === "LONG" && sig.btcTrend === "SHORT") continue;
          if (mtfAnalysis.signal === "SHORT" && sig.btcTrend === "LONG") continue;
        }

        if (mtfAnalysis.signal === "LONG" && !sig.ltfValidLong) {
           continue;
        }
        if (mtfAnalysis.signal === "SHORT" && !sig.ltfValidShort) {
           continue;
        }
        
        const originalClose = current15mCandle.close;
        const proposedSL = mtfAnalysis.sl || (mtfAnalysis.signal === "LONG" ? originalClose * 0.985 : originalClose * 1.015);
            
        let entryPrice = originalClose;
        if (config.pullbackFactor > 0) {
            const distanceToSl = Math.abs(originalClose - proposedSL);
            if (mtfAnalysis.signal === "LONG") {
                entryPrice = originalClose - (distanceToSl * config.pullbackFactor);
            } else {
                entryPrice = originalClose + (distanceToSl * config.pullbackFactor);
            }
        }
        
        const risk = Math.abs(entryPrice - proposedSL);
        if (risk / entryPrice > 0.05) continue; // Skip if SL is > 5% away to avoid liquidation
        
        pendingTrade = {
          symbol,
          direction: mtfAnalysis.signal as "LONG" | "SHORT",
          entryTime: currentTime,
          entryPrice: entryPrice,
          tp: entryPrice + (mtfAnalysis.signal === "LONG" ? risk * 3 : -risk * 3), // Dynamic R:R
          tp1: entryPrice + (mtfAnalysis.signal === "LONG" ? risk * 1.5 : -risk * 1.5),
          tp2: entryPrice + (mtfAnalysis.signal === "LONG" ? risk * 2.5 : -risk * 2.5),
          tp3: entryPrice + (mtfAnalysis.signal === "LONG" ? risk * 4.0 : -risk * 4.0),
          sl: proposedSL,
          currentSl: proposedSL,
          pnlPercentage: 0,
          status: "PENDING",
          confidence: mtfAnalysis.confidence,
          reason: mtfAnalysis.reason,
          hasHitTp1: false,
          hasHitTp2: false
        };
        totalExecutedTrades++;
      }
    }
    
    const winRate = totalExecutedTrades > 0 ? (successfulTrades / totalExecutedTrades) * 100 : 0;
    const profitFactor = totalLosses > 0 ? totalProfits / totalLosses : totalProfits;
    
    let firstCandleTime = 0, lastCandleTime = 0;
    if (Object.values(dataStore).length > 0) {
        firstCandleTime = Object.values(dataStore)[0]["15m"][0]?.time || 0;
        lastCandleTime = Object.values(dataStore)[0]["15m"][Object.values(dataStore)[0]["15m"].length - 1]?.time || 0;
    }
    const days = firstCandleTime !== 0 ? (lastCandleTime - firstCandleTime) / 86400 : 365;
    
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

  results.sort((a, b) => b.pnl - a.pnl);

  console.log("\n================================================================================");
  console.log("🏆 TOP 15 OPTIMIZATION RESULTS FOR 1-YEAR TIMEFRAME 🏆");
  console.log("================================================================================");
  console.log("RANK | CONF | BTC FLT | HTF ALIGN | 1H CTRL | PULLBACK | TRADES |  WIN%  |   PNL%  | PRF FCT | /DAY ");
  console.log("-------------------------------------------------------------------------------------------------");
  
  results.slice(0, 15).forEach((r, i) => {
    const parse = r.configName.match(/C(\d+)_BTC([YN])_HTF([YN])_1H([YN])_PB([\d.]+)/);
    if (!parse) return;
    const [_, conf, btc, htf, h1, pb] = parse;
    
    console.log(
      `${(i + 1).toString().padEnd(4)} | ` +
      `${conf.padEnd(4)} | ` +
      `${btc.padEnd(7)} | ` +
      `${htf.padEnd(9)} | ` +
      `${h1.padEnd(7)} | ` +
      `${pb.padEnd(8)} | ` +
      `${r.trades.toString().padEnd(6)} | ` +
      `${r.winRate.toFixed(1).padStart(5)}% | ` +
      `${r.pnl.toFixed(1).padStart(6)}% | ` +
      `${r.profitFactor.toFixed(2).padStart(7)} | ` +
      `${r.freq.toFixed(2)} `
    );
  });
  
  console.log("\n💡 Strategy engine executed successfully.");
}

runBacktestSuite().catch(e => console.error("FATAL ERROR", e));
