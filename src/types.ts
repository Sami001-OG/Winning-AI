export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isFinal?: boolean;
}

export interface IndicatorResult {
  name: string;
  value: string | number;
  signal: 'bullish' | 'bearish' | 'neutral';
  description: string;
}

export interface Trade {
  id: string;
  symbol: string;
  type: 'LONG' | 'SHORT';
  entry: number;
  tp: number;
  sl: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  timestamp: number;
}

export interface AnalysisResult {
  signal: 'LONG' | 'SHORT' | 'NO TRADE';
  confidence: number;
  indicators: IndicatorResult[];
  patterns: string[];
  confluences: {
    supporting: string[];
    opposing: string[];
    neutral: string[];
  };
  tp?: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  sl?: number;
  suggestedEntry?: number; // Deprecated, keeping for backward compatibility
  limitEntry?: number; // The calculated pullback entry price
  entryStrategy?: 'Market (CMP)' | 'Limit (Pullback)' | 'Split (50/50)';
  layers?: {
    marketCondition: number;
    trend: number;
    entry: number;
    confirmation: number;
    structure: number;
    volatility: number;
  };
}
