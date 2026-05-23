import { Candle, AnalysisResult, IndicatorResult, Trade } from './types';
import { detectPatterns } from './patterns';
import { formatPrice } from './utils/format';
import { 
  detectBOS, 
  detectLiquidityGrab, 
  detectFakeout, 
  detectVolumeSpike, 
  detectAtrExpansion, 
  calculateOrderFlow,
  detectAllRsiDivergences,
  detectMacdDivergences
} from './structure';
import { calculateVolumeProfile } from './volumeProfile';
import { calculateSupertrend, calculateEMA, calculateSMA, calculateRSI, calculateATR, calculateOBV, calculateMACD, calculateADX, calculateBollingerBands } from './indicators';

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

export * from './multiTimeframe';

export const analyzeChart = (
  data: Candle[], 
  indicatorReliability: Record<string, number> = { ema: 1.5, macd: 0.5, rsi: 1.5, stoch: 0.5, cci: 0.25, vol: 1.2, obv: 1.2 },
  trades: Trade[] = [],
  symbol: string,
  timeframe: string = '15m',
  customWeights?: number[],
  fomoMultiplier: number = 0.2, // Loose FOMO filter
  confMult: number = 80
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
  const adjustedReliability = { 
    ema: 1.5, 
    macd: 0.5, 
    rsi: 1.5, 
    stoch: 0.5, 
    cci: 0.25, 
    vol: 1.2, 
    obv: 1.2,
    sweep: 2.0,
    disp: 1.5,
    ...indicatorReliability 
  };

  detectedPatterns.forEach(p => {
    if (p.name === 'Double Bottom' || p.name === 'Double Top' || p.name === 'Triple Bottom' || p.name === 'Triple Top') {
      adjustedReliability.rsi *= 1.5;
      adjustedReliability.sweep *= 1.2;
    } else if (p.name === 'Bullish Engulfing' || p.name === 'Bearish Engulfing') {
      adjustedReliability.macd *= 1.8;
      adjustedReliability.vol *= 1.5;
      adjustedReliability.disp *= 1.3;
    } else if (p.name === 'Ascending Triangle' || p.name === 'Descending Triangle' || p.name === 'Symmetrical Triangle') {
      adjustedReliability.ema *= 1.3;
      adjustedReliability.obv *= 1.5;
    } else if (p.name === 'Bull Flag' || p.name === 'Bear Flag' || p.name === 'Bull Pennant' || p.name === 'Bear Pennant') {
      adjustedReliability.macd *= 1.5;
      adjustedReliability.ema *= 1.5;
      adjustedReliability.vol *= 1.3;
    } else if (p.name === 'Falling Wedge' || p.name === 'Rising Wedge') {
      adjustedReliability.rsi *= 1.8;
      adjustedReliability.macd *= 1.5;
    } else if (p.name === 'Head and Shoulders' || p.name === 'Inverted Head and Shoulders') {
      adjustedReliability.macd *= 1.7;
      adjustedReliability.rsi *= 1.5;
      adjustedReliability.vol *= 1.4;
    } else if (p.name === 'Cup and Handle' || p.name === 'Inverted Cup and Handle') {
      adjustedReliability.vol *= 1.6;
      adjustedReliability.ema *= 1.4;
    }
  });

  const lastClose = closes[closes.length - 1];
  const lastOpen = data[data.length - 1].open;

  // ==========================================
  // CALCULATE INDICATORS
  // ==========================================
  
  // ==========================================
  // CALCULATE INDICATORS
  // ==========================================
  
  const TF_CONFIG: Record<string, { ema: number[], bb: [number, number], adx: number, orderFlow: number }> = {
    '5m': { ema: [10, 30, 100], bb: [20, 2.5], adx: 7, orderFlow: 3 },
    '15m': { ema: [20, 50, 200], bb: [30, 2], adx: 20, orderFlow: 5 },
    '1h': { ema: [9, 21, 50], bb: [30, 2], adx: 10, orderFlow: 5 },
    '4h': { ema: [9, 21, 50], bb: [30, 2], adx: 20, orderFlow: 10 },
    '1d': { ema: [20, 50, 200], bb: [20, 2.5], adx: 20, orderFlow: 20 },
  };
  const config = TF_CONFIG[timeframe] || { ema: [20, 50, 200], bb: [20, 2], adx: 14, orderFlow: 14 };

  // Volatility & Market Condition
  const atr = calculateATR(highs, lows, closes, 14);
  const lastAtr = atr[atr.length - 1] || 0;
  
  const adxResult = calculateADX(highs, lows, closes, config.adx);
  const lastAdx = { 
    adx: adxResult.adx[adxResult.adx.length - 1], 
    pdi: adxResult.pdi[adxResult.pdi.length - 1], 
    mdi: adxResult.mdi[adxResult.mdi.length - 1] 
  };
  
  const bbResult = calculateBollingerBands(closes, config.bb[0], config.bb[1]);
  const lastBB = { 
    upper: bbResult.upper[bbResult.upper.length - 1], 
    middle: bbResult.middle[bbResult.middle.length - 1], 
    lower: bbResult.lower[bbResult.lower.length - 1] 
  };
  const prevBB = { 
    upper: bbResult.upper[bbResult.upper.length - 2], 
    middle: bbResult.middle[bbResult.middle.length - 2], 
    lower: bbResult.lower[bbResult.lower.length - 2] 
  };

  // Trend
  const ema20 = calculateEMA(closes, config.ema[0]);
  const ema50 = calculateEMA(closes, config.ema[1]);
  const ema200 = calculateEMA(closes, config.ema[2]);
  const lastEma20 = ema20[ema20.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  const lastEma200 = ema200[ema200.length - 1];

  const macdResult = calculateMACD(closes, 12, 26, 9);
  const macd = macdResult.macd.map((m, i) => ({ 
    macd: m, 
    signalLine: macdResult.signalLine[i], 
    histogram: macdResult.histogram[i] 
  }));
  const lastMacd = macd[macd.length - 1];
  const prevMacd = macd[macd.length - 2];
  const prevPrevMacd = macd[macd.length - 3];

  // Momentum / Entry
  const rsi = calculateRSI(closes, 14);
  const lastRsi = rsi[rsi.length - 1];

  // Volume / Confirmation
  const obv = calculateOBV(closes, volumes);
  const lastObv = obv[obv.length - 1];
  const prevObv = obv[obv.length - 2];
  
  const volSma = calculateSMA(volumes, 20);
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
  const orderFlow = calculateOrderFlow(data, config.orderFlow);
  const volProfile = calculateVolumeProfile(data);

  let rsiDivergence = 'none';
  let macdDivergence = 'none';
  let lastSupertrend = null;
  let supertrendSignal = 'neutral';

  if (timeframe === '15m') {
    rsiDivergence = detectAllRsiDivergences(data, rsi);
    const macd15mResult = calculateMACD(closes, 5, 34, 5);
    const macd15m = macd15mResult.macd.map((m, i) => ({
      macd: m,
      signalLine: macd15mResult.signalLine[i],
      histogram: macd15mResult.histogram[i]
    }));
    const macdHistValues = macd15m.map(m => m.histogram || 0);
    macdDivergence = detectMacdDivergences(data, macdHistValues);
    
    const atr7 = calculateATR(highs, lows, closes, 7);
    const st15m = calculateSupertrend(data, atr7, 7, 3);
    lastSupertrend = st15m[st15m.length - 1];
    supertrendSignal = lastSupertrend?.trend === 1 ? 'bullish' : lastSupertrend?.trend === -1 ? 'bearish' : 'neutral';
  }

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

  // Squeeze Detection
  const bbWidths = bbResult.upper.map((u, i) => (u - bbResult.lower[i]) / bbResult.middle[i]);
  const recentBbWidths = bbWidths.slice(-50);
  const sortedBbWidths = [...recentBbWidths].sort((a, b) => a - b);
  const bbWidth20thPercentile = sortedBbWidths[Math.floor(sortedBbWidths.length * 0.2)] || 0;
  const isSqueeze = bbWidth < bbWidth20thPercentile;

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
  // LAYER 2: TREND DIRECTION & MACD LEADING MOMENTUM
  // ==========================================
  let emaScore = 0;
  if (lastClose > lastEma20 && lastEma20 > lastEma50 && lastEma50 > lastEma200) emaScore = 1;
  else if (lastClose < lastEma20 && lastEma20 < lastEma50 && lastEma50 < lastEma200) emaScore = -1;
  else if (lastClose > lastEma50) emaScore = 0.5;
  else if (lastClose < lastEma50) emaScore = -0.5;

  let macdScore = 0;
  let macdDescription = 'Neutral';
  let macdSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';

  if (lastMacd && prevMacd && prevPrevMacd) {
    const hist = lastMacd.histogram || 0;
    const prevHist = prevMacd.histogram || 0;
    const prevPrevHist = prevPrevMacd.histogram || 0;

    // MACD Crossover Logic
    if (prevHist < 0 && hist > 0) {
      macdScore = 1.5; // Strong leading crossover
      macdSignal = 'bullish';
      macdDescription = 'Bullish Crossover (Histogram crossed 0)';
    } else if (prevHist > 0 && hist < 0) {
      macdScore = -1.5; // Strong leading crossover
      macdSignal = 'bearish';
      macdDescription = 'Bearish Crossover (Histogram crossed 0)';
    } else if (hist > 0) {
      // Uptrend (Green Histogram)
      if (hist > prevHist && prevHist > prevPrevHist) {
        // Deep Green: Momentum increasing
        macdScore = 1;
        macdSignal = 'bullish';
        macdDescription = 'Strong Bullish Momentum (Deep Green)';
      } else if (hist < prevHist) {
        // Light Green: Momentum shifting/weakening
        macdScore = -0.5; // Leading indicator of weakness
        macdSignal = 'bearish';
        macdDescription = 'Bullish Momentum Weakening (Light Green)';
      } else {
        macdScore = 0.5;
        macdSignal = 'bullish';
        macdDescription = 'Bullish Momentum';
      }
    } else if (hist < 0) {
      // Downtrend (Red Histogram)
      if (hist < prevHist && prevHist < prevPrevHist) {
        // Deep Red: Momentum increasing downwards
        macdScore = -1;
        macdSignal = 'bearish';
        macdDescription = 'Strong Bearish Momentum (Deep Red)';
      } else if (hist > prevHist) {
        // Light Red: Momentum shifting/weakening
        macdScore = 0.5; // Leading indicator of strength
        macdSignal = 'bullish';
        macdDescription = 'Bearish Momentum Weakening (Light Red)';
      } else {
        macdScore = -0.5;
        macdSignal = 'bearish';
        macdDescription = 'Bearish Momentum';
      }
    }
  }

  const emaRel = adjustedReliability.ema;
  const macdRel = adjustedReliability.macd; // Exact match to screenshot
  const layer2Score = (emaScore * emaRel + macdScore * macdRel) / (emaRel + macdRel);

  indicators.push({
    name: 'Trend Alignment',
    value: layer2Score > 0.5 ? 'STRONG BULL' : layer2Score < -0.5 ? 'STRONG BEAR' : 'MIXED',
    signal: layer2Score > 0 ? 'bullish' : layer2Score < 0 ? 'bearish' : 'neutral',
    description: 'EMA Alignment'
  });

  indicators.push({
    name: 'MACD Momentum',
    value: macdDescription,
    signal: macdSignal,
    description: 'Leading Indicator based on Histogram shifts'
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

  const rsiRel = adjustedReliability.rsi;
  const sweepRel = adjustedReliability.sweep;
  const dispRel = adjustedReliability.disp;
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

  const volRel = adjustedReliability.vol;
  const obvRel = adjustedReliability.obv;
  const layer4Score = (volScore * volRel + obvScore * obvRel) / (volRel + obvRel);

  indicators.push({
    name: 'Volume Confirm',
    value: layer4Score > 0 ? 'ACCUMULATION' : layer4Score < 0 ? 'DISTRIBUTION' : 'NEUTRAL',
    signal: layer4Score > 0 ? 'bullish' : layer4Score < 0 ? 'bearish' : 'neutral',
    description: 'Volume & OBV Flow'
  });

  const totalFlow = orderFlow.buyingPressure + orderFlow.sellingPressure;
  const flowIntensity = totalFlow > 0 ? Math.abs(orderFlow.netFlow) / totalFlow : 0;

  indicators.push({
    name: 'Order Flow',
    value: orderFlow.signal === 'bullish' ? 'BUYING PRESSURE' : orderFlow.signal === 'bearish' ? 'SELLING PRESSURE' : 'NEUTRAL',
    signal: orderFlow.signal,
    description: `Net Flow: ${orderFlow.netFlow > 0 ? '+' : ''}${(orderFlow.netFlow / 1000).toFixed(1)}k (${(flowIntensity * 100).toFixed(1)}% Intensity)`
  });

  // ==========================================
  // ADAPTIVE WEIGHTS & FINAL SCORE (Refined & Balanced)
  // ==========================================
  // Base Weights (User Requested Distribution)
  // Layer 1: Market Condition (5%)
  // Layer 2: Trend Direction (5%)
  // Layer 3: Entry Timing (20%)
  // Layer 4: Confirmation (5%)
  // Layer 5: Market Structure (35%)
  // Layer 6: Volume/Volatility (30%)

  // ==========================================
  // ADAPTIVE WEIGHTS & FINAL SCORE (ACE-v2 Convex combinations)
  // ==========================================
  const rTrend = Math.max(0, Math.min(1.0, ((lastAdx?.adx || 20) - 20) / 15.0));

  let w1 = 0.10; // Market Condition (Regime)
  let w2 = 0.15 * (1.0 + 0.20 * rTrend); // Trend Direction
  let w3 = 0.15 * (1.0 - 0.15 * rTrend); // Entry Timing (Momentum)
  let w4 = 0.10; // Confirmation
  let w5 = 0.25 * (1.0 + 0.10 * rTrend); // Structure
  let w6 = 0.25; // Volume/Volatility

  // Normalize weights to sum exactly to 1.0 (Convex combination)
  const totalW = w1 + w2 + w3 + w4 + w5 + w6;
  w1 /= totalW;
  w2 /= totalW;
  w3 /= totalW;
  w4 /= totalW;
  w5 /= totalW;
  w6 /= totalW;
  
  const trendStrength = Math.abs(layer1Score); // 0 to 1

  // Structure Score (Market Structure 35%)
  // BOS (50%), Liquidity Grab (30%), Fakeout (20%)
  let structureScore = 0;
  if (bos === 'bullish') structureScore += 0.50;
  else if (bos === 'bearish') structureScore -= 0.50;
  if (liquidityGrab === 'bullish') structureScore += 0.30;
  else if (liquidityGrab === 'bearish') structureScore -= 0.30;
  if (fakeout === 'bullish') structureScore += 0.20;
  else if (fakeout === 'bearish') structureScore -= 0.20;

  // Volume/Volatility Score (Layer 6)
  // Volume spike (40%, threshold: Volume > 2x Vol SMA)
  // ATR expansion (30%, 20-bar lookback)
  // Order flow intensity (30%)
  let volVolScore = 0;
  
  if (volumeSpike > 2.0) volVolScore += (lastClose > closes[closes.length - 2] ? 0.40 : -0.40);
  
  if (atrExpansion > 1.3) volVolScore += (lastClose > closes[closes.length - 2] ? 0.30 : -0.30);
  
  const intensity = Math.min(1.0, (lastVol / (lastVolSma * 2.0)));
  if (orderFlow.signal === 'bullish') volVolScore += 0.30 * intensity;
  else if (orderFlow.signal === 'bearish') volVolScore -= 0.30 * intensity;

  let finalScore = (layer1Score * w1) + (layer2Score * w2) + (layer3Score * w3) + (layer4Score * w4) + (structureScore * w5) + (volVolScore * w6);
  
  // ACE-v2 Sigmoid Confidence Squashing
  const k_slope = 7.0;
  const theta_offset = 0.55;
  let confidence = 100 / (1 + Math.exp(-k_slope * (Math.abs(finalScore) - theta_offset)));

  // Session Logic - Based on UTC Time
  const latestCandle = data[data.length - 1];
  const lastCandleDate = new Date(latestCandle.time * 1000);
  const utcHour = lastCandleDate.getUTCHours();
  const inAsianSession = utcHour >= 0 && utcHour < 9;
  const inLondonSession = utcHour >= 8 && utcHour < 17;
  const inNewYorkSession = utcHour >= 13 && utcHour < 22;

  let currentSession = 'OUTSIDE';
  if (inNewYorkSession) currentSession = 'New York';
  else if (inLondonSession) currentSession = 'London';
  else if (inAsianSession) currentSession = 'Asian';

  // Optional: Cap confidence at 100
  confidence = Math.min(100, confidence);

  // ==========================================
  // ANTI-NOISE FILTER & DECISION RULE
  // ==========================================
  let signal: 'LONG' | 'SHORT' | 'NO TRADE' = 'NO TRADE';
  let tier: 'WATCH' | 'STRONG' | 'ELITE' | 'STANDBY' = 'STANDBY';
  let reason = 'Awaiting high-probability setup.';

  // Perfect Confirmation Logic
  const isPerfectConfirmation = (
    score: number,
    l1: number,
    l2: number,
    l3: number,
    l4: number,
    sScore: number,
    vvScore: number
  ): boolean => {
    const direction = Math.sign(score);
    if (direction === 0) return false;

    // 1. Directional Confluence: All layers must align or be neutral
    const layers = [l1, l2, l3, l4, sScore, vvScore];
    const allAgree = layers.every(l => Math.sign(l) === direction || l === 0);
    
    // 3. High confidence threshold
    return allAgree && Math.abs(score) > 0.3;
  };

  const perfect = isPerfectConfirmation(finalScore, layer1Score, layer2Score, layer3Score, layer4Score, structureScore, volVolScore);

  // Removed strict conflict check to allow structure to override trend
  // const isConflict = Math.sign(layer2Score) !== Math.sign(structureScore) && Math.abs(layer2Score) > 0.5 && Math.abs(structureScore) > 0.5;

  if (perfect) {
    confidence = Math.min(100, confidence + 10); // Boost confidence for perfect setup
  }

  if (confidence >= 70) {
    signal = finalScore > 0 ? 'LONG' : 'SHORT';
    if (confidence >= 88) {
      tier = 'ELITE';
    } else if (confidence >= 78) {
      tier = 'STRONG';
    } else {
      tier = 'WATCH';
    }
    reason = `${tier} ${signal} setup. High confluence.`;
  } else {
    signal = 'NO TRADE';
    tier = 'STANDBY';
    reason = 'Awaiting high-probability setup.';
  }

  // Reject trades in extreme low volatility
  if (lastAtr / lastClose < 0.0001) { // Extremely low
    signal = 'NO TRADE';
    tier = 'STANDBY';
    confidence *= 0.5;
    reason = 'Volatility too low for safe entry.';
  }

  // Skip squeeze context - optimized strategy addition
  if (isSqueeze) {
    signal = 'NO TRADE';
    tier = 'STANDBY';
    confidence = 0;
    reason = 'Squeeze Filter: Bollinger Band Width in bottom 20th percentile. New entries are suppressed.';
  }

  // Cap confidence at 100
  confidence = Math.min(100, confidence);

  indicators.push({
    name: 'Volume Profile',
    value: lastClose > volProfile.vaHigh ? 'ABOVE VA' : lastClose < volProfile.vaLow ? 'BELOW VA' : 'INSIDE VA',
    signal: lastClose > volProfile.vaHigh ? 'bullish' : lastClose < volProfile.vaLow ? 'bearish' : 'neutral',
    description: `VAH: ${formatPrice(volProfile.vaHigh)} | VAL: ${formatPrice(volProfile.vaLow)}`
  });

  indicators.push({
    name: 'Session Killzone',
    value: currentSession,
    signal: currentSession !== 'OUTSIDE' ? (signal === 'LONG' ? 'bullish' : signal === 'SHORT' ? 'bearish' : 'neutral') : 'neutral',
    description: 'Active Trading Session (UTC)'
  });

  indicators.push({
    name: 'System Logic',
    value: signal !== 'NO TRADE' ? `${signal} (${(confidence || 0).toFixed(1)}%)` : 'STANDBY',
    signal: signal === 'LONG' ? 'bullish' : signal === 'SHORT' ? 'bearish' : 'neutral',
    description: reason
  });

  // ==========================================
  // DYNAMIC ENTRY CALCULATION (DUAL STRATEGY)
  // ==========================================
  // Primary Entry: Current Market Price (Instant Execution)
  const entryPrice = lastClose;
  
  // Secondary Entry: Pullback Limit Order (Better R:R)
  let limitEntry: number | undefined;
  let entryStrategy: 'Market (CMP)' | 'Limit (Pullback)' | 'Split (50/50)' = 'Market (CMP)';
  
  // Determine if the momentum is extremely strong (FOMO market)
  const isStrongMomentum = (signal === 'LONG' && lastClose > lastBB?.upper!) || 
                           (signal === 'SHORT' && lastClose < lastBB?.lower!);
                           
  // Determine if we are near a major support/resistance level
  const isNearSupportResistance = Math.abs(lastClose - volProfile.pocPrice) / lastClose < 0.01;

  if (signal === 'LONG' && layer4Score > 0) {
    if (lastClose > volProfile.vaHigh) {
      limitEntry = volProfile.vaHigh; // Pullback to VA High
    } else if (isTrending) {
      limitEntry = lastEma20; // Pullback to EMA20
    } else {
      limitEntry = lastBB?.lower; // Mean reversion to lower BB
    }
    // Only provide a limit entry if it's actually a pullback (below current price)
    if (limitEntry && limitEntry >= lastClose) {
      limitEntry = undefined;
    }
  } else if (signal === 'SHORT' && layer4Score < 0) {
    if (lastClose < volProfile.vaLow) {
      limitEntry = volProfile.vaLow; // Pullback to VA Low
    } else if (isTrending) {
      limitEntry = lastEma20; // Pullback to EMA20
    } else {
      limitEntry = lastBB?.upper; // Mean reversion to upper BB
    }
    // Only provide a limit entry if it's actually a pullback (above current price)
    if (limitEntry && limitEntry <= lastClose) {
      limitEntry = undefined;
    }
  }
  
  // Dynamic Strategy Decision
  if (limitEntry) {
    const distanceToLimit = Math.abs(lastClose - limitEntry) / lastClose;
    
    if (isStrongMomentum) {
      // If momentum is crazy strong, a pullback might never happen. Just market buy.
      entryStrategy = 'Market (CMP)';
      limitEntry = undefined; // Discard limit entry to avoid confusion
    } else if (distanceToLimit > 0.02) {
      // If the limit entry is very far away (>2%), the market entry has terrible R:R.
      // Better to wait for the limit order.
      entryStrategy = 'Limit (Pullback)';
    } else {
      // If the limit entry is reasonably close (<=2%), use the professional split strategy.
      entryStrategy = 'Split (50/50)';
    }
  }

  // ==========================================
  // RISK MANAGEMENT (TP / SL)
  // ==========================================
  let tp: number | undefined;
  let sl: number | undefined;
  let tpSlStrategy = 'Dynamic';

  // Calculate recent swing high/low for structure-based stops and targets
  const lookbackPeriod = Math.min(20, data.length);
  const recentCandles = data.slice(-lookbackPeriod);
  const swingHigh = Math.max(...recentCandles.map(c => c.high));
  const swingLow = Math.min(...recentCandles.map(c => c.low));

  const entryCandle = data[data.length - 1];
  const lastCloseVal = entryCandle.close;
  
  // Extra FOMO Check
  const fomoMultiplierToUse = fomoMultiplier ?? 0.2; // Default to 0.2 if not set (loose FOMO)
  const isNearHigh = Math.abs(lastCloseVal - swingHigh) < (lastAtr * fomoMultiplierToUse);
  const isNearLow = Math.abs(lastCloseVal - swingLow) < (lastAtr * fomoMultiplierToUse);
  
  if (signal === 'LONG' && isNearHigh) {
    signal = 'NO TRADE';
    reason = 'FOMO Filter: Price too close to recent high';
  } else if (signal === 'SHORT' && isNearLow) {
    signal = 'NO TRADE';
    reason = 'FOMO Filter: Price too close to recent low';
  }

  const entryRange = Math.max(lastAtr * 0.5, entryCandle.high - entryCandle.low);
  
  let risk = 0;
  
  // Dynamic Trade Condition Evaluator
  const computeDynamicStops = () => {
    let calcSl = entryPrice;
    let riskUnscaled = lastAtr;
    let strategyDesc = '';
    let contextMode = 'Default';

    if (isHighVolatility) {
      // Case A: High Volatility Expansion - widen ATR to avoid wicks
      contextMode = 'High Volatility';
      const mu = 2.2;
      riskUnscaled = mu * lastAtr;
      calcSl = signal === 'LONG' ? entryPrice - (riskUnscaled * 1.6) : entryPrice + (riskUnscaled * 1.6);
      strategyDesc = `Context: High Volatility Noise-Dampening (Raw ATR ${mu}x, Scaled 1.6x)`;
    } else if (isSqueeze) {
      // Case B: Bollinger Squeeze Consolidation - tight compression, tight stop
      contextMode = 'Squeeze Compression';
      const mu = 1.25;
      riskUnscaled = mu * lastAtr;
      calcSl = signal === 'LONG' ? entryPrice - (riskUnscaled * 1.6) : entryPrice + (riskUnscaled * 1.6);
      strategyDesc = `Context: Tight Squeeze Compression (Raw ATR ${mu}x, Scaled 1.6x)`;
    } else if (isTrendingUp || isTrendingDown) {
      // Case C: Strong Trend - place past key structural swing points
      contextMode = 'Trend Structure';
      if (signal === 'LONG') {
        const structuralStop = swingLow - 0.25 * lastAtr;
        // Clamp stop loss between 1.5x and 3.0x ATR for security and breathing room before scale
        riskUnscaled = Math.max(1.5 * lastAtr, Math.min(3.0 * lastAtr, entryPrice - structuralStop));
        calcSl = entryPrice - (riskUnscaled * 1.6);
      } else { // SHORT
        const structuralStop = swingHigh + 0.25 * lastAtr;
        riskUnscaled = Math.max(1.5 * lastAtr, Math.min(3.0 * lastAtr, structuralStop - entryPrice));
        calcSl = entryPrice + (riskUnscaled * 1.6);
      }
      strategyDesc = `Context: Trend Structural Alignment (Swing-based, Scaled 1.6x)`;
    } else {
      // Case D: Standard Sideways / Ranging - place past range boundaries
      contextMode = 'Sideways Structure';
      if (signal === 'LONG') {
        const structuralStop = swingLow - 0.2 * lastAtr;
        // Clamp stop loss between 1.5x and 2.0x ATR for tight range protection before scale
        riskUnscaled = Math.max(1.5 * lastAtr, Math.min(2.0 * lastAtr, entryPrice - structuralStop));
        calcSl = entryPrice - (riskUnscaled * 1.6);
      } else { // SHORT
        const structuralStop = swingHigh + 0.2 * lastAtr;
        riskUnscaled = Math.max(1.5 * lastAtr, Math.min(2.0 * lastAtr, structuralStop - entryPrice));
        calcSl = entryPrice + (riskUnscaled * 1.6);
      }
      strategyDesc = `Context: Range Structural Boundary (Swing-based, Scaled 1.6x)`;
    }

    // Risk amount is unscaled risk for TP calculations
    const risk = riskUnscaled;
    
    // Dynamic context-based Take Profit multipliers to capture optimal reward levels
    let tp1Mult = 1.0;
    let tp2Mult = 2.0;
    let tp3Mult = 3.5;
    let targetContextDesc = '';

    if (isHighVolatility) {
      tp1Mult = 1.25;
      tp2Mult = 2.50;
      tp3Mult = 4.75;
      targetContextDesc = 'Expanded Volatility Targets';
    } else if (isSqueeze) {
      tp1Mult = 0.90;
      tp2Mult = 1.75;
      tp3Mult = 3.0;
      targetContextDesc = 'Compression Breakout Targets';
    } else if (isTrendingUp || isTrendingDown) {
      tp1Mult = 1.10;
      tp2Mult = 2.20;
      tp3Mult = 4.25;
      targetContextDesc = 'Trend Continuation Standard Targets';
    } else {
      tp1Mult = 0.85;
      tp2Mult = 1.60;
      tp3Mult = 2.75;
      targetContextDesc = 'Range Scalp Boundaries';
    }

    // TP1: 33% Volume with dynamic R:R target
    let calcTp1 = signal === 'LONG' ? entryPrice + (risk * tp1Mult) : entryPrice - (risk * tp1Mult);
    
    // TP2: 33% Volume with dynamic R:R target
    let calcTp2 = signal === 'LONG' ? entryPrice + (risk * tp2Mult) : entryPrice - (risk * tp2Mult);
    
    // TP3: 34% Volume with dynamic R:R runner target
    let calcTp3 = signal === 'LONG' ? entryPrice + (risk * tp3Mult) : entryPrice - (risk * tp3Mult);
    
    let calcTp = calcTp3; // Overall Take Profit matches the ultimate runner target
    let breakEvenTrigger = calcTp1;
    let trailingStopMode = isTrending ? 'ATR' : 'Structure' as 'ATR' | 'Percentage' | 'Structure';
    strategyDesc += ` | Target Dynamic Model: ${targetContextDesc} (${tp1Mult.toFixed(2)}x / ${tp2Mult.toFixed(2)}x / ${tp3Mult.toFixed(2)}x R:R)`;

    // Default cleanup
    calcTp = Math.max(0.00000001, calcTp);
    if (calcTp1) calcTp1 = Math.max(0.00000001, calcTp1);
    if (calcTp2) calcTp2 = Math.max(0.00000001, calcTp2);
    if (calcTp3) calcTp3 = Math.max(0.00000001, calcTp3);
    if (breakEvenTrigger) breakEvenTrigger = Math.max(0.00000001, breakEvenTrigger);

    return { calcSl, calcTp, calcTp1, calcTp2, calcTp3, breakEvenTrigger, trailingStopMode, strategyDesc };
  };

  let tp1: number | undefined;
  let tp2: number | undefined;
  let tp3: number | undefined;
  let breakEvenTrigger: number | undefined;
  let trailingStopMode: 'ATR' | 'Percentage' | 'Structure' | undefined;

  if (signal !== 'NO TRADE') {
    const { calcSl, calcTp, calcTp1, calcTp2: _tp2, calcTp3, breakEvenTrigger: calcBE, trailingStopMode: calcTS, strategyDesc } = computeDynamicStops();
    sl = calcSl;
    tp = calcTp;
    tp1 = calcTp1;
    tp2 = _tp2;
    tp3 = calcTp3;
    breakEvenTrigger = calcBE;
    trailingStopMode = calcTS;
    tpSlStrategy = strategyDesc;
    risk = Math.abs(entryPrice - sl);
  }

  // ==========================================
  // SANITY CHECK: LIMIT ENTRY vs STOP LOSS
  // ==========================================
  if (limitEntry !== undefined && sl !== undefined) {
    let limitIsInvalid = false;
    
    if (signal === 'LONG' && limitEntry <= sl) {
      limitIsInvalid = true;
    } else if (signal === 'SHORT' && limitEntry >= sl) {
      limitIsInvalid = true;
    }

    if (limitIsInvalid) {
      const oldRisk = Math.abs(entryPrice - sl);
      
      // ==========================================
      // DYNAMIC DECISION TREE
      // ==========================================
      if (isStrongMomentum) {
        // Scenario A: Extreme Momentum (FOMO)
        // A deep pullback invalidates the momentum. Don't widen SL, don't catch a falling knife.
        // -> Solution 3: Market Entry Only
        entryStrategy = 'Market (CMP)';
        limitEntry = undefined;
        tpSlStrategy += ' (Limit Cancelled: Strong Momentum)';
        
      } else if (isTrending || isHighVolatility) {
        // Scenario B: Trending or High Volatility
        // Give the trade room to breathe around the structural limit entry.
        // -> Solution 2: Widen Stop Loss (Structural Stop)
        let newSl = signal === 'LONG' ? limitEntry - (lastAtr * 0.8) : limitEntry + (lastAtr * 0.8);
        const newRisk = Math.abs(entryPrice - newSl);
        
        // Safety check: Max 12% risk
        if (newRisk / entryPrice <= 0.12) {
          sl = newSl;
          risk = newRisk;
          tpSlStrategy += ' (SL Widened for Volatility/Trend)';
        } else {
          // Fallback to Midpoint if widening is too dangerous
          const midpoint = signal === 'LONG' ? entryPrice - (oldRisk * 0.5) : entryPrice + (oldRisk * 0.5);
          limitEntry = midpoint;
          entryStrategy = 'Split (50/50)';
          tpSlStrategy += ' (Limit Adjusted: Max Risk Reached)';
        }
        
      } else {
        // Scenario C: Sideways / Ranging Market
        // Keep risk tight. Widening SL in a range means you're holding a breakout against you.
        // -> Solution 1: Midpoint Fallback
        const midpoint = signal === 'LONG' ? entryPrice - (oldRisk * 0.5) : entryPrice + (oldRisk * 0.5);
        limitEntry = midpoint;
        
        const distanceToMidpoint = Math.abs(entryPrice - midpoint) / entryPrice;
        if (distanceToMidpoint < 0.002) {
          entryStrategy = 'Market (CMP)';
          limitEntry = undefined;
          tpSlStrategy += ' (Limit Cancelled: Range Too Tight)';
        } else {
          entryStrategy = 'Split (50/50)';
          tpSlStrategy += ' (Limit Adjusted to Midpoint: Range Market)';
        }
      }
    }
  }

  // Penalize excessive risk
  if (signal !== 'NO TRADE' && risk > 0) {
    const riskPercentage = risk / entryPrice;
    if (riskPercentage > 0.15) {
      confidence *= 0.5; // Heavy penalty for >15% stop loss
      reason += ' | Excessive risk (SL > 15%)';
    } else if (riskPercentage > 0.08) {
      confidence *= 0.8; // Minor penalty for >8% stop loss
      reason += ' | High risk (SL > 8%)';
    }
  }

  // Liquidity Zone Filter
  if (signal !== 'NO TRADE') {
    const recentData = data.slice(-50);
    const highestHigh = Math.max(...recentData.map(d => d.high));
    const lowestLow = Math.min(...recentData.map(d => d.low));
    const zoneThreshold = lastAtr * 2;
    
    const isNearHigh = Math.abs(lastClose - highestHigh) < zoneThreshold;
    const isNearLow = Math.abs(lastClose - lowestLow) < zoneThreshold;

    if (!isNearHigh && !isNearLow) {
      confidence *= 0.8;
      reason += ' | Not near strong liquidity zone';
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
  // PATTERN DETECTION
  // ==========================================
  const lastCandle = data[data.length - 1];
  const prevCandle = data[data.length - 2];
  
  if (lastCandle) {
    if (isDoji(lastCandle) && !patternNames.includes('Doji')) patternNames.push('Doji');
    if (isHammer(lastCandle) && !patternNames.includes('Hammer')) patternNames.push('Hammer');
    if (prevCandle) {
      if (isEngulfingBullish(prevCandle, lastCandle) && !patternNames.includes('Bullish Engulfing')) patternNames.push('Bullish Engulfing');
      if (isEngulfingBearish(prevCandle, lastCandle) && !patternNames.includes('Bearish Engulfing')) patternNames.push('Bearish Engulfing');
    }
  }

  // Adjust confidence based on patterns
  let confidenceAdjustment = 0;
  if (patternNames.includes('Bullish Engulfing') && finalScore > 0) confidenceAdjustment += 10;
  else if (patternNames.includes('Bearish Engulfing') && finalScore < 0) confidenceAdjustment += 10;
  else if (patternNames.includes('Hammer') && finalScore > 0) confidenceAdjustment += 5;
  
  // Complex patterns confidence adjustment
  if (finalScore > 0) {
    if (patternNames.includes('Inverted Head and Shoulders')) confidenceAdjustment += 18;
    if (patternNames.includes('Cup and Handle')) confidenceAdjustment += 16;
    if (patternNames.includes('Bull Flag')) confidenceAdjustment += 15;
    if (patternNames.includes('Triple Bottom')) confidenceAdjustment += 14;
    if (patternNames.includes('Bull Pennant')) confidenceAdjustment += 12;
    if (patternNames.includes('Falling Wedge')) confidenceAdjustment += 10;
    if (patternNames.includes('Ascending Triangle')) confidenceAdjustment += 8;
    if (patternNames.includes('Double Bottom')) confidenceAdjustment += 8;
  } else if (finalScore < 0) {
    if (patternNames.includes('Head and Shoulders')) confidenceAdjustment += 18;
    if (patternNames.includes('Inverted Cup and Handle')) confidenceAdjustment += 16;
    if (patternNames.includes('Bear Flag')) confidenceAdjustment += 15;
    if (patternNames.includes('Triple Top')) confidenceAdjustment += 14;
    if (patternNames.includes('Bear Pennant')) confidenceAdjustment += 12;
    if (patternNames.includes('Rising Wedge')) confidenceAdjustment += 10;
    if (patternNames.includes('Descending Triangle')) confidenceAdjustment += 8;
    if (patternNames.includes('Double Top')) confidenceAdjustment += 8;
  }
  
  confidence = Math.min(100, Math.max(0, confidence + confidenceAdjustment));

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
    name: `EMA ${config.ema[0]}`,
    value: lastEma20Val !== undefined ? formatPrice(lastEma20Val) : 'N/A',
    signal: lastClose > lastEma20Val ? 'bullish' : 'bearish',
    description: 'Short-term Trend'
  });
  indicators.push({
    name: `EMA ${config.ema[1]}`,
    value: lastEma50Val !== undefined ? formatPrice(lastEma50Val) : 'N/A',
    signal: lastClose > lastEma50Val ? 'bullish' : 'bearish',
    description: 'Medium-term Trend'
  });
  indicators.push({
    name: `Bollinger Bands (${config.bb[0]}, ${config.bb[1]})`,
    value: lastBBVal ? `Upper: ${formatPrice(lastBBVal.upper)}, Lower: ${formatPrice(lastBBVal.lower)}` : 'N/A',
    signal: lastBBVal && lastClose < lastBBVal.lower ? 'bullish' : lastBBVal && lastClose > lastBBVal.upper ? 'bearish' : 'neutral',
    description: 'Volatility/Mean Reversion'
  });
  indicators.push({
    name: 'Volume Profile (POC)',
    value: volProfile.pocPrice ? formatPrice(volProfile.pocPrice) : 'N/A',
    signal: lastClose > volProfile.vaHigh ? 'bullish' : lastClose < volProfile.vaLow ? 'bearish' : 'neutral',
    description: `VA: ${volProfile.vaLow ? formatPrice(volProfile.vaLow) : 'N/A'} - ${volProfile.vaHigh ? formatPrice(volProfile.vaHigh) : 'N/A'}`
  });

  if (timeframe === '15m') {
    indicators.push({
      name: 'RSI Divergence',
      value: rsiDivergence,
      signal: rsiDivergence === 'regular_bullish' || rsiDivergence === 'hidden_bullish' ? 'bullish' : rsiDivergence === 'regular_bearish' || rsiDivergence === 'hidden_bearish' ? 'bearish' : 'neutral',
      description: 'RSI Price Divergence'
    });
    indicators.push({
      name: 'MACD Divergence',
      value: macdDivergence,
      signal: macdDivergence === 'regular_bullish' || macdDivergence === 'hidden_bullish' ? 'bullish' : macdDivergence === 'regular_bearish' || macdDivergence === 'hidden_bearish' ? 'bearish' : 'neutral',
      description: 'MACD Histogram Divergence'
    });
    indicators.push({
      name: 'Supertrend (7, 3)',
      value: lastSupertrend ? formatPrice(lastSupertrend.value) : 'N/A',
      signal: supertrendSignal as 'bullish' | 'bearish' | 'neutral',
      description: 'Directional Trend Filter'
    });
  }

  indicators.push({
    name: 'MACD',
    value: lastMacd?.macd !== undefined ? formatPrice(lastMacd.macd) : 'N/A',
    signal: (lastMacd?.macd || 0) > (lastMacd?.signalLine || 0) ? 'bullish' : 'bearish',
    description: 'Trend Oscillator'
  });
  indicators.push({
    name: 'ATR (14)',
    value: lastAtr ? formatPrice(lastAtr) : 'N/A',
    signal: 'neutral',
    description: 'Average True Range'
  });


  return {
    signal,
    confidence,
    tier,
    indicators,
    patterns: patternNames,
    confluences: {
      supporting: indicators.filter(i => i.signal === supportingSignal).map(i => i.name),
      opposing: indicators.filter(i => i.signal === opposingSignal).map(i => i.name),
      neutral: indicators.filter(i => i.signal === 'neutral').map(i => i.name)
    },
    tp,
    tp1,
    tp2,
    tp3,
    sl,
    breakEvenTrigger,
    trailingStopMode,
    suggestedEntry: entryPrice, // For backward compatibility
    limitEntry,
    entryStrategy,
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
