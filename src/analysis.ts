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
import { detectPatterns } from './patterns';
import { 
  detectBOS, 
  detectLiquidityGrab, 
  detectFakeout, 
  detectVolumeSpike, 
  detectAtrExpansion, 
  calculateOrderFlow,
  detectRsiDivergence
} from './structure';
import { calculateVolumeProfile } from './volumeProfile';

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
  indicatorReliability: Record<string, number> = { ema: 1.5, macd: 0.5, rsi: 1.5, stoch: 0.5, cci: 0.25, vol: 1.2, obv: 1.2 },
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

  // Detect Patterns
  const detectedPatterns = detectPatterns(data);
  const patternNames = detectedPatterns.map(p => p.name);

  // Dynamically adjust weights based on patterns
  const adjustedReliability = { ...indicatorReliability };
  detectedPatterns.forEach(p => {
    if (p.name === 'Double Bottom' || p.name === 'Double Top') {
      adjustedReliability.rsi = (adjustedReliability.rsi || 1) * 1.5;
    } else if (p.name === 'Bullish Engulfing' || p.name === 'Bearish Engulfing') {
      adjustedReliability.macd = (adjustedReliability.macd || 1) * 1.8;
      adjustedReliability.vol = (adjustedReliability.vol || 1) * 1.5;
    } else if (p.name === 'Ascending Triangle' || p.name === 'Descending Triangle') {
      adjustedReliability.ema = (adjustedReliability.ema || 1) * 1.3;
      adjustedReliability.obv = (adjustedReliability.obv || 1) * 1.5;
    }
  });

  const lastClose = closes[closes.length - 1];
  const lastOpen = data[data.length - 1].open;

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

  // Volume / Confirmation
  const obv = OBV.calculate({ close: closes, volume: volumes });
  const lastObv = obv[obv.length - 1];
  const prevObv = obv[obv.length - 2];
  
  const volSma = SMA.calculate({ values: volumes, period: 20 });
  const lastVolSma = volSma[volSma.length - 1];
  const lastVol = volumes[volumes.length - 1];

  // ==========================================
  // CALCULATE NEW INDICATORS
  // ==========================================
  const bos = detectBOS(data);
  const liquidityGrab = detectLiquidityGrab(data);
  const fakeout = detectFakeout(data);
  const volumeSpike = detectVolumeSpike(data);
  const atrExpansion = detectAtrExpansion(data, atr);
  const orderFlow = calculateOrderFlow(data);
  const rsiDivergence = detectRsiDivergence(data, rsi);
  const volProfile = calculateVolumeProfile(data);
  // Using existing ema20, ema50, bb variables
  const lastEma20Val = lastEma20;
  const lastEma50Val = lastEma50;
  const lastBBVal = lastBB;

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

  let adxScore = 0;
  if (isTrendingUp) adxScore = Math.min((lastAdx.adx - 15) / 25, 1); // ADX 40 = 1.0
  else if (isTrendingDown) adxScore = Math.max(-(lastAdx.adx - 15) / 25, -1);

  let structScore = 0;
  if (bos === 'bullish') structScore = 1;
  else if (bos === 'bearish') structScore = -1;

  // Combine ADX with Structure (BOS) and Volatility for a more robust Layer 1
  let layer1Score = (adxScore * 0.5) + (structScore * 0.5);

  indicators.push({
    name: 'Market State',
    value: isHighVolatility ? 'HIGH VOLATILITY' : isTrendingUp ? 'TRENDING UP' : isTrendingDown ? 'TRENDING DOWN' : 'SIDEWAYS',
    signal: layer1Score > 0 ? 'bullish' : layer1Score < 0 ? 'bearish' : 'neutral',
    description: `ADX: ${lastAdx?.adx?.toFixed(1) || 'N/A'} | BBW: ${(bbWidth*100).toFixed(2)}%`
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

  const emaRel = adjustedReliability.ema || 1;
  const macdRel = Math.min(adjustedReliability.macd || 0.2, 0.2); // Cap MACD weight at 0.2 to reduce lag
  const layer2Score = (emaScore * emaRel + macdScore * macdRel) / (emaRel + macdRel);

  indicators.push({
    name: 'Trend Alignment',
    value: layer2Score > 0.5 ? 'STRONG BULL' : layer2Score < -0.5 ? 'STRONG BEAR' : 'MIXED',
    signal: layer2Score > 0 ? 'bullish' : layer2Score < 0 ? 'bearish' : 'neutral',
    description: 'EMA Alignment'
  });

  // ==========================================
  // LAYER 3: ENTRY TIMING (Momentum & Displacement)
  // ==========================================
  let rsiScore = 0;
  let sweepScore = 0;
  let displacementScore = 0;

  if (isTrendingUp) {
    // Bullish Trend: Look for pullbacks OR strong momentum (breakouts)
    if (lastRsi < 45) rsiScore = 1; // Deep Pullback
    else if (lastRsi >= 55 && lastRsi <= 70) rsiScore = 1; // Strong Momentum
    else if (lastRsi > 70) rsiScore = -0.5; // Overbought, risky entry
  } else if (isTrendingDown) {
    // Bearish Trend: Look for pullbacks (bounces) OR strong downward momentum
    if (lastRsi > 55) rsiScore = -1; // Bounce
    else if (lastRsi <= 45 && lastRsi >= 30) rsiScore = -1; // Strong Downward Momentum
    else if (lastRsi < 30) rsiScore = 0.5; // Oversold, risky short
  } else {
    // Sideways Mean Reversion
    if (lastRsi < 35) rsiScore = 1;
    else if (lastRsi > 65) rsiScore = -1;
  }

  if (liquidityGrab === 'bullish') sweepScore = 1;
  else if (liquidityGrab === 'bearish') sweepScore = -1;

  const lastCandleBody = Math.abs(lastClose - lastOpen);
  const isDisplacementUp = lastClose > lastOpen && lastCandleBody > (lastAtr * 0.8) && lastVol > lastVolSma;
  const isDisplacementDown = lastClose < lastOpen && lastCandleBody > (lastAtr * 0.8) && lastVol > lastVolSma;

  if (isDisplacementUp) displacementScore = 1;
  else if (isDisplacementDown) displacementScore = -1;

  const rsiRel = 0.5; // RSI is less reliable than price action
  const sweepRel = 2.0; // Liquidity sweeps are high conviction
  const dispRel = 1.5; // Displacement confirms the sweep
  const layer3Score = (rsiScore * rsiRel + sweepScore * sweepRel + displacementScore * dispRel) / (rsiRel + sweepRel + dispRel);

  indicators.push({
    name: 'Entry Timing',
    value: layer3Score > 0.5 ? 'OPTIMAL LONG' : layer3Score < -0.5 ? 'OPTIMAL SHORT' : 'WAIT',
    signal: layer3Score > 0 ? 'bullish' : layer3Score < 0 ? 'bearish' : 'neutral',
    description: 'RSI, Sweep, Displacement'
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

  const volRel = 1.5;
  const obvRel = 1.0;
  const layer4Score = (volScore * volRel + obvScore * obvRel) / (volRel + obvRel);

  indicators.push({
    name: 'Volume Confirm',
    value: layer4Score > 0 ? 'ACCUMULATION' : layer4Score < 0 ? 'DISTRIBUTION' : 'NEUTRAL',
    signal: layer4Score > 0 ? 'bullish' : layer4Score < 0 ? 'bearish' : 'neutral',
    description: 'Volume & OBV Flow'
  });

  indicators.push({
    name: 'Order Flow',
    value: orderFlow.signal === 'bullish' ? 'BUYING PRESSURE' : orderFlow.signal === 'bearish' ? 'SELLING PRESSURE' : 'NEUTRAL',
    signal: orderFlow.signal,
    description: `Net Flow: ${orderFlow.netFlow > 0 ? '+' : ''}${(orderFlow.netFlow / 1000).toFixed(1)}k`
  });

  // ==========================================
  // ADAPTIVE WEIGHTS & FINAL SCORE
  // ==========================================
  let w1 = 0.10; // Market Condition (10%)
  let w2 = 0.10; // Trend (10% - Lagging)
  let w3 = 0.20; // Entry Timing (20% - Sweeps/Displacement)
  let w4 = 0.10; // Confirmation (10% - Volume)
  let w5 = 0.30; // Structure (30% - BOS/Fakeouts)
  let w6 = 0.20; // Volatility/Order Flow (20% - Institutional Footprint)

  // Dynamic adjustment based on market state
  if (isTrending) {
    // Trending -> follow trend & structure
    w2 += 0.10; // Increase Trend weight
    w5 += 0.05; // Increase Structure weight
    w3 -= 0.10; // Decrease Mean Reversion Entry weight
    w6 += 0.05; // Increase Order Flow weight
  } else if (isSideways) {
    // Sideways -> use oscillators & fakeouts
    w3 += 0.15; // Increase Entry (Oscillators/Sweeps) weight
    w5 += 0.10; // Increase Structure (Fakeouts) weight
    w2 -= 0.10; // Decrease Trend weight
    w1 -= 0.05; // Decrease Market Condition weight
  }
  
  const trendStrength = Math.abs(layer1Score); // 0 to 1

  // Structure Score
  let structureScore = 0;
  if (bos === 'bullish') structureScore += 0.4;
  else if (bos === 'bearish') structureScore -= 0.4;
  if (liquidityGrab === 'bullish') structureScore += 0.4;
  else if (liquidityGrab === 'bearish') structureScore -= 0.4;
  if (fakeout === 'bullish') structureScore += 0.2;
  else if (fakeout === 'bearish') structureScore -= 0.2;

  // Volume/Volatility Score
  let volVolScore = 0;
  if (orderFlow.signal === 'bullish') volVolScore += 0.5;
  else if (orderFlow.signal === 'bearish') volVolScore -= 0.5;
  if (volumeSpike > 1.5) volVolScore += 0.3;
  if (atrExpansion > 1.2) volVolScore += 0.2;

  // Normalize weights to sum to 1
  const total = w1 + w2 + w3 + w4 + w5 + w6;
  w1 /= total;
  w2 /= total;
  w3 /= total;
  w4 /= total;
  w5 /= total;
  w6 /= total;

  const finalScore = (layer1Score * w1) + (layer2Score * w2) + (layer3Score * w3) + (layer4Score * w4) + (structureScore * w5) + (volVolScore * w6);
  
  let confidence = Math.abs(finalScore) * 100;
  
  // High Volatility is often good for breakouts, removing the penalty
  // if (isHighVolatility) {
  //   confidence *= 0.8; 
  // }

  // Session Logic (Killzones) - Based on New York Time (EST/EDT)
  const latestCandle = data[data.length - 1];
  const lastCandleDate = new Date(latestCandle.time * 1000);
  
  // Get the hour in New York time (0-23)
  const nyTimeStr = lastCandleDate.toLocaleString('en-US', { 
    timeZone: 'America/New_York', 
    hour: 'numeric', 
    hour12: false 
  });
  let nyHour = parseInt(nyTimeStr, 10);
  if (nyHour === 24) nyHour = 0;
  
  // ICT Killzones (New York Time)
  // Asian Killzone: 20:00 - 00:00 NY Time
  // London Killzone: 02:00 - 05:00 NY Time
  // NY Killzone: 07:00 - 10:00 NY Time
  const isAsianKillzone = nyHour >= 20;
  const isLondonKillzone = nyHour >= 2 && nyHour < 5;
  const isNYKillzone = nyHour >= 7 && nyHour < 10;
  const inKillzone = isAsianKillzone || isLondonKillzone || isNYKillzone;

  if (inKillzone) {
    confidence *= 1.10; // +10% confidence boost during killzones
  }

  // ==========================================
  // LOGICAL PENALTIES
  // ==========================================
  const isLong = finalScore > 0;
  const isShort = finalScore < 0;

  // 1. Low Volume Penalty (Dead Market)
  // Trading breakouts or trends in low volume is highly risky (fakeouts)
  if (lastVol < lastVolSma * 0.5) {
    confidence *= 0.85; // -15% penalty
  }

  // 2. Extreme Over-extension Penalty
  // Buying when already extremely overbought, or selling when extremely oversold
  if (isLong && lastRsi > 80) {
    confidence *= 0.80; // -20% penalty
  } else if (isShort && lastRsi < 20) {
    confidence *= 0.80; // -20% penalty
  }

  // 3. Choppy Market / No Clear Structure Penalty
  // If the market is sideways and we have no structural trigger (sweep/fakeout), it's just noise
  if (isSideways && Math.abs(structureScore) < 0.3) {
    confidence *= 0.85; // -15% penalty
  }
  
  // 4. Against Major Trend Penalty
  // If we are longing but price is below the 200 EMA, or shorting but price is above 200 EMA
  if (isLong && lastClose < lastEma200) {
    confidence *= 0.90; // -10% penalty
  } else if (isShort && lastClose > lastEma200) {
    confidence *= 0.90; // -10% penalty
  }

  // 5. Indecision Candle Penalty (Doji)
  // If the last candle has a very small body compared to its wick, it shows indecision
  const lastCandleBodySize = Math.abs(lastClose - latestCandle.open);
  const lastCandleRange = latestCandle.high - latestCandle.low;
  if (lastCandleRange > 0 && lastCandleBodySize / lastCandleRange < 0.15) {
    confidence *= 0.90; // -10% penalty
  }

  // 6. Volume Profile (Value Area) Boost
  // If the current price is outside the Value Area (VA) and the trading signal aligns with moving out of the VA
  if (isLong && lastClose > volProfile.vaHigh) {
    confidence *= 1.15; // +15% boost for bullish breakout of VA
  } else if (isShort && lastClose < volProfile.vaLow) {
    confidence *= 1.15; // +15% boost for bearish breakout of VA
  }

  // ==========================================
  // ANTI-NOISE FILTER & DECISION RULE
  // ==========================================
  let signal: 'LONG' | 'SHORT' | 'NO TRADE' = 'NO TRADE';
  let reason = 'Awaiting high-probability setup.';

  // Perfect Confirmation Logic
  const isPerfectConfirmation = (
    score: number,
    l1: number,
    l2: number,
    l3: number,
    l4: number,
    sScore: number,
    vvScore: number,
    divergence: string
  ): boolean => {
    const direction = Math.sign(score);
    if (direction === 0) return false;

    // 1. Directional Confluence: All layers must align or be neutral
    const layers = [l1, l2, l3, l4, sScore, vvScore];
    const allAgree = layers.every(l => Math.sign(l) === direction || l === 0);
    
    // 2. RSI Divergence must align
    const hasDivergence = divergence === (direction > 0 ? 'bullish' : 'bearish');

    // 3. High confidence threshold
    return allAgree && hasDivergence && Math.abs(score) > 0.3;
  };

  const perfect = isPerfectConfirmation(finalScore, layer1Score, layer2Score, layer3Score, layer4Score, structureScore, volVolScore, rsiDivergence);

  // Removed strict conflict check to allow structure to override trend
  // const isConflict = Math.sign(layer2Score) !== Math.sign(structureScore) && Math.abs(layer2Score) > 0.5 && Math.abs(structureScore) > 0.5;

  if (perfect) {
    signal = finalScore > 0 ? 'LONG' : 'SHORT';
    confidence = Math.min(100, confidence + 20); // Boost confidence for perfect setup
    reason = `PERFECT ${signal} setup. High confluence & divergence.`;
  } else if (confidence >= 75) { 
    signal = finalScore > 0 ? 'LONG' : 'SHORT';
    reason = `Strong ${signal} setup. High confluence.`;
  } else if (confidence >= 60) {
    signal = finalScore > 0 ? 'LONG' : 'SHORT';
    reason = `Valid ${signal} setup. Moderate confluence.`;
  } else {
    signal = 'NO TRADE';
    reason = 'Awaiting high-probability setup.';
  }

  // Reject trades in extreme low volatility
  if (lastAtr / lastClose < 0.0005) { // Lowered the threshold to allow more trades
    signal = 'NO TRADE';
    confidence *= 0.5;
    reason = 'Volatility too low for safe entry.';
  }

  // Cap confidence at 100
  confidence = Math.min(100, confidence);

  indicators.push({
    name: 'Volume Profile',
    value: lastClose > volProfile.vaHigh ? 'ABOVE VA' : lastClose < volProfile.vaLow ? 'BELOW VA' : 'INSIDE VA',
    signal: lastClose > volProfile.vaHigh ? 'bullish' : lastClose < volProfile.vaLow ? 'bearish' : 'neutral',
    description: `VAH: ${volProfile.vaHigh.toFixed(4)} | VAL: ${volProfile.vaLow.toFixed(4)}`
  });

  indicators.push({
    name: 'Session Killzone',
    value: inKillzone ? (isAsianKillzone ? 'ASIAN' : isLondonKillzone ? 'LONDON' : 'NEW YORK') : 'OUTSIDE',
    signal: inKillzone ? (signal === 'LONG' ? 'bullish' : signal === 'SHORT' ? 'bearish' : 'neutral') : 'neutral',
    description: 'Asian (20-00) / London (02-05) / NY (07-10) EST'
  });

  indicators.push({
    name: 'System Logic',
    value: signal !== 'NO TRADE' ? `${signal} (${(confidence || 0).toFixed(1)}%)` : 'STANDBY',
    signal: signal === 'LONG' ? 'bullish' : signal === 'SHORT' ? 'bearish' : 'neutral',
    description: reason
  });

  // ==========================================
  // RISK MANAGEMENT (TP / SL)
  // ==========================================
  let tp: number | undefined;
  let sl: number | undefined;
  let tpSlStrategy = 'ATR Multiplier';

  // Calculate recent swing high/low for structure-based stops
  const lookbackPeriod = Math.min(20, data.length);
  const recentCandles = data.slice(-lookbackPeriod);
  const swingHigh = Math.max(...recentCandles.map(c => c.high));
  const swingLow = Math.min(...recentCandles.map(c => c.low));

  if (signal === 'LONG') {
    if (lastClose > volProfile.vaHigh) {
      // Strategy 1: Volume Profile Breakout
      tpSlStrategy = 'Volume Profile Breakout';
      sl = volProfile.pocPrice; // Stop loss at Point of Control
      const risk = lastClose - sl;
      tp = lastClose + (risk * 2.5); // 1:2.5 RR based on POC risk
    } else if (isSideways && lastBB) {
      // Strategy 2: Mean Reversion / Sideways
      tpSlStrategy = 'Bollinger Bands (Mean Reversion)';
      sl = Math.min(lastBB.lower - (lastAtr * 0.5), swingLow - (lastAtr * 0.2));
      const risk = lastClose - sl;
      tp = lastBB.upper; // Target upper band
      // Ensure minimum 1:1.5 RR
      if ((tp - lastClose) < (risk * 1.5)) {
        tp = lastClose + (risk * 1.5);
      }
    } else {
      // Strategy 3: Trend Following (ATR & Structure)
      tpSlStrategy = 'Trend Following (ATR & Structure)';
      const atrStop = lastClose - (lastAtr * 2);
      const structureStop = swingLow - (lastAtr * 0.2);
      // Use structure stop if it's not too far (within 3 ATR), otherwise use ATR stop
      sl = (lastClose - structureStop <= lastAtr * 3) ? structureStop : atrStop;
      const risk = lastClose - sl;
      tp = lastClose + (risk * 2); // 1:2 RR
    }
  } else if (signal === 'SHORT') {
    if (lastClose < volProfile.vaLow) {
      // Strategy 1: Volume Profile Breakout
      tpSlStrategy = 'Volume Profile Breakout';
      sl = volProfile.pocPrice; // Stop loss at Point of Control
      const risk = sl - lastClose;
      tp = lastClose - (risk * 2.5);
    } else if (isSideways && lastBB) {
      // Strategy 2: Mean Reversion / Sideways
      tpSlStrategy = 'Bollinger Bands (Mean Reversion)';
      sl = Math.max(lastBB.upper + (lastAtr * 0.5), swingHigh + (lastAtr * 0.2));
      const risk = sl - lastClose;
      tp = lastBB.lower; // Target lower band
      // Ensure minimum 1:1.5 RR
      if ((lastClose - tp) < (risk * 1.5)) {
        tp = lastClose - (risk * 1.5);
      }
    } else {
      // Strategy 3: Trend Following (ATR & Structure)
      tpSlStrategy = 'Trend Following (ATR & Structure)';
      const atrStop = lastClose + (lastAtr * 2);
      const structureStop = swingHigh + (lastAtr * 0.2);
      // Use structure stop if it's not too far (within 3 ATR), otherwise use ATR stop
      sl = (structureStop - lastClose <= lastAtr * 3) ? structureStop : atrStop;
      const risk = sl - lastClose;
      tp = lastClose - (risk * 2); // 1:2 RR
    }
  }

  if (signal !== 'NO TRADE') {
    indicators.push({
      name: 'TP/SL Strategy',
      value: tpSlStrategy,
      signal: 'neutral',
      description: 'Dynamic risk management applied.'
    });
  }

  // ==========================================
  // DYNAMIC ENTRY CALCULATION
  // ==========================================
  let suggestedEntry: number | undefined;
  
  if (signal === 'LONG' && layer4Score > 0) {
    if (lastClose > volProfile.vaHigh) {
      // Breakout above VA: Pullback to VA High is a perfect entry
      suggestedEntry = volProfile.vaHigh;
    } else if (isTrending) {
      // In a trending market, look for a pullback to EMA20
      suggestedEntry = lastEma20;
    } else {
      // In a sideways market, look for entry near the lower Bollinger Band
      suggestedEntry = lastBB?.lower;
    }
  } else if (signal === 'SHORT' && layer4Score < 0) {
    if (lastClose < volProfile.vaLow) {
      // Breakout below VA: Pullback to VA Low is a perfect entry
      suggestedEntry = volProfile.vaLow;
    } else if (isTrending) {
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
  const lastCandle = data[data.length - 1];
  const prevCandle = data[data.length - 2];
  
  if (lastCandle) {
    if (isDoji(lastCandle)) patternNames.push('Doji');
    if (isHammer(lastCandle)) patternNames.push('Hammer');
    if (prevCandle) {
      if (isEngulfingBullish(prevCandle, lastCandle)) patternNames.push('Bullish Engulfing');
      if (isEngulfingBearish(prevCandle, lastCandle)) patternNames.push('Bearish Engulfing');
    }
  }

  // Adjust confidence based on patterns
  let confidenceAdjustment = 0;
  if (patternNames.includes('Bullish Engulfing') && finalScore > 0) confidenceAdjustment = 10;
  else if (patternNames.includes('Bearish Engulfing') && finalScore < 0) confidenceAdjustment = 10;
  else if (patternNames.includes('Hammer') && finalScore > 0) confidenceAdjustment = 5;
  
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
    name: 'EMA 20',
    value: lastEma20Val?.toFixed(2) || 'N/A',
    signal: lastClose > lastEma20Val ? 'bullish' : 'bearish',
    description: 'Short-term Trend'
  });
  indicators.push({
    name: 'EMA 50',
    value: lastEma50Val?.toFixed(2) || 'N/A',
    signal: lastClose > lastEma50Val ? 'bullish' : 'bearish',
    description: 'Medium-term Trend'
  });
  indicators.push({
    name: 'Bollinger Bands (20, 2)',
    value: lastBBVal ? `Upper: ${lastBBVal.upper.toFixed(2)}, Lower: ${lastBBVal.lower.toFixed(2)}` : 'N/A',
    signal: lastBBVal && lastClose < lastBBVal.lower ? 'bullish' : lastBBVal && lastClose > lastBBVal.upper ? 'bearish' : 'neutral',
    description: 'Volatility/Mean Reversion'
  });
  indicators.push({
    name: 'RSI Divergence',
    value: rsiDivergence,
    signal: rsiDivergence,
    description: 'RSI Price Divergence'
  });
  indicators.push({
    name: 'Volume Profile (POC)',
    value: volProfile.pocPrice?.toFixed(2) || 'N/A',
    signal: lastClose > volProfile.vaHigh ? 'bullish' : lastClose < volProfile.vaLow ? 'bearish' : 'neutral',
    description: `VA: ${volProfile.vaLow?.toFixed(2) || 'N/A'} - ${volProfile.vaHigh?.toFixed(2) || 'N/A'}`
  });
  indicators.push({
    name: 'MACD',
    value: lastMacd?.MACD !== undefined ? `${lastMacd.MACD.toFixed(2)}` : 'N/A',
    signal: (lastMacd?.MACD || 0) > (lastMacd?.signal || 0) ? 'bullish' : 'bearish',
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
    patterns: patternNames,
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
      confirmation: layer4Score,
      structure: structureScore,
      volatility: volVolScore
    }
  };
};
