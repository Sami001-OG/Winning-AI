import React, { useState, useEffect, useRef } from 'react';
import { analyzeChart } from '../analysis';
import { Candle, AnalysisResult, Trade } from '../types';
import { sendTelegramAlert } from '../services/telegramService';
import { TrendingUp, TrendingDown, Minus, Activity, RefreshCw, Lock, Unlock, ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react';
import { fetchWithRetry } from '../utils/api';

const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];
const sessions = ['ALL', 'ASIAN', 'LONDON', 'NEW YORK'];

interface TradeSignal {
  symbol: string;
  analysis: AnalysisResult;
  lastPrice: number;
  entryDirection: 'up' | 'down' | 'none';
}

const DEFAULT_RELIABILITY = { ema: 1.5, macd: 0.5, rsi: 1.5, stoch: 0.5, cci: 0.25, vol: 1.2, obv: 1.2 };

interface TopTradesTableProps {
  trades: Trade[];
}

export const TopTradesTable: React.FC<TopTradesTableProps> = ({ trades }) => {
  const [interval, setInterval] = useState('15m');
  const [sessionFilter, setSessionFilter] = useState('ALL');
  const [signals, setSignals] = useState<TradeSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [frozenEntries, setFrozenEntries] = useState<Record<string, number>>({});
  
  const klinesDataRef = useRef<Record<string, Candle[]>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const prevEntriesRef = useRef<Record<string, number>>({});
  const lastSentSignalsRef = useRef<Record<string, { direction: string, timestamp: number }>>({});
  const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours cooldown

  const fetchTopSymbols = async () => {
    try {
      const res = await fetchWithRetry('https://api.binance.com/api/v3/ticker/24hr');
      const data = await res.json();
      const usdtPairs = data
        .filter((t: any) => t.symbol.endsWith('USDT') && parseFloat(t.volume) > 0)
        .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, 30)
        .map((t: any) => t.symbol);
      return usdtPairs;
    } catch (e) {
      console.error('Error fetching top symbols', e);
      // Fallback
      return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT'];
    }
  };

  const fetchKlines = async (symbol: string, tf: string) => {
    const res = await fetchWithRetry(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=250`);
    const data = await res.json();
    return data.map((d: any) => ({
      time: Math.floor(d[0] / 1000),
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5]),
      isFinal: true
    }));
  };

  const updateSignals = () => {
    const newSignals: TradeSignal[] = [];
    for (const [symbol, data] of Object.entries(klinesDataRef.current) as [string, Candle[]][]) {
      if (data.length > 0) {
        const analysis = analyzeChart(data, DEFAULT_RELIABILITY, trades, symbol);
        const currentEntry = analysis.suggestedEntry;
        const prevEntry = prevEntriesRef.current[symbol];
        
        let entryDirection: 'up' | 'down' | 'none' = 'none';
        if (currentEntry && prevEntry) {
          if (currentEntry > prevEntry) entryDirection = 'up';
          else if (currentEntry < prevEntry) entryDirection = 'down';
        }
        
        if (currentEntry) {
          prevEntriesRef.current[symbol] = currentEntry;
        }

        // Telegram Alert Logic
        if (analysis.confidence >= 75) {
          const structure = analysis.layers?.structure || 0;
          const lastClose = data[data.length - 1].close;

          // Check if the previous candles also had the same signal to prevent continuous spam on page refresh
          const prevKlines1 = data.slice(0, -1);
          const prevAnalysis1 = analyzeChart(prevKlines1, DEFAULT_RELIABILITY, trades, symbol);
          
          const prevKlines2 = data.slice(0, -2);
          const prevAnalysis2 = analyzeChart(prevKlines2, DEFAULT_RELIABILITY, trades, symbol);

          const prevKlines3 = data.slice(0, -3);
          const prevAnalysis3 = analyzeChart(prevKlines3, DEFAULT_RELIABILITY, trades, symbol);
          
          const isContinuous = 
            (prevAnalysis1.signal === analysis.signal && prevAnalysis1.confidence >= 70) ||
            (prevAnalysis2.signal === analysis.signal && prevAnalysis2.confidence >= 70) ||
            (prevAnalysis3.signal === analysis.signal && prevAnalysis3.confidence >= 70);

          if (!isContinuous) {
            const bullishImageUrl = "https://quickchart.io/chart?c={type:'line',data:{labels:['1','2','3','4','5','6','7'],datasets:[{label:'Bullish',data:[10,15,13,22,18,28,35],borderColor:'rgb(16,185,129)',backgroundColor:'rgba(16,185,129,0.2)',fill:true}]},options:{legend:{display:false},scales:{xAxes:[{display:false}],yAxes:[{display:false}]}}}";
            const bearishImageUrl = "https://quickchart.io/chart?c={type:'line',data:{labels:['1','2','3','4','5','6','7'],datasets:[{label:'Bearish',data:[35,28,32,20,24,15,10],borderColor:'rgb(244,63,94)',backgroundColor:'rgba(244,63,94,0.2)',fill:true}]},options:{legend:{display:false},scales:{xAxes:[{display:false}],yAxes:[{display:false}]}}}";

            const now = Date.now();
            const lastSent = lastSentSignalsRef.current[symbol];

            if (!lastSent || lastSent.direction !== analysis.signal || (now - lastSent.timestamp) > COOLDOWN_MS) {
              if (analysis.signal === 'LONG' && structure >= 0 && analysis.confidence > 90) {
                sendTelegramAlert(`<b>LONG SIGNAL: ${symbol}</b>\nConfidence: ${analysis.confidence.toFixed(1)}%\nPrice: ${lastClose.toFixed(4)}`, bullishImageUrl);
                lastSentSignalsRef.current[symbol] = { direction: 'LONG', timestamp: now };
              } else if (analysis.signal === 'SHORT' && structure <= 0 && analysis.confidence > 90) {
                sendTelegramAlert(`<b>SHORT SIGNAL: ${symbol}</b>\nConfidence: ${analysis.confidence.toFixed(1)}%\nPrice: ${lastClose.toFixed(4)}`, bearishImageUrl);
                lastSentSignalsRef.current[symbol] = { direction: 'SHORT', timestamp: now };
              }
            }
          }
        }

        newSignals.push({
          symbol,
          analysis,
          lastPrice: data[data.length - 1].close,
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

  useEffect(() => {
    let isMounted = true;
    
    const init = async () => {
      setLoading(true);
      setError(null);
      
      if (wsRef.current) {
        wsRef.current.close();
      }

      try {
        const symbols = await fetchTopSymbols();
        if (!isMounted) return;

        const batches = [];
        for (let i = 0; i < symbols.length; i += 5) {
          batches.push(symbols.slice(i, i + 5));
        }

        klinesDataRef.current = {};
        
        for (const batch of batches) {
          await Promise.all(batch.map(async (sym) => {
            try {
              const klines = await fetchKlines(sym, interval);
              klinesDataRef.current[sym] = klines;
            } catch (e) {
              console.error(`Error fetching klines for ${sym}`, e);
            }
          }));
        }

        if (!isMounted) return;
        updateSignals();
        setLoading(false);

        // Setup WS
        const streams = symbols.map(s => `${s.toLowerCase()}@kline_${interval}`).join('/');
        const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
        wsRef.current = ws;

        ws.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.data && message.data.e === 'kline') {
            const kline = message.data.k;
            const symbol = message.data.s;
            
            if (klinesDataRef.current[symbol]) {
              const data = klinesDataRef.current[symbol];
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
            }
          }
        };
      } catch (e: any) {
        console.error('Init error', e);
        if (isMounted) {
          setError(e.message || 'Failed to initialize market scan');
          setLoading(false);
        }
      }
    };

    init();

    const timerId = window.setInterval(() => {
      updateSignals();
    }, 2000); // Update table every 2 seconds

    return () => {
      isMounted = false;
      window.clearInterval(timerId);
      if (wsRef.current) wsRef.current.close();
    };
  }, [interval]);

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 85) return 'text-emerald-400';
    if (confidence >= 70) return 'text-yellow-400';
    return 'text-white/60';
  };

  const getScoreColor = (score: number | undefined) => {
    if (score === undefined) return 'text-white/40';
    if (score > 0.5) return 'text-emerald-400';
    if (score < -0.5) return 'text-rose-400';
    if (score > 0) return 'text-emerald-400/60';
    if (score < 0) return 'text-rose-400/60';
    return 'text-white/40';
  };

  const filteredSignals = signals.filter(signal => {
    if (sessionFilter === 'ALL') return true;
    const sessionIndicator = signal.analysis.indicators.find(i => i.name === 'Session Killzone');
    return sessionIndicator?.value === sessionFilter;
  });
  
  const displaySignals = filteredSignals.slice(0, 10);

  return (
    <section className="w-full rounded-xl border border-white/10 bg-[#0A0A0A] overflow-hidden shadow-xl mb-8">
      <div className="p-4 border-b border-white/10 bg-white/[0.02] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-emerald-400" />
          <h2 className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Weighted Confirmed Trades (Top 10)</h2>
        </div>
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="text-[10px] font-mono text-white/40 flex items-center gap-1">
            <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
            {loading ? "Scanning Market..." : `Updated: ${lastUpdate.toLocaleTimeString()}`}
          </div>
          
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-white/5 p-1 rounded-md border border-white/10">
              {sessions.map((session) => (
                <button
                  key={session}
                  onClick={() => setSessionFilter(session)}
                  className={`px-3 py-1 rounded text-[10px] font-mono font-bold uppercase transition-all ${
                    sessionFilter === session 
                      ? "bg-white/10 text-blue-400" 
                      : "text-white/40 hover:text-white/80 hover:bg-white/5"
                  }`}
                >
                  {session}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 bg-white/5 p-1 rounded-md border border-white/10">
              {timeframes.map((tf) => (
                <button
                  key={tf}
                  onClick={() => setInterval(tf)}
                  className={`px-3 py-1 rounded text-[10px] font-mono font-bold uppercase transition-all ${
                    interval === tf 
                      ? "bg-white/10 text-emerald-400" 
                      : "text-white/40 hover:text-white/80 hover:bg-white/5"
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      <div className="p-0 overflow-x-auto">
        {error && (
          <div className="p-4 bg-rose-500/10 border-b border-rose-500/20 text-rose-400 text-xs font-mono flex items-center gap-2">
            <AlertTriangle size={14} />
            <span>{error}. Using fallback symbols.</span>
          </div>
        )}
        <table className="w-full text-left border-collapse min-w-[800px]">
          <thead>
            <tr className="border-b border-white/5 bg-white/[0.02] text-[10px] font-mono text-white/40 uppercase tracking-widest">
              <th className="p-4 font-normal">Symbol</th>
              <th className="p-4 font-normal">Trade Signal</th>
              <th className="p-4 font-normal">Confidence Score</th>
              <th className="p-4 font-normal text-center">Market Condition</th>
              <th className="p-4 font-normal text-center">Trend Alignment</th>
              <th className="p-4 font-normal text-center">Entry Timing</th>
              <th className="p-4 font-normal text-center">Volume Confirmation</th>
              <th className="p-4 font-normal text-right">Target Entry Price</th>
              <th className="p-4 font-normal text-right">Current Price</th>
              <th className="p-4 font-normal text-right">Take Profit / Stop Loss</th>
            </tr>
          </thead>
          <tbody className="font-mono text-sm">
            {loading && displaySignals.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-8 text-center text-white/40 text-xs">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <RefreshCw size={24} className="animate-spin text-emerald-500/50" />
                    <span>Analyzing top 30 pairs...</span>
                  </div>
                </td>
              </tr>
            ) : displaySignals.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-8 text-center text-white/40 text-xs">No active signals found for the selected session.</td>
              </tr>
            ) : (
              displaySignals.map((s) => (
                <tr key={s.symbol} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="p-4 font-bold text-white">{s.symbol}</td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${
                      s.analysis.signal === 'LONG' ? "bg-emerald-500/10 text-emerald-400" : 
                      s.analysis.signal === 'SHORT' ? "bg-rose-500/10 text-rose-400" : 
                      "bg-white/5 text-white/40"
                    }`}>
                      {s.analysis.signal}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <span className={`font-bold ${getConfidenceColor(s.analysis.confidence)}`}>
                        {s.analysis.confidence.toFixed(1)}%
                      </span>
                      <div className="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${s.analysis.confidence >= 85 ? 'bg-emerald-500' : s.analysis.confidence >= 70 ? 'bg-yellow-500' : 'bg-white/20'}`}
                          style={{ width: `${s.analysis.confidence}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className={`p-4 text-center ${getScoreColor(s.analysis.layers?.marketCondition)}`}>
                    {s.analysis.layers?.marketCondition !== undefined ? s.analysis.layers.marketCondition.toFixed(2) : '-'}
                  </td>
                  <td className={`p-4 text-center ${getScoreColor(s.analysis.layers?.trend)}`}>
                    {s.analysis.layers?.trend !== undefined ? s.analysis.layers.trend.toFixed(2) : '-'}
                  </td>
                  <td className={`p-4 text-center ${getScoreColor(s.analysis.layers?.entry)}`}>
                    {s.analysis.layers?.entry !== undefined ? s.analysis.layers.entry.toFixed(2) : '-'}
                  </td>
                  <td className={`p-4 text-center ${getScoreColor(s.analysis.layers?.confirmation)}`}>
                    {s.analysis.layers?.confirmation !== undefined ? s.analysis.layers.confirmation.toFixed(2) : '-'}
                  </td>
                  <td className="p-4 text-right">
                    {s.analysis.signal !== 'NO TRADE' && (frozenEntries[s.symbol] || s.analysis.suggestedEntry) ? (
                      <div className="flex items-center justify-end gap-2">
                        {frozenEntries[s.symbol] ? (
                          <Lock 
                            size={12} 
                            className="text-emerald-400 cursor-pointer" 
                            onClick={() => toggleFreeze(s.symbol, s.analysis.suggestedEntry!)}
                          />
                        ) : (
                          <Unlock 
                            size={12} 
                            className="text-white/20 hover:text-white/60 cursor-pointer transition-colors" 
                            onClick={() => toggleFreeze(s.symbol, s.analysis.suggestedEntry!)}
                          />
                        )}
                        <div className="flex items-center gap-1">
                          <span className={frozenEntries[s.symbol] ? "text-emerald-400 font-bold" : "text-white"}>
                            {(frozenEntries[s.symbol] || s.analysis.suggestedEntry || 0).toFixed(4)}
                          </span>
                          {!frozenEntries[s.symbol] && s.entryDirection === 'up' && <ArrowUp size={12} className="text-emerald-400" />}
                          {!frozenEntries[s.symbol] && s.entryDirection === 'down' && <ArrowDown size={12} className="text-rose-400" />}
                          {!frozenEntries[s.symbol] && s.entryDirection === 'none' && <span className="w-3" />}
                        </div>
                      </div>
                    ) : (
                      <span className="text-white/20">-</span>
                    )}
                  </td>
                  <td className="p-4 text-right text-white/80">{s.lastPrice.toFixed(4)}</td>
                  <td className="p-4 text-right">
                    {s.analysis.signal !== 'NO TRADE' && s.analysis.tp && s.analysis.sl ? (
                      <div className="flex flex-col items-end text-[10px]">
                        <span className="text-emerald-400">{s.analysis.tp !== undefined ? s.analysis.tp.toFixed(4) : '-'}</span>
                        <span className="text-rose-400">{s.analysis.sl !== undefined ? s.analysis.sl.toFixed(4) : '-'}</span>
                      </div>
                    ) : (
                      <span className="text-white/20">-</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
