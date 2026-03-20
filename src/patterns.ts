import { Candle } from './types';

export interface Pattern {
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  strength: number; // 0 to 1
}

import { Candle } from './types';

export interface Pattern {
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  strength: number; // 0 to 1
}

export const detectPatterns = (data: Candle[]): Pattern[] => {
  const patterns: Pattern[] = [];
  if (data.length < 50) return patterns;

  const closes = data.map(d => d.close);
  const highs = data.map(d => d.high);
  const lows = data.map(d => d.low);
  const last = data[data.length - 1];
  const prev = data[data.length - 2];

  // 1. Hammer
  const body = Math.abs(last.close - last.open);
  const lowerShadow = Math.min(last.open, last.close) - last.low;
  const upperShadow = last.high - Math.max(last.open, last.close);
  if (lowerShadow > body * 2 && upperShadow < body) {
    patterns.push({ name: 'Hammer', type: 'bullish', strength: 0.6 });
  }

  // 2. Shooting Star
  if (upperShadow > body * 2 && lowerShadow < body) {
    patterns.push({ name: 'Shooting Star', type: 'bearish', strength: 0.6 });
  }

  // 3. Double Bottom / Top
  const recent = closes.slice(-30);
  const min = Math.min(...recent);
  const max = Math.max(...recent);
  if (Math.abs(last.close - min) < last.close * 0.005) {
    patterns.push({ name: 'Double Bottom', type: 'bullish', strength: 0.7 });
  } else if (Math.abs(last.close - max) < last.close * 0.005) {
    patterns.push({ name: 'Double Top', type: 'bearish', strength: 0.7 });
  }

  // 4. Bullish/Bearish Engulfing
  if (prev.close < prev.open && last.close > last.open && last.close > prev.open && last.open < prev.close) {
    patterns.push({ name: 'Bullish Engulfing', type: 'bullish', strength: 0.8 });
  } else if (prev.close > prev.open && last.close < last.open && last.close < prev.open && last.open > prev.close) {
    patterns.push({ name: 'Bearish Engulfing', type: 'bearish', strength: 0.8 });
  }

  // 5. Simple Ascending/Descending Triangle (very basic)
  const recentHighs = highs.slice(-20);
  const recentLows = lows.slice(-20);
  const highRange = Math.max(...recentHighs) - Math.min(...recentHighs);
  const lowRange = Math.max(...recentLows) - Math.min(...recentLows);
  
  if (highRange < last.close * 0.02 && lowRange > last.close * 0.05) {
    patterns.push({ name: 'Ascending Triangle', type: 'bullish', strength: 0.6 });
  } else if (lowRange < last.close * 0.02 && highRange > last.close * 0.05) {
    patterns.push({ name: 'Descending Triangle', type: 'bearish', strength: 0.6 });
  }

  return patterns;
};

