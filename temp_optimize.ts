import { analyzeChart } from './src/analysis';
import { Candle } from './src/types';

async function fetchKlines(symbol: string, interval: string, limit: number = 1000): Promise<Candle[]> {
  const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  const data = await response.json();
  return data.map((d: any) => ({
    timestamp: d[0],
    open: parseFloat(d[1]),
    high: parseFloat(d[2]),
    low: parseFloat(d[3]),
    close: parseFloat(d[4]),
    volume: parseFloat(d[5]),
  }));
}

async function run() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
  const timeframes = ['15m', '1h'];
  
  const allKlines: Record<string, Candle[]> = {};
  for (const sym of symbols) {
    for (const tf of timeframes) {
      allKlines[`${sym}-${tf}`] = await fetchKlines(sym, tf, 1000);
    }
  }

  const testWeights = [
    { ema: 1.5, macd: 0.8, rsi: 1.5, stoch: 0.8, cci: 0.5, vol: 1.2, obv: 1.0, exception: 2.0 },
    { ema: 2.0, macd: 1.0, rsi: 2.0, stoch: 0.5, cci: 0.5, vol: 1.5, obv: 1.0, exception: 2.5 }
  ];

  for (let wIdx = 0; wIdx < testWeights.length; wIdx++) {
    const weights = testWeights[wIdx];
    let totalWins = 0;
    let totalLosses = 0;
    let standardWins = 0;
    let standardLosses = 0;

    for (const sym of symbols) {
      for (const tf of timeframes) {
        const klines = allKlines[`${sym}-${tf}`];
        for (let i = 200; i < klines.length - 20; i++) {
          const slice = klines.slice(0, i);
          const analysis = analyzeChart(slice, weights, [], sym);
          
          if (analysis.signal !== 'NO TRADE' && analysis.confidence >= 85) {
            const tp = analysis.tp;
            const sl = analysis.sl;
            if (!tp || !sl) continue;

            let outcome = 'PENDING';
            for (let j = i; j < klines.length; j++) {
              const futureCandle = klines[j];
              if (analysis.signal === 'LONG') {
                if (futureCandle.low <= sl) { outcome = 'LOSS'; break; }
                if (futureCandle.high >= tp) { outcome = 'WIN'; break; }
              } else {
                if (futureCandle.high >= sl) { outcome = 'LOSS'; break; }
                if (futureCandle.low <= tp) { outcome = 'WIN'; break; }
              }
            }
            
            const isException = analysis.indicators.some(ind => ind.description.includes('EXCEPTION STRATEGY'));
            if (outcome === 'WIN') {
              totalWins++;
              if (!isException) standardWins++;
            }
            if (outcome === 'LOSS') {
              totalLosses++;
              if (!isException) standardLosses++;
            }
          }
        }
      }
    }
    
    const standardTrades = standardWins + standardLosses;
    const standardWr = standardTrades > 0 ? (standardWins / standardTrades) * 100 : 0;
    console.log(`Weights ${wIdx}: Standard WR: ${standardWr.toFixed(2)}% (${standardWins}W/${standardLosses}L) - ${JSON.stringify(weights)}`);
  }
}

run().catch(console.error);
