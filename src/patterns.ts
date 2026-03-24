import { Candle } from './types';

export interface Pattern {
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  strength: number; // 0 to 1
}

function linearRegression(y: number[]): { slope: number, intercept: number } {
  const n = y.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += y[i];
    sumXY += i * y[i];
    sumXX += i * i;
  }
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  return { slope, intercept };
}

function findPeaksAndTroughs(data: number[], window: number = 5): { peaks: {index: number, value: number}[], troughs: {index: number, value: number}[] } {
  const peaks = [];
  const troughs = [];
  
  for (let i = window; i < data.length - window; i++) {
    let isPeak = true;
    let isTrough = true;
    
    for (let j = 1; j <= window; j++) {
      if (data[i] <= data[i - j] || data[i] <= data[i + j]) isPeak = false;
      if (data[i] >= data[i - j] || data[i] >= data[i + j]) isTrough = false;
    }
    
    if (isPeak) peaks.push({ index: i, value: data[i] });
    if (isTrough) troughs.push({ index: i, value: data[i] });
  }
  
  return { peaks, troughs };
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

  // 3. Double/Triple Bottom / Top & Head and Shoulders
  const { peaks, troughs } = findPeaksAndTroughs(closes, 5);
  
  if (peaks.length >= 3) {
    const p1 = peaks[peaks.length - 3];
    const p2 = peaks[peaks.length - 2];
    const p3 = peaks[peaks.length - 1];
    
    const avgPeak = (p1.value + p2.value + p3.value) / 3;
    const isTripleTop = Math.abs(p1.value - avgPeak) / avgPeak < 0.01 && 
                        Math.abs(p2.value - avgPeak) / avgPeak < 0.01 && 
                        Math.abs(p3.value - avgPeak) / avgPeak < 0.01;
                        
    const isHeadAndShoulders = p2.value > p1.value && p2.value > p3.value && 
                               Math.abs(p1.value - p3.value) / p1.value < 0.02;
                               
    if (isTripleTop) {
      patterns.push({ name: 'Triple Top', type: 'bearish', strength: 0.85 });
    } else if (isHeadAndShoulders) {
      patterns.push({ name: 'Head and Shoulders', type: 'bearish', strength: 0.9 });
    }
  }
  
  if (troughs.length >= 3) {
    const t1 = troughs[troughs.length - 3];
    const t2 = troughs[troughs.length - 2];
    const t3 = troughs[troughs.length - 1];
    
    const avgTrough = (t1.value + t2.value + t3.value) / 3;
    const isTripleBottom = Math.abs(t1.value - avgTrough) / avgTrough < 0.01 && 
                           Math.abs(t2.value - avgTrough) / avgTrough < 0.01 && 
                           Math.abs(t3.value - avgTrough) / avgTrough < 0.01;
                           
    const isInvertedHeadAndShoulders = t2.value < t1.value && t2.value < t3.value && 
                                       Math.abs(t1.value - t3.value) / t1.value < 0.02;
                                       
    if (isTripleBottom) {
      patterns.push({ name: 'Triple Bottom', type: 'bullish', strength: 0.85 });
    } else if (isInvertedHeadAndShoulders) {
      patterns.push({ name: 'Inverted Head and Shoulders', type: 'bullish', strength: 0.9 });
    }
  }
  
  if (peaks.length >= 2 && !patterns.some(p => p.name === 'Triple Top' || p.name === 'Head and Shoulders')) {
    const p1 = peaks[peaks.length - 2];
    const p2 = peaks[peaks.length - 1];
    if (Math.abs(p1.value - p2.value) / p1.value < 0.01) {
      patterns.push({ name: 'Double Top', type: 'bearish', strength: 0.75 });
    }
  }
  
  if (troughs.length >= 2 && !patterns.some(p => p.name === 'Triple Bottom' || p.name === 'Inverted Head and Shoulders')) {
    const t1 = troughs[troughs.length - 2];
    const t2 = troughs[troughs.length - 1];
    if (Math.abs(t1.value - t2.value) / t1.value < 0.01) {
      patterns.push({ name: 'Double Bottom', type: 'bullish', strength: 0.75 });
    }
  }

  // 4. Bullish/Bearish Engulfing
  if (prev.close < prev.open && last.close > last.open && last.close > prev.open && last.open < prev.close) {
    patterns.push({ name: 'Bullish Engulfing', type: 'bullish', strength: 0.8 });
  } else if (prev.close > prev.open && last.close < last.open && last.close < prev.open && last.open > prev.close) {
    patterns.push({ name: 'Bearish Engulfing', type: 'bearish', strength: 0.8 });
  }

  // 5. Triangles (Ascending, Descending, Symmetrical)
  const recentHighs = highs.slice(-20);
  const recentLows = lows.slice(-20);
  const highRange = Math.max(...recentHighs) - Math.min(...recentHighs);
  const lowRange = Math.max(...recentLows) - Math.min(...recentLows);
  
  const highReg20 = linearRegression(recentHighs);
  const lowReg20 = linearRegression(recentLows);
  const highSlope20 = highReg20.slope / last.close;
  const lowSlope20 = lowReg20.slope / last.close;
  
  if (highRange < last.close * 0.02 && lowRange > last.close * 0.05 && lowSlope20 > 0.001) {
    patterns.push({ name: 'Ascending Triangle', type: 'bullish', strength: 0.7 });
  } else if (lowRange < last.close * 0.02 && highRange > last.close * 0.05 && highSlope20 < -0.001) {
    patterns.push({ name: 'Descending Triangle', type: 'bearish', strength: 0.7 });
  } else if (highSlope20 < -0.001 && lowSlope20 > 0.001 && Math.abs(highSlope20 + lowSlope20) < 0.001) {
    // Symmetrical triangle: converging lines with roughly equal but opposite slopes
    // Direction depends on the preceding trend, but we'll mark it neutral/continuation here
    // For simplicity, we'll just add it as neutral and let other indicators decide direction
    patterns.push({ name: 'Symmetrical Triangle', type: 'neutral', strength: 0.65 });
  }

  // 6. Flags, Pennants, Wedges, Cup and Handle
  if (data.length >= 40) {
    const poleWindow = data.slice(-40, -20);
    const flagWindow = data.slice(-20);
    
    const poleStart = poleWindow[0].close;
    const poleEnd = poleWindow[poleWindow.length - 1].close;
    const poleMove = (poleEnd - poleStart) / poleStart;
    
    const flagHighs = flagWindow.map(d => d.high);
    const flagLows = flagWindow.map(d => d.low);
    
    const highReg = linearRegression(flagHighs);
    const lowReg = linearRegression(flagLows);
    
    const highSlope = highReg.slope / poleEnd; // normalized slope
    const lowSlope = lowReg.slope / poleEnd;
    
    const isBullPole = poleMove > 0.03; // 3% move for pole
    const isBearPole = poleMove < -0.03;
    
    // Cup and Handle
    // Simplistic detection: A rounded bottom (cup) over ~30 candles, then a slight downward drift (handle) over ~10 candles
    if (data.length >= 50) {
      const cupWindow = data.slice(-50, -10).map(d => d.close);
      const handleWindow = data.slice(-10).map(d => d.close);
      
      const cupStart = cupWindow[0];
      const cupEnd = cupWindow[cupWindow.length - 1];
      const cupMin = Math.min(...cupWindow);
      const cupMax = Math.max(...cupWindow);
      
      const handleStart = handleWindow[0];
      const handleEnd = handleWindow[handleWindow.length - 1];
      const handleMin = Math.min(...handleWindow);
      
      const isCupShape = cupStart > cupMin && cupEnd > cupMin && Math.abs(cupStart - cupEnd) / cupStart < 0.05;
      const isHandleShape = handleEnd < handleStart && handleMin > cupMin;
      
      if (isCupShape && isHandleShape && cupMax - cupMin > cupStart * 0.05) {
        patterns.push({ name: 'Cup and Handle', type: 'bullish', strength: 0.85 });
      }
      
      const cupMaxInverted = Math.max(...cupWindow);
      const isCupShapeInverted = cupStart < cupMaxInverted && cupEnd < cupMaxInverted && Math.abs(cupStart - cupEnd) / cupStart < 0.05;
      const isHandleShapeInverted = handleEnd > handleStart && Math.max(...handleWindow) < cupMaxInverted;
      
      if (isCupShapeInverted && isHandleShapeInverted && cupMaxInverted - Math.min(...cupWindow) > cupStart * 0.05) {
        patterns.push({ name: 'Inverted Cup and Handle', type: 'bearish', strength: 0.85 });
      }
    }
    
    // Bull Flag: Bull pole, downward sloping parallel channel
    if (isBullPole && highSlope < -0.0002 && lowSlope < -0.0002 && Math.abs(highSlope - lowSlope) < 0.001) {
      patterns.push({ name: 'Bull Flag', type: 'bullish', strength: 0.85 });
    }
    // Bear Flag: Bear pole, upward sloping parallel channel
    else if (isBearPole && highSlope > 0.0002 && lowSlope > 0.0002 && Math.abs(highSlope - lowSlope) < 0.001) {
      patterns.push({ name: 'Bear Flag', type: 'bearish', strength: 0.85 });
    }
    
    // Bull Pennant: Bull pole, converging symmetrical triangle
    else if (isBullPole && highSlope < -0.0002 && lowSlope > 0.0002) {
      patterns.push({ name: 'Bull Pennant', type: 'bullish', strength: 0.8 });
    }
    // Bear Pennant: Bear pole, converging symmetrical triangle
    else if (isBearPole && highSlope < -0.0002 && lowSlope > 0.0002) {
      patterns.push({ name: 'Bear Pennant', type: 'bearish', strength: 0.8 });
    }
    
    // Falling Wedge: Both slopes down, but highs falling faster than lows (converging)
    else if (highSlope < -0.0005 && lowSlope < -0.0002 && highSlope < lowSlope) {
      patterns.push({ name: 'Falling Wedge', type: 'bullish', strength: 0.75 });
    }
    // Rising Wedge: Both slopes up, but lows rising faster than highs (converging)
    else if (highSlope > 0.0002 && lowSlope > 0.0005 && lowSlope > highSlope) {
      patterns.push({ name: 'Rising Wedge', type: 'bearish', strength: 0.75 });
    }
  }

  return patterns;
};
