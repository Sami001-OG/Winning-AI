import { Candle } from './types';

export const calculateSupertrend = (data: Candle[], atrArray: number[], period: number = 10, multiplier: number = 3) => {
  const supertrend = [];
  let finalUpperband = 0;
  let finalLowerband = 0;
  let trend = 1; // 1 for up, -1 for down

  // Pad ATR array to match data length (technicalindicators ATR returns length - period)
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
      trend = -1; // Flip to downtrend
    } else if (prevTrend === -1 && data[i].close >= finalLowerband) {
      trend = 1; // Flip to uptrend
    } else {
      trend = prevTrend;
    }

    const stValue = trend === 1 ? finalLowerband : finalUpperband;
    supertrend.push({ value: stValue, trend });
  }

  return supertrend;
};
