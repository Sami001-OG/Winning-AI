import { Candle } from './types';

export const detectBOS = (data: Candle[]): 'bullish' | 'bearish' | 'neutral' => {
  if (data.length < 30) return 'neutral';
  
  // Find swing highs and swing lows dynamically using a very practical, responsive lookback (left=3, right=1)
  const highs = data.map(c => c.high);
  const lows = data.map(c => c.low);
  const swingHighs: { price: number, index: number }[] = [];
  const swingLows: { price: number, index: number }[] = [];
  
  const left = 3;
  const right = 1; // Only 1 candle lag for ultra-responsiveness
  
  for (let i = left; i < data.length - right; i++) {
    const h = highs[i];
    const l = lows[i];
    
    let isSH = true;
    let isSL = true;
    
    for (let j = 1; j <= left; j++) {
      if (highs[i - j] > h) isSH = false;
      if (lows[i - j] < l) isSL = false;
    }
    for (let j = 1; j <= right; j++) {
      if (highs[i + j] > h) isSH = false;
      if (lows[i + j] < l) isSL = false;
    }
    
    if (isSH) swingHighs.push({ price: h, index: i });
    if (isSL) swingLows.push({ price: l, index: i });
  }

  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const sh1 = swingHighs[swingHighs.length - 1]; // latest SH
    const sh2 = swingHighs[swingHighs.length - 2]; // previous SH
    const sl1 = swingLows[swingLows.length - 1];   // latest SL
    const sl2 = swingLows[swingLows.length - 2];   // previous SL
    
    // Check Higher High & Higher Low
    if (sh1.price > sh2.price && sl1.price > sl2.price) {
      return 'bullish';
    }
    // Check Lower Low & Lower High
    if (sh1.price < sh2.price && sl1.price < sl2.price) {
      return 'bearish';
    }
  }
  
  return 'neutral';
};

export const detectLiquidityGrab = (data: Candle[]): 'bullish' | 'bearish' | 'neutral' => {
  if (data.length < 25) return 'neutral';
  
  // Find a raw sweep first in the last 4 candles to make it practical and responsive
  for (let s = 1; s <= 4; s++) {
    const sweepCandleIdx = data.length - s;
    const sweepCandle = data[sweepCandleIdx];
    
    const lookbackStart = Math.max(0, sweepCandleIdx - 15);
    const prevLow = Math.min(...data.slice(lookbackStart, sweepCandleIdx).map(c => c.low));
    const prevHigh = Math.max(...data.slice(lookbackStart, sweepCandleIdx).map(c => c.high));
    
    // Raw Bullish Sweep (low swept, closes back above)
    if (sweepCandle.low < prevLow && sweepCandle.close > prevLow) {
      let hasDisplacement = false;
      let hasStructureConfirmation = false;
      
      const recentCandles = data.slice(-25);
      const atrs = recentCandles.map((c, idx) => {
        if (idx === 0) return c.high - c.low;
        const prevClose = recentCandles[idx - 1].close;
        return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
      });
      const avgAtr = atrs.reduce((a, b) => a + b, 0) / atrs.length;
      const avgVol = recentCandles.reduce((sum, c) => sum + c.volume, 0) / recentCandles.length;
      
      for (let j = sweepCandleIdx; j < data.length; j++) {
        const c = data[j];
        const body = c.close - c.open;
        
        // Displacement: Solid positive body with volume matching or exceeding average
        if (body > avgAtr * 0.5 && c.volume > avgVol * 0.8) {
          hasDisplacement = true;
        }
        
        // Structure confirmation: A close above the high of the sweeping candle or a higher high breakout
        if (c.close > sweepCandle.high) {
          hasStructureConfirmation = true;
        }
      }
      
      // Cover the sweeping candle itself if it contains immediate massive displacement/pressure
      if (sweepCandle.close > sweepCandle.open && (sweepCandle.close - sweepCandle.open) > avgAtr * 0.6) {
        hasDisplacement = true;
      }
      if (sweepCandleIdx > 0 && sweepCandle.close > data[sweepCandleIdx - 1].high) {
        hasStructureConfirmation = true;
      }
      
      if (hasDisplacement && hasStructureConfirmation) {
        return 'bullish';
      }
    }
    
    // Raw Bearish Sweep
    if (sweepCandle.high > prevHigh && sweepCandle.close < prevHigh) {
      let hasDisplacement = false;
      let hasStructureConfirmation = false;
      
      const recentCandles = data.slice(-25);
      const atrs = recentCandles.map((c, idx) => {
        if (idx === 0) return c.high - c.low;
        const prevClose = recentCandles[idx - 1].close;
        return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
      });
      const avgAtr = atrs.reduce((a, b) => a + b, 0) / atrs.length;
      const avgVol = recentCandles.reduce((sum, c) => sum + c.volume, 0) / recentCandles.length;
      
      for (let j = sweepCandleIdx; j < data.length; j++) {
        const c = data[j];
        const body = c.open - c.close; // Bearish body
        
        // Displacement: Solid negative body with volume matching or exceeding average
        if (body > avgAtr * 0.5 && c.volume > avgVol * 0.8) {
          hasDisplacement = true;
        }
        
        // Structure confirmation: A close below the low of the sweeping candle
        if (c.close < sweepCandle.low) {
          hasStructureConfirmation = true;
        }
      }
      
      if (sweepCandle.open > sweepCandle.close && (sweepCandle.open - sweepCandle.close) > avgAtr * 0.6) {
        hasDisplacement = true;
      }
      if (sweepCandleIdx > 0 && sweepCandle.close < data[sweepCandleIdx - 1].low) {
        hasStructureConfirmation = true;
      }
      
      if (hasDisplacement && hasStructureConfirmation) {
        return 'bearish';
      }
    }
  }
  
  return 'neutral';
};

export const detectMSS = (data: Candle[]): 'bullish' | 'bearish' | 'neutral' => {
  if (data.length < 30) return 'neutral';
  
  const highs = data.map(c => c.high);
  const lows = data.map(c => c.low);
  const closes = data.map(c => c.close);
  
  const swingHighs: number[] = [];
  const swingLows: number[] = [];
  
  const left = 3;
  const right = 2; // Stable swing pivot structure
  
  for (let i = left; i < data.length - right; i++) {
    const h = highs[i];
    const l = lows[i];
    
    let isSH = true;
    let isSL = true;
    
    for (let j = 1; j <= left; j++) {
      if (highs[i - j] >= h) isSH = false;
      if (lows[i - j] <= l) isSL = false;
    }
    for (let j = 1; j <= right; j++) {
      if (highs[i + j] >= h) isSH = false;
      if (lows[i + j] <= l) isSL = false;
    }
    
    if (isSH) swingHighs.push(h);
    if (isSL) swingLows.push(l);
  }
  
  if (swingHighs.length === 0 || swingLows.length === 0) return 'neutral';
  
  const lastClose = closes[closes.length - 1];
  const lastSwingHigh = swingHighs[swingHighs.length - 1];
  const lastSwingLow = swingLows[swingLows.length - 1];
  
  if (lastClose > lastSwingHigh) return 'bullish';
  if (lastClose < lastSwingLow) return 'bearish';
  
  return 'neutral';
};

export const detectSFP = (data: Candle[]): 'bullish' | 'bearish' | 'neutral' => {
  if (data.length < 20) return 'neutral';
  
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  
  const prevHighs = data.slice(-17, -2).map(c => c.high);
  const prevLows = data.slice(-17, -2).map(c => c.low);
  
  const keyHigh = Math.max(...prevHighs);
  const keyLow = Math.min(...prevLows);
  
  // Bullish SFP: low went below keyLow, but closed back above keyLow
  if ((last.low < keyLow && last.close > keyLow) || (prev.low < keyLow && prev.close > keyLow && last.close > keyLow)) {
    return 'bullish';
  }
  
  // Bearish SFP: high went above keyHigh, but closed back below keyHigh
  if ((last.high > keyHigh && last.close < keyHigh) || (prev.high > keyHigh && prev.close < keyHigh && last.close < keyHigh)) {
    return 'bearish';
  }
  
  return 'neutral';
};

export const detectFailedLiquidityGrab = (data: Candle[]): 'bullish' | 'bearish' | 'neutral' => {
  if (data.length < 15) return 'neutral';
  
  for (let s = 2; s <= 5; s++) {
    const sCandle = data[data.length - s];
    const lookbackStart = Math.max(0, data.length - s - 15);
    const prevLow = Math.min(...data.slice(lookbackStart, data.length - s).map(c => c.low));
    const prevHigh = Math.max(...data.slice(lookbackStart, data.length - s).map(c => c.high));
    
    // Bullish raw sweep
    if (sCandle.low < prevLow && sCandle.close > prevLow) {
      for (let j = data.length - s + 1; j < data.length; j++) {
        if (data[j].close < sCandle.low) {
          return 'bearish'; // Sweeping candle's low was violated (failed grab, highly bearish)
        }
      }
    }
    
    // Bearish raw sweep
    if (sCandle.high > prevHigh && sCandle.close < prevHigh) {
      for (let j = data.length - s + 1; j < data.length; j++) {
        if (data[j].close > sCandle.high) {
          return 'bullish'; // Sweeping candle's high was violated (failed grab, highly bullish)
        }
      }
    }
  }
  
  return 'neutral';
};

export const detectFakeout = (data: Candle[]): 'bullish' | 'bearish' | 'neutral' => {
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
    
    const buyPct = (c.close - c.low) / trueRange;
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

  const pivots: { price: number, rsi: number, index: number, type: 'high' | 'low' }[] = [];
  const prices = data.map(c => c.close);
  const lookback = 5;
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

  if (lastPivot.type === 'low' && prevPivot.type === 'low' && lastPivot.price < prevPivot.price && lastPivot.rsi > prevPivot.rsi) return 'regular_bullish';
  if (lastPivot.type === 'high' && prevPivot.type === 'high' && lastPivot.price > prevPivot.price && lastPivot.rsi < prevPivot.rsi) return 'regular_bearish';
  if (lastPivot.type === 'low' && prevPivot.type === 'low' && lastPivot.price > prevPivot.price && lastPivot.rsi < prevPivot.rsi) return 'hidden_bullish';
  if (lastPivot.type === 'high' && prevPivot.type === 'high' && lastPivot.price < prevPivot.price && lastPivot.rsi > prevPivot.rsi) return 'hidden_bearish';

  return 'none';
};

export const detectMacdDivergences = (data: Candle[], macdHist: number[]): DivergenceType => {
  if (data.length < 50 || macdHist.length < 50) return 'none';

  const prices = data.map(c => c.close);
  const lastIdx = macdHist.length - 1;
  const isColorShiftBullish = macdHist[lastIdx] > 0 && macdHist[lastIdx - 1] < 0;
  const isColorShiftBearish = macdHist[lastIdx] < 0 && macdHist[lastIdx - 1] > 0;
  
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
  
  if (lastPivot.val < 0 && lastPivot.val < prevPivot.val) {
      if (lastPrice > prevPrice) return 'hidden_bullish';
      if (lastPrice < prevPrice) return 'regular_bullish';
  }
  
  if (lastPivot.val > 0 && lastPivot.val > prevPivot.val) {
      if (lastPrice < prevPrice) return 'hidden_bearish';
      if (lastPrice > prevPrice) return 'regular_bearish';
  }

  return isColorShiftBullish ? 'regular_bullish' : isColorShiftBearish ? 'regular_bearish' : 'none';
};
