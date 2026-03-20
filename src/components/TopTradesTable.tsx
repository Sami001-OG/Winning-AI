import React, { useState, useEffect, useRef } from 'react';
import { analyzeChart } from '../analysis';
import { Candle, AnalysisResult } from '../types';
import { TrendingUp, TrendingDown, Minus, Activity, RefreshCw, Lock, Unlock, ArrowUp, ArrowDown } from 'lucide-react';
import { fetchWithRetry } from '../utils/api';
import { isNYSession, sendTelegramMessage } from '../utils/telegram';

const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];

interface TradeSignal {
  symbol: string;
  analysis: AnalysisResult;
  lastPrice: number;
  entryDirection: 'up' | 'down' | 'none';
}

export const TopTradesTable: React.FC = () => {
  const [interval, setInterval] = useState('15m');
  const [signals, setSignals] = useState<TradeSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [frozenEntries, setFrozenEntries] = useState<Record<string, number>>({});
  
  const klinesDataRef = useRef<Record<string, Candle[]>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const prevEntriesRef = useRef<Record<string, number>>({});
  const lastSentSignalsRef = useRef<Record<string, number>>({});
  const lastGlobalSendRef = useRef<number>(0);

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
      time: new Date(d[0]).toISOString(),
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
        const analysis = analyzeChart(data);
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
    const top10 = newSignals.slice(0, 10);
    setSignals(top10);
    setLastUpdate(new Date());

    // Telegram Bot Logic
    const botToken = import.meta.env.VITE_TELEGRAM_BOT_TOKEN;
    const chatId = import.meta.env.VITE_TELEGRAM_CHAT_ID;
    
    if (botToken && chatId && top10.length > 0) {
      const highestProbTrade = top10[0];
      if (highestProbTrade.analysis.signal !== 'NO TRADE' && highestProbTrade.analysis.tp && highestProbTrade.analysis.sl) {
        if (isNYSession()) {
          const signalKey = `${highestProbTrade.symbol}-${highestProbTrade.analysis.signal}-${interval}`;
          const now = Date.now();
          const lastSent = lastSentSignalsRef.current[signalKey] || 0;
          
          // 15 minute cooldown per unique signal, and 5 minute global cooldown
          if (now - lastSent > 15 * 60 * 1000 && now - lastGlobalSendRef.current > 5 * 60 * 1000) {
            lastSentSignalsRef.current[signalKey] = now;
            lastGlobalSendRef.current = now;
            
            const message = `
<b>Symbol :</b> ${highestProbTrade.symbol}
<b>Trade Direction :</b> ${highestProbTrade.analysis.signal === 'LONG' ? 'Long' : 'Short'}
<b>TP :</b> ${highestProbTrade.analysis.tp.toFixed(4)}
<b>SL :</b> ${highestProbTrade.analysis.sl.toFixed(4)}
<b>Confidence :</b> ${highestProbTrade.analysis.confidence.toFixed(1)}%
<b>Time Frame :</b> ${interval}
            `.trim();
            
            sendTelegramMessage(botToken, chatId, message);
          }
        }
      }
    }
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
      
      if (wsRef.current) {
        wsRef.current.close();
      }

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
              time: new Date(kline.t).toISOString(),
              open: parseFloat(kline.o),
              high: parseFloat(kline.h),
              low: parseFloat(kline.l),
              close: parseFloat(kline.c),
              volume: parseFloat(kline.v),
              isFinal: kline.x
            };

            const lastCandle = data[data.length - 1];
            if (lastCandle && new Date(lastCandle.time).getTime() === kline.t) {
              data[data.length - 1] = candle;
            } else {
              data.push(candle);
              if (data.length > 250) data.shift();
            }
          }
        }
      };
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
    if (confidence > 75) return 'text-emerald-400';
    if (confidence >= 60) return 'text-yellow-400';
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

  return (
    <section className="w-full rounded-xl border border-white/10 bg-[#0A0A0A] overflow-hidden shadow-xl mb-8">
      <div className="p-4 border-b border-white/10 bg-white/[0.02] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-emerald-400" />
          <h2 className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Weighted Confirmed Trades (Top 10)</h2>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={async () => {
              const botToken = import.meta.env.VITE_TELEGRAM_BOT_TOKEN;
              if (!botToken) {
                alert("Please configure VITE_TELEGRAM_BOT_TOKEN in AI Studio Secrets first.");
                return;
              }
              
              try {
                const response = await fetch(`/api/telegram/debug?botToken=${encodeURIComponent(botToken)}`);
                const data = await response.json();
                
                if (response.ok) {
                  if (data.foundChats && data.foundChats.length > 0) {
                    alert(`Found these recent chats:\n\n${data.foundChats.join('\n')}\n\nUse one of these IDs as your VITE_TELEGRAM_CHAT_ID.`);
                  } else {
                    alert("No recent chats found. Please send a message in your channel/group first, then try again.");
                  }
                } else {
                  alert(`Failed to fetch debug info:\n\n${data.error || 'Unknown error'}\n${data.details || ''}`);
                }
              } catch (e: any) {
                alert(`Network error: ${e.message || e}`);
              }
            }}
            className="px-3 py-1 rounded text-[10px] font-mono font-bold uppercase transition-all bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30"
          >
            Find Chat ID
          </button>
          <button 
            onClick={async () => {
              const botToken = import.meta.env.VITE_TELEGRAM_BOT_TOKEN;
              const chatId = import.meta.env.VITE_TELEGRAM_CHAT_ID;
              if (botToken && chatId) {
                try {
                  const response = await fetch('/api/telegram/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      botToken,
                      chatId,
                      message: "<b>Test Message</b>\nThis is a test message from Endellion Trade to verify your Telegram setup."
                    }),
                  });
                  
                  if (response.ok) {
                    alert("Test message sent successfully! Check your Telegram channel.");
                  } else {
                    let errorText = "Unknown error";
                    try {
                      const errorData = await response.json();
                      errorText = errorData.error || JSON.stringify(errorData);
                    } catch (e) {
                      errorText = await response.text();
                    }
                    alert(`Failed to send message:\n\n${errorText}`);
                  }
                } catch (e: any) {
                  alert(`Network error while trying to send test message: ${e.message || e}`);
                }
              } else {
                alert("Please configure VITE_TELEGRAM_BOT_TOKEN and VITE_TELEGRAM_CHAT_ID in AI Studio Secrets.");
              }
            }}
            className="px-3 py-1 rounded text-[10px] font-mono font-bold uppercase transition-all bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30"
          >
            Test Telegram
          </button>
          <div className="text-[10px] font-mono text-white/40 flex items-center gap-1">
            <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
            {loading ? "Scanning Market..." : `Updated: ${lastUpdate.toLocaleTimeString()}`}
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
      
      <div className="p-0 overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[800px]">
          <thead>
            <tr className="border-b border-white/5 bg-white/[0.02] text-[10px] font-mono text-white/40 uppercase tracking-widest">
              <th className="p-4 font-normal">Symbol</th>
              <th className="p-4 font-normal">Signal</th>
              <th className="p-4 font-normal">Confidence</th>
              <th className="p-4 font-normal text-center">Market</th>
              <th className="p-4 font-normal text-center">Trend</th>
              <th className="p-4 font-normal text-center">Entry</th>
              <th className="p-4 font-normal text-center">Confirm</th>
              <th className="p-4 font-normal text-right">Target Entry</th>
              <th className="p-4 font-normal text-right">Price</th>
              <th className="p-4 font-normal text-right">TP / SL</th>
            </tr>
          </thead>
          <tbody className="font-mono text-sm">
            {loading && signals.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-8 text-center text-white/40 text-xs">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <RefreshCw size={24} className="animate-spin text-emerald-500/50" />
                    <span>Analyzing top 30 pairs...</span>
                  </div>
                </td>
              </tr>
            ) : signals.length === 0 ? (
              <tr>
                <td colSpan={10} className="p-8 text-center text-white/40 text-xs">No active signals found.</td>
              </tr>
            ) : (
              signals.map((s) => (
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
                          className={`h-full rounded-full ${s.analysis.confidence > 75 ? 'bg-emerald-500' : s.analysis.confidence >= 60 ? 'bg-yellow-500' : 'bg-white/20'}`}
                          style={{ width: `${s.analysis.confidence}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className={`p-4 text-center ${getScoreColor(s.analysis.layers?.marketCondition)}`}>
                    {s.analysis.layers?.marketCondition.toFixed(2) || '-'}
                  </td>
                  <td className={`p-4 text-center ${getScoreColor(s.analysis.layers?.trend)}`}>
                    {s.analysis.layers?.trend.toFixed(2) || '-'}
                  </td>
                  <td className={`p-4 text-center ${getScoreColor(s.analysis.layers?.entry)}`}>
                    {s.analysis.layers?.entry.toFixed(2) || '-'}
                  </td>
                  <td className={`p-4 text-center ${getScoreColor(s.analysis.layers?.confirmation)}`}>
                    {s.analysis.layers?.confirmation.toFixed(2) || '-'}
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
                            {(frozenEntries[s.symbol] || s.analysis.suggestedEntry!).toFixed(4)}
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
                        <span className="text-emerald-400">{s.analysis.tp.toFixed(4)}</span>
                        <span className="text-rose-400">{s.analysis.sl.toFixed(4)}</span>
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
