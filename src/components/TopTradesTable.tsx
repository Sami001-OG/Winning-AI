import React, { useState, useEffect, useRef } from 'react';
import { analyzeMultiTimeframe } from '../analysis';
import { Candle, AnalysisResult, Trade } from '../types';
import { sendTelegramAlert } from '../services/telegramService';
import { TrendingUp, TrendingDown, Minus, Activity, RefreshCw, Lock, Unlock, ArrowUp, ArrowDown, AlertTriangle } from 'lucide-react';
import { fetchWithRetry } from '../utils/api';
import { formatPrice } from '../utils/format';

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
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [frozenEntries, setFrozenEntries] = useState<Record<string, number>>({});
  
  const klinesDataRef = useRef<Record<string, Record<string, Candle[]>>>({});
  const wsRefs = useRef<WebSocket[]>([]);
  const prevEntriesRef = useRef<Record<string, number>>({});
  const lastSentSignalsRef = useRef<Record<string, { direction: string, timestamp: number }>>({});
  const activeTradesRef = useRef<Record<string, ActiveTrade>>({});
  const lastSessionAlertRef = useRef<string>('');
  const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours cooldown

  const fetchTopSymbols = async () => {
    try {
      const res = await fetchWithRetry('https://fapi.binance.com/fapi/v1/ticker/24hr');
      const data = await res.json();
      const usdtPairs = data
        .filter((t: any) => 
          t.symbol.endsWith('USDT') && 
          parseFloat(t.volume) > 0 &&
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
      const res = await fetchWithRetry(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=250`);
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

  const updateSignals = () => {
    const newSignals: TradeSignal[] = [];
    for (const [symbol, tfData] of Object.entries(klinesDataRef.current)) {
      if (!tfData['4h'] || !tfData['15m'] || !tfData['5m']) continue;
      if (tfData['4h'].length === 0 || tfData['15m'].length === 0 || tfData['5m'].length === 0) continue;

      const lastPrice = tfData['5m'][tfData['5m'].length - 1].close;
      
      // --- ACTIVE TRADE MONITORING ---
      const activeTrade = activeTradesRef.current[symbol];
      if (activeTrade && activeTrade.isMTF) {
        let updated = false;

        if (activeTrade.direction === 'LONG') {
          if (lastPrice <= activeTrade.sl) {
            sendTelegramAlert(`🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📈 <b>Direction:</b> LONG\n❌ <b>Stop Loss Hit</b> at ${formatPrice(lastPrice)}`);
            delete activeTradesRef.current[symbol];
          } else if (activeTrade.achieved < 3 && lastPrice >= activeTrade.tp3) {
            sendTelegramAlert(`🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📈 <b>Direction:</b> LONG\n✅✅✅ <b>TP3 Achieved</b> at ${formatPrice(lastPrice)}`);
            delete activeTradesRef.current[symbol];
          } else if (activeTrade.achieved < 2 && lastPrice >= activeTrade.tp2) {
            sendTelegramAlert(`🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📈 <b>Direction:</b> LONG\n✅✅ <b>TP2 Achieved</b> at ${formatPrice(lastPrice)}`);
            activeTrade.achieved = 2;
            updated = true;
          } else if (activeTrade.achieved < 1 && lastPrice >= activeTrade.tp1) {
            sendTelegramAlert(`🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📈 <b>Direction:</b> LONG\n✅ <b>TP1 Achieved</b> at ${formatPrice(lastPrice)}`);
            activeTrade.achieved = 1;
            updated = true;
          }
        } else if (activeTrade.direction === 'SHORT') {
          if (lastPrice >= activeTrade.sl) {
            sendTelegramAlert(`🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📉 <b>Direction:</b> SHORT\n❌ <b>Stop Loss Hit</b> at ${formatPrice(lastPrice)}`);
            delete activeTradesRef.current[symbol];
          } else if (activeTrade.achieved < 3 && lastPrice <= activeTrade.tp3) {
            sendTelegramAlert(`🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📉 <b>Direction:</b> SHORT\n✅✅✅ <b>TP3 Achieved</b> at ${formatPrice(lastPrice)}`);
            delete activeTradesRef.current[symbol];
          } else if (activeTrade.achieved < 2 && lastPrice <= activeTrade.tp2) {
            sendTelegramAlert(`🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📉 <b>Direction:</b> SHORT\n✅✅ <b>TP2 Achieved</b> at ${formatPrice(lastPrice)}`);
            activeTrade.achieved = 2;
            updated = true;
          } else if (activeTrade.achieved < 1 && lastPrice <= activeTrade.tp1) {
            sendTelegramAlert(`🚨 <b>TRADE UPDATE</b> 🚨\n\n🪙 <b>Pair:</b> #${symbol}\n📉 <b>Direction:</b> SHORT\n✅ <b>TP1 Achieved</b> at ${formatPrice(lastPrice)}`);
            activeTrade.achieved = 1;
            updated = true;
          }
        }
        
        if (updated) {
          activeTradesRef.current[symbol] = activeTrade;
        }
      }
      // --- END ACTIVE TRADE MONITORING ---

      const analysis = analyzeMultiTimeframe(tfData['4h'], tfData['15m'], tfData['5m'], DEFAULT_RELIABILITY, trades, symbol);

      if (analysis.signal !== 'NO TRADE') {
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
          lastPrice: tfData['5m'][tfData['5m'].length - 1].close,
          entryDirection
        });
      }
    }
    
    // Sort by confidence
    newSignals.sort((a, b) => b.analysis.confidence - a.analysis.confidence);
    setSignals(newSignals);
    setLastUpdate(new Date());

    // Telegram Alert Logic - ONLY SEND THE BEST SIGNAL
    for (const bestTrade of newSignals) {
      const { symbol, analysis, lastPrice } = bestTrade;
      
      if (analysis.signal === 'NO TRADE') continue;

      const data4h = klinesDataRef.current[symbol]['4h'];
      const data15m = klinesDataRef.current[symbol]['15m'];
      const data5m = klinesDataRef.current[symbol]['5m'];
      if (!data4h || !data15m || !data5m) continue;

      const structure = analysis.layers?.structure || 0;

      // Check if the previous candles also had the same signal to prevent continuous spam on page refresh
      const prevAnalysis1 = analyzeMultiTimeframe(data4h.slice(0, -1), data15m.slice(0, -1), data5m.slice(0, -1), DEFAULT_RELIABILITY, trades, symbol);
      const prevAnalysis2 = analyzeMultiTimeframe(data4h.slice(0, -2), data15m.slice(0, -2), data5m.slice(0, -2), DEFAULT_RELIABILITY, trades, symbol);
      const prevAnalysis3 = analyzeMultiTimeframe(data4h.slice(0, -3), data15m.slice(0, -3), data5m.slice(0, -3), DEFAULT_RELIABILITY, trades, symbol);
      
      const isContinuous = 
        (prevAnalysis1.signal === analysis.signal) ||
        (prevAnalysis2.signal === analysis.signal) ||
        (prevAnalysis3.signal === analysis.signal);

      if (!isContinuous) {
        const bullishImageUrl = "https://quickchart.io/chart?c={type:'line',data:{labels:['1','2','3','4','5','6','7'],datasets:[{label:'Bullish',data:[10,15,13,22,18,28,35],borderColor:'rgb(16,185,129)',backgroundColor:'rgba(16,185,129,0.2)',fill:true}]},options:{legend:{display:false},scales:{xAxes:[{display:false}],yAxes:[{display:false}]}}}";
        const bearishImageUrl = "https://quickchart.io/chart?c={type:'line',data:{labels:['1','2','3','4','5','6','7'],datasets:[{label:'Bearish',data:[35,28,32,20,24,15,10],borderColor:'rgb(244,63,94)',backgroundColor:'rgba(244,63,94,0.2)',fill:true}]},options:{legend:{display:false},scales:{xAxes:[{display:false}],yAxes:[{display:false}]}}}";

        const now = Date.now();
        const lastSent = lastSentSignalsRef.current[symbol];

        if (!lastSent || lastSent.direction !== analysis.signal || (now - lastSent.timestamp) > COOLDOWN_MS) {
          const entryPrice = analysis.suggestedEntry || lastPrice;
          const tpDistance = (analysis.tp || 0) - entryPrice;
          const tp1 = entryPrice + (tpDistance * 0.3333);
          const tp2 = entryPrice + (tpDistance * 0.6666);
          const tp3 = analysis.tp || 0;
          const sl = analysis.sl || 0;

          const directionEmoji = analysis.signal === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
          const message = `⚡️ <b>ENDELLION TRADE</b> ⚡️\n\n🪙 <b>Pair:</b> #${symbol}\n${analysis.signal === 'LONG' ? '📈' : '📉'} <b>Direction:</b> ${directionEmoji}\n⏱ <b>Timeframe:</b> Multi-TF (4h, 15m, 5m)\n\n🎯 <b>Entry:</b> ${formatPrice(entryPrice)}\n\n✅ <b>TP1:</b> ${formatPrice(tp1)}\n✅ <b>TP2:</b> ${formatPrice(tp2)}\n✅ <b>TP3:</b> ${formatPrice(tp3)}\n\n❌ <b>Stop Loss:</b> ${formatPrice(sl)}\n\n🧠 <b>Confidence:</b> ${(analysis.confidence || 0).toFixed(1)}%`;

          console.log(`[Telegram Debug] Sending alert for ${symbol}: ${message}`);

          if (analysis.signal === 'LONG' && structure >= 0) {
            sendTelegramAlert(message, bullishImageUrl);
            lastSentSignalsRef.current[symbol] = { direction: 'LONG', timestamp: now };
            activeTradesRef.current[symbol] = {
              symbol,
              direction: 'LONG',
              entry: entryPrice,
              tp1, tp2, tp3, sl,
              achieved: 0,
              isMTF: true
            };
            break; // Only send the absolute best one
          } else if (analysis.signal === 'SHORT' && structure <= 0) {
            sendTelegramAlert(message, bearishImageUrl);
            lastSentSignalsRef.current[symbol] = { direction: 'SHORT', timestamp: now };
            activeTradesRef.current[symbol] = {
              symbol,
              direction: 'SHORT',
              entry: entryPrice,
              tp1, tp2, tp3, sl,
              achieved: 0,
              isMTF: true
            };
            break; // Only send the absolute best one
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

  const updateSignalsRef = useRef(updateSignals);
  useEffect(() => {
    updateSignalsRef.current = updateSignals;
  }, [updateSignals]);

  useEffect(() => {
    const checkSessionAlerts = () => {
      const now = new Date();
      const utcHour = now.getUTCHours();
      const utcMinute = now.getUTCMinutes();
      
      // We only want to alert exactly on the hour
      if (utcMinute !== 0) return;

      const dateStr = now.toISOString().split('T')[0];
      const alertKey = `${dateStr}-${utcHour}`;

      if (lastSessionAlertRef.current === alertKey) return;

      let alertMessage = '';

      switch (utcHour) {
        case 0:
          alertMessage = '🟢 <b>Asian Session Opens</b>\nTokyo market is now open.';
          break;
        case 8:
          alertMessage = '🟢 <b>London Session Opens</b>\nLondon market is now open.';
          break;
        case 9:
          alertMessage = '🔴 <b>Asian Session Closes</b>\nTokyo market is now closed.';
          break;
        case 13:
          alertMessage = '🟢 <b>New York Session Opens</b>\nNew York market is now open.';
          break;
        case 17:
          alertMessage = '🔴 <b>London Session Closes</b>\nLondon market is now closed.';
          break;
        case 22:
          alertMessage = '🔴 <b>New York Session Closes</b>\nNew York market is now closed.';
          break;
      }

      if (alertMessage) {
        sendTelegramAlert(`🕒 <b>MARKET SESSION UPDATE</b>\n\n${alertMessage}`);
        lastSessionAlertRef.current = alertKey;
      }
    };

    // Check every minute
    const sessionTimerId = window.setInterval(checkSessionAlerts, 60000);
    
    // Also check immediately on mount
    checkSessionAlerts();

    return () => {
      window.clearInterval(sessionTimerId);
    };
  }, []);

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

        const batches = [];
        for (let i = 0; i < symbols.length; i += 15) {
          batches.push(symbols.slice(i, i + 15));
        }

        klinesDataRef.current = {};
        
        for (const batch of batches) {
          await Promise.all(batch.map(async (sym) => {
            klinesDataRef.current[sym] = {};
            try {
              await Promise.all(TIMEFRAMES.map(async (tf) => {
                const klines = await fetchKlines(sym, tf);
                klinesDataRef.current[sym][tf] = klines;
              }));
            } catch (e) {
              console.error(`Error fetching klines for ${sym}`, e);
            }
          }));
          // Delay to respect Binance rate limits (2400 weight / min for Futures)
          // 15 symbols * 3 TFs = 45 requests * 2 weight = 90 weight per batch
          // 20 batches * 500ms = 10 seconds total loading time
          // Total weight = 1800 (well under 2400/min limit)
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        if (!isMounted) return;
        updateSignalsRef.current();
        setLoading(false);

        // Setup WS
        const allStreams = symbols.flatMap(s => TIMEFRAMES.map(tf => `${s.toLowerCase()}@kline_${tf}`));
        
        // Binance allows max 1024 streams per connection. We'll use 900 per connection to be safe.
        const streamsPerConnection = 900;
        
        for (let i = 0; i < allStreams.length; i += streamsPerConnection) {
          const connectionStreams = allStreams.slice(i, i + streamsPerConnection);
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
              }
            }
          };
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

    const timerId = window.setInterval(() => {
      updateSignalsRef.current();
    }, 2000); // Update table every 2 seconds

    return () => {
      isMounted = false;
      window.clearInterval(timerId);
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
            {loading ? "Scanning Market..." : `Updated: ${lastUpdate.toLocaleTimeString()}`}
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
                <span>Analyzing top 50 pairs...</span>
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
                          <span className={frozenEntries[s.symbol] ? "text-emerald-400 font-bold" : "text-white group-hover:text-black"}>
                            {formatPrice(frozenEntries[s.symbol] || s.analysis.suggestedEntry || 0)}
                          </span>
                          {!frozenEntries[s.symbol] && s.entryDirection === 'up' && <ArrowUp size={12} className="text-emerald-400" />}
                          {!frozenEntries[s.symbol] && s.entryDirection === 'down' && <ArrowDown size={12} className="text-rose-400" />}
                          {!frozenEntries[s.symbol] && s.entryDirection === 'none' && <span className="w-3" />}
                        </div>
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
