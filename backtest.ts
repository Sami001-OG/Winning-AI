import { analyzeChart } from './src/analysis.js';

async function fetchKlines(symbol, interval) {
  const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=1000`);
  const data = await res.json();
  return data.map((d) => ({
    time: Math.floor(d[0] / 1000),
    open: parseFloat(d[1]),
    high: parseFloat(d[2]),
    low: parseFloat(d[3]),
    close: parseFloat(d[4]),
    volume: parseFloat(d[5]),
    isFinal: true
  }));
}

async function run() {
  console.log("Fetching data for backtest...");
  const btc = await fetchKlines('BTCUSDT', '15m');
  
  const combinations = [];
  // Generate 100 random weight combinations that sum to 1
  for(let i=0; i<100; i++) {
    let w = [Math.random(), Math.random(), Math.random(), Math.random(), Math.random(), Math.random()];
    let sum = w.reduce((a,b)=>a+b,0);
    combinations.push(w.map(x => x/sum));
  }
  
  // Add the current balanced weights as baseline
  combinations.push([0.15, 0.20, 0.20, 0.15, 0.15, 0.15]);

  let bestWinRate = 0;
  let bestWeights = [];
  let bestStats = {};

  console.log("Running backtest over 100 combinations...");
  for (let c=0; c<combinations.length; c++) {
    const weights = combinations[c];
    let wins = 0;
    let losses = 0;
    let totalTrades = 0;

    // Simulate over the last 500 candles
    for (let i = 500; i < btc.length - 10; i++) {
      const slice = btc.slice(0, i);
      const analysis = analyzeChart(slice, { ema: 1.5, macd: 1.0, rsi: 1.5, vol: 1.2, obv: 1.2, exception: 2.0 }, [], 'BTCUSDT', '15m', weights);
      
      if (analysis.confidence >= 85 && (analysis.signal === 'LONG' || analysis.signal === 'SHORT')) {
        totalTrades++;
        const tp = analysis.tp1;
        const sl = analysis.sl;
        
        // Look ahead to see if it hit TP or SL first
        let won = false;
        let lost = false;
        for(let j = i; j < i + 20 && j < btc.length; j++) {
           const futureCandle = btc[j];
           if (analysis.signal === 'LONG') {
             if (futureCandle.low <= sl) { lost = true; break; }
             if (futureCandle.high >= tp) { won = true; break; }
           } else {
             if (futureCandle.high >= sl) { lost = true; break; }
             if (futureCandle.low <= tp) { won = true; break; }
           }
        }
        if (won) wins++;
        else if (lost) losses++;
      }
    }
    
    const winRate = wins / (wins + losses || 1);
    if (winRate > bestWinRate && totalTrades > 3) {
      bestWinRate = winRate;
      bestWeights = weights;
      bestStats = { wins, losses, totalTrades, winRate };
    }
  }
  
  console.log("Best Weights:", bestWeights);
  console.log("Best Stats:", bestStats);
}
run();
