export interface Candle {
  time: string;
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
  confluences: {
    supporting: string[];
    opposing: string[];
    neutral: string[];
  };
  tp?: number;
  sl?: number;
  suggestedEntry?: number;
  layers?: {
    marketCondition: number;
    trend: number;
    entry: number;
    confirmation: number;
  };
}
