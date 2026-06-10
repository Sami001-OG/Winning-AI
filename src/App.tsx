import React, { useState, useCallback, useEffect, useRef, memo } from "react";
import {
  Activity,
  ShieldCheck,
  AlertTriangle,
  Info,
  TrendingUp,
  TrendingDown,
  Minus,
  Search,
  ActivitySquare,
  Clock,
  Target,
  Crosshair,
  LayoutGrid,
  Square,
  X,
} from "lucide-react";
import { fetchWithRetry } from "./utils/api";
import { formatPrice } from "./utils/format";
import { LightweightChart } from "./LightweightChart";
import { TopTradesTable } from "./components/TopTradesTable";
import { analyzeChart } from "./analysis";
import { Candle, AnalysisResult, Trade } from "./types";
import { useBinanceData } from "./hooks/useBinanceData";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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

const MemoizedChart = memo(
  ({
    symbol,
    interval,
    activeTrade,
    activeAnalysis,
  }: {
    symbol: string;
    interval: string;
    activeTrade?: Trade;
    activeAnalysis?: AnalysisResult | null;
  }) => {
    return (
      <LightweightChart
        symbol={symbol}
        interval={interval}
        activeTrade={activeTrade}
        activeAnalysis={activeAnalysis}
      />
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.symbol === nextProps.symbol &&
      prevProps.interval === nextProps.interval &&
      prevProps.activeTrade?.id === nextProps.activeTrade?.id &&
      prevProps.activeTrade?.status === nextProps.activeTrade?.status &&
      prevProps.activeAnalysis?.tp === nextProps.activeAnalysis?.tp &&
      prevProps.activeAnalysis?.sl === nextProps.activeAnalysis?.sl
    );
  },
);

const DEFAULT_RELIABILITY = {
  ema: 1.5,
  macd: 0.2,
  rsi: 1.5,
  vol: 1.2,
  obv: 1.2,
};

export default function App() {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [multiAnalysis, setMultiAnalysis] = useState<
    Record<string, AnalysisResult>
  >({});
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState("15m");
  const [analysisTf, setAnalysisTf] = useState("15m");
  const [searchInput, setSearchInput] = useState("BTCUSDT");
  const [layout, setLayout] = useState<"single" | "multi">("single");
  const [trades, setTrades] = useState<Trade[]>(() => {
    const saved = localStorage.getItem("demo_trades");
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
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(() => {
    return localStorage.getItem("endellion_auto_trade") === "true";
  });
  const [scannerStatus, setScannerStatus] = useState<any>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/scanner-status");
        if (res.ok) {
          const data = await res.json();
          setScannerStatus(data);
        }
      } catch (err) {
        console.error("Failed to fetch scanner status:", err);
      }
    };
    fetchStatus();
    const intervalId = setInterval(fetchStatus, 15000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    localStorage.setItem("endellion_auto_trade", String(autoTradeEnabled));
  }, [autoTradeEnabled]);

  useEffect(() => {
    // Keep backend alive so it never goes off
    const pingInterval = window.setInterval(() => {
      fetch("/api/health").catch(() => {});
    }, 45000); // 45 seconds
    return () => window.clearInterval(pingInterval);
  }, []);

  const { data, indicators, error, isConnected } = useBinanceData(symbol, interval);

  const prevTradesForAlerts = useRef<Trade[]>(trades);

  useEffect(() => {
    prevTradesForAlerts.current = trades;
  }, [trades]);

  useEffect(() => {
    localStorage.setItem("demo_trades", JSON.stringify(trades));
  }, [trades]);

  // fetchMultiTimeframeData removed -> data and needed indicators will come through websocket stream

  useEffect(() => {
    if (indicators) {
      setAnalysis(indicators);
    } else if (data.length === 0) {
      setAnalysis(null);
    }
  }, [indicators, data.length]);

  useEffect(() => {
    if (["5m", "15m", "1h", "4h"].includes(interval)) {
      setAnalysisTf(interval);
    }
  }, [interval]);

  useEffect(() => {
    if (data.length === 0) return;

    setTrades((prevTrades) => {
      let changed = false;
      const newTrades = prevTrades.map((trade) => {
        if (trade.status !== "PENDING") return trade;
        if (trade.symbol !== symbol) return trade;

        let newStatus = trade.status;

        for (let i = 0; i < data.length; i++) {
          const candle = data[i];
          const candleTime = candle.time * 1000;

          if (candleTime > trade.timestamp) {
            if (trade.type === "LONG") {
              if (candle.high >= trade.tp) {
                newStatus = "SUCCESS";
                break;
              }
              if (candle.low <= trade.sl) {
                newStatus = "FAILED";
                break;
              }
            } else {
              if (candle.low <= trade.tp) {
                newStatus = "SUCCESS";
                break;
              }
              if (candle.high >= trade.sl) {
                newStatus = "FAILED";
                break;
              }
            }
          } else if (
            candleTime <= trade.timestamp &&
            (i === data.length - 1 || data[i + 1].time * 1000 > trade.timestamp)
          ) {
            if (trade.type === "LONG") {
              if (candle.close >= trade.tp) {
                newStatus = "SUCCESS";
                break;
              }
              if (candle.close <= trade.sl) {
                newStatus = "FAILED";
                break;
              }
            } else {
              if (candle.close <= trade.tp) {
                newStatus = "SUCCESS";
                break;
              }
              if (candle.close >= trade.sl) {
                newStatus = "FAILED";
                break;
              }
            }
          }
        }

        if (newStatus !== trade.status) changed = true;
        return { ...trade, status: newStatus };
      });
      return changed ? newTrades : prevTrades;
    });
  }, [data, symbol]);

  const activeAnalysis =
    analysisTf === interval ? analysis : multiAnalysis[analysisTf] || analysis;
  const activeTrade = trades.find(
    (t) => t.symbol === symbol && t.status === "PENDING",
  );

  const trackTradeSignal = () => {
    if (
      !activeAnalysis ||
      activeAnalysis.signal === "NO TRADE" ||
      !activeAnalysis.tp ||
      !activeAnalysis.sl
    )
      return;
    if (data.length === 0) return;

    // Prevent duplicate active trades for the same coin
    const hasActiveTrade = trades.some(t => t.symbol === symbol && t.status === 'PENDING');
    if (hasActiveTrade) {
      if (showConfirmDialog) {
        alert(`There is already an active trade for ${symbol}. Please wait for it to finish or delete it before starting a new one.`);
        setShowConfirmDialog(false);
      }
      return;
    }

    const currentPrice = data[data.length - 1].close;

    const tpDistance =
      Math.abs(activeAnalysis.tp - currentPrice) / currentPrice;
    if (tpDistance < 0.01) {
      console.log("TP distance too small, trade rejected.");
      return;
    }

    const newTrade: Trade = {
      id: Math.random().toString(36).substr(2, 9),
      symbol: symbol,
      type: activeAnalysis.signal,
      entry: currentPrice,
      tp: activeAnalysis.tp,
      sl: activeAnalysis.sl,
      status: "PENDING",
      timestamp: Date.now(),
    };

    setTrades((prev) => [newTrade, ...prev].slice(0, 100));
    setShowConfirmDialog(false);

    // Tell backend to explicitly monitor this trade, keeping Telegram alive regardless of frontend.
    fetch("/api/trade/register-active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newTrade)
    }).catch(console.error);
  };

  // Auto-trade Logic
  useEffect(() => {
    if (autoTradeEnabled && activeAnalysis && activeAnalysis.signal !== "NO TRADE" && activeAnalysis.tp && activeAnalysis.sl) {
      const hasActiveTrade = trades.some(t => t.symbol === symbol && t.status === 'PENDING');
      if (!hasActiveTrade) {
        trackTradeSignal();
      }
    }
  }, [activeAnalysis, autoTradeEnabled, trades, symbol]);

  return (
    <div className="h-screen w-screen bg-[#050505] text-white/90 font-sans overflow-hidden flex flex-col selection:bg-emerald-500/30">
      {/* Top Navigation Bar */}
      <header className="min-h-14 sm:h-14 border-b border-white/10 bg-[#0A0A0A] flex flex-col sm:flex-row items-center justify-between px-3 sm:px-5 py-2.5 sm:py-0 gap-3 shrink-0">
        <div className="flex items-center justify-between w-full sm:w-auto gap-3 shrink-0">
          <h1 className="flex items-center gap-2 text-emerald-500 m-0 shrink-0">
            <ActivitySquare size={18} />
            <span className="font-bold tracking-widest uppercase text-xs sm:text-sm text-white">
              ENDELLION<span className="text-emerald-500">-TRADE</span>
            </span>
          </h1>

          {/* Connected Indicator for Small Screens */}
          <div className="flex items-center gap-2 sm:hidden bg-white/5 border border-white/5 px-2.5 py-1 rounded-md">
            <div
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                isConnected
                  ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                  : "bg-rose-500",
              )}
            />
            <span className="text-[9px] font-mono font-bold text-white/50 uppercase tracking-widest">
              {isConnected ? "LIVE" : "OFFLINE"}
            </span>
          </div>
        </div>

        {/* Search & Actions block */}
        <div className="flex items-center justify-between sm:justify-end gap-3.5 w-full sm:w-auto shrink-0">
          {/* Symbol Search */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              let newSymbol = searchInput.toUpperCase().trim();
              if (newSymbol) {
                if (
                  !newSymbol.endsWith("USDT") &&
                  !newSymbol.endsWith("BTC") &&
                  !newSymbol.endsWith("ETH") &&
                  !newSymbol.endsWith("BNB") &&
                  !newSymbol.endsWith("USDC") &&
                  !newSymbol.endsWith("FDUSD")
                ) {
                  newSymbol += "USDT";
                }
                setSymbol(newSymbol);
                setSearchInput(newSymbol);
              }
            }}
            className="flex items-center gap-1.5 relative shrink-0"
          >
            <div className="relative flex items-center">
              <Search size={13} className="absolute left-2.5 text-white/40" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className={cn(
                  "bg-white/5 border rounded-lg pl-8 pr-2 py-1.5 text-xs font-mono text-white placeholder:text-white/30 focus:outline-none focus:bg-white/10 transition-all w-[100px] sm:w-[120px] uppercase",
                  error
                    ? "border-rose-500/50 focus:border-rose-500"
                    : "border-white/10 focus:border-emerald-500/50",
                )}
                placeholder="SYMBOL"
              />
            </div>
            <button
              type="submit"
              className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/20 rounded-lg px-3 py-1.5 text-xs font-mono font-bold uppercase transition-colors shrink-0 cursor-pointer"
            >
              Scan
            </button>
            {error && (
              <div className="absolute top-[110%] left-0 text-[9px] text-rose-400 font-mono whitespace-nowrap bg-rose-500/10 px-2 py-1 rounded border border-rose-500/20 z-50">
                {error}
              </div>
            )}
          </form>

          <div className="flex items-center gap-2 shrink-0">
            {/* Auto Trade Toggle */}
            <div
              onClick={() => setAutoTradeEnabled(!autoTradeEnabled)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] sm:text-xs font-mono transition-colors cursor-pointer select-none",
                autoTradeEnabled 
                  ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400 font-bold" 
                  : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80"
              )}
            >
              <div className={cn(
                "w-1.5 h-1.5 rounded-full",
                autoTradeEnabled ? "bg-emerald-400 animate-pulse" : "bg-white/20"
              )} />
              <span>Auto</span>
            </div>

            {/* Layout Toggle */}
            <div className="hidden sm:flex items-center gap-1 bg-white/5 p-1 rounded-lg border border-white/10 shrink-0">
              <button
                onClick={() => setLayout("single")}
                className={cn(
                  "p-1 rounded transition-all cursor-pointer",
                  layout === "single"
                    ? "bg-white/10 text-emerald-400"
                    : "text-white/40 hover:text-white/80",
                )}
                title="Single Chart"
              >
                <Square size={13} />
              </button>
              <button
                onClick={() => setLayout("multi")}
                className={cn(
                  "p-1 rounded transition-all cursor-pointer",
                  layout === "multi"
                    ? "bg-white/10 text-emerald-400"
                    : "text-white/40 hover:text-white/80",
                )}
                title="Multi Chart"
              >
                <LayoutGrid size={13} />
              </button>
            </div>
            
            {/* Connection Indicator (Desktop) */}
            <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-white/10">
              <div
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  isConnected
                    ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                    : "bg-rose-500",
                )}
              />
              <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                {isConnected ? "online" : "offline"}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Grid */}
      <main className="flex-1 overflow-y-auto custom-scrollbar bg-[#050505]">
        <div className="max-w-[1600px] mx-auto p-2 sm:p-4 flex flex-col gap-4">
          {/* Top Panel: Chart */}
          <section
            className={cn(
              "w-full rounded-xl border border-white/10 bg-[#0A0A0A] overflow-hidden relative shadow-2xl transition-all duration-300",
              layout === "multi"
                ? "h-[800px] sm:h-[600px] lg:h-[70vh]"
                : "h-[45vh] sm:h-[60vh] min-h-[320px] sm:min-h-[550px]",
            )}
          >
            {layout === "single" ? (
              <div className="w-full h-full relative">
                <div className="absolute top-2 sm:top-4 left-2 sm:left-4 z-20 flex items-center gap-1 bg-black/80 backdrop-blur border border-white/10 p-1 rounded-lg shadow-xl max-w-[calc(100%-1rem)] sm:max-w-[calc(100%-2rem)] overflow-x-auto no-scrollbar">
                  {["1m", "5m", "15m", "1h", "4h", "1d"].map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setInterval(tf)}
                      className={cn(
                        "px-2 sm:px-3 py-1 sm:py-1.5 rounded text-[10px] sm:text-xs font-mono font-bold transition-colors cursor-pointer",
                        interval === tf
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "text-white/60 hover:text-white hover:bg-white/10",
                      )}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
                <MemoizedChart
                  key={`${symbol}-${interval}`}
                  symbol={symbol}
                  interval={interval}
                  activeTrade={activeTrade}
                  activeAnalysis={activeAnalysis}
                />
              </div>
            ) : (
              <div className="w-full h-full grid grid-cols-1 sm:grid-cols-2 grid-rows-4 sm:grid-rows-2 gap-px bg-white/10">
                {["5m", "15m", "1h", "4h"].map((tf) => (
                  <div
                    key={`${symbol}-${tf}-multi`}
                    className={cn(
                      "w-full h-full bg-[#0A0A0A] relative transition-all min-h-[200px] sm:min-h-0",
                      interval === tf
                        ? "ring-2 ring-inset ring-emerald-500 z-10"
                        : "",
                    )}
                  >
                    <button
                      onClick={() => setInterval(tf)}
                      className={cn(
                        "absolute top-2 left-2 z-20 backdrop-blur px-2 sm:px-3 py-1 sm:py-1.5 rounded text-[10px] sm:text-xs font-mono font-bold border transition-colors cursor-pointer shadow-lg",
                        interval === tf
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/50"
                          : "bg-black/80 text-white/80 border-white/20 hover:bg-white/20 hover:text-white",
                      )}
                    >
                      {tf}
                    </button>
                    <MemoizedChart
                      key={`${symbol}-${tf}`}
                      symbol={symbol}
                      interval={tf}
                      activeTrade={activeTrade}
                      activeAnalysis={multiAnalysis[tf] || analysis}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Middle Panel: ENDELLION-TRADE */}
          <section className="w-full rounded-xl border border-white/10 bg-[#0A0A0A] overflow-hidden shadow-xl">
            <div className="p-4 border-b border-white/10 bg-white/[0.01] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 w-full lg:w-auto">
                <div className="flex items-center justify-between w-full sm:w-auto">
                  <h2 className="text-[10px] font-mono text-white/40 uppercase tracking-widest m-0 shrink-0">
                    ENDELLION-TRADE CONFIG{" "}
                    <span className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded ml-1">
                      [{analysisTf}]
                    </span>
                  </h2>
                </div>
                
                {/* Timeframe Taps */}
                <div className="grid grid-cols-4 sm:flex items-center gap-1.5 w-full sm:w-auto">
                  {["5m", "15m", "1h", "4h"].map((tf) => {
                    const res = multiAnalysis[tf];
                    if (!res) return null;
                    return (
                      <button
                        key={tf}
                        onClick={() => setAnalysisTf(tf)}
                        className={cn(
                          "flex justify-center items-center gap-1.5 border rounded-lg py-2 sm:py-1 px-3.5 transition-all cursor-pointer text-xs font-mono font-bold",
                          analysisTf === tf
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-sm"
                            : "border-white/5 bg-white/[0.02] text-white/55 hover:bg-white/5 hover:text-white",
                        )}
                        title={`${tf} Signal: ${res.signal}`}
                      >
                        <span>{tf}</span>
                        <div
                          className={cn(
                            "w-1.5 h-1.5 rounded-full shrink-0",
                            res.signal === "LONG"
                              ? "bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]"
                              : res.signal === "SHORT"
                                ? "bg-rose-500 shadow-[0_0_5px_rgba(244,63,94,0.5)]"
                                : "bg-yellow-500 shadow-[0_0_5px_rgba(234,179,8,0.5)]",
                          )}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Dynamic Target, SL, Score, Signal Action */}
              <div className="grid grid-cols-2 sm:flex sm:items-center gap-x-4 gap-y-3 w-full lg:w-auto pt-3 lg:pt-0 border-t lg:border-t-0 border-white/5">
                {/* TP Column */}
                <div className="flex flex-col">
                  <span className="text-[9px] font-mono text-emerald-400/50 uppercase tracking-widest flex items-center gap-1">
                    <Target className="w-3 h-3 text-emerald-400" /> Target (TP)
                  </span>
                  <span className="text-sm font-mono font-bold text-emerald-400 mt-1">
                    {((activeTrade ? activeTrade.tp : activeAnalysis?.tp) || 0).toFixed(6)}
                  </span>
                </div>

                {/* SL Column */}
                <div className="flex flex-col">
                  <span className="text-[9px] font-mono text-rose-400/50 uppercase tracking-widest flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-rose-400" /> Stop (SL)
                  </span>
                  <span className="text-sm font-mono font-bold text-rose-400 mt-1">
                    {((activeTrade ? activeTrade.sl : activeAnalysis?.sl) || 0).toFixed(6)}
                  </span>
                </div>

                {/* Score Column */}
                <div className="flex flex-col">
                  <span className="text-[9px] font-mono text-white/40 uppercase tracking-widest">
                    Confidence
                  </span>
                  <div
                    className={cn(
                      "text-sm sm:text-base font-bold font-mono transition-colors duration-500 mt-1",
                      activeAnalysis?.confidence && activeAnalysis.confidence >= 85
                        ? "text-emerald-400"
                        : activeAnalysis?.confidence && activeAnalysis.confidence < 60
                          ? "text-rose-400"
                          : "text-white",
                    )}
                  >
                    {typeof activeAnalysis?.confidence === "number" &&
                    !isNaN(activeAnalysis.confidence) ? (
                      <AnimatedNumber value={activeAnalysis.confidence} />
                    ) : (
                      "0"
                    )}
                    %
                  </div>
                </div>

                {/* Signal Badge & Track Button */}
                <div className="col-span-2 sm:col-span-1 flex items-center justify-between sm:justify-start gap-4">
                  <div
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-mono font-bold uppercase tracking-wider border flex items-center justify-center min-w-[70px]",
                      activeAnalysis?.signal === "LONG"
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : activeAnalysis?.signal === "SHORT"
                          ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                          : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
                    )}
                  >
                    {activeAnalysis?.signal || "WAIT"}
                  </div>

                  {activeAnalysis?.signal && activeAnalysis.signal !== "NO TRADE" && (
                    <button
                      onClick={() => setShowConfirmDialog(true)}
                      className={cn(
                        "flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-mono font-bold uppercase transition-all border shadow-lg flex items-center justify-center gap-2 active:scale-95 cursor-pointer whitespace-nowrap",
                        activeAnalysis.signal === "LONG"
                          ? "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border-emerald-500/50 hover:shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                          : "bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border-rose-500/50 hover:shadow-[0_0_15px_rgba(244,63,94,0.2)]",
                      )}
                    >
                      <Target size={14} />
                      <span>Track Signal</span>
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
                  <span className="text-[10px] font-mono uppercase tracking-widest">
                    Supporting
                  </span>
                  <span className="ml-auto text-[9px] font-mono bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded">
                    {activeAnalysis?.confluences.supporting.length || 0}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {activeAnalysis?.confluences.supporting.map((name) => (
                    <div
                      key={name}
                      className="flex items-start gap-2 text-xs font-mono text-white/70 bg-white/[0.02] px-2.5 py-1.5 rounded border border-white/[0.02]"
                    >
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
                  <span className="text-[10px] font-mono uppercase tracking-widest">
                    Opposing
                  </span>
                  <span className="ml-auto text-[9px] font-mono bg-rose-500/10 text-rose-400 px-1.5 py-0.5 rounded">
                    {activeAnalysis?.confluences.opposing.length || 0}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {activeAnalysis?.confluences.opposing.map((name) => (
                    <div
                      key={name}
                      className="flex items-start gap-2 text-xs font-mono text-white/70 bg-white/[0.02] px-2.5 py-1.5 rounded border border-white/[0.02]"
                    >
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
                  <span className="text-[10px] font-mono uppercase tracking-widest">
                    Neutral
                  </span>
                  <span className="ml-auto text-[9px] font-mono bg-yellow-500/10 text-yellow-400 px-1.5 py-0.5 rounded">
                    {activeAnalysis?.confluences.neutral.length || 0}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {activeAnalysis?.confluences.neutral.map((name) => (
                    <div
                      key={name}
                      className="flex items-start gap-2 text-xs font-mono text-white/70 bg-white/[0.02] px-2.5 py-1.5 rounded border border-white/[0.02]"
                    >
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
              <h2 className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                Technical Indicators
              </h2>
            </div>
            <div className="p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {activeAnalysis?.indicators.map((indicator) => (
                <div
                  key={indicator.name}
                  className="bg-black/40 border border-white/5 p-4 rounded-lg hover:border-white/20 hover:bg-white/[0.02] transition-all duration-300 group shadow-inner"
                >
                  <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider mb-2 group-hover:text-white/70 transition-colors truncate">
                    {indicator.name}
                  </div>
                  <div className="flex items-end justify-between">
                    <div className="text-sm sm:text-base font-mono font-bold text-white/90 group-hover:text-white transition-colors truncate pr-2">
                      {indicator.value}
                    </div>
                    {indicator.signal === "bullish" ? (
                      <TrendingUp
                        size={14}
                        className="text-emerald-400 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity"
                      />
                    ) : indicator.signal === "bearish" ? (
                      <TrendingDown
                        size={14}
                        className="text-rose-400 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity"
                      />
                    ) : (
                      <Minus
                        size={14}
                        className="text-yellow-400 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Bottom Panel: Trades */}
          <section className="w-full rounded-xl border border-white/10 bg-[#0A0A0A] overflow-hidden shadow-xl mb-8">
            <div className="p-4 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
              <h2 className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                Recent Trades
              </h2>
              {trades.length > 0 && (
                <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest flex gap-4">
                  <span>Total: {trades.length}</span>
                  <span>
                    Win Rate:{" "}
                    {trades.filter(
                      (t) => t.status === "SUCCESS" || t.status === "FAILED",
                    ).length > 0
                      ? (
                          (trades.filter((t) => t.status === "SUCCESS").length /
                            trades.filter(
                              (t) =>
                                t.status === "SUCCESS" || t.status === "FAILED",
                            ).length) *
                            100 || 0
                        ).toFixed(1)
                      : "0.0"}
                    %
                  </span>
                </div>
              )}
            </div>
            <div className="p-0 overflow-x-auto no-scrollbar">
              {trades.length === 0 ? (
                <div className="p-12 text-center text-white/40 font-mono text-xs flex flex-col items-center gap-2">
                  <ActivitySquare size={24} className="opacity-20" />
                  <span>No signals tracked yet.</span>
                </div>
              ) : (
                <div className="min-w-[800px]">
                  {/* Header */}
                  <div className="grid grid-cols-8 gap-4 p-4 border-b border-white/5 bg-[#111] text-[10px] font-mono text-white/40 uppercase tracking-widest sticky top-0 z-10">
                    <div className="col-span-1 flex items-center">Time</div>
                    <div className="col-span-1 flex items-center">Pair</div>
                    <div className="col-span-1 flex items-center">Type</div>
                    <div className="col-span-1 flex items-center">Entry</div>
                    <div className="col-span-1 flex items-center">
                      Target (TP)
                    </div>
                    <div className="col-span-1 flex items-center">
                      Stop (SL)
                    </div>
                    <div className="col-span-1 flex items-center justify-end">
                      Status
                    </div>
                    <div className="col-span-1 flex items-center justify-end">
                      Action
                    </div>
                  </div>

                  {/* Body */}
                  <div className="flex flex-col">
                    {trades.map((trade) => (
                      <div
                        key={trade.id}
                        className="grid grid-cols-8 gap-4 p-4 border-b border-white/5 hover:bg-white/[0.02] transition-colors group items-center"
                      >
                        <div className="col-span-1 text-xs font-mono text-white/60 group-hover:text-white/80 transition-colors">
                          {new Date(trade.timestamp).toLocaleTimeString()}
                        </div>
                        <div className="col-span-1 text-sm font-bold text-white group-hover:text-emerald-400 transition-colors">
                          {trade.symbol}
                        </div>
                        <div className="col-span-1">
                          <span
                            className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-bold tracking-wider",
                              trade.type === "LONG"
                                ? "bg-emerald-500/10 text-emerald-400"
                                : "bg-rose-500/10 text-rose-400",
                            )}
                          >
                            {trade.type}
                          </span>
                        </div>
                        <div className="col-span-1 text-sm font-mono text-white/80 group-hover:text-white transition-colors">
                          {(trade.entry || 0).toFixed(2)}
                        </div>
                        <div className="col-span-1 text-sm font-mono text-emerald-400/80 group-hover:text-emerald-400 transition-colors">
                          {(trade.tp || 0).toFixed(2)}
                        </div>
                        <div className="col-span-1 text-sm font-mono text-rose-400/80 group-hover:text-rose-400 transition-colors">
                          {(trade.sl || 0).toFixed(2)}
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <span
                            className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-bold tracking-wider",
                              trade.status === "SUCCESS"
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/20"
                                : trade.status === "FAILED"
                                  ? "bg-rose-500/20 text-rose-400 border border-rose-500/20"
                                  : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20",
                            )}
                          >
                            {trade.status}
                          </span>
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <button
                            onClick={() =>
                              setTrades((prev) =>
                                prev.filter((t) => t.id !== trade.id),
                              )
                            }
                            className="text-rose-400/50 hover:text-rose-400 p-1.5 rounded hover:bg-rose-500/10 transition-colors"
                            title="Delete Trade"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Bottom Panel: Top Trades */}
          <TopTradesTable trades={trades} />

          {/* Credit Section */}
          <footer className="w-full text-center py-8 mt-4 border-t border-white/5 flex flex-col items-center justify-center gap-1">
            <p className="text-xs font-mono text-white/40 tracking-widest">
              ©All Right Reserve to Sami_001 ©
            </p>
            <p className="text-[10px] font-mono text-white/30">since 2026</p>
          </footer>
        </div>
      </main>

      {/* Confirmation Dialog */}
      {showConfirmDialog && activeAnalysis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#0A0A0A] border border-white/10 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/[0.02]">
              <h3 className="text-sm font-mono font-bold text-white uppercase tracking-widest">
                Confirm Tracking
              </h3>
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
                <span
                  className={cn(
                    "px-2 py-0.5 rounded text-xs font-bold tracking-wider",
                    activeAnalysis.signal === "LONG"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-rose-500/10 text-rose-400",
                  )}
                >
                  {activeAnalysis.signal}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/40">Entry Price</span>
                <span className="text-white/80">
                  {(data[data.length - 1]?.close || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/40">Take Profit (Main)</span>
                <span className="text-emerald-400">
                  {activeAnalysis.tp?.toFixed(2)}
                </span>
              </div>
              {activeAnalysis.tp1 && (
                <div className="flex justify-between items-center">
                  <span className="text-white/40">Take Profit 1 (Scale Out)</span>
                  <span className="text-emerald-400">
                    {activeAnalysis.tp1?.toFixed(2)}
                  </span>
                </div>
              )}
              {activeAnalysis.tp2 && (
                <div className="flex justify-between items-center">
                  <span className="text-white/40">Take Profit 2 (Scale Out)</span>
                  <span className="text-emerald-400">
                    {activeAnalysis.tp2?.toFixed(2)}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-white/40">Stop Loss</span>
                <span className="text-rose-400">
                  {activeAnalysis.sl?.toFixed(2)}
                </span>
              </div>
              {activeAnalysis.breakEvenTrigger && (
                <div className="flex justify-between items-center">
                  <span className="text-white/40">Break Even Trigger</span>
                  <span className="text-blue-400">
                    {activeAnalysis.breakEvenTrigger?.toFixed(2)}
                  </span>
                </div>
              )}
              {activeAnalysis.trailingStopMode && (
                <div className="flex justify-between items-center">
                  <span className="text-white/40">Trailing Stop</span>
                  <span className="text-blue-400">
                    {activeAnalysis.trailingStopMode}
                  </span>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-white/10 bg-white/[0.02] flex gap-3">
              <button
                onClick={() => setShowConfirmDialog(false)}
                className="flex-1 px-4 py-2 rounded text-xs font-mono font-bold uppercase transition-colors border border-white/10 text-white/60 hover:text-white hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={trackTradeSignal}
                className={cn(
                  "flex-1 px-4 py-2 rounded text-xs font-mono font-bold uppercase transition-colors border",
                  activeAnalysis.signal === "LONG"
                    ? "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border-emerald-500/50"
                    : "bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border-rose-500/50",
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
