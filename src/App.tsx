import React, { useState, useCallback, useEffect, useRef } from 'react';
import { 
  Activity, ShieldCheck, AlertTriangle, Info, TrendingUp, TrendingDown, Minus,
  Search, ActivitySquare, Clock, Target, Crosshair, LayoutGrid, Square
} from 'lucide-react';
import { AdvancedRealTimeChart } from "react-ts-tradingview-widgets";
import { analyzeChart } from './analysis';
import { Candle, AnalysisResult } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const mapIntervalToTV = (inv: string) => {
  const map: Record<string, string> = {
    '1m': '1',
    '5m': '5',
    '15m': '15',
    '1h': '60',
    '4h': '240',
    '1d': 'D'
  };
  return map[inv] || '15';
};

export default function App() {
  const [data, setData] = useState<Candle[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [multiAnalysis, setMultiAnalysis] = useState<Record<string, AnalysisResult>>({});
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState('15m');
  const [analysisTf, setAnalysisTf] = useState('15m');
  const [searchInput, setSearchInput] = useState('BTCUSDT');
  const [isConnected, setIsConnected] = useState(false);
  const [layout, setLayout] = useState<'single' | 'multi'>('single');
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];

  const fetchData = async (targetSymbol: string, targetInterval: string) => {
    try {
      setError(null);
      const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${targetSymbol.toUpperCase()}&interval=${targetInterval}&limit=300`);
      if (!response.ok) {
        throw new Error('Failed to fetch data from Binance');
      }
      const data = await response.json();
      const candles: Candle[] = data.map((k: any) => ({
        time: new Date(k[0]).toISOString(),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }));
      setData(candles);
      connectWebSocket(targetSymbol.toUpperCase(), targetInterval);
    } catch (error: any) {
      console.error('Error fetching data:', error);
      setError(error.message || 'Failed to fetch data');
    }
  };

  const fetchMultiTimeframeData = async (targetSymbol: string) => {
    const tfs = ['5m', '15m', '1h', '4h'];
    const results: Record<string, AnalysisResult> = {};
    
    await Promise.all(tfs.map(async (tf) => {
      try {
        const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${targetSymbol.toUpperCase()}&interval=${tf}&limit=300`);
        if (response.ok) {
          const data = await response.json();
          const candles: Candle[] = data.map((k: any) => ({
            time: new Date(k[0]).toISOString(),
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
          }));
          results[tf] = analyzeChart(candles);
        }
      } catch (e) {
        console.error(`Failed to fetch ${tf}`, e);
      }
    }));
    
    setMultiAnalysis(results);
  };

  useEffect(() => {
    fetchData(symbol, interval);
    fetchMultiTimeframeData(symbol);
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [symbol, interval]);

  useEffect(() => {
    if (data.length > 0) {
      setAnalysis(analyzeChart(data));
    }
  }, [data]);

  useEffect(() => {
    if (['5m', '15m', '1h', '4h'].includes(interval)) {
      setAnalysisTf(interval);
    }
  }, [interval]);

  const activeAnalysis = analysisTf === interval ? analysis : (multiAnalysis[analysisTf] || analysis);

  const connectWebSocket = useCallback((targetSymbol: string, targetInterval: string) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const wsUrl = `wss://stream.binance.com:9443/ws/${targetSymbol.toLowerCase()}@kline_${targetInterval}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.k) {
          const k = message.k;
          const newCandle: Candle = {
            time: new Date(k.t).toISOString(),
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v)
          };
          
          setData(prevData => {
            if (prevData.length === 0) return [newCandle];
            const lastCandle = prevData[prevData.length - 1];
            if (lastCandle.time === newCandle.time) {
              return [...prevData.slice(0, -1), newCandle];
            } else {
              return [...prevData, newCandle].slice(-300);
            }
          });
        }
      } catch (e) {
        console.error("Error parsing Binance message:", e);
      }
    };

    ws.onclose = () => setIsConnected(false);
    ws.onerror = () => setIsConnected(false);
  }, []);

  return (
    <div className="h-screen w-screen bg-[#050505] text-white/90 font-sans overflow-hidden flex flex-col selection:bg-emerald-500/30">
      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-white/10 bg-[#0A0A0A] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-emerald-500">
            <ActivitySquare size={20} />
            <span className="font-bold tracking-widest uppercase text-sm text-white">Nexus<span className="text-emerald-500">Trade</span></span>
          </div>

          <div className="h-4 w-px bg-white/10" />

          {/* Symbol Search */}
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              let newSymbol = searchInput.toUpperCase().trim();
              if (newSymbol) {
                // Auto-append USDT if the user just typed the base asset
                if (!newSymbol.endsWith('USDT') && !newSymbol.endsWith('BTC') && !newSymbol.endsWith('ETH') && !newSymbol.endsWith('BNB') && !newSymbol.endsWith('USDC') && !newSymbol.endsWith('FDUSD')) {
                  newSymbol += 'USDT';
                }
                setSymbol(newSymbol);
                setSearchInput(newSymbol);
              }
            }}
            className="flex items-center gap-2 relative"
          >
            <div className="relative flex items-center">
              <Search size={14} className="absolute left-3 text-white/40" />
              <input 
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className={cn(
                  "bg-white/5 border rounded-md pl-9 pr-4 py-1.5 text-xs font-mono text-white placeholder:text-white/30 focus:outline-none focus:bg-white/10 transition-all w-32 uppercase",
                  error ? "border-rose-500/50 focus:border-rose-500" : "border-white/10 focus:border-emerald-500/50"
                )}
                placeholder="SYMBOL"
              />
            </div>
            <button 
              type="submit"
              className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/20 rounded-md px-3 py-1.5 text-xs font-mono font-bold uppercase transition-colors"
            >
              Search
            </button>
            {error && (
              <div className="absolute top-full left-0 mt-1 text-[10px] text-rose-400 font-mono whitespace-nowrap bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20 z-50">
                {error}
              </div>
            )}
          </form>

          {/* Timeframes */}
          <div className="flex items-center gap-1 bg-white/5 p-1 rounded-md border border-white/10">
            {timeframes.map((tf) => (
              <button
                key={tf}
                onClick={() => setInterval(tf)}
                className={cn(
                  "px-3 py-1 rounded text-[10px] font-mono font-bold uppercase transition-all",
                  interval === tf 
                    ? "bg-white/10 text-emerald-400" 
                    : "text-white/40 hover:text-white/80 hover:bg-white/5"
                )}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-white/10 mx-2" />

          {/* Layout Toggle */}
          <div className="flex items-center gap-1 bg-white/5 p-1 rounded-md border border-white/10">
            <button
              onClick={() => setLayout('single')}
              className={cn(
                "p-1.5 rounded transition-all",
                layout === 'single' ? "bg-white/10 text-emerald-400" : "text-white/40 hover:text-white/80 hover:bg-white/5"
              )}
              title="Single Timeframe"
            >
              <Square size={14} />
            </button>
            <button
              onClick={() => setLayout('multi')}
              className={cn(
                "p-1.5 rounded transition-all",
                layout === 'multi' ? "bg-white/10 text-emerald-400" : "text-white/40 hover:text-white/80 hover:bg-white/5"
              )}
              title="Multiple Timeframes"
            >
              <LayoutGrid size={14} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {/* Current Price Ticker */}
          {data.length > 0 && (
            <div className="flex items-center gap-3 font-mono">
              <span className="text-xs text-white/40">LAST</span>
              <span className={cn(
                "text-sm font-bold",
                data[data.length - 1].close >= data[data.length - 1].open ? "text-emerald-400" : "text-rose-400"
              )}>
                {data[data.length - 1].close.toFixed(2)}
              </span>
            </div>
          )}
          
          <div className="h-4 w-px bg-white/10" />
          
          <div className="flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full", isConnected ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : "bg-rose-500")} />
            <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
              {isConnected ? 'Connected' : 'Offline'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Grid */}
      <main className="flex-1 overflow-y-auto custom-scrollbar bg-[#050505]">
        <div className="max-w-[1600px] mx-auto p-4 flex flex-col gap-4">
          
          {/* Top Panel: Chart */}
          <section className="w-full h-[60vh] min-h-[500px] rounded-xl border border-white/10 bg-[#0A0A0A] overflow-hidden relative shadow-2xl">
            {layout === 'single' ? (
              <div className="w-full h-full">
                <AdvancedRealTimeChart
                  key={`${symbol}-${interval}-single`}
                  symbol={`BINANCE:${symbol}`}
                  interval={mapIntervalToTV(interval) as any}
                  theme="dark"
                  autosize
                  allow_symbol_change={false}
                  save_image={false}
                  backgroundColor="#0A0A0A"
                  gridLineColor="rgba(255,255,255,0.05)"
                  hide_top_toolbar={true}
                  hide_legend={false}
                  style="1"
                />
              </div>
            ) : (
              <div className="w-full h-full grid grid-cols-2 grid-rows-2 gap-px bg-white/10">
                {['5m', '15m', '1h', '4h'].map((tf) => (
                  <div 
                    key={`${symbol}-${tf}-multi`} 
                    className={cn(
                      "w-full h-full bg-[#0A0A0A] relative transition-all",
                      interval === tf ? "ring-2 ring-inset ring-emerald-500 z-10" : ""
                    )}
                  >
                    <button 
                      onClick={() => setInterval(tf)}
                      className={cn(
                        "absolute top-2 left-2 z-20 backdrop-blur px-3 py-1.5 rounded text-xs font-mono font-bold border transition-colors cursor-pointer shadow-lg",
                        interval === tf
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/50"
                          : "bg-black/80 text-white/80 border-white/20 hover:bg-white/20 hover:text-white"
                      )}
                    >
                      {tf}
                    </button>
                    <AdvancedRealTimeChart
                      symbol={`BINANCE:${symbol}`}
                      interval={mapIntervalToTV(tf) as any}
                      theme="dark"
                      autosize
                      allow_symbol_change={false}
                      save_image={false}
                      backgroundColor="#0A0A0A"
                      gridLineColor="rgba(255,255,255,0.05)"
                      hide_top_toolbar={true}
                      hide_legend={false}
                      style="1"
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Middle Panel: Neural Matrix */}
          <section className="w-full rounded-xl border border-white/10 bg-[#0A0A0A] overflow-hidden shadow-xl">
            <div className="p-4 border-b border-white/10 bg-white/[0.02] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <h2 className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                  Neural Matrix <span className="text-emerald-400 ml-1">[{analysisTf}]</span>
                </h2>
                <div className="h-4 w-px bg-white/10" />
                <div className="flex items-center gap-2">
                  {['5m', '15m', '1h', '4h'].map(tf => {
                    const res = multiAnalysis[tf];
                    if (!res) return null;
                    return (
                      <button 
                        key={tf} 
                        onClick={() => setAnalysisTf(tf)}
                        className={cn(
                          "flex items-center gap-1.5 border rounded px-2 py-0.5 transition-colors cursor-pointer",
                          analysisTf === tf ? "border-white/30 bg-white/10" : "border-white/10 bg-white/5 hover:bg-white/10"
                        )} 
                        title={`${tf} Signal: ${res.signal}`}
                      >
                        <span className={cn("text-[9px] font-mono", analysisTf === tf ? "text-white" : "text-white/40")}>{tf}</span>
                        <div className={cn(
                          "w-1.5 h-1.5 rounded-full", 
                          res.signal === 'LONG' ? 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]' : 
                          res.signal === 'SHORT' ? 'bg-rose-500 shadow-[0_0_5px_rgba(244,63,94,0.5)]' : 
                          'bg-yellow-500 shadow-[0_0_5px_rgba(234,179,8,0.5)]'
                        )} />
                      </button>
                    )
                  })}
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                {activeAnalysis?.signal !== 'NO TRADE' && activeAnalysis?.tp && activeAnalysis?.sl && (
                  <div className="flex items-center gap-3 mr-4 border-r border-white/10 pr-4">
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] font-mono text-emerald-400/70 uppercase tracking-widest">Target (TP)</span>
                      <span className="text-sm font-mono font-bold text-emerald-400">{activeAnalysis.tp.toFixed(2)}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] font-mono text-rose-400/70 uppercase tracking-widest">Stop (SL)</span>
                      <span className="text-sm font-mono font-bold text-rose-400">{activeAnalysis.sl.toFixed(2)}</span>
                    </div>
                  </div>
                )}
                <div className="text-2xl font-bold font-mono text-white">
                  {typeof activeAnalysis?.confidence === 'number' && !isNaN(activeAnalysis.confidence) ? activeAnalysis.confidence.toFixed(0) : '0'}%
                </div>
                <div className={cn(
                  "px-3 py-1 rounded text-xs font-mono font-bold uppercase tracking-wider border",
                  activeAnalysis?.signal === 'LONG' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                  activeAnalysis?.signal === 'SHORT' ? "bg-rose-500/10 text-rose-400 border-rose-500/20" : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                )}>
                  {activeAnalysis?.signal || 'WAIT'}
                </div>
              </div>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Supporting */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-emerald-400 border-b border-white/5 pb-2">
                  <ShieldCheck size={16} />
                  <span className="text-xs font-mono uppercase tracking-widest">Supporting</span>
                  <span className="ml-auto text-[10px] font-mono bg-emerald-500/20 px-2 py-0.5 rounded">{activeAnalysis?.confluences.supporting.length || 0}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {activeAnalysis?.confluences.supporting.map(name => (
                    <div key={name} className="flex items-center gap-3 text-sm font-mono text-white/80 bg-white/5 px-3 py-2 rounded-lg border border-white/5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      {name}
                    </div>
                  ))}
                </div>
              </div>

              {/* Opposing */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-rose-400 border-b border-white/5 pb-2">
                  <AlertTriangle size={16} />
                  <span className="text-xs font-mono uppercase tracking-widest">Opposing</span>
                  <span className="ml-auto text-[10px] font-mono bg-rose-500/20 px-2 py-0.5 rounded">{activeAnalysis?.confluences.opposing.length || 0}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {activeAnalysis?.confluences.opposing.map(name => (
                    <div key={name} className="flex items-center gap-3 text-sm font-mono text-white/80 bg-white/5 px-3 py-2 rounded-lg border border-white/5">
                      <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                      {name}
                    </div>
                  ))}
                </div>
              </div>

              {/* Neutral */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-yellow-400 border-b border-white/5 pb-2">
                  <Info size={16} />
                  <span className="text-xs font-mono uppercase tracking-widest">Neutral</span>
                  <span className="ml-auto text-[10px] font-mono bg-yellow-500/20 px-2 py-0.5 rounded">{activeAnalysis?.confluences.neutral.length || 0}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {activeAnalysis?.confluences.neutral.map(name => (
                    <div key={name} className="flex items-center gap-3 text-sm font-mono text-white/80 bg-white/5 px-3 py-2 rounded-lg border border-white/5">
                      <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                      {name}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Bottom Panel: Indicators */}
          <section className="w-full rounded-xl border border-white/10 bg-[#0A0A0A] overflow-hidden shadow-xl mb-8">
            <div className="p-4 border-b border-white/10 bg-white/[0.02]">
              <h2 className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Technical Indicators</h2>
            </div>
            <div className="p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {activeAnalysis?.indicators.map(indicator => (
                <div key={indicator.name} className="bg-white/5 border border-white/5 p-4 rounded-lg hover:border-white/20 transition-colors group">
                  <div className="text-xs font-mono text-white/50 uppercase tracking-wider mb-2 group-hover:text-white/80 transition-colors truncate">
                    {indicator.name}
                  </div>
                  <div className="flex items-end justify-between">
                    <div className="text-base font-mono font-bold text-white truncate pr-2">
                      {indicator.value}
                    </div>
                    {indicator.signal === 'bullish' ? (
                      <TrendingUp size={16} className="text-emerald-400 shrink-0" />
                    ) : indicator.signal === 'bearish' ? (
                      <TrendingDown size={16} className="text-rose-400 shrink-0" />
                    ) : (
                      <Minus size={16} className="text-yellow-400 shrink-0" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

