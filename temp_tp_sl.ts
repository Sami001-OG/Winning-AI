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

  const weights = { ema: 1.5, macd: 0.5, rsi: 1.5, stoch: 0.5, cci: 0.25, vol: 1.2, obv: 1.2, exception: 2.0 };

  const atrMultipliers = [
    { slAtr: 1.5, tpRiskMult: 1.0 },
  ];

  for (const mult of atrMultipliers) {
    let grossProfit = 0;
    let grossLoss = 0;
    let wins = 0;
    let losses = 0;

    for (const sym of symbols) {
      for (const tf of timeframes) {
        const klines = allKlines[`${sym}-${tf}`];
        for (let i = 200; i < klines.length - 50; i++) {
          const slice = klines.slice(0, i);
          const analysis = analyzeChart(slice, weights, [], sym);
          
          if (analysis.signal !== 'NO TRADE' && analysis.confidence >= 85) {
            const isException = analysis.indicators.some(ind => ind.description.includes('EXCEPTION STRATEGY'));
            if (isException) continue; // ONLY STANDARD STRATEGIES
            
            // STRICT TREND FILTER
            const marketState = analysis.indicators.find(i => i.name === 'Market State');
            if (!marketState || marketState.value === 'SIDEWAYS') continue;
            
            const lastClose = slice[slice.length - 1].close;
            let lastAtr = 0;
            if (analysis.signal === 'LONG') {
              lastAtr = (lastClose - analysis.sl!) / 1.5;
            } else {
              lastAtr = (analysis.sl! - lastClose) / 1.5;
            }

            let sl, tp;
            if (analysis.signal === 'LONG') {
              sl = lastClose - (lastAtr * mult.slAtr);
              const risk = lastClose - sl;
              tp = lastClose + (risk * mult.tpRiskMult);
            } else {
              sl = lastClose + (lastAtr * mult.slAtr);
              const risk = sl - lastClose;
              tp = lastClose - (risk * mult.tpRiskMult);
            }

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
            
            let riskUnit = 1;
            let rewardUnit = mult.tpRiskMult;

            if (outcome === 'WIN') {
              wins++;
              grossProfit += rewardUnit;
            } else if (outcome === 'LOSS') {
              losses++;
              grossLoss += riskUnit;
            }
          }
        }
      }
    }
    const wr = (wins / (wins + losses)) * 100;
    const pf = grossProfit / grossLoss;
    console.log(`TRENDING ONLY -> WR: ${wr.toFixed(2)}% (${wins}W/${losses}L), PF: ${pf.toFixed(2)}`);
  }
}

run().catch(console.error);
