import { Candle, AnalysisResult, Trade } from './types';
import { analyzeChart } from './analysis';
import { EMA, MACD, ADX, RSI, SMA, ATR } from 'technicalindicators';
import { detectBOS, detectLiquidityGrab, detectRsiDivergence } from './structure';
import { calculateVolumeProfile } from './volumeProfile';
import { detectPatterns } from './patterns';

const createNoTradeResult = (reason: string): AnalysisResult => ({
  signal: 'NO TRADE',
  confidence: 0,
  indicators: [{
    name: 'System Logic',
    value: 'STANDBY',
    signal: 'neutral',
    description: reason
  }],
  patterns: [],
  confluences: { supporting: [], opposing: [], neutral: [] },
  layers: { marketCondition: 0, trend: 0, entry: 0, confirmation: 0, structure: 0, volatility: 0 }
});

const getHTFDirection = (data: Candle[]): 'LONG' | 'SHORT' | 'NEUTRAL' => {
  if (data.length < 200) return 'NEUTRAL';
  const closes = data.map(d => d.close);
  const highs = data.map(d => d.high);
  const lows = data.map(d => d.low);
  
  const ema50 = EMA.calculate({ values: closes, period: 50 });
  const ema200 = EMA.calculate({ values: closes, period: 200 });
  const lastEma50 = ema50[ema50.length - 1];
  const lastEma200 = ema200[ema200.length - 1];
  const lastClose = closes[closes.length - 1];

  const macd = MACD.calculate({
    values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    SimpleMAOscillator: false, SimpleMASignal: false
  });
  const lastMacd = macd[macd.length - 1];

  const adx = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const lastAdx = adx[adx.length - 1];

  const bos = detectBOS(data);
  const volProfile = calculateVolumeProfile(data);

  let longScore = 0;
  let shortScore = 0;

  if (lastClose > lastEma50 && lastEma50 > lastEma200) longScore++;
  if (lastClose < lastEma50 && lastEma50 < lastEma200) shortScore++;

  if (lastMacd && lastMacd.MACD! > lastMacd.signal!) longScore++;
  if (lastMacd && lastMacd.MACD! < lastMacd.signal!) shortScore++;

  if (lastAdx && lastAdx.adx > 20) {
    if (lastAdx.pdi > lastAdx.mdi) longScore++;
    if (lastAdx.mdi > lastAdx.pdi) shortScore++;
  }

  if (bos === 'bullish') longScore++;
  if (bos === 'bearish') shortScore++;

  if (lastClose > volProfile.vaHigh) longScore++;
  if (lastClose < volProfile.vaLow) shortScore++;

  if (longScore >= 3 && shortScore === 0) return 'LONG';
  if (shortScore >= 3 && longScore === 0) return 'SHORT';
  
  return 'NEUTRAL';
};

const validateLTFEntry = (data: Candle[], direction: 'LONG' | 'SHORT'): { isValid: boolean, reason: string } => {
  if (data.length < 20) return { isValid: false, reason: 'Not enough data' };
  const closes = data.map(d => d.close);
  const volumes = data.map(d => d.volume);
  
  const volSma = SMA.calculate({ values: volumes, period: 20 });
  const lastVolSma = volSma[volSma.length - 1];
  const lastVol = volumes[volumes.length - 1];
  const prevVol = volumes[volumes.length - 2];

  const bos = detectBOS(data);
  const liquidityGrab = detectLiquidityGrab(data);
  
  const lastCandle = data[data.length - 1];
  
  const atr = ATR.calculate({ high: data.map(d => d.high), low: data.map(d => d.low), close: closes, period: 14 });
  const lastAtr = atr[atr.length - 1];

  const lastCandleBody = Math.abs(lastCandle.close - lastCandle.open);
  const isDisplacementUp = lastCandle.close > lastCandle.open && lastCandleBody > (lastAtr * 0.8) && lastVol > lastVolSma;
  const isDisplacementDown = lastCandle.close < lastCandle.open && lastCandleBody > (lastAtr * 0.8) && lastVol > lastVolSma;

  const volumeSpike = lastVol > lastVolSma * 1.5 || prevVol > lastVolSma * 1.5;

  if (direction === 'LONG') {
    const isBullishCandle = lastCandle.close > lastCandle.open;
    const isMicroBOS = bos === 'bullish';
    const isLiquiditySweep = liquidityGrab === 'bullish';
    
    if (!isBullishCandle) return { isValid: false, reason: 'LTF No bullish candle confirmation' };
    if (!volumeSpike) return { isValid: false, reason: 'LTF No volume spike' };
    if (!isDisplacementUp && !isMicroBOS && !isLiquiditySweep) {
      return { isValid: false, reason: 'LTF No entry trigger (Displacement, BOS, or Sweep)' };
    }
  } else {
    const isBearishCandle = lastCandle.close < lastCandle.open;
    const isMicroBOS = bos === 'bearish';
    const isLiquiditySweep = liquidityGrab === 'bearish';
    
    if (!isBearishCandle) return { isValid: false, reason: 'LTF No bearish candle confirmation' };
    if (!volumeSpike) return { isValid: false, reason: 'LTF No volume spike' };
    if (!isDisplacementDown && !isMicroBOS && !isLiquiditySweep) {
      return { isValid: false, reason: 'LTF No entry trigger (Displacement, BOS, or Sweep)' };
    }
  }

  return { isValid: true, reason: 'Valid' };
};

export const analyzeMultiTimeframe = (
  data4h: Candle[], 
  data15m: Candle[], 
  data5m: Candle[], 
  indicatorReliability: Record<string, number>,
  trades: Trade[],
  symbol: string
): AnalysisResult => {
  // 1. Analyze all timeframes
  const htfAnalysis = analyzeChart(data4h, indicatorReliability, trades, symbol);
  const mtfAnalysis = analyzeChart(data15m, indicatorReliability, trades, symbol);
  const ltfAnalysis = analyzeChart(data5m, indicatorReliability, trades, symbol);
  
  if (mtfAnalysis.signal === 'NO TRADE') {
    return mtfAnalysis;
  }

  // 2. Check for alignment
  const signals = [htfAnalysis.signal, mtfAnalysis.signal, ltfAnalysis.signal];
  const isAligned = signals.every(s => s === mtfAnalysis.signal);
  
  if (!isAligned) {
    return createNoTradeResult(`Timeframes not aligned: 4h(${htfAnalysis.signal}), 15m(${mtfAnalysis.signal}), 5m(${ltfAnalysis.signal})`);
  }

  // 3. Combine confidence
  // Weighting: 15m (MTF) is core, 4h (HTF) is trend, 5m (LTF) is trigger
  const combinedConfidence = (htfAnalysis.confidence * 0.3) + (mtfAnalysis.confidence * 0.4) + (ltfAnalysis.confidence * 0.3);
  
  // 4. Final result
  const finalAnalysis = { ...mtfAnalysis };
  finalAnalysis.confidence = combinedConfidence;
  
  // Update the System Logic indicator to reflect multi-TF alignment
  const sysLogicIdx = finalAnalysis.indicators.findIndex(i => i.name === 'System Logic');
  if (sysLogicIdx !== -1) {
    finalAnalysis.indicators[sysLogicIdx].description = `Multi-TF Aligned: 4h(${htfAnalysis.signal}), 15m(${mtfAnalysis.signal}), 5m(${ltfAnalysis.signal}). Combined Confidence: ${combinedConfidence.toFixed(1)}%`;
  }

  return finalAnalysis;
};
