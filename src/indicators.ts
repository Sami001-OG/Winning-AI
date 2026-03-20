import { Candle } from './types';

export const calculateEMA = (data: Candle[], period: number): number => {
  if (data.length < period) return data[data.length - 1].close;
  
  const k = 2 / (period + 1);
  let ema = data[0].close;
  
  for (let i = 1; i < data.length; i++) {
    ema = data[i].close * k + ema * (1 - k);
  }
  
  return ema;
};

export const calculateBollingerBands = (data: Candle[], period: number = 20, multiplier: number = 2) => {
  if (data.length < period) return { upper: 0, lower: 0, mid: 0 };
  
  const slice = data.slice(-period);
  const closes = slice.map(c => c.close);
  const mid = closes.reduce((a, b) => a + b, 0) / period;
  
  const variance = closes.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  
  return {
    upper: mid + (multiplier * stdDev),
    lower: mid - (multiplier * stdDev),
    mid
  };
};
