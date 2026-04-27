import { Candle } from './types';

export const detectBOS = (data: Candle[]): 'bullish' | 'bearish' | 'neutral' => {
  if (data.length < 20) return 'neutral';
  const last = data[data.length - 1];
  const prevHigh = Math.max(...data.slice(-20, -1).map(c => c.high));
  const prevLow = Math.min(...data.slice(-20, -1).map(c => c.low));
  
  if (last.close > prevHigh) return 'bullish';
  if (last.close < prevLow) return 'bearish';
  return 'neutral';
};

export const detectLiquidityGrab = (data: Candle[]): 'bullish' | 'bearish' | 'neutral' => {
  if (data.length < 15) return 'neutral';
  
  // Check the last 3 candles to see if any of them swept liquidity
  for (let i = 1; i <= 3; i++) {
    const candle = data[data.length - i];
    const prevLow = Math.min(...data.slice(-15 - i, -i).map(c => c.low));
    const prevHigh = Math.max(...data.slice(-15 - i, -i).map(c => c.high));
    
    if (candle.low < prevLow && candle.close > prevLow) return 'bullish';
    if (candle.high > prevHigh && candle.close < prevHigh) return 'bearish';
  }
  
  return 'neutral';
};

export const detectFakeout = (data: Candle[]): 'bullish' | 'bearish' | 'neutral' => {
  // Similar to liquidity grab but specifically on a wider range
  if (data.length < 20) return 'neutral';
  const last = data[data.length - 1];
  const rangeHigh = Math.max(...data.slice(-20, -1).map(c => c.high));
  const rangeLow = Math.min(...data.slice(-20, -1).map(c => c.low));
  
  if (last.low < rangeLow && last.close > rangeLow) return 'bullish';
  if (last.high > rangeHigh && last.close < rangeHigh) return 'bearish';
  return 'neutral';
};

export const detectVolumeSpike = (data: Candle[]): number => {
  if (data.length < 20) return 0;
  const lastVol = data[data.length - 1].volume;
  const avgVol = data.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
  return lastVol / avgVol;
};

export const detectAtrExpansion = (data: Candle[], atr: number[]): number => {
  if (data.length < 20 || atr.length < 20) return 0;
  const lastAtr = atr[atr.length - 1];
  const avgAtr = atr.slice(-20).reduce((sum, a) => sum + a, 0) / 20;
  return lastAtr / avgAtr;
};

export const calculateOrderFlow = (data: Candle[], period: number = 14): { buyingPressure: number, sellingPressure: number, netFlow: number, signal: 'bullish' | 'bearish' | 'neutral' } => {
  if (data.length < period) return { buyingPressure: 0, sellingPressure: 0, netFlow: 0, signal: 'neutral' };
  
  let buyingVolume = 0;
  let sellingVolume = 0;
  
  for (let i = data.length - period; i < data.length; i++) {
    const c = data[i];
    const trueRange = c.high - c.low;
    
    if (trueRange === 0) {
      buyingVolume += c.volume / 2;
      sellingVolume += c.volume / 2;
      continue;
    }
    
    // Buying pressure is distance from low to close
    const buyPct = (c.close - c.low) / trueRange;
    // Selling pressure is distance from close to high
    const sellPct = (c.high - c.close) / trueRange;
    
    buyingVolume += c.volume * buyPct;
    sellingVolume += c.volume * sellPct;
  }
  
  const netFlow = buyingVolume - sellingVolume;
  const totalVolume = buyingVolume + sellingVolume;
  const buyRatio = totalVolume > 0 ? buyingVolume / totalVolume : 0.5;
  
  let signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (buyRatio > 0.55) signal = 'bullish';
  else if (buyRatio < 0.45) signal = 'bearish';
  
  return {
    buyingPressure: buyingVolume,
    sellingPressure: sellingVolume,
    netFlow,
    signal
  };
};

export type DivergenceType = 'regular_bullish' | 'regular_bearish' | 'hidden_bullish' | 'hidden_bearish' | 'none';

export const detectAllRsiDivergences = (data: Candle[], rsi: number[]): DivergenceType => {
  if (data.length < 50 || rsi.length < 50) return 'none';

  // Find local pivots (highs/lows)
  const pivots: { price: number, rsi: number, index: number, type: 'high' | 'low' }[] = [];
  const prices = data.map(c => c.close);
  const lookback = 5; // Increased lookback for more significant pivots
  for (let i = lookback; i < prices.length - lookback; i++) {
      let isHigh = true;
      let isLow = true;
      for (let j = 1; j <= lookback; j++) {
          if (prices[i] <= prices[i-j] || prices[i] <= prices[i+j]) isHigh = false;
          if (prices[i] >= prices[i-j] || prices[i] >= prices[i+j]) isLow = false;
      }
      if (isHigh) pivots.push({ price: prices[i], rsi: rsi[i], index: i, type: 'high' });
      if (isLow) pivots.push({ price: prices[i], rsi: rsi[i], index: i, type: 'low' });
  }
  
  if (pivots.length < 2) return 'none';

  const lastPivot = pivots[pivots.length - 1];
  const prevPivot = pivots[pivots.length - 2];

  // Regular Bullish: Price LL, RSI HL
  if (lastPivot.type === 'low' && prevPivot.type === 'low' && lastPivot.price < prevPivot.price && lastPivot.rsi > prevPivot.rsi) return 'regular_bullish';
  // Regular Bearish: Price HH, RSI LH
  if (lastPivot.type === 'high' && prevPivot.type === 'high' && lastPivot.price > prevPivot.price && lastPivot.rsi < prevPivot.rsi) return 'regular_bearish';
  // Hidden Bullish: Price HL, RSI LL
  if (lastPivot.type === 'low' && prevPivot.type === 'low' && lastPivot.price > prevPivot.price && lastPivot.rsi < prevPivot.rsi) return 'hidden_bullish';
  // Hidden Bearish: Price LH, RSI HH
  if (lastPivot.type === 'high' && prevPivot.type === 'high' && lastPivot.price < prevPivot.price && lastPivot.rsi > prevPivot.rsi) return 'hidden_bearish';

  return 'none';
};

export const detectMacdDivergences = (data: Candle[], macdHist: number[]): DivergenceType => {
  if (data.length < 50 || macdHist.length < 50) return 'none';

  const prices = data.map(c => c.close);
  
  // 1. Identify Histogram Color Shifts (Momentum Shifts)
  const lastIdx = macdHist.length - 1;
  const isColorShiftBullish = macdHist[lastIdx] > 0 && macdHist[lastIdx - 1] < 0;
  const isColorShiftBearish = macdHist[lastIdx] < 0 && macdHist[lastIdx - 1] > 0;

  // 2. Identify Troughs/Peaks to check for divergence
  // A trough is a local minimum in the MACD histogram (below 0)
  // A peak is a local maximum (above 0)
  
  const getPivots = (arr: number[]): {val: number, idx: number}[] => {
      const pivots = [];
      for(let i = 1; i < arr.length - 1; i++) {
          if ((arr[i] > arr[i-1] && arr[i] > arr[i+1]) || (arr[i] < arr[i-1] && arr[i] < arr[i+1])) {
              pivots.push({val: arr[i], idx: i});
          }
      }
      return pivots;
  };
  
  const pivots = getPivots(macdHist);
  if (pivots.length < 2) return isColorShiftBullish ? 'regular_bullish' : isColorShiftBearish ? 'regular_bearish' : 'none';

  const lastPivot = pivots[pivots.length - 1];
  const prevPivot = pivots[pivots.length - 2];
  
  const lastPrice = prices[lastPivot.idx];
  const prevPrice = prices[prevPivot.idx];
  
  // Bullish: Hist trough is higher than prev trough, but Price is lower (Regular) or Higher (Hidden)
  if (lastPivot.val < 0 && lastPivot.val > prevPivot.val) {
      if (lastPrice < prevPrice) return 'regular_bullish';
      if (lastPrice > prevPrice) return 'hidden_bullish';
  }
  
  // Bearish: Hist peak is lower than prev peak, but Price is higher (Regular) or Lower (Hidden)
  if (lastPivot.val > 0 && lastPivot.val < prevPivot.val) {
      if (lastPrice > prevPrice) return 'regular_bearish';
      if (lastPrice < prevPrice) return 'hidden_bearish';
  }

  return isColorShiftBullish ? 'regular_bullish' : isColorShiftBearish ? 'regular_bearish' : 'none';
};
