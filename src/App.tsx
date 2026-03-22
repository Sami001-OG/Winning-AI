import React, { useState, useCallback, useEffect, useRef, memo } from 'react';
import { 
  Activity, ShieldCheck, AlertTriangle, Info, TrendingUp, TrendingDown, Minus,
  Search, ActivitySquare, Clock, Target, Crosshair, LayoutGrid, Square, X
} from 'lucide-react';
import { fetchWithRetry } from './utils/api';
import { LightweightChart } from './LightweightChart';
import { TopTradesTable } from './components/TopTradesTable';
import { analyzeChart } from './analysis';
import { Candle, AnalysisResult, Trade } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function AnimatedNumber({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    let startTimestamp: number | null = null;
    const duration = 500;
    const startValue = displayValue;
    const endValue = value;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 4);
      setDisplayValue(startValue + (endValue - startValue) * ease);
      
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };
    
    window.requestAnimationFrame(step);
  }, [value]);

  return <>{(displayValue || 0).toFixed(0)}</>;
}

const MemoizedChart = memo(({ symbol, interval, activeTrade }: { symbol: string, interval: string, activeTrade?: Trade }) => {
  return <LightweightChart symbol={symbol} interval={interval} activeTrade={activeTrade} />;
}, (prevProps, nextProps) => {
  return prevProps.symbol === nextProps.symbol && 
         prevProps.interval === nextProps.interval &&
         prevProps.activeTrade?.id === nextProps.activeTrade?.id &&
         prevProps.activeTrade?.status === nextProps.activeTrade?.status;
});

const DEFAULT_RELIABILITY = { ema: 1.5, macd: 0.2, rsi: 1.5, vol: 1.2, obv: 1.2 };

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
  const [trades, setTrades] = useState<Trade[]>(() => {
    const saved = localStorage.getItem('demo_trades');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return [];
      }
    }
    return [];
  });
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    localStorage.setItem('demo_trades', JSON.stringify(trades));
  }, [trades]);

  const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];

  const fetchData = async (targetSymbol: string, targetInterval: string) => {
    try {
      setError(null);
      setData([]); // Clear old data immediately
      setAnalysis(null); // Clear old analysis
      const response = await fetchWithRetry(`https://api.binance.com/api/v3/klines?symbol=${targetSymbol.toUpperCase()}&interval=${targetInterval}&limit=300`);
      if (!response.ok) {
        throw new Error('Failed to fetch data from Binance');
      }
      const data = await response.json();
      const candles: Candle[] = data.map((k: any) => ({
        time: Math.floor(k[0] / 1000),
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
    setMultiAnalysis({}); // Clear old multi-timeframe analysis immediately
    const tfs = ['5m', '15m', '1h', '4h'];
    const results: Record<string, AnalysisResult> = {};
    
    await Promise.all(tfs.map(async (tf) => {
      try {
        const response = await fetchWithRetry(`https://api.binance.com/api/v3/klines?symbol=${targetSymbol.toUpperCase()}&interval=${tf}&limit=300`);
        if (response.ok) {
          const data = await response.json();
          const candles: Candle[] = data.map((k: any) => ({
            time: Math.floor(k[0] / 1000),
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
          }));
          results[tf] = analyzeChart(candles, DEFAULT_RELIABILITY, trades, symbol);
        }
      } catch (e) {
        console.error(`Failed to fetch ${tf}`, e);
      }
    }));
    
    setMultiAnalysis(results);
  };

  useEffect(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    fetchData(symbol, interval);
    fetchMultiTimeframeData(symbol);
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [symbol, interval]);

  useEffect(() => {
    if (data.length > 0) {
      setAnalysis(analyzeChart(data, DEFAULT_RELIABILITY, trades, symbol));
    }
  }, [data, trades, symbol]);

  useEffect(() => {
    if (['5m', '15m', '1h', '4h'].includes(interval)) {
      setAnalysisTf(interval);
    }
  }, [interval]);

  useEffect(() => {
    if (data.length === 0) return;
    
    setTrades(prevTrades => {
      let changed = false;
      const newTrades = prevTrades.map(trade => {
        if (trade.status !== 'PENDING') return trade;
        if (trade.symbol !== symbol) return trade;

        let newStatus = trade.status;
        
        for (let i = 0; i < data.length; i++) {
          const candle = data[i];
          const candleTime = candle.time * 1000;
          
          if (candleTime > trade.timestamp) {
            if (trade.type === 'LONG') {
              if (candle.high >= trade.tp) { newStatus = 'SUCCESS'; break; }
              if (candle.low <= trade.sl) { newStatus = 'FAILED'; break; }
            } else {
              if (candle.low <= trade.tp) { newStatus = 'SUCCESS'; break; }
              if (candle.high >= trade.sl) { newStatus = 'FAILED'; break; }
            }
          } else if (candleTime <= trade.timestamp && (i === data.length - 1 || data[i+1].time * 1000 > trade.timestamp)) {
            if (trade.type === 'LONG') {
              if (candle.close >= trade.tp) { newStatus = 'SUCCESS'; break; }
              if (candle.close <= trade.sl) { newStatus = 'FAILED'; break; }
            } else {
              if (candle.close <= trade.tp) { newStatus = 'SUCCESS'; break; }
              if (candle.close >= trade.sl) { newStatus = 'FAILED'; break; }
            }
          }
        }
        
        if (newStatus !== trade.status) changed = true;
        return { ...trade, status: newStatus };
      });
      return changed ? newTrades : prevTrades;
    });
  }, [data, symbol]);

  const activeAnalysis = analysisTf === interval ? analysis : (multiAnalysis[analysisTf] || analysis);
  const activeTrade = trades.find(t => t.symbol === symbol && t.status === 'PENDING');

  const executeTrade = () => {
    if (!activeAnalysis || activeAnalysis.signal === 'NO TRADE' || !activeAnalysis.tp || !activeAnalysis.sl) return;
    if (data.length === 0) return;
    
    const currentPrice = data[data.length - 1].close;
    
    const newTrade: Trade = {
      id: Math.random().toString(36).substr(2, 9),
      symbol: symbol,
      type: activeAnalysis.signal,
      entry: currentPrice,
      tp: activeAnalysis.tp,
      sl: activeAnalysis.sl,
      status: 'PENDING',
      timestamp: Date.now()
    };

    setTrades(prev => [newTrade, ...prev].slice(0, 100));
    setShowConfirmDialog(false);
  };

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
            time: Math.floor(k.t / 1000),
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

  const testTelegram = async () => {
    try {
      const response = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: import.meta.env.VITE_TELEGRAM_BOT_TOKEN,
          chatId: import.meta.env.VITE_TELEGRAM_CHAT_ID,
          message: `<b>TEST MESSAGE</b>\n\nEndellion Trade Telegram integration is working perfectly! 🚀\n\nTime: ${new Date().toISOString()}`
        })
      });
      
      if (response.ok) {
        alert('Telegram test message sent successfully!');
      } else {
        const err = await response.text();
        alert(`Failed to send Telegram message: ${err}`);
      }
    } catch (err) {
      alert(`Error sending Telegram message: ${err}`);
    }
  };

  return (
    <div className="h-screen w-screen bg-[#050505] text-white/90 font-sans overflow-hidden flex flex-col selection:bg-emerald-500/30">
      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-white/10 bg-[#0A0A0A] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-emerald-500">
            <ActivitySquare size={20} />
            <span className="font-bold tracking-widest uppercase text-sm text-white">ENDELLION<span className="text-emerald-500">-TRADE</span></span>
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
          
          <button
            onClick={testTelegram}
            className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded-md px-3 py-1.5 text-xs font-mono font-bold uppercase transition-colors flex items-center gap-1"
          >
            Test Telegram
          </button>
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
                {(data[data.length - 1].close || 0).toFixed(2)}
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
              <div className="w-full h-full relative">
                <div className="absolute top-4 left-4 z-20 flex items-center gap-1 bg-black/80 backdrop-blur border border-white/10 p-1 rounded-lg shadow-xl">
                  {['1m', '5m', '15m', '1h', '4h', '1d'].map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setInterval(tf)}
                      className={cn(
                        "px-3 py-1.5 rounded text-xs font-mono font-bold transition-colors cursor-pointer",
                        interval === tf
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "text-white/60 hover:text-white hover:bg-white/10"
                      )}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
                <MemoizedChart key={`${symbol}-${interval}`} symbol={symbol} interval={interval} activeTrade={activeTrade} />
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
                    <MemoizedChart key={`${symbol}-${tf}`} symbol={symbol} interval={tf} activeTrade={activeTrade} />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Middle Panel: ENDELLION-TRADE */}
          <section className="w-full rounded-xl border border-white/10 bg-[#0A0A0A] overflow-hidden shadow-xl">
            <div className="p-4 border-b border-white/10 bg-white/[0.02] flex flex-col xl:flex-row xl:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                <h2 className="text-[10px] font-mono text-white/40 uppercase tracking-widest flex items-center gap-2">
                  ENDELLION-TRADE <span className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">[{analysisTf}]</span>
                </h2>
                <div className="hidden sm:block h-4 w-px bg-white/10" />
                <div className="flex items-center gap-1.5">
                  {['5m', '15m', '1h', '4h'].map(tf => {
                    const res = multiAnalysis[tf];
                    if (!res) return null;
                    return (
                      <button 
                        key={tf} 
                        onClick={() => setAnalysisTf(tf)}
                        className={cn(
                          "flex items-center gap-1.5 border rounded px-2 py-1 transition-colors cursor-pointer",
                          analysisTf === tf ? "border-white/30 bg-white/10 shadow-sm" : "border-white/5 bg-white/[0.02] hover:bg-white/5"
                        )} 
                        title={`${tf} Signal: ${res.signal}`}
                      >
                        <span className={cn("text-[9px] font-mono", analysisTf === tf ? "text-white font-bold" : "text-white/40")}>{tf}</span>
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
              
              <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                {activeTrade && activeTrade.tp && activeTrade.sl && (
                  <div className="flex items-center gap-3 sm:gap-4 border-r border-white/10 pr-3 sm:pr-4">
                    <div className="flex flex-col items-end">
                      <span className="text-[9px] font-mono text-emerald-400/50 uppercase tracking-widest">Target</span>
                      <span className="text-xs sm:text-sm font-mono font-bold text-emerald-400">{(activeTrade.tp || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[9px] font-mono text-rose-400/50 uppercase tracking-widest">Stop</span>
                      <span className="text-xs sm:text-sm font-mono font-bold text-rose-400">{(activeTrade.sl || 0).toFixed(2)}</span>
                    </div>
                  </div>
                )}
                
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="flex flex-col items-end mr-1 sm:mr-2">
                    <span className="text-[9px] font-mono text-white/40 uppercase tracking-widest">Confidence</span>
                    <div className={cn(
                      "text-sm sm:text-base font-bold font-mono transition-colors duration-500",
                      activeAnalysis?.confidence && activeAnalysis.confidence >= 85 ? "text-emerald-400" :
                      activeAnalysis?.confidence && activeAnalysis.confidence < 60 ? "text-rose-400" : "text-white"
                    )}>
                      {typeof activeAnalysis?.confidence === 'number' && !isNaN(activeAnalysis.confidence) ? (
                        <AnimatedNumber value={activeAnalysis.confidence} />
                      ) : '0'}%
                    </div>
                  </div>
                  
                  <div className={cn(
                    "px-2 sm:px-3 py-1 sm:py-1.5 rounded text-[10px] sm:text-xs font-mono font-bold uppercase tracking-wider border flex items-center justify-center min-w-[60px]",
                    activeAnalysis?.signal === 'LONG' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                    activeAnalysis?.signal === 'SHORT' ? "bg-rose-500/10 text-rose-400 border-rose-500/20" : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                  )}>
                    {activeAnalysis?.signal || 'WAIT'}
                  </div>

                  {data.length > 0 && (
                    <div className="flex flex-col items-end ml-1 sm:ml-2 border-l border-white/10 pl-2 sm:pl-3">
                      <span className="text-[9px] font-mono text-white/40 uppercase tracking-widest">Price</span>
                      <span className={cn(
                        "text-sm sm:text-base font-bold font-mono transition-colors duration-500",
                        data[data.length - 1].close >= data[data.length - 1].open ? "text-emerald-400" : "text-rose-400"
                      )}>
                        {(data[data.length - 1].close || 0).toFixed(2)}
                      </span>
                    </div>
                  )}

                  {activeAnalysis?.signal && activeAnalysis.signal !== 'NO TRADE' && (
                    <button
                      onClick={() => setShowConfirmDialog(true)}
                      className={cn(
                        "px-3 py-1.5 rounded text-[10px] sm:text-xs font-mono font-bold uppercase transition-all border shadow-lg flex items-center gap-1.5 active:scale-95",
                        activeAnalysis.signal === 'LONG' 
                          ? "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border-emerald-500/50 hover:shadow-[0_0_15px_rgba(16,185,129,0.2)]" 
                          : "bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border-rose-500/50 hover:shadow-[0_0_15px_rgba(244,63,94,0.2)]"
                      )}
                    >
                      <Target size={12} />
                      Execute
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 sm:p-6 grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
              {/* Supporting */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-emerald-400/80 pb-2 border-b border-white/5">
                  <ShieldCheck size={14} />
                  <span className="text-[10px] font-mono uppercase tracking-widest">Supporting</span>
                  <span className="ml-auto text-[9px] font-mono bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded">{activeAnalysis?.confluences.supporting.length || 0}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {activeAnalysis?.confluences.supporting.map(name => (
                    <div key={name} className="flex items-start gap-2 text-xs font-mono text-white/70 bg-white/[0.02] px-2.5 py-1.5 rounded border border-white/[0.02]">
                      <div className="w-1 h-1 rounded-full bg-emerald-500/50 mt-1.5 shrink-0" />
                      <span className="leading-relaxed">{name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Opposing */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-rose-400/80 pb-2 border-b border-white/5">
                  <AlertTriangle size={14} />
                  <span className="text-[10px] font-mono uppercase tracking-widest">Opposing</span>
                  <span className="ml-auto text-[9px] font-mono bg-rose-500/10 text-rose-400 px-1.5 py-0.5 rounded">{activeAnalysis?.confluences.opposing.length || 0}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {activeAnalysis?.confluences.opposing.map(name => (
                    <div key={name} className="flex items-start gap-2 text-xs font-mono text-white/70 bg-white/[0.02] px-2.5 py-1.5 rounded border border-white/[0.02]">
                      <div className="w-1 h-1 rounded-full bg-rose-500/50 mt-1.5 shrink-0" />
                      <span className="leading-relaxed">{name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Neutral */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-yellow-400/80 pb-2 border-b border-white/5">
                  <Info size={14} />
                  <span className="text-[10px] font-mono uppercase tracking-widest">Neutral</span>
                  <span className="ml-auto text-[9px] font-mono bg-yellow-500/10 text-yellow-400 px-1.5 py-0.5 rounded">{activeAnalysis?.confluences.neutral.length || 0}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {activeAnalysis?.confluences.neutral.map(name => (
                    <div key={name} className="flex items-start gap-2 text-xs font-mono text-white/70 bg-white/[0.02] px-2.5 py-1.5 rounded border border-white/[0.02]">
                      <div className="w-1 h-1 rounded-full bg-yellow-500/50 mt-1.5 shrink-0" />
                      <span className="leading-relaxed">{name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Bottom Panel: Indicators */}
          <section className="w-full rounded-xl border border-white/10 bg-[#0A0A0A] overflow-hidden shadow-xl mb-4">
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

          {/* Bottom Panel: Trades */}
          <section className="w-full rounded-xl border border-white/10 bg-[#0A0A0A] overflow-hidden shadow-xl mb-8">
            <div className="p-4 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
              <h2 className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Recent Trades</h2>
              {trades.length > 0 && (
                <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest flex gap-4">
                  <span>Total: {trades.length}</span>
                  <span>Win Rate: {trades.filter(t => t.status === 'SUCCESS' || t.status === 'FAILED').length > 0 ? (((trades.filter(t => t.status === 'SUCCESS').length / trades.filter(t => t.status === 'SUCCESS' || t.status === 'FAILED').length) * 100) || 0).toFixed(1) : '0.0'}%</span>
                </div>
              )}
            </div>
            <div className="p-0">
              {trades.length === 0 ? (
                <div className="p-6 text-center text-white/40 font-mono text-sm">No trades executed yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/5 bg-white/[0.02] text-[10px] font-mono text-white/40 uppercase tracking-widest">
                        <th className="p-4 font-normal">Time</th>
                        <th className="p-4 font-normal">Pair</th>
                        <th className="p-4 font-normal">Type</th>
                        <th className="p-4 font-normal">Entry</th>
                        <th className="p-4 font-normal">Target (TP)</th>
                        <th className="p-4 font-normal">Stop (SL)</th>
                        <th className="p-4 font-normal text-right">Status</th>
                        <th className="p-4 font-normal text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-sm">
                      {trades.map(trade => (
                        <tr key={trade.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                          <td className="p-4 text-white/60">{new Date(trade.timestamp).toLocaleTimeString()}</td>
                          <td className="p-4 font-bold text-white">{trade.symbol}</td>
                          <td className="p-4">
                            <span className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-bold tracking-wider",
                              trade.type === 'LONG' ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                            )}>
                              {trade.type}
                            </span>
                          </td>
                          <td className="p-4 text-white/80">{(trade.entry || 0).toFixed(2)}</td>
                          <td className="p-4 text-emerald-400">{(trade.tp || 0).toFixed(2)}</td>
                          <td className="p-4 text-rose-400">{(trade.sl || 0).toFixed(2)}</td>
                          <td className="p-4 text-right">
                            <span className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-bold tracking-wider",
                              trade.status === 'SUCCESS' ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/20" :
                              trade.status === 'FAILED' ? "bg-rose-500/20 text-rose-400 border border-rose-500/20" :
                              "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                            )}>
                              {trade.status}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <button
                              onClick={() => setTrades(prev => prev.filter(t => t.id !== trade.id))}
                              className="text-rose-400 hover:text-rose-300 p-1 rounded hover:bg-rose-500/10 transition-colors"
                              title="Delete Trade"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          {/* Bottom Panel: Top Trades */}
          <TopTradesTable trades={trades} />
        </div>
      </main>

      {/* Confirmation Dialog */}
      {showConfirmDialog && activeAnalysis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#0A0A0A] border border-white/10 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/[0.02]">
              <h3 className="text-sm font-mono font-bold text-white uppercase tracking-widest">Confirm Trade</h3>
              <button 
                onClick={() => setShowConfirmDialog(false)} 
                className="text-white/40 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-6 space-y-4 font-mono text-sm">
              <div className="flex justify-between items-center">
                <span className="text-white/40">Symbol</span>
                <span className="font-bold text-white text-base">{symbol}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/40">Type</span>
                <span className={cn(
                  "px-2 py-0.5 rounded text-xs font-bold tracking-wider",
                  activeAnalysis.signal === 'LONG' ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                )}>
                  {activeAnalysis.signal}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/40">Entry Price</span>
                <span className="text-white/80">{(data[data.length - 1]?.close || 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/40">Take Profit</span>
                <span className="text-emerald-400">{activeAnalysis.tp?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/40">Stop Loss</span>
                <span className="text-rose-400">{activeAnalysis.sl?.toFixed(2)}</span>
              </div>
            </div>
            <div className="p-4 border-t border-white/10 bg-white/[0.02] flex gap-3">
              <button 
                onClick={() => setShowConfirmDialog(false)}
                className="flex-1 px-4 py-2 rounded text-xs font-mono font-bold uppercase transition-colors border border-white/10 text-white/60 hover:text-white hover:bg-white/5"
              >
                Cancel
              </button>
              <button 
                onClick={executeTrade}
                className={cn(
                  "flex-1 px-4 py-2 rounded text-xs font-mono font-bold uppercase transition-colors border",
                  activeAnalysis.signal === 'LONG' 
                    ? "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border-emerald-500/50" 
                    : "bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border-rose-500/50"
                )}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

