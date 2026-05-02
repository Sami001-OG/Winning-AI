import { analyzeChart } from './src/analysis';
import { getHTFDirection, get1HControlState } from './src/multiTimeframe';

const DEFAULT_RELIABILITY = {
  ema: 1.5, macd: 1.0, rsi: 1.5, vol: 1.2, obv: 1.2, exception: 2.0,
};

async function fetchKlines(symbol: string, tf: string, limit: number) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=${limit}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.map((d: any) => ({
    time: Math.floor(d[0] / 1000),
    open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5]),
  }));
}

async function debugConfidences() {
  const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr`);
  const data = await res.json();
  const topSymbols = data
    .filter((t: any) => t.symbol.endsWith("USDT") && parseFloat(t.volume) > 0 && !t.symbol.includes("UPUSDT") && !t.symbol.includes("DOWNUSDT"))
    .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, 50)
    .map((t: any) => t.symbol);

  for (const symbol of topSymbols) {
    try {
      const klines15m = await fetchKlines(symbol, '15m', 500);
      const mtfAnalysis = analyzeChart(klines15m, DEFAULT_RELIABILITY, [], symbol, '15m');
      
      const sysLogic = mtfAnalysis.indicators.find((i: any) => i.name === 'System Logic');
      if (mtfAnalysis.confidence >= 60) {
          console.log(`[${symbol}] Signal: ${mtfAnalysis.signal} | Conf: ${mtfAnalysis.confidence} | Reason: ${sysLogic?.description}`);
      }
    } catch (e) { }
  }
}

debugConfidences();
