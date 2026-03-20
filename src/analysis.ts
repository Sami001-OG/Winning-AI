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
import { Candle, AnalysisResult, IndicatorResult, Trade } from './types';

// Pattern Detection Helpers
const isDoji = (c: Candle) => Math.abs(c.close - c.open) <= (c.high - c.low) * 0.1;
const isHammer = (c: Candle) => {
    const body = Math.abs(c.close - c.open);
    const lowerShadow = Math.min(c.open, c.close) - c.low;
    const upperShadow = c.high - Math.max(c.open, c.close);
    return lowerShadow > body * 2 && upperShadow < body;
};
const isEngulfingBullish = (p: Candle, c: Candle) => p.close < p.open && c.close > c.open && c.close > p.open && c.open < p.close;
const isEngulfingBearish = (p: Candle, c: Candle) => p.close > p.open && c.close < c.open && c.close < p.open && c.open > p.close;

export const analyzeChart = (
  data: Candle[], 
  indicatorReliability: Record<string, number> = { ema: 1.5, macd: 0.5, rsi: 1.5, stoch: 0.5, cci: 0.25, vol: 1.2, obv: 1.2, exception: 2.0 },
  trades: Trade[] = [],
  symbol: string
): AnalysisResult => {
  const closes = data.map(d => d.close);
  const highs = data.map(d => d.high);
  const lows = data.map(d => d.low);
  const volumes = data.map(d => d.volume);

  const indicators: IndicatorResult[] = [];
  
  if (data.length === 0) {
    return {
      signal: 'NO TRADE',
      confidence: 0,
      indicators: [],
      patterns: [],
      confluences: { supporting: [], opposing: [], neutral: [] }
    };
  }

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
  if (isTrendingUp) layer1Score = Math.min((lastAdx.adx - 15) / 25, 1); // ADX 40 = 1.0
  else if (isTrendingDown) layer1Score = Math.max(-(lastAdx.adx - 15) / 25, -1);

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

  const emaRel = indicatorReliability.ema || 1;
  const macdRel = indicatorReliability.macd || 1;
  const layer2Score = (emaScore * emaRel + macdScore * macdRel) / (emaRel + macdRel);

  indicators.push({
    name: 'Trend Alignment',
    value: layer2Score > 0.5 ? 'STRONG BULL' : layer2Score < -0.5 ? 'STRONG BEAR' : 'MIXED',
    signal: layer2Score > 0 ? 'bullish' : layer2Score < 0 ? 'bearish' : 'neutral',
    description: 'EMA & MACD Confluence'
  });

  // ==========================================
  // LAYER 3: ENTRY TIMING (Momentum & Mean Reversion)
  // ==========================================
  let rsiScore = 0;
  let stochScore = 0;
  let cciScore = 0;

  if (isTrendingUp) {
    // Bullish Trend: Look for pullbacks OR strong momentum (breakouts)
    if (lastRsi < 45) rsiScore = 1; // Deep Pullback
    else if (lastRsi >= 55 && lastRsi <= 70) rsiScore = 1; // Strong Momentum
    else if (lastRsi > 70) rsiScore = -0.5; // Overbought, risky entry

    if (lastStoch?.k < 40) stochScore = 1; // Pullback
    else if (lastStoch?.k >= 60 && lastStoch?.k <= 80) stochScore = 1; // Momentum
    else if (lastStoch?.k > 80) stochScore = -0.5;

    if (lastCci < -50) cciScore = 1; // Pullback
    else if (lastCci > 50 && lastCci < 150) cciScore = 1; // Momentum
    else if (lastCci >= 150) cciScore = -0.5;
  } else if (isTrendingDown) {
    // Bearish Trend: Look for pullbacks (bounces) OR strong downward momentum
    if (lastRsi > 55) rsiScore = -1; // Bounce
    else if (lastRsi <= 45 && lastRsi >= 30) rsiScore = -1; // Strong Downward Momentum
    else if (lastRsi < 30) rsiScore = 0.5; // Oversold, risky short

    if (lastStoch?.k > 60) stochScore = -1; // Bounce
    else if (lastStoch?.k <= 40 && lastStoch?.k >= 20) stochScore = -1; // Momentum
    else if (lastStoch?.k < 20) stochScore = 0.5;

    if (lastCci > 50) cciScore = -1; // Bounce
    else if (lastCci < -50 && lastCci > -150) cciScore = -1; // Momentum
    else if (lastCci <= -150) cciScore = 0.5;
  } else {
    // Sideways Mean Reversion
    if (lastRsi < 35) rsiScore = 1;
    else if (lastRsi > 65) rsiScore = -1;
    
    if (lastStoch?.k < 25) stochScore = 1;
    else if (lastStoch?.k > 75) stochScore = -1;
    
    if (lastCci < -100) cciScore = 1;
    else if (lastCci > 100) cciScore = -1;
  }

  const rsiRel = indicatorReliability.rsi || 1;
  const stochRel = indicatorReliability.stoch || 1;
  const cciRel = indicatorReliability.cci || 1;
  const layer3Score = (rsiScore * rsiRel + stochScore * stochRel + cciScore * cciRel) / (rsiRel + stochRel + cciRel);

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

  const volRel = indicatorReliability.vol || 1;
  const obvRel = indicatorReliability.obv || 1;
  const layer4Score = (volScore * volRel + obvScore * obvRel) / (volRel + obvRel);

  indicators.push({
    name: 'Volume Confirm',
    value: layer4Score > 0 ? 'ACCUMULATION' : layer4Score < 0 ? 'DISTRIBUTION' : 'NEUTRAL',
    signal: layer4Score > 0 ? 'bullish' : layer4Score < 0 ? 'bearish' : 'neutral',
    description: 'Volume & OBV Flow'
  });

  // ==========================================
  // ADAPTIVE WEIGHTS & FINAL SCORE
  // ==========================================
  let w1 = 0.25; // Market Condition
  let w2 = 0.25; // Trend
  let w3 = 0.25; // Entry
  let w4 = 0.25; // Confirmation

  const trendStrength = Math.abs(layer1Score); // 0 to 1

  // Trend is more important when trendStrength is high
  w2 = 0.15 + (trendStrength * 0.50); // 0.15 to 0.65
  // Entry is more important when trendStrength is low (sideways)
  w3 = 0.15 + ((1 - trendStrength) * 0.50); // 0.15 to 0.65
  
  // Confirmation is important in high volatility
  if (isHighVolatility) {
    w4 = 0.35;
    w1 = 0.15;
  }

  // Normalize weights to sum to 1
  const total = w1 + w2 + w3 + w4;
  w1 /= total;
  w2 /= total;
  w3 /= total;
  w4 /= total;

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
  const isConflict = Math.sign(layer2Score) !== Math.sign(layer3Score) && Math.abs(layer2Score) > 0.5 && Math.abs(layer3Score) > 0.5;

  if (isConflict) {
    signal = 'NO TRADE';
    confidence *= 0.3; // Reduce confidence heavily instead of 0
    reason = 'Signal conflict: Trend vs Momentum.';
  } else if (confidence >= 85) {
    signal = finalScore > 0 ? 'LONG' : 'SHORT';
    reason = `Strong ${signal} setup. High confluence.`;
  } else if (confidence >= 70) {
    signal = finalScore > 0 ? 'LONG' : 'SHORT';
    reason = `Moderate ${signal} setup. Acceptable risk.`;
  } else if (confidence >= 60) {
    signal = finalScore > 0 ? 'LONG' : 'SHORT';
    reason = `Weak ${signal} setup. Proceed with caution.`;
  } else {
    signal = 'NO TRADE';
    reason = 'Low confidence. Market noise detected.';
  }

  // Reject trades in extreme low volatility
  if (lastAtr / lastClose < 0.0005) { // Lowered the threshold to allow more trades
    signal = 'NO TRADE';
    confidence *= 0.5;
    reason = 'Volatility too low for safe entry.';
  }

  // ==========================================
  // EXCEPTION STRATEGIES (High Win Rate Overrides)
  // ==========================================
  let exceptionTriggered = false;
  let exceptionName = '';

  const lastCandle = data[data.length - 1];
  const prevCandle = data[data.length - 2];

  // 1. Flash Crash Buyer (3% drop in 1h)
  const isFlashCrash = (lastCandle.open - lastCandle.close) / lastCandle.open > 0.03;
  
  // 4. EMA 200 Rubber Band (5% below EMA 200)
  const isEmaRubberBand = lastEma200 ? (lastClose - lastEma200) / lastEma200 < -0.05 : false;

  // 6. Extreme Mean Reversion (RSI < 30 + Close < Lower BB)
  const isExtremeMeanReversion = lastRsi < 30 && lastBB && lastClose < lastBB.lower;

  if (isFlashCrash) {
    exceptionTriggered = true;
    exceptionName = 'Flash Crash Buyer';
  } else if (isEmaRubberBand) {
    exceptionTriggered = true;
    exceptionName = 'EMA 200 Rubber Band';
  } else if (isExtremeMeanReversion) {
    exceptionTriggered = true;
    exceptionName = 'Extreme Mean Reversion';
  }

  const exceptionWeight = indicatorReliability.exception || 2.0;

  if (exceptionTriggered) {
    signal = 'LONG';
    const boost = 20 * exceptionWeight;
    const minConf = Math.min(95, 80 + (exceptionWeight * 5));
    confidence = Math.min(100, Math.max(confidence + boost, minConf));
    reason = `EXCEPTION STRATEGY: ${exceptionName} triggered.`;
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

  if (exceptionTriggered) {
    // Custom TP/SL for exception strategies based on backtest
    if (exceptionName === 'Flash Crash Buyer') {
      tp = lastClose * 1.015; // 1.5% TP
      sl = lastClose * 0.95;  // 5% SL
    } else if (exceptionName === 'EMA 200 Rubber Band') {
      tp = lastClose * 1.02;  // 2% TP
      sl = lastClose * 0.95;  // 5% SL
    } else if (exceptionName === 'Extreme Mean Reversion') {
      tp = lastClose * 1.02;  // 2% TP
      sl = lastClose * 0.97;  // 3% SL
    }
  } else if (signal === 'LONG') {
    sl = lastClose - (lastAtr * 2); // 2 ATR Stop Loss
    const risk = lastClose - sl;
    tp = lastClose + (risk * 2);    // 1:2 Risk/Reward
  } else if (signal === 'SHORT') {
    sl = lastClose + (lastAtr * 2);
    const risk = sl - lastClose;
    tp = lastClose - (risk * 2);
  }

  // ==========================================
  // DYNAMIC ENTRY CALCULATION
  // ==========================================
  let suggestedEntry: number | undefined;
  
  if (exceptionTriggered) {
    suggestedEntry = lastClose; // Market execution for extreme setups
  } else if (signal === 'LONG' && layer4Score > 0) {
    if (isTrending) {
      // In a trending market, look for a pullback to EMA20
      suggestedEntry = lastEma20;
    } else {
      // In a sideways market, look for entry near the lower Bollinger Band
      suggestedEntry = lastBB?.lower;
    }
  } else if (signal === 'SHORT' && layer4Score < 0) {
    if (isTrending) {
      // In a trending market, look for a pullback to EMA20 resistance
      suggestedEntry = lastEma20;
    } else {
      // In a sideways market, look for entry near the upper Bollinger Band
      suggestedEntry = lastBB?.upper;
    }
  }

  // ==========================================
  // PATTERN DETECTION
  // ==========================================
  const patterns: string[] = [];

  if (lastCandle) {
    if (isDoji(lastCandle)) patterns.push('Doji');
    if (isHammer(lastCandle)) patterns.push('Hammer');
    if (prevCandle) {
      if (isEngulfingBullish(prevCandle, lastCandle)) patterns.push('Bullish Engulfing');
      if (isEngulfingBearish(prevCandle, lastCandle)) patterns.push('Bearish Engulfing');
    }
  }

  // Adjust confidence based on patterns
  let confidenceAdjustment = 0;
  if (patterns.includes('Bullish Engulfing') && finalScore > 0) confidenceAdjustment = 10;
  else if (patterns.includes('Bearish Engulfing') && finalScore < 0) confidenceAdjustment = 10;
  else if (patterns.includes('Hammer') && finalScore > 0) confidenceAdjustment = 5;
  
  confidence = Math.min(100, Math.max(0, confidence + confidenceAdjustment));

  // ==========================================
  // HISTORICAL PERFORMANCE FILTER
  // ==========================================
  const symbolTrades = trades.filter(t => t.symbol === symbol && (t.status === 'SUCCESS' || t.status === 'FAILED'));
  if (symbolTrades.length >= 5) {
    const wins = symbolTrades.filter(t => t.status === 'SUCCESS').length;
    const winRate = wins / symbolTrades.length;
    
    if (winRate < 0.4) {
      confidence *= 0.5; // Heavy penalty for poor history
    } else if (winRate < 0.6) {
      confidence *= 0.8; // Minor penalty
    }
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
    patterns,
    confluences: {
      supporting: indicators.filter(i => i.signal === supportingSignal).map(i => i.name),
      opposing: indicators.filter(i => i.signal === opposingSignal).map(i => i.name),
      neutral: indicators.filter(i => i.signal === 'neutral').map(i => i.name)
    },
    tp,
    sl,
    suggestedEntry,
    layers: {
      marketCondition: layer1Score,
      trend: layer2Score,
      entry: layer3Score,
      confirmation: layer4Score
    }
  };
};
