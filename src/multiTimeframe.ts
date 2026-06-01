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
  const ema200 = EMA.calculate({ values: closes, period: 200 });
  const lastEma9 = ema9[ema9.length - 1];
  const lastEma21 = ema21[ema21.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  const lastEma200 = ema200[ema200.length - 1];
  const lastClose = closes[closes.length - 1];

  const macd = MACD.calculate({
    values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    SimpleMAOscillator: false, SimpleMASignal: false
  });
  const lastMacd = macd[macd.length - 1];
  const prevMacd = macd[macd.length - 2];

  const adx = ADX.calculate({ high: highs, low: lows, close: closes, period: 20 });
  const lastAdx = adx[adx.length - 1];

  const bos = detectBOS(data);
  const volProfile = calculateVolumeProfile(data);
  const orderFlow = calculateOrderFlow(data, 10);
  const liquidityGrab = detectLiquidityGrab(data);

  let longScore = 0;
  let shortScore = 0;

  // 1. Price vs 200 EMA (30 pts)
  if (lastClose > lastEma200) longScore += 30;
  if (lastClose < lastEma200) shortScore += 30;

  // 2. 9 EMA vs 50 EMA (20 pts)
  if (lastEma9 > lastEma50) longScore += 20;
  if (lastEma9 < lastEma50) shortScore += 20;

  // 3. MACD Histogram (25 pts max)
  if (lastMacd && prevMacd) {
    const hist = lastMacd.histogram || 0;
    const prevHist = prevMacd.histogram || 0;
    
    if (hist > 0 && hist > prevHist) longScore += 25; // Dark green
    else if (hist > 0) longScore += 10; // Light green

    if (hist < 0 && hist < prevHist) shortScore += 25; // Dark red
    else if (hist < 0) shortScore += 10; // Light red
  }

  // 4. ADX (15 pts) - Looser ADX requirement
  if (lastAdx) {
    if (lastAdx.adx > 25) {
      if (lastAdx.pdi > lastAdx.mdi) longScore += 15;
      if (lastAdx.mdi > lastAdx.pdi) shortScore += 15;
    } else if (lastAdx.adx > 20) {
      if (lastAdx.pdi > lastAdx.mdi) longScore += 5;
      if (lastAdx.mdi > lastAdx.pdi) shortScore += 5;
    }
  }

  // 5. Market Structure / BOS (10 pts)
  if (bos === 'bullish') longScore += 10;
  if (bos === 'bearish') shortScore += 10;

  if (longScore >= 50) return 'LONG';
  if (shortScore >= 50) return 'SHORT';
  
  return 'NEUTRAL';
};

export const get1HControlState = (data: Candle[], htfBias: 'LONG' | 'SHORT'): { state: 'CONTINUATION' | 'WAIT' | 'VETO', reason: string } => {
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
    // EXHAUSTION TYPE B (Deep) / VETO
    if (hist < 0 && hist < prevHist && hist < -0.05) {
      return { state: 'VETO', reason: 'Strong Bearish Pullback (Dark Red MACD)' };
    }
    
    // CONTINUATION
    if (hist > 0 && hist > prevHist && lastRsi > 50 && lastClose > lastEma20) {
      return { state: 'CONTINUATION', reason: 'Momentum Expansion (Dark Green MACD)' };
    }
    
    // EXHAUSTION TYPE A (Shallow) -> WAIT
    if (hist <= 0 || hist <= prevHist) {
      return { state: 'WAIT', reason: 'Bearish Exhaustion or Minor Pullback' };
    }
    
    return { state: 'CONTINUATION', reason: 'Defaulting to Continuation' };
  } else {
    // SHORT BIAS
    // EXHAUSTION TYPE B (Deep) / VETO
    if (hist > 0 && hist > prevHist && hist > 0.05) {
      return { state: 'VETO', reason: 'Strong Bullish Pullback (Dark Green MACD)' };
    }
    
    // CONTINUATION
    if (hist < 0 && hist < prevHist && lastRsi < 55) {
      return { state: 'CONTINUATION', reason: 'Momentum Expansion (Dark Red MACD)' };
    }
    
    // EXHAUSTION TYPE A (Shallow) -> WAIT
    if (hist >= 0 || hist >= prevHist) {
      return { state: 'WAIT', reason: 'Bullish Exhaustion or Minor Pullback' };
    }
    
    return { state: 'CONTINUATION', reason: 'Defaulting to Continuation' };
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

  const rsi = RSI.calculate({ values: closes, period: 14 });
  const lastRsi = rsi[rsi.length - 1];

  let cumulativeTypicalVolume = 0;
  let cumulativeVolume = 0;
  for (const candle of data.slice(-100)) {
    const tp = (candle.high + candle.low + candle.close) / 3;
    cumulativeTypicalVolume += tp * candle.volume;
    cumulativeVolume += candle.volume;
  }
  const vwap = cumulativeVolume > 0 ? cumulativeTypicalVolume / cumulativeVolume : closes[closes.length - 1];
  const priceAtVwap = Math.abs(lastCandle.close - vwap) / vwap < 0.003;

  const isEmaCrossImminentUp = lastEma10 < lastEma30 && (lastEma30 - lastEma10) / lastEma30 < 0.001;
  const isEmaCrossImminentDown = lastEma10 > lastEma30 && (lastEma10 - lastEma30) / lastEma30 < 0.001;

  let score = 0;
  const breakDown: Record<string, number> = {};

  if (direction === 'LONG') {
    const isEmaAligned = lastCandle.close > lastEma10 && lastEma10 > lastEma30;
    if (isEmaAligned) { score += 25; breakDown['EMA'] = 25; }

    const isMicroBOS = bos === 'bullish';
    if (isMicroBOS) { score += 25; breakDown['Structure'] = 25; }

    const isMomentumUp = (lastAdx && lastAdx.adx > 15 && lastAdx.pdi > lastAdx.mdi) || (lastRsi > 50 && lastRsi < 70);
    if (isMomentumUp) { score += 20; breakDown['Momentum'] = 20; }

    const isLiquiditySweep = liquidityGrab === 'bullish';
    if (isLiquiditySweep) { score += 15; breakDown['Liquidity'] = 15; }

    const isVolumeUp = isDisplacementUp || (lastVol > lastVolSma && orderFlow.signal === 'bullish') || (volumeSpike && orderFlow.signal === 'bullish');
    if (isVolumeUp) { score += 15; breakDown['Volume'] = 15; }

    const threshold = 40;
    if (score < threshold) {
      return { isValid: false, reason: `LTF Rejection: Score is ${score}/${threshold} (Needed >= ${threshold}). Details: [${Object.entries(breakDown).map(([k,v]) => `${k}:${v}`).join(', ')}]` };
    }
  } else {
    const isEmaAligned = lastCandle.close < lastEma10 && lastEma10 < lastEma30;
    if (isEmaAligned) { score += 25; breakDown['EMA'] = 25; }

    const isMicroBOS = bos === 'bearish';
    if (isMicroBOS) { score += 25; breakDown['Structure'] = 25; }

    const isMomentumDown = (lastAdx && lastAdx.adx > 15 && lastAdx.mdi > lastAdx.pdi) || (lastRsi < 50 && lastRsi > 30);
    if (isMomentumDown) { score += 20; breakDown['Momentum'] = 20; }

    const isLiquiditySweep = liquidityGrab === 'bearish';
    if (isLiquiditySweep) { score += 15; breakDown['Liquidity'] = 15; }

    const isVolumeUp = isDisplacementDown || (lastVol > lastVolSma && orderFlow.signal === 'bearish') || (volumeSpike && orderFlow.signal === 'bearish');
    if (isVolumeUp) { score += 15; breakDown['Volume'] = 15; }

    const threshold = 40;
    if (score < threshold) {
      return { isValid: false, reason: `LTF Rejection: Score is ${score}/${threshold} (Needed >= ${threshold}). Details: [${Object.entries(breakDown).map(([k,v]) => `${k}:${v}`).join(', ')}]` };
    }
  }

  return { isValid: true, reason: 'Valid' };
};
