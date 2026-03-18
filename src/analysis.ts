import { 
  RSI, 
  MACD, 
  EMA, 
  SMA,
  BollingerBands, 
  Stochastic, 
  ATR, 
  ADX, 
  IchimokuCloud,
  CCI,
  WilliamsR,
  OBV,
  ROC,
  MFI,
  PSAR
} from 'technicalindicators';
import { Candle, AnalysisResult, IndicatorResult } from './types';

export const analyzeChart = (data: Candle[]): AnalysisResult => {
  const closes = data.map(d => d.close);
  const highs = data.map(d => d.high);
  const lows = data.map(d => d.low);
  const volumes = data.map(d => d.volume);

  const indicators: IndicatorResult[] = [];
  const lastClose = closes[closes.length - 1];

  // 1. RSI
  const rsiValues = RSI.calculate({ values: closes, period: 14 });
  const lastRsi = rsiValues[rsiValues.length - 1];
  indicators.push({
    name: 'RSI (14)',
    value: lastRsi?.toFixed(2) || 'N/A',
    signal: lastRsi < 30 ? 'bullish' : lastRsi > 70 ? 'bearish' : 'neutral',
    description: lastRsi < 30 ? 'Oversold' : lastRsi > 70 ? 'Overbought' : 'Neutral range'
  });

  // 2. MACD
  const macdValues = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const lastMacd = macdValues[macdValues.length - 1];
  const macdSignal = lastMacd?.MACD! > lastMacd?.signal! ? 'bullish' : 'bearish';
  indicators.push({
    name: 'MACD',
    value: lastMacd ? `${lastMacd.MACD?.toFixed(2)} / ${lastMacd.signal?.toFixed(2)}` : 'N/A',
    signal: macdSignal,
    description: macdSignal === 'bullish' ? 'Bullish Crossover' : 'Bearish Crossover'
  });

  // 3. EMA 9
  const ema9 = EMA.calculate({ values: closes, period: 9 });
  const lastEma9 = ema9[ema9.length - 1];
  indicators.push({
    name: 'EMA 9',
    value: lastEma9?.toFixed(2) || 'N/A',
    signal: lastClose > lastEma9 ? 'bullish' : 'bearish',
    description: lastClose > lastEma9 ? 'Price > EMA 9' : 'Price < EMA 9'
  });

  // 4. EMA 20
  const ema20 = EMA.calculate({ values: closes, period: 20 });
  const lastEma20 = ema20[ema20.length - 1];
  indicators.push({
    name: 'EMA 20',
    value: lastEma20?.toFixed(2) || 'N/A',
    signal: lastClose > lastEma20 ? 'bullish' : 'bearish',
    description: lastClose > lastEma20 ? 'Price > EMA 20' : 'Price < EMA 20'
  });

  // 5. EMA 50
  const ema50 = EMA.calculate({ values: closes, period: 50 });
  const lastEma50 = ema50[ema50.length - 1];
  indicators.push({
    name: 'EMA 50',
    value: lastEma50?.toFixed(2) || 'N/A',
    signal: lastClose > lastEma50 ? 'bullish' : 'bearish',
    description: lastClose > lastEma50 ? 'Price > EMA 50' : 'Price < EMA 50'
  });

  // 6. EMA 200
  const ema200 = EMA.calculate({ values: closes, period: 200 });
  const lastEma200 = ema200[ema200.length - 1];
  indicators.push({
    name: 'EMA 200',
    value: lastEma200?.toFixed(2) || 'N/A',
    signal: lastClose > lastEma200 ? 'bullish' : 'bearish',
    description: lastClose > lastEma200 ? 'Price > EMA 200' : 'Price < EMA 200'
  });

  // 7. SMA 20
  const sma20 = SMA.calculate({ values: closes, period: 20 });
  const lastSma20 = sma20[sma20.length - 1];
  indicators.push({
    name: 'SMA 20',
    value: lastSma20?.toFixed(2) || 'N/A',
    signal: lastClose > lastSma20 ? 'bullish' : 'bearish',
    description: lastClose > lastSma20 ? 'Price > SMA 20' : 'Price < SMA 20'
  });

  // 8. SMA 50
  const sma50 = SMA.calculate({ values: closes, period: 50 });
  const lastSma50 = sma50[sma50.length - 1];
  indicators.push({
    name: 'SMA 50',
    value: lastSma50?.toFixed(2) || 'N/A',
    signal: lastClose > lastSma50 ? 'bullish' : 'bearish',
    description: lastClose > lastSma50 ? 'Price > SMA 50' : 'Price < SMA 50'
  });

  // 9. SMA 200
  const sma200 = SMA.calculate({ values: closes, period: 200 });
  const lastSma200 = sma200[sma200.length - 1];
  indicators.push({
    name: 'SMA 200',
    value: lastSma200?.toFixed(2) || 'N/A',
    signal: lastClose > lastSma200 ? 'bullish' : 'bearish',
    description: lastClose > lastSma200 ? 'Price > SMA 200' : 'Price < SMA 200'
  });

  // 10. Bollinger Bands
  const bb = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
  const lastBB = bb[bb.length - 1];
  let bbSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (lastBB && lastClose < lastBB.lower) bbSignal = 'bullish';
  if (lastBB && lastClose > lastBB.upper) bbSignal = 'bearish';
  indicators.push({
    name: 'Bollinger Bands',
    value: lastBB ? `L: ${lastBB.lower.toFixed(2)} U: ${lastBB.upper.toFixed(2)}` : 'N/A',
    signal: bbSignal,
    description: bbSignal === 'bullish' ? 'Price at Lower Band' : bbSignal === 'bearish' ? 'Price at Upper Band' : 'Inside Bands'
  });

  // 11. Stochastic
  const stoch = Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14,
    signalPeriod: 3
  });
  const lastStoch = stoch[stoch.length - 1];
  indicators.push({
    name: 'Stochastic',
    value: lastStoch ? `K: ${lastStoch.k.toFixed(2)} D: ${lastStoch.d.toFixed(2)}` : 'N/A',
    signal: lastStoch?.k < 20 ? 'bullish' : lastStoch?.k > 80 ? 'bearish' : 'neutral',
    description: lastStoch?.k < 20 ? 'Stoch Oversold' : lastStoch?.k > 80 ? 'Stoch Overbought' : 'Neutral'
  });

  // 12. ATR
  const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const lastAtr = atr[atr.length - 1];
  indicators.push({
    name: 'ATR',
    value: lastAtr?.toFixed(4) || 'N/A',
    signal: 'neutral',
    description: `Market Volatility: ${lastAtr?.toFixed(4) || 'N/A'}`
  });

  // 13. ADX
  const adx = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const lastAdx = adx[adx.length - 1];
  indicators.push({
    name: 'ADX',
    value: lastAdx?.adx.toFixed(2) || 'N/A',
    signal: lastAdx?.adx > 25 ? (lastAdx?.pdi > lastAdx?.mdi ? 'bullish' : 'bearish') : 'neutral',
    description: lastAdx?.adx > 25 ? 'Strong Trend' : 'Weak Trend/Ranging'
  });

  // 14. Ichimoku Cloud
  const ichimoku = IchimokuCloud.calculate({
    high: highs,
    low: lows,
    conversionPeriod: 9,
    basePeriod: 26,
    spanPeriod: 52,
    displacement: 26
  });
  const lastIchi = ichimoku[ichimoku.length - 1];
  const ichiSignal = lastIchi?.conversion > lastIchi?.base ? 'bullish' : 'bearish';
  indicators.push({
    name: 'Ichimoku',
    value: lastIchi ? `C: ${lastIchi.conversion.toFixed(2)} B: ${lastIchi.base.toFixed(2)}` : 'N/A',
    signal: ichiSignal,
    description: ichiSignal === 'bullish' ? 'Tenkan > Kijun' : 'Tenkan < Kijun'
  });

  // 15. CCI
  const cci = CCI.calculate({ high: highs, low: lows, close: closes, period: 20 });
  const lastCci = cci[cci.length - 1];
  indicators.push({
    name: 'CCI (20)',
    value: lastCci?.toFixed(2) || 'N/A',
    signal: lastCci < -100 ? 'bullish' : lastCci > 100 ? 'bearish' : 'neutral',
    description: lastCci < -100 ? 'Oversold' : lastCci > 100 ? 'Overbought' : 'Neutral'
  });

  // 16. Williams %R
  const willR = WilliamsR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const lastWillR = willR[willR.length - 1];
  indicators.push({
    name: 'Williams %R',
    value: lastWillR?.toFixed(2) || 'N/A',
    signal: lastWillR < -80 ? 'bullish' : lastWillR > -20 ? 'bearish' : 'neutral',
    description: lastWillR < -80 ? 'Oversold' : lastWillR > -20 ? 'Overbought' : 'Neutral'
  });

  // 17. OBV
  const obv = OBV.calculate({ close: closes, volume: volumes });
  const lastObv = obv[obv.length - 1];
  const prevObv = obv[obv.length - 2];
  indicators.push({
    name: 'OBV',
    value: lastObv ? (lastObv / 1000000).toFixed(2) + 'M' : 'N/A',
    signal: lastObv > prevObv ? 'bullish' : 'bearish',
    description: lastObv > prevObv ? 'Accumulation' : 'Distribution'
  });

  // 18. ROC
  const roc = ROC.calculate({ values: closes, period: 14 });
  const lastRoc = roc[roc.length - 1];
  indicators.push({
    name: 'ROC (14)',
    value: lastRoc ? lastRoc.toFixed(2) + '%' : 'N/A',
    signal: lastRoc > 0 ? 'bullish' : 'bearish',
    description: lastRoc > 0 ? 'Positive Momentum' : 'Negative Momentum'
  });

  // 19. MFI
  const mfi = MFI.calculate({ high: highs, low: lows, close: closes, volume: volumes, period: 14 });
  const lastMfi = mfi[mfi.length - 1];
  indicators.push({
    name: 'MFI (14)',
    value: lastMfi?.toFixed(2) || 'N/A',
    signal: lastMfi < 20 ? 'bullish' : lastMfi > 80 ? 'bearish' : 'neutral',
    description: lastMfi < 20 ? 'Oversold' : lastMfi > 80 ? 'Overbought' : 'Neutral'
  });

  // 20. PSAR
  const psar = PSAR.calculate({ high: highs, low: lows, step: 0.02, max: 0.2 });
  const lastPsar = psar[psar.length - 1];
  indicators.push({
    name: 'Parabolic SAR',
    value: lastPsar?.toFixed(2) || 'N/A',
    signal: lastClose > lastPsar ? 'bullish' : 'bearish',
    description: lastClose > lastPsar ? 'Price > PSAR' : 'Price < PSAR'
  });

  // 21. Volume Relative
  const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const lastVol = volumes[volumes.length - 1];
  indicators.push({
    name: 'Volume Relative',
    value: (lastVol / avgVol).toFixed(2) + 'x',
    signal: lastVol > avgVol * 1.5 ? 'neutral' : 'neutral',
    description: lastVol > avgVol * 1.5 ? 'High Volume Spike' : 'Normal Volume'
  });

  // 22. Momentum (3C)
  const last3 = data.slice(-3);
  const isUpTrend = last3.every((c, i) => i === 0 || c.close > last3[i-1].close);
  const isDownTrend = last3.every((c, i) => i === 0 || c.close < last3[i-1].close);
  indicators.push({
    name: 'Momentum (3C)',
    value: isUpTrend ? 'UP' : isDownTrend ? 'DOWN' : 'FLAT',
    signal: isUpTrend ? 'bullish' : isDownTrend ? 'bearish' : 'neutral',
    description: isUpTrend ? 'Strong Upward Momentum' : isDownTrend ? 'Strong Downward Momentum' : 'Consolidating'
  });

  // 23. Price Action (Candlestick Patterns)
  const currentCandle = data[data.length - 1];
  const prevCandle = data[data.length - 2];
  const prevPrevCandle = data[data.length - 3];
  
  const cBody = Math.abs(currentCandle.close - currentCandle.open);
  const cLowerWick = Math.min(currentCandle.open, currentCandle.close) - currentCandle.low;
  const cUpperWick = currentCandle.high - Math.max(currentCandle.open, currentCandle.close);
  const cRange = currentCandle.high - currentCandle.low;
  
  const pBody = Math.abs(prevCandle.close - prevCandle.open);
  const ppBody = Math.abs(prevPrevCandle.close - prevPrevCandle.open);

  // Basic Patterns
  const isBullishEngulfing = prevCandle.close < prevCandle.open && 
                             currentCandle.close > currentCandle.open && 
                             currentCandle.close > prevCandle.open && 
                             currentCandle.open < prevCandle.close;
                             
  const isBearishEngulfing = prevCandle.close > prevCandle.open && 
                             currentCandle.close < currentCandle.open && 
                             currentCandle.close < prevCandle.open && 
                             currentCandle.open > prevCandle.close;
                             
  const isHammer = cLowerWick > cBody * 2 && cUpperWick < cBody && cBody > 0;
  const isShootingStar = cUpperWick > cBody * 2 && cLowerWick < cBody && cBody > 0;
  const isDoji = cBody <= cRange * 0.1 && cRange > 0;

  // Advanced Patterns
  const isMorningStar = prevPrevCandle.close < prevPrevCandle.open && ppBody > cRange * 0.5 && // Strong bearish
                        pBody <= (prevCandle.high - prevCandle.low) * 0.3 && // Small body (star)
                        currentCandle.close > currentCandle.open && currentCandle.close > prevPrevCandle.open - (ppBody / 2); // Strong bullish closing above midpoint of day 1
                        
  const isEveningStar = prevPrevCandle.close > prevPrevCandle.open && ppBody > cRange * 0.5 && // Strong bullish
                        pBody <= (prevCandle.high - prevCandle.low) * 0.3 && // Small body (star)
                        currentCandle.close < currentCandle.open && currentCandle.close < prevPrevCandle.open + (ppBody / 2); // Strong bearish closing below midpoint of day 1

  const isThreeWhiteSoldiers = prevPrevCandle.close > prevPrevCandle.open && prevCandle.close > prevCandle.open && currentCandle.close > currentCandle.open &&
                               prevCandle.close > prevPrevCandle.close && currentCandle.close > prevCandle.close &&
                               prevCandle.open > prevPrevCandle.open && currentCandle.open > prevCandle.open;

  const isThreeBlackCrows = prevPrevCandle.close < prevPrevCandle.open && prevCandle.close < prevCandle.open && currentCandle.close < currentCandle.open &&
                            prevCandle.close < prevPrevCandle.close && currentCandle.close < prevCandle.close &&
                            prevCandle.open < prevPrevCandle.open && currentCandle.open < prevCandle.open;

  let paSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let paDesc = 'No clear pattern';
  
  if (isMorningStar) { paSignal = 'bullish'; paDesc = 'Morning Star'; }
  else if (isEveningStar) { paSignal = 'bearish'; paDesc = 'Evening Star'; }
  else if (isThreeWhiteSoldiers) { paSignal = 'bullish'; paDesc = 'Three White Soldiers'; }
  else if (isThreeBlackCrows) { paSignal = 'bearish'; paDesc = 'Three Black Crows'; }
  else if (isBullishEngulfing) { paSignal = 'bullish'; paDesc = 'Bullish Engulfing'; }
  else if (isBearishEngulfing) { paSignal = 'bearish'; paDesc = 'Bearish Engulfing'; }
  else if (isHammer) { paSignal = 'bullish'; paDesc = 'Bullish Hammer'; }
  else if (isShootingStar) { paSignal = 'bearish'; paDesc = 'Shooting Star'; }
  else if (isDoji) { paSignal = 'neutral'; paDesc = 'Doji (Indecision)'; }

  indicators.push({
    name: 'Price Action',
    value: paDesc !== 'No clear pattern' ? paDesc : 'Neutral',
    signal: paSignal,
    description: 'Candlestick Pattern Analysis'
  });

  // ==========================================
  // ADVANCED SCORING & CONFLUENCE ENGINE
  // ==========================================
  let score = 0;
  let maxPossibleScore = 0;

  const evaluate = (bullishCondition: boolean, bearishCondition: boolean, weight: number) => {
    maxPossibleScore += weight;
    if (bullishCondition) score += weight;
    else if (bearishCondition) score -= weight;
  };

  // 1. Trend Alignment (High Weight)
  evaluate(lastClose > lastEma200, lastClose < lastEma200, 3); // Macro Trend
  evaluate(lastEma50 > lastEma200, lastEma50 < lastEma200, 2); // Golden/Death Cross
  evaluate(lastClose > lastEma50, lastClose < lastEma50, 2);   // Micro Trend
  evaluate(ichiSignal === 'bullish', ichiSignal === 'bearish', 2); // Cloud Breakout

  // 2. Momentum (Medium Weight)
  evaluate(macdSignal === 'bullish', macdSignal === 'bearish', 2);
  
  // RSI Logic: Bullish if oversold (<30) OR holding uptrend (>50). Bearish if overbought (>70) OR holding downtrend (<50).
  const rsiBullish = lastRsi < 30 || (lastRsi > 50 && lastRsi < 70);
  const rsiBearish = lastRsi > 70 || (lastRsi < 50 && lastRsi > 30);
  evaluate(rsiBullish, rsiBearish, 2);

  evaluate(lastStoch?.k < 20, lastStoch?.k > 80, 1.5); // Stoch Extremes
  evaluate(lastCci < -100, lastCci > 100, 1);
  evaluate(lastWillR < -80, lastWillR > -20, 1);
  evaluate(lastRoc > 0, lastRoc < 0, 1);
  evaluate(lastMfi < 20, lastMfi > 80, 1);

  // 3. Volume & Volatility (Confirmations)
  evaluate(lastObv > prevObv, lastObv < prevObv, 1.5); // Smart Money Flow
  
  // ADX measures trend strength. Only apply ADX directional weight if trend is actually strong (>25)
  const isStrongTrend = lastAdx?.adx > 25;
  if (isStrongTrend) {
    evaluate(lastAdx?.pdi > lastAdx?.mdi, lastAdx?.pdi < lastAdx?.mdi, 2);
  }

  evaluate(bbSignal === 'bullish', bbSignal === 'bearish', 1.5); // BB Rejections
  evaluate(lastClose > lastPsar, lastClose < lastPsar, 1);
  evaluate(isUpTrend, isDownTrend, 1); // 3-Candle Momentum
  
  // Give higher weight to advanced patterns
  const isAdvancedPattern = ['Morning Star', 'Evening Star', 'Three White Soldiers', 'Three Black Crows'].includes(paDesc);
  evaluate(paSignal === 'bullish', paSignal === 'bearish', isAdvancedPattern ? 3 : 2); // Price Action

  // Normalize score to -100 to 100
  const normalizedScore = (score / maxPossibleScore) * 100;
  
  let signal: 'LONG' | 'SHORT' | 'NO TRADE' = 'NO TRADE';
  let confidence = Math.abs(normalizedScore);

  // ==========================================
  // STRICT ENTRY CRITERIA (CONFLUENCE LOGIC)
  // ==========================================
  const isMacroBullish = lastClose > lastEma200;
  const isMacroBearish = lastClose < lastEma200;
  
  const isMomentumBullish = macdSignal === 'bullish' || lastRsi > 50;
  const isMomentumBearish = macdSignal === 'bearish' || lastRsi < 50;

  const isOversold = lastRsi < 30 || lastStoch?.k < 20 || bbSignal === 'bullish' || lastWillR < -80;
  const isOverbought = lastRsi > 70 || lastStoch?.k > 80 || bbSignal === 'bearish' || lastWillR > -20;
  
  // Volatility Breakout Confluence
  const bbBandwidth = lastBB ? (lastBB.upper - lastBB.lower) / lastBB.middle : 0;
  const prevBB = bb[bb.length - 2];
  const prevBbBandwidth = prevBB ? (prevBB.upper - prevBB.lower) / prevBB.middle : 0;
  const isVolatilityExpansion = bbBandwidth > prevBbBandwidth && isStrongTrend;

  // LONG Logic:
  // 1. Trend Following: Macro Bullish + Momentum Bullish + Overall Score > 25
  // 2. Mean Reversion: Deeply Oversold + Reversal PA + Overall Score > 15
  // 3. Volatility Breakout: Expanding BB + Strong ADX + Bullish Momentum
  if ((isMacroBullish && isMomentumBullish && normalizedScore > 25) || 
      (isOversold && paSignal === 'bullish' && normalizedScore > 15) ||
      (isVolatilityExpansion && lastAdx?.pdi > lastAdx?.mdi && isMomentumBullish && normalizedScore > 20)) {
    signal = 'LONG';
  } 
  // SHORT Logic:
  // 1. Trend Following: Macro Bearish + Momentum Bearish + Overall Score < -25
  // 2. Mean Reversion: Deeply Overbought + Reversal PA + Overall Score < -15
  // 3. Volatility Breakout: Expanding BB + Strong ADX + Bearish Momentum
  else if ((isMacroBearish && isMomentumBearish && normalizedScore < -25) || 
           (isOverbought && paSignal === 'bearish' && normalizedScore < -15) ||
           (isVolatilityExpansion && lastAdx?.mdi > lastAdx?.pdi && isMomentumBearish && normalizedScore < -20)) {
    signal = 'SHORT';
  }

  // Boost confidence if multiple confluences align perfectly
  if (signal === 'LONG' && isMacroBullish && isMomentumBullish && isOversold) confidence += 15;
  if (signal === 'SHORT' && isMacroBearish && isMomentumBearish && isOverbought) confidence += 15;
  if (isAdvancedPattern && paSignal === (signal === 'LONG' ? 'bullish' : 'bearish')) confidence += 10;

  // Cap confidence between 0 and 100
  confidence = Math.min(Math.max(confidence, 0), 100);

  // ==========================================
  // DYNAMIC TP/SL (MARKET STRUCTURE + VOLATILITY)
  // ==========================================
  let tp: number | undefined;
  let sl: number | undefined;

  // Find recent swing high/low for structural SL placement
  const lookback = 20;
  const recentLows = lows.slice(-lookback);
  const recentHighs = highs.slice(-lookback);
  const swingLow = Math.min(...recentLows);
  const swingHigh = Math.max(...recentHighs);

  if (signal === 'LONG' && lastAtr) {
    // SL is below recent swing low OR 1.5 ATR, whichever is safer (lower)
    const atrSl = lastClose - (lastAtr * 1.5);
    sl = Math.min(atrSl, swingLow - (lastAtr * 0.2)); 
    
    // Risk = Entry - SL
    const risk = lastClose - sl;
    // TP is 2x Risk (1:2 Risk/Reward Ratio)
    tp = lastClose + (risk * 2);
  } else if (signal === 'SHORT' && lastAtr) {
    // SL is above recent swing high OR 1.5 ATR, whichever is safer (higher)
    const atrSl = lastClose + (lastAtr * 1.5);
    sl = Math.max(atrSl, swingHigh + (lastAtr * 0.2)); 
    
    // Risk = SL - Entry
    const risk = sl - lastClose;
    // TP is 2x Risk
    tp = lastClose - (risk * 2);
  }

  const dominantSignal = normalizedScore > 0 ? 'bullish' : 'bearish';
  const supportingSignal = signal !== 'NO TRADE' ? (signal === 'LONG' ? 'bullish' : 'bearish') : dominantSignal;
  const opposingSignal = supportingSignal === 'bullish' ? 'bearish' : 'bullish';

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
