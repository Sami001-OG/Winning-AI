import React, { useState, useEffect, useRef } from 'react';
import { analyzeChart } from '../analysis';
import { getHTFDirection, validateLTFEntry, createNoTradeResult } from '../multiTimeframe';
import { Candle, AnalysisResult, Trade } from '../types';
import { TrendingUp, TrendingDown, Minus, Activity, RefreshCw, Lock, Unlock, ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react';
import { fetchWithRetry } from '../utils/api';
import { formatPrice } from '../utils/format';
import { sendTelegramAlert } from '../services/telegramService';

const TIMEFRAMES = ['4h', '15m', '5m'];

interface TradeSignal {
  symbol: string;
  analysis: AnalysisResult;
  lastPrice: number;
  entryDirection: 'up' | 'down' | 'none';
}

interface ActiveTrade {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  tp1: number;
  tp2: number;
  tp3: number;
  sl: number;
  achieved: number; // 0, 1, 2, 3
  isMTF: boolean;
}

const DEFAULT_RELIABILITY = { ema: 1.5, macd: 0.5, rsi: 1.5, stoch: 0.5, cci: 0.25, vol: 1.2, obv: 1.2 };

interface TopTradesTableProps {
  trades: Trade[];
}

export const TopTradesTable: React.FC<TopTradesTableProps> = ({ trades }) => {
  const [signals, setSignals] = useState<TradeSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [frozenEntries, setFrozenEntries] = useState<Record<string, number>>({});
  
  const klinesDataRef = useRef<Record<string, Record<string, Candle[]>>>({});
  const wsRefs = useRef<WebSocket[]>([]);
  const prevEntriesRef = useRef<Record<string, number>>({});
  const pushedSignalsRef = useRef<Record<string, number>>({});
  const lastSessionAlertRef = useRef<string>('');
  const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours cooldown

  const fetchTopSymbols = async () => {
    try {
      const res = await fetchWithRetry(`https://fapi.binance.com/fapi/v1/ticker/24hr?_t=${Date.now()}`);
      const data = await res.json();
      const usdtPairs = data
        .filter((t: any) => 
          (t.symbol.endsWith('USDT') || t.symbol.endsWith('USDC') || t.symbol.endsWith('BUSD')) && 
          parseFloat(t.volume) > 0 &&
          !t.symbol.includes('_') && // Exclude delivery contracts like BTCUSDT_240628
          !t.symbol.includes('UPUSDT') &&
          !t.symbol.includes('DOWNUSDT') &&
          !t.symbol.includes('BULLUSDT') &&
          !t.symbol.includes('BEARUSDT')
        )
        .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .map((t: any) => t.symbol);
      return usdtPairs;
    } catch (e) {
      console.error('Error fetching top symbols', e);
      // Fallback
      return ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT'];
    }
  };

  const fetchKlines = async (symbol: string, tf: string) => {
    try {
      const res = await fetchWithRetry(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=250&_t=${Date.now()}`);
      const data = await res.json();
      
      if (!Array.isArray(data)) {
        console.warn(`[Binance API Warning] Expected array for ${symbol} ${tf}, got:`, data);
        return [];
      }

      return data.map((d: any) => ({
        time: Math.floor(d[0] / 1000),
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5]),
        isFinal: true
      }));
    } catch (error) {
      console.error(`[Binance API Error] Failed to fetch klines for ${symbol} ${tf}:`, error);
      return [];
    }
  };

  type PipelineState = {
    bias4h: 'LONG' | 'SHORT' | 'NEUTRAL';
    analysis15m: AnalysisResult | null;
    entry5m: { isValid: boolean, reason: string } | null;
  };
  const pipelineStateRef = useRef<Record<string, PipelineState>>({});

  const run4HBiasEngine = (symbol?: string) => {
    const symbols = symbol ? [symbol] : Object.keys(klinesDataRef.current);
    symbols.forEach(sym => {
      const data4h = klinesDataRef.current[sym]?.['4h'];
      if (data4h && data4h.length > 0) {
        if (!pipelineStateRef.current[sym]) {
          pipelineStateRef.current[sym] = { bias4h: 'NEUTRAL', analysis15m: null, entry5m: null };
        }
        pipelineStateRef.current[sym].bias4h = getHTFDirection(data4h);
      }
    });
  };

  const run15MRankingEngine = (symbol?: string) => {
    const symbols = symbol ? [symbol] : Object.keys(klinesDataRef.current);
    symbols.forEach(sym => {
      const data15m = klinesDataRef.current[sym]?.['15m'];
      if (data15m && data15m.length > 0) {
        if (!pipelineStateRef.current[sym]) {
          pipelineStateRef.current[sym] = { bias4h: 'NEUTRAL', analysis15m: null, entry5m: null };
        }
        pipelineStateRef.current[sym].analysis15m = analyzeChart(data15m, DEFAULT_RELIABILITY, trades, sym);
      }
    });
  };

  const run5MEntryEngine = (symbol: string) => {
    const data5m = klinesDataRef.current[symbol]?.['5m'];
    const state = pipelineStateRef.current[symbol];
    if (data5m && data5m.length > 0 && state && state.analysis15m && state.analysis15m.signal !== 'NO TRADE') {
      state.entry5m = validateLTFEntry(data5m, state.analysis15m.signal as 'LONG' | 'SHORT');
    }
  };

  const updateTable = () => {
    const newSignals: TradeSignal[] = [];
    
    for (const [symbol, state] of Object.entries(pipelineStateRef.current) as [string, PipelineState][]) {
      if (!state.analysis15m) continue;
      
      let finalAnalysis: AnalysisResult;
      
      if (state.bias4h !== 'NEUTRAL' && state.bias4h !== state.analysis15m.signal) {
        finalAnalysis = createNoTradeResult(`4h Trend (${state.bias4h}) opposes 15m Setup (${state.analysis15m.signal})`);
      } else if (state.analysis15m.signal === 'NO TRADE') {
        finalAnalysis = state.analysis15m;
      } else if (!state.entry5m || !state.entry5m.isValid) {
        finalAnalysis = createNoTradeResult(`5m Entry Invalid: ${state.entry5m?.reason || 'Waiting for close'}`);
      } else {
        let combinedConfidence = state.analysis15m.confidence;
        if (state.bias4h === state.analysis15m.signal) {
          combinedConfidence += 15;
        }
        combinedConfidence = Math.min(99, combinedConfidence);
        
        finalAnalysis = { ...state.analysis15m, confidence: combinedConfidence };
        const sysLogicIdx = finalAnalysis.indicators.findIndex(i => i.name === 'System Logic');
        const alignmentDesc = `Top-Down Aligned: 4h Trend (${state.bias4h}) → 15m Setup (${state.analysis15m.signal}) → 5m Trigger (Valid).`;
        
        if (sysLogicIdx >= 0) {
          finalAnalysis.indicators[sysLogicIdx] = {
            ...finalAnalysis.indicators[sysLogicIdx],
            description: alignmentDesc
          };
        } else {
          finalAnalysis.indicators.push({
            name: 'System Logic',
            value: 'ALIGNED',
            signal: finalAnalysis.signal === 'LONG' ? 'bullish' : 'bearish',
            description: alignmentDesc
          });
        }
      }
      
      if (finalAnalysis.signal !== 'NO TRADE') {
        const currentEntry = finalAnalysis.suggestedEntry;
        const prevEntry = prevEntriesRef.current[symbol];
        
        let entryDirection: 'up' | 'down' | 'none' = 'none';
        if (currentEntry && prevEntry) {
          if (currentEntry > prevEntry) entryDirection = 'up';
          else if (currentEntry < prevEntry) entryDirection = 'down';
        }
        
        if (currentEntry) {
          prevEntriesRef.current[symbol] = currentEntry;
        }

        const data5m = klinesDataRef.current[symbol]?.['5m'];
        const lastPrice = data5m && data5m.length > 0 ? data5m[data5m.length - 1].close : 0;
        const lastCandleTime = data5m && data5m.length > 0 ? data5m[data5m.length - 1].time : 0;

        if (lastCandleTime > 0 && pushedSignalsRef.current[symbol] !== lastCandleTime && finalAnalysis.confidence >= 75) {
          pushedSignalsRef.current[symbol] = lastCandleTime;
          
          // Telegram alerts are now handled exclusively by the 24/7 backend server loop
          // to ensure TP/SL tracking and session alerts work even when the browser is closed.
        }

        newSignals.push({
          symbol,
          analysis: finalAnalysis,
          lastPrice,
          entryDirection
        });
      }
    }
    
    // Sort by confidence
    newSignals.sort((a, b) => b.analysis.confidence - a.analysis.confidence);
    setSignals(newSignals);
    setLastUpdate(new Date());
  };

  const toggleFreeze = (symbol: string, entry: number) => {
    setFrozenEntries(prev => {
      const newFrozen = { ...prev };
      if (newFrozen[symbol]) {
        delete newFrozen[symbol];
      } else {
        newFrozen[symbol] = entry;
      }
      return newFrozen;
    });
  };

  const updateTableRef = useRef(updateTable);
  const run4HBiasEngineRef = useRef(run4HBiasEngine);
  const run15MRankingEngineRef = useRef(run15MRankingEngine);
  const run5MEntryEngineRef = useRef(run5MEntryEngine);

  useEffect(() => {
    updateTableRef.current = updateTable;
    run4HBiasEngineRef.current = run4HBiasEngine;
    run15MRankingEngineRef.current = run15MRankingEngine;
    run5MEntryEngineRef.current = run5MEntryEngine;
  });

  useEffect(() => {
    let isMounted = true;
    
    const init = async () => {
      setLoading(true);
      setError(null);
      
      if (wsRefs.current.length > 0) {
        wsRefs.current.forEach(ws => ws.close());
        wsRefs.current = [];
      }

      try {
        const symbols = await fetchTopSymbols();
        if (!isMounted) return;

        setLoadingProgress({ current: 0, total: symbols.length });

        klinesDataRef.current = {};
        
        let processedCount = 0;
        
        // Helper for concurrent execution with limit
        const asyncPool = async <T,>(poolLimit: number, array: T[], iteratorFn: (item: T) => Promise<any>) => {
          const ret = [];
          const executing: Promise<any>[] = [];
          for (const item of array) {
            const p = Promise.resolve().then(() => iteratorFn(item));
            ret.push(p);
            if (poolLimit <= array.length) {
              const e: Promise<any> = p.then(() => executing.splice(executing.indexOf(e), 1));
              executing.push(e);
              if (executing.length >= poolLimit) {
                await Promise.race(executing);
              }
            }
          }
          return Promise.all(ret);
        };

        // Process symbols in chunks to update progress
        const chunkSize = 20;
        const chunks = [];
        for (let i = 0; i < symbols.length; i += chunkSize) {
          chunks.push(symbols.slice(i, i + chunkSize));
        }

        for (const chunk of chunks) {
          await asyncPool<string>(5, chunk, async (sym) => {
            klinesDataRef.current[sym] = {};
            try {
              // Fetch timeframes sequentially for each symbol to reduce burst
              for (const tf of TIMEFRAMES) {
                const klines = await fetchKlines(sym, tf);
                klinesDataRef.current[sym][tf] = klines;
              }
            } catch (e) {
              console.error(`Error fetching klines for ${sym}`, e);
            }
          });
          
          processedCount += chunk.length;
          if (isMounted) {
            setLoadingProgress({ current: processedCount, total: symbols.length });
          }

          // Small delay between chunks to respect rate limits
          // 20 symbols * 3 TFs = 60 requests * 2 weight = 120 weight
          // 120 weight / 3.5s = ~34 weight/s = ~2050 weight/min (safe margin below 2400 limit)
          await new Promise(resolve => setTimeout(resolve, 3500));
        }

        if (!isMounted) return;
        
        // Initial run of the pipeline
        run4HBiasEngineRef.current();
        run15MRankingEngineRef.current();
        Object.keys(klinesDataRef.current).forEach(sym => run5MEntryEngineRef.current(sym));
        updateTableRef.current();
        
        setLoading(false);

        // Setup WS
        const allStreams = symbols.flatMap(s => TIMEFRAMES.map(tf => `${s.toLowerCase()}@kline_${tf}`));
        
        // Binance allows max 1024 streams per connection. We'll use 900 per connection to be safe.
        const streamsPerConnection = 900;
        
        for (let i = 0; i < allStreams.length; i += streamsPerConnection) {
          const connectionStreams = allStreams.slice(i, i + streamsPerConnection);
          
          const connectWs = () => {
            const ws = new WebSocket(`wss://fstream.binance.com/ws`);
            wsRefs.current.push(ws);

            ws.onopen = () => {
              // Binance allows max 200 streams per SUBSCRIBE request
              for (let j = 0; j < connectionStreams.length; j += 200) {
                const chunk = connectionStreams.slice(j, j + 200);
                ws.send(JSON.stringify({
                  method: "SUBSCRIBE",
                  params: chunk,
                  id: j + 1
                }));
              }
            };

            ws.onclose = () => {
              if (isMounted) {
                // Remove the closed ws from refs
                wsRefs.current = wsRefs.current.filter(ref => ref !== ws);
                // Reconnect after 5 seconds
                setTimeout(() => {
                  if (isMounted) connectWs();
                }, 5000);
              }
            };

            ws.onerror = (error) => {
              console.error('WebSocket error in TopTradesTable:', error);
            };

            ws.onmessage = (event) => {
              const message = JSON.parse(event.data);
              const klineData = message.e === 'kline' ? message : (message.data && message.data.e === 'kline' ? message.data : null);
              
              if (klineData) {
                const kline = klineData.k;
                const symbol = klineData.s;
                const interval = kline.i;
                
                if (klinesDataRef.current[symbol] && klinesDataRef.current[symbol][interval]) {
                  const data = klinesDataRef.current[symbol][interval];
                  const candle: Candle = {
                    time: Math.floor(kline.t / 1000),
                    open: parseFloat(kline.o),
                    high: parseFloat(kline.h),
                    low: parseFloat(kline.l),
                    close: parseFloat(kline.c),
                    volume: parseFloat(kline.v),
                    isFinal: kline.x
                  };

                  const lastCandle = data[data.length - 1];
                  if (lastCandle && lastCandle.time === Math.floor(kline.t / 1000)) {
                    data[data.length - 1] = candle;
                  } else {
                    data.push(candle);
                    if (data.length > 250) data.shift();
                  }

                  // 5M Entry Engine Trigger
                  if (interval === '5m' && kline.x) {
                    run5MEntryEngineRef.current(symbol);
                    updateTableRef.current();
                  }
                }
              }
            };
          };

          connectWs();
        }
      } catch (e: any) {
        console.error('Init error', e);
        if (isMounted) {
          setError(e.message || 'Failed to initialize market scan');
          setLoading(false);
        }
      }
    };

    init();

    const timer4h = window.setInterval(() => {
      run4HBiasEngineRef.current();
      updateTableRef.current();
    }, 10 * 60 * 1000); // 10 minutes

    const timer15m = window.setInterval(() => {
      run15MRankingEngineRef.current();
      updateTableRef.current();
    }, 60 * 1000); // 1 minute

    const timerTable = window.setInterval(() => {
      updateTableRef.current();
    }, 2000); // Update table every 2 seconds for price updates

    return () => {
      isMounted = false;
      window.clearInterval(timer4h);
      window.clearInterval(timer15m);
      window.clearInterval(timerTable);
      wsRefs.current.forEach(ws => ws.close());
    };
  }, []);

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 85) return 'text-emerald-400 group-hover:text-emerald-600';
    if (confidence >= 70) return 'text-yellow-400 group-hover:text-yellow-600';
    return 'text-white/60 group-hover:text-black/60';
  };

  const getScoreColor = (score: number | undefined) => {
    if (score === undefined) return 'text-white/40 group-hover:text-black/40';
    if (score > 0.5) return 'text-emerald-400 group-hover:text-emerald-600';
    if (score < -0.5) return 'text-rose-400 group-hover:text-rose-600';
    if (score > 0) return 'text-emerald-400/60 group-hover:text-emerald-600/60';
    if (score < 0) return 'text-rose-400/60 group-hover:text-rose-600/60';
    return 'text-white/40 group-hover:text-black/40';
  };

  const filteredSignals = signals.filter(signal => {
    // 1% TP check
    if (signal.analysis.tp && signal.analysis.suggestedEntry) {
      const tpDistance = Math.abs(signal.analysis.tp - signal.analysis.suggestedEntry) / signal.analysis.suggestedEntry;
      if (tpDistance < 0.01) return false;
    }
    
    return true;
  });
  
  const displaySignals = filteredSignals;

  return (
    <section className="w-full rounded-2xl border border-white/10 bg-[#050505] overflow-hidden shadow-2xl mb-8 relative">
      {/* Subtle gradient background for the section */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
      
      <div className="p-5 border-b border-white/10 bg-black/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
            <Activity size={16} className="text-emerald-400" />
          </div>
          <h2 className="text-xs font-mono font-bold text-white uppercase tracking-widest">High Probability Signals <span className="text-white/40 font-normal">(Multi-TF Aligned)</span></h2>
        </div>
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="text-[10px] font-mono text-white/40 flex items-center gap-1">
            <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
            {loading ? `Scanning Market... ${loadingProgress.total > 0 ? `(${loadingProgress.current}/${loadingProgress.total})` : ''}` : `Updated: ${lastUpdate.toLocaleTimeString()}`}
          </div>
        </div>
      </div>
      
      <div className="p-0 overflow-x-auto no-scrollbar">
        {error && (
          <div className="p-4 bg-rose-500/10 border-b border-rose-500/20 text-rose-400 text-xs font-mono flex items-center gap-2">
            <AlertTriangle size={14} />
            <span>{error}. Using fallback symbols.</span>
          </div>
        )}
        <div className="min-w-[1000px]">
          {/* Header */}
          <div className="grid grid-cols-[100px_100px_150px_1fr_1fr_1fr_1fr_150px_120px_120px] gap-4 p-4 border-y border-white/20 bg-[#111] text-[10px] font-mono text-white/50 uppercase tracking-widest sticky top-0 z-10 shadow-md">
            <div className="flex items-center">Symbol</div>
            <div className="flex items-center">Signal</div>
            <div className="flex items-center">Confidence</div>
            <div className="text-center flex items-center justify-center">Market</div>
            <div className="text-center flex items-center justify-center">Trend</div>
            <div className="text-center flex items-center justify-center">Timing</div>
            <div className="text-center flex items-center justify-center">Volume</div>
            <div className="text-right flex items-center justify-end">Target Entry</div>
            <div className="text-right flex items-center justify-end">Current</div>
            <div className="text-right flex items-center justify-end">TP / SL</div>
          </div>
          
          {/* Body */}
          <div className="font-mono text-sm">
            {loading && displaySignals.length === 0 ? (
              <div className="p-8 text-center text-white/40 text-xs flex flex-col items-center justify-center gap-2">
                <RefreshCw size={24} className="animate-spin text-emerald-500/50" />
                <span>Analyzing all USDT Futures pairs... {loadingProgress.total > 0 ? `(${loadingProgress.current}/${loadingProgress.total})` : ''}</span>
              </div>
            ) : displaySignals.length === 0 ? (
              <div className="p-8 text-center text-white/40 text-xs">No active signals found.</div>
            ) : (
              displaySignals.map((s) => (
                <div key={s.symbol} className="grid grid-cols-[100px_100px_150px_1fr_1fr_1fr_1fr_150px_120px_120px] gap-4 p-4 border-b border-white/5 hover:bg-white hover:text-black transition-all duration-200 group items-center cursor-pointer">
                  <div className="font-bold text-white group-hover:text-black">{s.symbol}</div>
                  <div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${
                      s.analysis.signal === 'LONG' ? "bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500 group-hover:text-white" : 
                      s.analysis.signal === 'SHORT' ? "bg-rose-500/10 text-rose-400 group-hover:bg-rose-500 group-hover:text-white" : 
                      "bg-white/5 text-white/40 group-hover:bg-black/10 group-hover:text-black"
                    }`}>
                      {s.analysis.signal}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`font-bold ${getConfidenceColor(s.analysis.confidence)}`}>
                        {s.analysis.confidence.toFixed(1)}%
                      </span>
                      <div className="w-16 h-1.5 bg-white/5 group-hover:bg-black/10 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${s.analysis.confidence >= 85 ? 'bg-emerald-500' : s.analysis.confidence >= 70 ? 'bg-yellow-500' : 'bg-white/20 group-hover:bg-black/20'}`}
                          style={{ width: `${s.analysis.confidence}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className={`text-center ${getScoreColor(s.analysis.layers?.marketCondition)}`}>
                    {s.analysis.layers?.marketCondition !== undefined ? s.analysis.layers.marketCondition.toFixed(2) : '-'}
                  </div>
                  <div className={`text-center ${getScoreColor(s.analysis.layers?.trend)}`}>
                    {s.analysis.layers?.trend !== undefined ? s.analysis.layers.trend.toFixed(2) : '-'}
                  </div>
                  <div className={`text-center ${getScoreColor(s.analysis.layers?.entry)}`}>
                    {s.analysis.layers?.entry !== undefined ? s.analysis.layers.entry.toFixed(2) : '-'}
                  </div>
                  <div className={`text-center ${getScoreColor(s.analysis.layers?.confirmation)}`}>
                    {s.analysis.layers?.confirmation !== undefined ? s.analysis.layers.confirmation.toFixed(2) : '-'}
                  </div>
                  <div className="text-right">
                    {s.analysis.signal !== 'NO TRADE' && (frozenEntries[s.symbol] || s.analysis.suggestedEntry) ? (
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center justify-end gap-2">
                          {frozenEntries[s.symbol] ? (
                            <Lock 
                              size={12} 
                              className="text-emerald-400 cursor-pointer" 
                              onClick={(e) => { e.stopPropagation(); toggleFreeze(s.symbol, s.analysis.suggestedEntry!); }}
                            />
                          ) : (
                            <Unlock 
                              size={12} 
                              className="text-white/20 group-hover:text-black/40 hover:!text-emerald-500 cursor-pointer transition-colors" 
                              onClick={(e) => { e.stopPropagation(); toggleFreeze(s.symbol, s.analysis.suggestedEntry!); }}
                            />
                          )}
                          <div className="flex items-center gap-1">
                            <span className={frozenEntries[s.symbol] ? "text-emerald-400 font-bold" : "text-white group-hover:text-black"} title="CMP Entry">
                              {formatPrice(frozenEntries[s.symbol] || s.analysis.suggestedEntry || 0)}
                            </span>
                            {!frozenEntries[s.symbol] && s.entryDirection === 'up' && <ArrowUp size={12} className="text-emerald-400" />}
                            {!frozenEntries[s.symbol] && s.entryDirection === 'down' && <ArrowDown size={12} className="text-rose-400" />}
                            {!frozenEntries[s.symbol] && s.entryDirection === 'none' && <span className="w-3" />}
                          </div>
                        </div>
                        {s.analysis.limitEntry && !frozenEntries[s.symbol] && (
                          <div className="text-[10px] text-yellow-400/80 group-hover:text-yellow-600/80" title="Limit (Pullback) Entry">
                            L: {formatPrice(s.analysis.limitEntry)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-white/20 group-hover:text-black/20">-</span>
                    )}
                  </div>
                  <div className="text-right text-white/80 group-hover:text-black/80">{formatPrice(s.lastPrice)}</div>
                  <div className="text-right">
                    {s.analysis.signal !== 'NO TRADE' && s.analysis.tp && s.analysis.sl ? (
                      <div className="flex flex-col items-end text-[10px]">
                        <span className="text-emerald-400 group-hover:text-emerald-600">{s.analysis.tp !== undefined ? formatPrice(s.analysis.tp) : '-'}</span>
                        <span className="text-rose-400 group-hover:text-rose-600">{s.analysis.sl !== undefined ? formatPrice(s.analysis.sl) : '-'}</span>
                      </div>
                    ) : (
                      <span className="text-white/20 group-hover:text-black/20">-</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
