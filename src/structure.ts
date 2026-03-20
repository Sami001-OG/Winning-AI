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
  if (data.length < 10) return 'neutral';
  const last = data[data.length - 1];
  const prevLow = Math.min(...data.slice(-10, -1).map(c => c.low));
  const prevHigh = Math.max(...data.slice(-10, -1).map(c => c.high));
  
  if (last.low < prevLow && last.close > prevLow) return 'bullish';
  if (last.high > prevHigh && last.close < prevHigh) return 'bearish';
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

export const calculateOrderFlow = (data: Candle[]): number => {
  if (data.length < 20) return 0;
  let flow = 0;
  for (let i = data.length - 20; i < data.length; i++) {
    const c = data[i];
    const priceChange = c.close - c.open;
    flow += priceChange * c.volume;
  }
  return flow;
};
