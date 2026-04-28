import { Candle } from './types';
import { EMA, SMA, RSI, ATR, MACD, ADX, BollingerBands } from 'technicalindicators';

export const calculateEMA = (values: number[], period: number): number[] => {
  const ema = EMA.calculate({ period, values });
  return new Array(values.length - ema.length).fill(ema[0] || 0).concat(ema);
};

export const calculateSMA = (values: number[], period: number): number[] => {
  const sma = SMA.calculate({ period, values });
  return new Array(values.length - sma.length).fill(sma[0] || 0).concat(sma);
};

export const calculateRSI = (values: number[], period: number = 14): number[] => {
  const rsi = RSI.calculate({ period, values });
  return new Array(values.length - rsi.length).fill(rsi[0] || 50).concat(rsi);
};

export const calculateSupertrend = (data: Candle[], atrArray: number[], period: number = 10, multiplier: number = 3) => {
  const supertrend = [];
  let finalUpperband = 0;
  let finalLowerband = 0;
  let trend = 1;

  for (let i = 0; i < data.length; i++) {
    if (i === 0 || atrArray[i] === 0) {
      supertrend.push({ value: 0, trend: 1 });
      continue;
    }

    const hl2 = (data[i].high + data[i].low) / 2;
    const basicUpperband = hl2 + multiplier * atrArray[i];
    const basicLowerband = hl2 - multiplier * atrArray[i];

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
  const atr = ATR.calculate({ high: highs, low: lows, close: closes, period });
  return new Array(highs.length - atr.length).fill(atr[0] || 0).concat(atr);
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

export const calculateMACD = (closes: number[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9): { macd: number[], signalLine: number[], histogram: number[] } => {
  const macdResult = MACD.calculate({ 
    values: closes, 
    fastPeriod, 
    slowPeriod, 
    signalPeriod,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  
  const padLength = closes.length - macdResult.length;
  const padAmount = padLength > 0 ? padLength : 0;
  
  const firstMacd = macdResult[0] && macdResult[0].MACD ? macdResult[0].MACD : 0;
  const firstSignal = macdResult[0] && macdResult[0].signal ? macdResult[0].signal : 0;
  const firstHist = macdResult[0] && macdResult[0].histogram ? macdResult[0].histogram : 0;

  return { 
    macd: new Array(padAmount).fill(firstMacd).concat(macdResult.map(m => m.MACD || 0)), 
    signalLine: new Array(padAmount).fill(firstSignal).concat(macdResult.map(m => m.signal || 0)), 
    histogram: new Array(padAmount).fill(firstHist).concat(macdResult.map(m => m.histogram || 0)) 
  };
};

export const calculateBollingerBands = (values: number[], period: number = 20, multiplier: number = 2): { upper: number[], middle: number[], lower: number[] } => {
  const bb = BollingerBands.calculate({ period, stdDev: multiplier, values });
  const padLength = values.length - bb.length;
  const padAmount = padLength > 0 ? padLength : 0;

  const firstUpper = bb[0] && bb[0].upper ? bb[0].upper : 0;
  const firstMiddle = bb[0] && bb[0].middle ? bb[0].middle : 0;
  const firstLower = bb[0] && bb[0].lower ? bb[0].lower : 0;

  return { 
    upper: new Array(padAmount).fill(firstUpper).concat(bb.map(b => b.upper)),
    middle: new Array(padAmount).fill(firstMiddle).concat(bb.map(b => b.middle)),
    lower: new Array(padAmount).fill(firstLower).concat(bb.map(b => b.lower))
  };
};

export const calculateADX = (highs: number[], lows: number[], closes: number[], period: number = 14): { adx: number[], pdi: number[], mdi: number[] } => {
  const adxResult = ADX.calculate({ high: highs, low: lows, close: closes, period });
  const padLength = highs.length - adxResult.length;
  const padAmount = padLength > 0 ? padLength : 0;

  const firstAdx = adxResult[0] && adxResult[0].adx ? adxResult[0].adx : 0;
  const firstPdi = adxResult[0] && adxResult[0].pdi ? adxResult[0].pdi : 0;
  const firstMdi = adxResult[0] && adxResult[0].mdi ? adxResult[0].mdi : 0;

  return {
    adx: new Array(padAmount).fill(firstAdx).concat(adxResult.map(a => a.adx)),
    pdi: new Array(padAmount).fill(firstPdi).concat(adxResult.map(a => a.pdi)),
    mdi: new Array(padAmount).fill(firstMdi).concat(adxResult.map(a => a.mdi))
  };
};
