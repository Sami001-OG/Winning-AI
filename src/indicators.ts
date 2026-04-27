import { Candle } from './types';

export const calculateEMA = (values: number[], period: number): number[] => {
  const k = 2 / (period + 1);
  const ema = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
};

export const calculateSMA = (values: number[], period: number): number[] => {
  const sma = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      sma.push(0);
    } else {
      const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      sma.push(sum / period);
    }
  }
  return sma;
};

export const calculateRSI = (values: number[], period: number = 14): number[] => {
  const rsi = [];
  let gains = 0;
  let losses = 0;

  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      rsi.push(0);
      continue;
    }
    const diff = values[i] - values[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;

    if (i < period) {
      rsi.push(0);
    } else if (i === period) {
      rsi.push(100 - (100 / (1 + (gains / period) / (losses / period))));
    } else {
      gains = (gains * (period - 1) + (diff > 0 ? diff : 0)) / period;
      losses = (losses * (period - 1) + (diff < 0 ? -diff : 0)) / period;
      rsi.push(100 - (100 / (1 + gains / losses)));
    }
  }
  return rsi;
};

export const calculateSupertrend = (data: Candle[], atrArray: number[], period: number = 10, multiplier: number = 3) => {
  const supertrend = [];
  let finalUpperband = 0;
  let finalLowerband = 0;
  let trend = 1; 

  const atrPadded = new Array(Math.max(0, data.length - atrArray.length)).fill(0).concat(atrArray);

  for (let i = 0; i < data.length; i++) {
    if (i === 0 || atrPadded[i] === 0) {
      supertrend.push({ value: 0, trend: 1 });
      continue;
    }

    const hl2 = (data[i].high + data[i].low) / 2;
    const basicUpperband = hl2 + multiplier * atrPadded[i];
    const basicLowerband = hl2 - multiplier * atrPadded[i];

    if (i === 1 || finalUpperband === 0) {
      finalUpperband = basicUpperband;
      finalLowerband = basicLowerband;
      trend = 1;
      supertrend.push({ value: finalLowerband, trend });
      continue;
    }

    const prevClose = data[i - 1].close;
    const prevFinalUpperband = finalUpperband;
    const prevFinalLowerband = finalLowerband;
    const prevTrend = trend;

    if (basicUpperband < prevFinalUpperband || prevClose > prevFinalUpperband) {
      finalUpperband = basicUpperband;
    } else {
      finalUpperband = prevFinalUpperband;
    }

    if (basicLowerband > prevFinalLowerband || prevClose < prevFinalLowerband) {
      finalLowerband = basicLowerband;
    } else {
      finalLowerband = prevFinalLowerband;
    }

    if (prevTrend === 1 && data[i].close <= finalUpperband) {
      trend = -1;
    } else if (prevTrend === -1 && data[i].close >= finalLowerband) {
      trend = 1;
    } else {
      trend = prevTrend;
    }

    const stValue = trend === 1 ? finalLowerband : finalUpperband;
    supertrend.push({ value: stValue, trend });
  }

  return supertrend;
};

export const calculateATR = (highs: number[], lows: number[], closes: number[], period: number = 14): number[] => {
  const trs = [];
  for (let i = 0; i < highs.length; i++) {
    if (i === 0) {
      trs.push(highs[i] - lows[i]);
    } else {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trs.push(tr);
    }
  }

  const atr = [];
  let sum = 0;
  for (let i = 0; i < trs.length; i++) {
    if (i < period) {
      sum += trs[i];
      if (i === period - 1) {
        atr.push(sum / period);
      } else {
        atr.push(0);
      }
    } else {
      const lastAtr = atr[i - 1];
      const newAtr = (lastAtr * (period - 1) + trs[i]) / period;
      atr.push(newAtr);
    }
  }
  return atr;
};

export const calculateOBV = (closes: number[], volumes: number[]): number[] => {
  const obv = [volumes[0]];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) {
      obv.push(obv[i - 1] + volumes[i]);
    } else if (closes[i] < closes[i - 1]) {
      obv.push(obv[i - 1] - volumes[i]);
    } else {
      obv.push(obv[i - 1]);
    }
  }
  return obv;
};

export const calculateMACD = (closes: number[], fast: number = 12, slow: number = 26, signal: number = 9): { macd: number[], signalLine: number[], histogram: number[] } => {
  const emaFast = calculateEMA(closes, fast);
  const emaSlow = calculateEMA(closes, slow);
  const macd = emaFast.map((line, i) => line - emaSlow[i]);
  const signalLine = calculateEMA(macd, signal);
  const histogram = macd.map((line, i) => line - signalLine[i]);
  return { macd, signalLine, histogram };
};

export const calculateBollingerBands = (values: number[], period: number = 20, multiplier: number = 2): { upper: number[], middle: number[], lower: number[] } => {
  const middle = calculateSMA(values, period);
  const upper = [];
  const lower = [];

  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      upper.push(0);
      lower.push(0);
    } else {
      const slice = values.slice(i - period + 1, i + 1);
      const mean = middle[i];
      const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
      const stdDev = Math.sqrt(variance);
      upper.push(mean + stdDev * multiplier);
      lower.push(mean - stdDev * multiplier);
    }
  }
  return { upper, middle, lower };
};

export const calculateADX = (highs: number[], lows: number[], closes: number[], period: number = 14): { adx: number[], pdi: number[], mdi: number[] } => {
  const trs = [];
  const plusDm = [];
  const minusDm = [];

  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];

    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);

    if (upMove > downMove && upMove > 0) plusDm.push(upMove);
    else plusDm.push(0);

    if (downMove > upMove && downMove > 0) minusDm.push(downMove);
    else minusDm.push(0);
  }

  // Smoothing (simple for now)
  const smoothedTr = new Array(trs.length).fill(0);
  const smoothedPlusDm = new Array(plusDm.length).fill(0);
  const smoothedMinusDm = new Array(minusDm.length).fill(0);

  // Initial sum
  for (let i = 0; i < period; i++) {
    smoothedTr[period - 1] += trs[i];
    smoothedPlusDm[period - 1] += plusDm[i];
    smoothedMinusDm[period - 1] += minusDm[i];
  }

  for (let i = period; i < trs.length; i++) {
    smoothedTr[i] = (smoothedTr[i - 1] * (period - 1) + trs[i]) / period;
    smoothedPlusDm[i] = (smoothedPlusDm[i - 1] * (period - 1) + plusDm[i]) / period;
    smoothedMinusDm[i] = (smoothedMinusDm[i - 1] * (period - 1) + minusDm[i]) / period;
  }

  const pdi = smoothedPlusDm.map((dm, i) => smoothedTr[i] === 0 ? 0 : (dm / smoothedTr[i]) * 100);
  const mdi = smoothedMinusDm.map((dm, i) => smoothedTr[i] === 0 ? 0 : (dm / smoothedTr[i]) * 100);

  const dx = pdi.map((p, i) => (p + mdi[i]) === 0 ? 0 : (Math.abs(p - mdi[i]) / (p + mdi[i])) * 100);
  const adx = new Array(dx.length).fill(0);
  
  let sumDx = 0;
  for (let i = 0; i < period; i++) sumDx += dx[i + period - 1];
  adx[period * 2 - 2] = sumDx / period;

  for (let i = period * 2 - 1; i < dx.length; i++) {
    adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period;
  }

  // Pad arrays to match highs.length
  return {
    adx: new Array(period).fill(0).concat(adx),
    pdi: new Array(period).fill(0).concat(pdi),
    mdi: new Array(period).fill(0).concat(mdi)
  };
};
