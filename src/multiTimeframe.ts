import { Candle, AnalysisResult, Trade } from './types';
import { analyzeChart } from './analysis';
import { EMA, MACD, ADX, RSI, SMA, ATR } from 'technicalindicators';
import { detectBOS, detectLiquidityGrab, detectAllRsiDivergences, detectMacdDivergences, calculateOrderFlow } from './structure';
import { calculateVolumeProfile } from './volumeProfile';
import { detectPatterns } from './patterns';
import { calculateSupertrend } from './indicators';

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
  
  const ema9 = EMA.calculate({ values: closes, period: 9 });
  const ema21 = EMA.calculate({ values: closes, period: 21 });
  const ema50 = EMA.calculate({ values: closes, period: 50 });
  const lastEma9 = ema9[ema9.length - 1];
  const lastEma21 = ema21[ema21.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  const lastClose = closes[closes.length - 1];

  const macd = MACD.calculate({
    values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    SimpleMAOscillator: false, SimpleMASignal: false
  });
  const lastMacd = macd[macd.length - 1];
  const prevMacd = macd[macd.length - 2];
  const prevPrevMacd = macd[macd.length - 3];

  const adx = ADX.calculate({ high: highs, low: lows, close: closes, period: 20 });
  const lastAdx = adx[adx.length - 1];

  const bos = detectBOS(data);
  const volProfile = calculateVolumeProfile(data);
  const orderFlow = calculateOrderFlow(data, 10);
  const liquidityGrab = detectLiquidityGrab(data);

  let longScore = 0;
  let shortScore = 0;

  // 1. Trend Alignment (High Weight)
  if (lastClose > lastEma9 && lastEma9 > lastEma21 && lastEma21 > lastEma50) longScore += 2;
  if (lastClose < lastEma9 && lastEma9 < lastEma21 && lastEma21 < lastEma50) shortScore += 2;

  // 2. Momentum (MACD as Leading Indicator)
  if (lastMacd && prevMacd && prevPrevMacd) {
    const hist = lastMacd.histogram || 0;
    const prevHist = prevMacd.histogram || 0;
    const prevPrevHist = prevPrevMacd.histogram || 0;

    if (hist > 0) {
      if (hist > prevHist && prevHist > prevPrevHist) longScore += 1.5; // Deep Green
      else if (hist < prevHist) shortScore += 1; // Light Green (Weakening)
      else longScore += 0.5;
    } else if (hist < 0) {
      if (hist < prevHist && prevHist < prevPrevHist) shortScore += 1.5; // Deep Red
      else if (hist > prevHist) longScore += 1; // Light Red (Weakening)
      else shortScore += 0.5;
    }
  }

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

  // 5. Divergence (Removed from 4h, handled in 15m)

  // Require a strong conviction for HTF trend
  if (longScore >= 4.5 && shortScore <= 2.5) return 'LONG';
  if (shortScore >= 4.5 && longScore <= 2.5) return 'SHORT';
  
  return 'NEUTRAL';
};

export const get1HControlState = (data: Candle[], htfBias: 'LONG' | 'SHORT'): { state: 'CONTINUATION' | 'EXHAUSTION' | 'VETO', reason: string } => {
  if (data.length < 50) return { state: 'VETO', reason: 'Not enough data' };
  
  const closes = data.map(d => d.close);
  const ema20 = EMA.calculate({ values: closes, period: 20 });
  const ema50 = EMA.calculate({ values: closes, period: 50 });
  const lastEma20 = ema20[ema20.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  
  const macd = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
  const hist = macd[macd.length - 1].histogram || 0;
  const prevHist = macd[macd.length - 2].histogram || 0;
  
  const rsi = RSI.calculate({ values: closes, period: 14 });
  const lastRsi = rsi[rsi.length - 1];
  const lastClose = closes[closes.length - 1];

  if (htfBias === 'LONG') {
    // VETO: Strong counter-trend momentum (Dark Red MACD)
    if (hist < 0 && hist < prevHist) {
      return { state: 'VETO', reason: 'Strong Bearish Pullback (Dark Red MACD)' };
    }
    
    // NEW VETO: RSI too high (late to the party)
    if (lastRsi > 65) {
      return { state: 'VETO', reason: '1H RSI Overbought (>65) - Too late to enter LONG' };
    }
    
    // CONTINUATION: Aligned momentum (Dark Green MACD), RSI > 50, Price > EMAs
    if (hist > 0 && hist > prevHist && lastRsi > 50 && lastClose > lastEma20) {
      return { state: 'CONTINUATION', reason: 'Momentum Expansion (Dark Green MACD)' };
    }
    
    // EXHAUSTION: Pullback is losing steam (Light Red MACD) or minor dip (Light Green MACD)
    if (hist < 0 && hist > prevHist) {
      return { state: 'EXHAUSTION', reason: 'Bearish Exhaustion (Light Red MACD)' };
    }
    if (hist > 0 && hist < prevHist && lastRsi > 40) {
      return { state: 'EXHAUSTION', reason: 'Minor Pullback (Light Green MACD)' };
    }
    
    return { state: 'VETO', reason: 'No clear 1H alignment' };
  } else {
    // SHORT BIAS
    // VETO: Strong counter-trend momentum (Dark Green MACD)
    if (hist > 0 && hist > prevHist) {
      return { state: 'VETO', reason: 'Strong Bullish Pullback (Dark Green MACD)' };
    }
    
    // NEW VETO: RSI too low (late to the party)
    if (lastRsi < 35) {
      return { state: 'VETO', reason: '1H RSI Oversold (<35) - Too late to enter SHORT' };
    }
    
    // CONTINUATION: Aligned momentum (Dark Red MACD), RSI < 50, Price < EMAs
    if (hist < 0 && hist < prevHist && lastRsi < 50 && lastClose < lastEma20) {
      return { state: 'CONTINUATION', reason: 'Momentum Expansion (Dark Red MACD)' };
    }
    
    // EXHAUSTION: Pullback is losing steam (Light Green MACD) or minor pump (Light Red MACD)
    if (hist > 0 && hist < prevHist) {
      return { state: 'EXHAUSTION', reason: 'Bullish Exhaustion (Light Green MACD)' };
    }
    if (hist < 0 && hist > prevHist && lastRsi < 60) {
      return { state: 'EXHAUSTION', reason: 'Minor Pullback (Light Red MACD)' };
    }
    
    return { state: 'VETO', reason: 'No clear 1H alignment' };
  }
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
  const orderFlow = calculateOrderFlow(data, 3); // Short term order flow
  
  const atr = ATR.calculate({ high: data.map(d => d.high), low: data.map(d => d.low), close: closes, period: 14 });
  const lastAtr = atr[atr.length - 1];

  const ema10 = EMA.calculate({ values: closes, period: 10 });
  const ema30 = EMA.calculate({ values: closes, period: 30 });
  const ema100 = EMA.calculate({ values: closes, period: 100 });
  const lastEma10 = ema10[ema10.length - 1];
  const lastEma30 = ema30[ema30.length - 1];
  const lastEma100 = ema100[ema100.length - 1];

  const adx = ADX.calculate({ high: data.map(d => d.high), low: data.map(d => d.low), close: closes, period: 7 });
  const lastAdx = adx[adx.length - 1];
  
  const lastCandle = data[data.length - 1];

  const lastCandleBody = Math.abs(lastCandle.close - lastCandle.open);
  const isDisplacementUp = lastCandle.close > lastCandle.open && lastCandleBody > (lastAtr * 0.8) && lastVol > lastVolSma;
  const isDisplacementDown = lastCandle.close < lastCandle.open && lastCandleBody > (lastAtr * 0.8) && lastVol > lastVolSma;

  const volumeSpike = lastVol > lastVolSma * 1.5 || prevVol > lastVolSma * 1.5 || prevVol2 > lastVolSma * 1.5;

  if (direction === 'LONG') {
    const isEmaAligned = lastCandle.close > lastEma10 && lastEma10 > lastEma30;
    const isMomentumUp = lastAdx && lastAdx.adx > 20 && lastAdx.pdi > lastAdx.mdi;

    const isBullishCandle = lastCandle.close > lastCandle.open;
    const isMicroBOS = bos === 'bullish';
    const isLiquiditySweep = liquidityGrab === 'bullish';
    const isBullishOrderFlow = orderFlow.signal === 'bullish';
    
    if (!isBullishCandle) return { isValid: false, reason: 'LTF No bullish candle confirmation' };
    if (!volumeSpike && !isBullishOrderFlow && !isDisplacementUp) return { isValid: false, reason: 'LTF No volume spike, order flow, or displacement' };
    if (!isDisplacementUp && !isMicroBOS && !isLiquiditySweep && !isEmaAligned && !isMomentumUp) {
      return { isValid: false, reason: 'LTF No entry trigger (Displacement, BOS, Sweep, EMA Alignment, or Momentum)' };
    }
  } else {
    const isEmaAligned = lastCandle.close < lastEma10 && lastEma10 < lastEma30;
    const isMomentumDown = lastAdx && lastAdx.adx > 20 && lastAdx.mdi > lastAdx.pdi;

    const isBearishCandle = lastCandle.close < lastCandle.open;
    const isMicroBOS = bos === 'bearish';
    const isLiquiditySweep = liquidityGrab === 'bearish';
    const isBearishOrderFlow = orderFlow.signal === 'bearish';
    
    if (!isBearishCandle) return { isValid: false, reason: 'LTF No bearish candle confirmation' };
    if (!volumeSpike && !isBearishOrderFlow && !isDisplacementDown) return { isValid: false, reason: 'LTF No volume spike, order flow, or displacement' };
    if (!isDisplacementDown && !isMicroBOS && !isLiquiditySweep && !isEmaAligned && !isMomentumDown) {
      return { isValid: false, reason: 'LTF No entry trigger (Displacement, BOS, Sweep, EMA Alignment, or Momentum)' };
    }
  }

  return { isValid: true, reason: 'Valid' };
};
