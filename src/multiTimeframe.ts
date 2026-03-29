import { Candle, AnalysisResult, Trade } from './types';
import { analyzeChart } from './analysis';
import { EMA, MACD, ADX, RSI, SMA, ATR } from 'technicalindicators';
import { detectBOS, detectLiquidityGrab, detectRsiDivergence, calculateOrderFlow } from './structure';
import { calculateVolumeProfile } from './volumeProfile';
import { detectPatterns } from './patterns';

export const createNoTradeResult = (reason: string): AnalysisResult => ({
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

export const getHTFDirection = (data: Candle[]): 'LONG' | 'SHORT' | 'NEUTRAL' => {
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
  const orderFlow = calculateOrderFlow(data, 20);
  const rsi = RSI.calculate({ values: closes, period: 14 });
  const rsiDivergence = detectRsiDivergence(data, rsi);
  const liquidityGrab = detectLiquidityGrab(data);

  let longScore = 0;
  let shortScore = 0;

  // 1. Trend Alignment (High Weight)
  if (lastClose > lastEma50 && lastEma50 > lastEma200) longScore += 2;
  if (lastClose < lastEma50 && lastEma50 < lastEma200) shortScore += 2;

  // 2. Momentum
  if (lastMacd && lastMacd.MACD! > lastMacd.signal!) longScore += 1;
  if (lastMacd && lastMacd.MACD! < lastMacd.signal!) shortScore += 1;

  if (lastAdx && lastAdx.adx > 25) {
    if (lastAdx.pdi > lastAdx.mdi) longScore += 1.5;
    if (lastAdx.mdi > lastAdx.pdi) shortScore += 1.5;
  }

  // 3. Market Structure & Liquidity
  if (bos === 'bullish') longScore += 1.5;
  if (bos === 'bearish') shortScore += 1.5;

  if (liquidityGrab === 'bullish') longScore += 1;
  if (liquidityGrab === 'bearish') shortScore += 1;

  // 4. Order Flow & Volume Profile
  if (lastClose > volProfile.vaHigh) longScore += 1;
  if (lastClose < volProfile.vaLow) shortScore += 1;

  if (orderFlow.signal === 'bullish') longScore += 1;
  if (orderFlow.signal === 'bearish') shortScore += 1;

  // 5. Divergence (Leading Indicator)
  if (rsiDivergence === 'bullish') longScore += 1.5;
  if (rsiDivergence === 'bearish') shortScore += 1.5;

  // Require a strong conviction for HTF trend
  if (longScore >= 5.5 && shortScore <= 2) return 'LONG';
  if (shortScore >= 5.5 && longScore <= 2) return 'SHORT';
  
  return 'NEUTRAL';
};

export const validateLTFEntry = (data: Candle[], direction: 'LONG' | 'SHORT'): { isValid: boolean, reason: string } => {
  if (data.length < 20) return { isValid: false, reason: 'Not enough data' };
  const closes = data.map(d => d.close);
  const volumes = data.map(d => d.volume);
  
  const volSma = SMA.calculate({ values: volumes, period: 20 });
  const lastVolSma = volSma[volSma.length - 1];
  const lastVol = volumes[volumes.length - 1];
  const prevVol = volumes[volumes.length - 2];
  const prevVol2 = volumes[volumes.length - 3];

  const bos = detectBOS(data);
  const liquidityGrab = detectLiquidityGrab(data);
  const orderFlow = calculateOrderFlow(data, 5); // Short term order flow
  const rsi = RSI.calculate({ values: closes, period: 14 });
  const rsiDivergence = detectRsiDivergence(data, rsi);
  
  const lastCandle = data[data.length - 1];
  
  const atr = ATR.calculate({ high: data.map(d => d.high), low: data.map(d => d.low), close: closes, period: 14 });
  const lastAtr = atr[atr.length - 1];

  const lastCandleBody = Math.abs(lastCandle.close - lastCandle.open);
  const isDisplacementUp = lastCandle.close > lastCandle.open && lastCandleBody > (lastAtr * 0.8) && lastVol > lastVolSma;
  const isDisplacementDown = lastCandle.close < lastCandle.open && lastCandleBody > (lastAtr * 0.8) && lastVol > lastVolSma;

  const volumeSpike = lastVol > lastVolSma * 1.5 || prevVol > lastVolSma * 1.5 || prevVol2 > lastVolSma * 1.5;

  if (direction === 'LONG') {
    const isBullishCandle = lastCandle.close > lastCandle.open;
    const isMicroBOS = bos === 'bullish';
    const isLiquiditySweep = liquidityGrab === 'bullish';
    const isBullishOrderFlow = orderFlow.signal === 'bullish';
    const isBullishDivergence = rsiDivergence === 'bullish';
    
    if (!isBullishCandle) return { isValid: false, reason: 'LTF No bullish candle confirmation' };
    if (!volumeSpike && !isBullishOrderFlow) return { isValid: false, reason: 'LTF No volume spike or bullish order flow' };
    if (!isDisplacementUp && !isMicroBOS && !isLiquiditySweep && !isBullishDivergence) {
      return { isValid: false, reason: 'LTF No entry trigger (Displacement, BOS, Sweep, or Divergence)' };
    }
  } else {
    const isBearishCandle = lastCandle.close < lastCandle.open;
    const isMicroBOS = bos === 'bearish';
    const isLiquiditySweep = liquidityGrab === 'bearish';
    const isBearishOrderFlow = orderFlow.signal === 'bearish';
    const isBearishDivergence = rsiDivergence === 'bearish';
    
    if (!isBearishCandle) return { isValid: false, reason: 'LTF No bearish candle confirmation' };
    if (!volumeSpike && !isBearishOrderFlow) return { isValid: false, reason: 'LTF No volume spike or bearish order flow' };
    if (!isDisplacementDown && !isMicroBOS && !isLiquiditySweep && !isBearishDivergence) {
      return { isValid: false, reason: 'LTF No entry trigger (Displacement, BOS, Sweep, or Divergence)' };
    }
  }

  return { isValid: true, reason: 'Valid' };
};
