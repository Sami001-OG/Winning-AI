import { Candle } from './types';

export interface VolumeProfileResult {
  pocPrice: number;
  vaHigh: number;
  vaLow: number;
  totalVolume: number;
}

export const calculateVolumeProfile = (data: Candle[], bins: number = 50): VolumeProfileResult => {
  if (data.length === 0) {
    return { pocPrice: 0, vaHigh: 0, vaLow: 0, totalVolume: 0 };
  }

  let minPrice = Infinity;
  let maxPrice = -Infinity;
  let totalVolume = 0;

  for (const candle of data) {
    if (candle.low < minPrice) minPrice = candle.low;
    if (candle.high > maxPrice) maxPrice = candle.high;
    totalVolume += candle.volume;
  }

  const binSize = (maxPrice - minPrice) / bins;
  const binVolumes = new Array(bins).fill(0);

  for (const candle of data) {
    // Use mid price for binning
    const midPrice = (candle.high + candle.low) / 2;
    let binIndex = Math.floor((midPrice - minPrice) / binSize);
    if (binIndex < 0) binIndex = 0;
    if (binIndex >= bins) binIndex = bins - 1;
    binVolumes[binIndex] += candle.volume;
  }

  // Find POC
  let maxVol = -1;
  let pocIndex = 0;
  for (let i = 0; i < bins; i++) {
    if (binVolumes[i] > maxVol) {
      maxVol = binVolumes[i];
      pocIndex = i;
    }
  }
  const pocPrice = minPrice + (pocIndex * binSize) + (binSize / 2);

  // Calculate Value Area (70% of total volume)
  const targetVolume = totalVolume * 0.7;
  let currentVolume = binVolumes[pocIndex];
  let vaLowIndex = pocIndex;
  let vaHighIndex = pocIndex;

  while (currentVolume < targetVolume && (vaLowIndex > 0 || vaHighIndex < bins - 1)) {
    const leftVol = vaLowIndex > 0 ? binVolumes[vaLowIndex - 1] : -1;
    const rightVol = vaHighIndex < bins - 1 ? binVolumes[vaHighIndex + 1] : -1;

    if (leftVol > rightVol) {
      vaLowIndex--;
      currentVolume += leftVol;
    } else {
      vaHighIndex++;
      currentVolume += rightVol;
    }
  }

  return {
    pocPrice,
    vaHigh: minPrice + (vaHighIndex * binSize) + binSize,
    vaLow: minPrice + (vaLowIndex * binSize),
    totalVolume
  };
};
