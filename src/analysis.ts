import { 
  RSI, 
  MACD, 
  EMA, 
  SMA,
  BollingerBands, 
  Stochastic, 
  ATR, 
  ADX, 
  CCI,
  OBV
} from 'technicalindicators';
import { Candle, AnalysisResult, IndicatorResult } from './types';

export const analyzeChart = (data: Candle[]): AnalysisResult => {
  const closes = data.map(d => d.close);
  const highs = data.map(d => d.high);
  const lows = data.map(d => d.low);
  const volumes = data.map(d => d.volume);

  const indicators: IndicatorResult[] = [];
  const lastClose = closes[closes.length - 1];

  // ==========================================
  // CALCULATE INDICATORS
  // ==========================================
  
  // Volatility & Market Condition
  const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const lastAtr = atr[atr.length - 1] || 0;
  
  const adx = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const lastAdx = adx[adx.length - 1];
  
  const bb = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
  const lastBB = bb[bb.length - 1];
  const prevBB = bb[bb.length - 2];

  // Trend
  const ema20 = EMA.calculate({ values: closes, period: 20 });
  const ema50 = EMA.calculate({ values: closes, period: 50 });
  const ema200 = EMA.calculate({ values: closes, period: 200 });
  const lastEma20 = ema20[ema20.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  const lastEma200 = ema200[ema200.length - 1];

  const macd = MACD.calculate({
    values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    SimpleMAOscillator: false, SimpleMASignal: false
  });
  const lastMacd = macd[macd.length - 1];

  // Momentum / Entry
  const rsi = RSI.calculate({ values: closes, period: 14 });
  const lastRsi = rsi[rsi.length - 1];

  const stoch = Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 });
  const lastStoch = stoch[stoch.length - 1];

  const cci = CCI.calculate({ high: highs, low: lows, close: closes, period: 20 });
  const lastCci = cci[cci.length - 1];

  // Volume / Confirmation
  const obv = OBV.calculate({ close: closes, volume: volumes });
  const lastObv = obv[obv.length - 1];
  const prevObv = obv[obv.length - 2];
  
  const volSma = SMA.calculate({ values: volumes, period: 20 });
  const lastVolSma = volSma[volSma.length - 1];
  const lastVol = volumes[volumes.length - 1];

  // ==========================================
  // LAYER 1: MARKET CONDITION DETECTION
  // ==========================================
  const isTrending = lastAdx?.adx > 25;
  const isTrendingUp = isTrending && lastAdx?.pdi > lastAdx?.mdi;
  const isTrendingDown = isTrending && lastAdx?.mdi > lastAdx?.pdi;
  const isSideways = !isTrending;
  
  const bbWidth = lastBB ? (lastBB.upper - lastBB.lower) / lastBB.middle : 0;
  const prevBbWidth = prevBB ? (prevBB.upper - prevBB.lower) / prevBB.middle : 0;
  const isHighVolatility = bbWidth > (prevBbWidth * 1.5); // Volatility expansion

  let layer1Score = 0;
  if (isTrendingUp) layer1Score = Math.min(lastAdx.adx / 50, 1);
  else if (isTrendingDown) layer1Score = Math.max(-lastAdx.adx / 50, -1);

  indicators.push({
    name: 'Market State',
    value: isHighVolatility ? 'HIGH VOLATILITY' : isTrendingUp ? 'TRENDING UP' : isTrendingDown ? 'TRENDING DOWN' : 'SIDEWAYS',
    signal: isTrendingUp ? 'bullish' : isTrendingDown ? 'bearish' : 'neutral',
    description: `ADX: ${lastAdx?.adx.toFixed(1)} | BBW: ${(bbWidth*100).toFixed(2)}%`
  });

  // ==========================================
  // LAYER 2: TREND DIRECTION
  // ==========================================
  let emaScore = 0;
  if (lastClose > lastEma20 && lastEma20 > lastEma50 && lastEma50 > lastEma200) emaScore = 1;
  else if (lastClose < lastEma20 && lastEma20 < lastEma50 && lastEma50 < lastEma200) emaScore = -1;
  else if (lastClose > lastEma50) emaScore = 0.5;
  else if (lastClose < lastEma50) emaScore = -0.5;

  let macdScore = 0;
  if (lastMacd) {
    if (lastMacd.MACD! > lastMacd.signal! && lastMacd.MACD! > 0) macdScore = 1;
    else if (lastMacd.MACD! < lastMacd.signal! && lastMacd.MACD! < 0) macdScore = -1;
    else if (lastMacd.MACD! > lastMacd.signal!) macdScore = 0.5;
    else if (lastMacd.MACD! < lastMacd.signal!) macdScore = -0.5;
  }

  const layer2Score = (emaScore + macdScore) / 2;

  indicators.push({
    name: 'Trend Alignment',
    value: layer2Score > 0.5 ? 'STRONG BULL' : layer2Score < -0.5 ? 'STRONG BEAR' : 'MIXED',
    signal: layer2Score > 0 ? 'bullish' : layer2Score < 0 ? 'bearish' : 'neutral',
    description: 'EMA & MACD Confluence'
  });

  // ==========================================
  // LAYER 3: ENTRY TIMING
  // ==========================================
  let rsiScore = 0;
  let stochScore = 0;
  let cciScore = 0;

  if (isTrendingUp) {
    if (lastRsi < 50) rsiScore = 1; // Pullback entry
    if (lastStoch?.k < 50) stochScore = 1;
    if (lastCci < 0) cciScore = 1;
  } else if (isTrendingDown) {
    if (lastRsi > 50) rsiScore = -1; // Pullback entry
    if (lastStoch?.k > 50) stochScore = -1;
    if (lastCci > 0) cciScore = -1;
  } else {
    // Sideways Mean Reversion
    if (lastRsi < 30) rsiScore = 1;
    else if (lastRsi > 70) rsiScore = -1;
    
    if (lastStoch?.k < 20) stochScore = 1;
    else if (lastStoch?.k > 80) stochScore = -1;
    
    if (lastCci < -100) cciScore = 1;
    else if (lastCci > 100) cciScore = -1;
  }

  const layer3Score = (rsiScore + stochScore + cciScore) / 3;

  indicators.push({
    name: 'Entry Timing',
    value: layer3Score > 0.5 ? 'OPTIMAL LONG' : layer3Score < -0.5 ? 'OPTIMAL SHORT' : 'WAIT',
    signal: layer3Score > 0 ? 'bullish' : layer3Score < 0 ? 'bearish' : 'neutral',
    description: 'RSI, Stoch, CCI Matrix'
  });

  // ==========================================
  // LAYER 4: CONFIRMATION
  // ==========================================
  let volScore = 0;
  if (lastVol > lastVolSma * 1.2) {
    volScore = lastClose > closes[closes.length - 2] ? 1 : -1;
  }

  let obvScore = 0;
  if (lastObv > prevObv) obvScore = 1;
  else if (lastObv < prevObv) obvScore = -1;

  const layer4Score = (volScore + obvScore) / 2;

  indicators.push({
    name: 'Volume Confirm',
    value: layer4Score > 0 ? 'ACCUMULATION' : layer4Score < 0 ? 'DISTRIBUTION' : 'NEUTRAL',
    signal: layer4Score > 0 ? 'bullish' : layer4Score < 0 ? 'bearish' : 'neutral',
    description: 'Volume & OBV Flow'
  });

  // ==========================================
  // ADAPTIVE WEIGHTS & FINAL SCORE
  // ==========================================
  let w1 = 0.30; // Market Condition
  let w2 = 0.30; // Trend
  let w3 = 0.25; // Entry
  let w4 = 0.15; // Confirmation

  if (isTrending) {
    w2 = 0.40; // Increase Trend weight
    w3 = 0.15; // Decrease Entry weight
  } else if (isSideways) {
    w3 = 0.40; // Increase Entry weight
    w2 = 0.15; // Decrease Trend weight
  }

  const finalScore = (layer1Score * w1) + (layer2Score * w2) + (layer3Score * w3) + (layer4Score * w4);
  
  let confidence = Math.abs(finalScore) * 100;
  
  // High Volatility Penalty
  if (isHighVolatility) {
    confidence *= 0.8; 
  }

  // ==========================================
  // ANTI-NOISE FILTER & DECISION RULE
  // ==========================================
  let signal: 'LONG' | 'SHORT' | 'NO TRADE' = 'NO TRADE';
  let reason = 'Awaiting high-probability setup.';

  // Conflict Check: If Trend and Entry strongly disagree
  const isConflict = Math.sign(layer2Score) !== Math.sign(layer3Score) && Math.abs(layer2Score) > 0.3 && Math.abs(layer3Score) > 0.3;

  if (isConflict) {
    signal = 'NO TRADE';
    confidence = 0;
    reason = 'Signal conflict: Trend vs Momentum.';
  } else if (confidence > 75) {
    signal = finalScore > 0 ? 'LONG' : 'SHORT';
    reason = `Strong ${signal} setup. High confluence.`;
  } else if (confidence >= 60) {
    signal = finalScore > 0 ? 'LONG' : 'SHORT';
    reason = `Moderate ${signal} setup. Acceptable risk.`;
  } else if (confidence >= 50) {
    signal = finalScore > 0 ? 'LONG' : 'SHORT';
    reason = `Weak ${signal} setup. Proceed with caution.`;
  } else {
    signal = 'NO TRADE';
    reason = 'Low confidence. Market noise detected.';
  }

  // Reject trades in extreme low volatility
  if (lastAtr / lastClose < 0.001) {
    signal = 'NO TRADE';
    confidence = 0;
    reason = 'Volatility too low for safe entry.';
  }

  indicators.push({
    name: 'System Logic',
    value: signal !== 'NO TRADE' ? `${signal} (${confidence.toFixed(1)}%)` : 'STANDBY',
    signal: signal === 'LONG' ? 'bullish' : signal === 'SHORT' ? 'bearish' : 'neutral',
    description: reason
  });

  // ==========================================
  // RISK MANAGEMENT (TP / SL)
  // ==========================================
  let tp: number | undefined;
  let sl: number | undefined;

  if (signal === 'LONG') {
    sl = lastClose - (lastAtr * 2); // 2 ATR Stop Loss
    const risk = lastClose - sl;
    tp = lastClose + (risk * 2);    // 1:2 Risk/Reward
  } else if (signal === 'SHORT') {
    sl = lastClose + (lastAtr * 2);
    const risk = sl - lastClose;
    tp = lastClose - (risk * 2);
  }

  // ==========================================
  // CONFLUENCE MAPPING FOR UI
  // ==========================================
  const dominantSignal = finalScore > 0 ? 'bullish' : 'bearish';
  const supportingSignal = signal !== 'NO TRADE' ? (signal === 'LONG' ? 'bullish' : 'bearish') : dominantSignal;
  const opposingSignal = supportingSignal === 'bullish' ? 'bearish' : 'bullish';

  // Add base indicators for UI richness
  indicators.push({
    name: 'RSI (14)',
    value: lastRsi?.toFixed(2) || 'N/A',
    signal: lastRsi < 30 ? 'bullish' : lastRsi > 70 ? 'bearish' : 'neutral',
    description: 'Momentum Oscillator'
  });
  indicators.push({
    name: 'MACD',
    value: lastMacd ? `${lastMacd.MACD?.toFixed(2)}` : 'N/A',
    signal: lastMacd?.MACD! > lastMacd?.signal! ? 'bullish' : 'bearish',
    description: 'Trend Oscillator'
  });
  indicators.push({
    name: 'ATR (14)',
    value: lastAtr?.toFixed(4) || 'N/A',
    signal: 'neutral',
    description: 'Average True Range'
  });

  return {
    signal,
    confidence,
    indicators,
    confluences: {
      supporting: indicators.filter(i => i.signal === supportingSignal).map(i => i.name),
      opposing: indicators.filter(i => i.signal === opposingSignal).map(i => i.name),
      neutral: indicators.filter(i => i.signal === 'neutral').map(i => i.name)
    },
    tp,
    sl
  };
};
