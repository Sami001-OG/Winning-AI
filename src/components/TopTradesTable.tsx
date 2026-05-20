import React, { useState } from 'react';
import { Trade } from '../types';
import { TrendingUp, TrendingDown, Minus, Activity, RefreshCw, Lock, Unlock } from 'lucide-react';
import { formatPrice } from '../utils/format';
import { useSignalScanner } from '../hooks/useSignalScanner';

interface TopTradesTableProps {
  trades: Trade[]; // Kept for prop compatibility
}

export const TopTradesTable: React.FC<TopTradesTableProps> = () => {
  const { signals, loading, error, lastUpdate } = useSignalScanner();
  const [frozenEntries, setFrozenEntries] = useState<Record<string, number>>({});
  
  const toggleFreeze = (symbol: string) => {
    setFrozenEntries(prev => {
      const isFrozen = !!prev[symbol];
      if (isFrozen) {
        const next = { ...prev };
        delete next[symbol];
        return next;
      } else {
        const sig = signals.find(s => s.symbol === symbol);
        return {
          ...prev,
          [symbol]: sig?.analysis?.suggestedEntry || sig?.lastPrice || 0
        };
      }
    });
  };

  if (loading) {
    return (
      <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-indigo-500/20 rounded-lg flex items-center justify-center">
              <Activity className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Live Confluence Scanner</h2>
              <p className="text-sm text-zinc-400">Loading data from backend...</p>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#0A0A0A] rounded-xl p-4 sm:p-6 border border-white/10 shadow-2xl relative">
      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-emerald-500 to-indigo-500 rounded-t-xl" />
      
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center relative overflow-hidden shrink-0">
            <div className="absolute inset-0 bg-emerald-500/10 animate-ping opacity-30" />
            <Activity className="w-5 h-5 text-emerald-400 relative z-10" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2 m-0">
              Live Confluence Scanner
            </h2>
            <p className="text-xs text-white/50 flex items-center gap-2 m-0 mt-0.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              Grid Network Synchronized
            </p>
          </div>
        </div>

        <div className="flex sm:flex-col justify-between sm:justify-center items-center sm:items-end text-xs font-mono font-medium border-t sm:border-t-0 border-white/5 pt-2 sm:pt-0">
          <div className="text-white/40">
            Sync Rate: ~5s
          </div>
          <div className="text-emerald-400 flex items-center gap-1.5 mt-0.5">
            <RefreshCw className="w-3 h-3 animate-spin"/>
            <span>Updated: {lastUpdate.toLocaleTimeString()}</span>
          </div>
        </div>
      </div>

      {error ? (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-4 mb-6">
          <p className="text-rose-400 text-sm m-0">{error}</p>
        </div>
      ) : signals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-white/40">
          <Activity className="w-12 h-12 text-white/10 mb-4" />
          <p className="m-0 font-mono text-sm">No active signals match filters</p>
          <p className="text-xs text-white/30 m-0 mt-1">Awaiting high-probability trend discovery...</p>
        </div>
      ) : (
        <>
          {/* Desktop Table View (>= md breakpoint) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-white/40 text-[10px] font-mono uppercase tracking-widest border-b border-white/10">
                  <th className="pb-3 px-4 font-semibold">Pair</th>
                  <th className="pb-3 px-4 font-semibold text-right">Entry / Target</th>
                  <th className="pb-3 px-4 font-semibold text-center">Score</th>
                  <th className="pb-3 px-4 font-semibold text-center">Signal Type</th>
                  <th className="pb-3 px-4 font-semibold text-center">Lock Edge</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {signals.map((s, idx) => {
                  const isFrozen = !!frozenEntries[s.symbol];
                  const displayEntry = isFrozen ? frozenEntries[s.symbol] : (s.analysis?.suggestedEntry || s.lastPrice);
                  
                  const getConfidenceColor = (confidence: number) => {
                    if (confidence >= 85) return 'text-emerald-400';
                    if (confidence >= 60) return 'text-yellow-400';
                    return 'text-white/50';
                  };

                  return (
                    <tr key={`${s.symbol}-${idx}`} className="group hover:bg-white/[0.02] transition-colors duration-150">
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2.5">
                          <div className="font-bold text-white text-base transition-colors group-hover:text-emerald-400">
                            {s.symbol.replace('USDT', '')}
                          </div>
                          <div className="text-[10px] font-mono text-white/40 px-2 py-0.5 bg-white/5 rounded-full">
                            /USDT
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <div className="flex flex-col items-end space-y-1">
                          <div className={`font-mono text-sm font-bold ${
                            isFrozen ? 'text-indigo-400' : 'text-white/90'
                          }`}>
                            {formatPrice(displayEntry)}
                          </div>
                          <div className="flex items-center space-x-2.5 text-[11px] font-mono">
                             <div className="text-emerald-400 flex items-center">
                               <TrendingUp className="w-3 h-3 mr-0.5" />
                               {formatPrice(s.analysis?.tp1 || s.analysis?.tp || 0)}
                             </div>
                             <div className="text-white/20">|</div>
                             <div className="text-rose-400 flex items-center">
                               <TrendingDown className="w-3 h-3 mr-0.5" />
                               {formatPrice(s.analysis?.sl || 0)}
                             </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex flex-col items-center">
                          <span className={`font-mono text-sm font-bold ${getConfidenceColor(s.analysis?.confidence || 0)}`}>
                            {(s.analysis?.confidence || 0).toFixed(1)}%
                          </span>
                          <div className="w-20 h-1 bg-white/5 rounded-full mt-1.5 overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${s.analysis?.confidence >= 85 ? 'bg-emerald-500' : s.analysis?.confidence >= 60 ? 'bg-yellow-500' : 'bg-white/20'}`}
                              style={{ width: `${s.analysis?.confidence || 0}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center justify-center">
                          <div className={`flex items-center space-x-1.5 font-bold px-3 py-1 border text-xs rounded-md shadow-sm w-max
                            ${s.analysis?.signal === 'LONG' 
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                              : s.analysis?.signal === 'SHORT'
                                ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                            }`}>
                            {s.analysis?.signal === 'LONG' ? <TrendingUp className="w-3.5 h-3.5" /> : 
                             s.analysis?.signal === 'SHORT' ? <TrendingDown className="w-3.5 h-3.5" /> : 
                             <Minus className="w-3.5 h-3.5" />}
                            <span>{s.analysis?.signal || 'WAIT'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex justify-center">
                          <button
                            onClick={() => toggleFreeze(s.symbol)}
                            className={`p-1.5 rounded-md transition-all border shadow-sm flex items-center justify-center hover:scale-105 active:scale-95 cursor-pointer
                              ${isFrozen 
                                ? 'bg-indigo-500 text-white border-indigo-400/30' 
                                : 'bg-white/5 text-white/50 border-white/10 hover:border-white/20 hover:text-white hover:bg-white/10'
                              }`}
                            title={isFrozen ? "Unlock Entry Price" : "Lock Entry Price"}
                          >
                            {isFrozen ? (
                              <Lock className="w-3.5 h-3.5" />
                            ) : (
                              <Unlock className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phone Mobile/Tablet Cards View (< md breakpoint) */}
          <div className="md:hidden space-y-4">
            {signals.map((s, idx) => {
              const isFrozen = !!frozenEntries[s.symbol];
              const displayEntry = isFrozen ? frozenEntries[s.symbol] : (s.analysis?.suggestedEntry || s.lastPrice);
              
              const getConfidenceBg = (confidence: number) => {
                if (confidence >= 85) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
                if (confidence >= 60) return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
                return 'bg-white/5 text-white/50 border-white/10';
              };

              return (
                <div 
                  key={`${s.symbol}-${idx}-mobile`}
                  className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-3.5 transition-all hover:bg-white/[0.04]"
                >
                  {/* Top header row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-white text-base tracking-tight">
                        {s.symbol.replace('USDT', '')}
                      </span>
                      <span className="text-[9px] font-mono text-white/40 px-2 py-0.5 bg-white/5 rounded-full">
                        /USDT
                      </span>
                    </div>

                    <div className={`flex items-center space-x-1.5 font-bold px-2.5 py-1 text-[11px] rounded border
                      ${s.analysis?.signal === 'LONG' 
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                        : s.analysis?.signal === 'SHORT'
                          ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                          : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                      }`}
                    >
                      {s.analysis?.signal === 'LONG' ? <TrendingUp className="w-3 h-3" /> : 
                       s.analysis?.signal === 'SHORT' ? <TrendingDown className="w-3 h-3" /> : 
                       <Minus className="w-3 h-3" />}
                      <span>{s.analysis?.signal || 'WAIT'}</span>
                    </div>
                  </div>

                  {/* Signal Stats Grid */}
                  <div className="grid grid-cols-3 gap-2 py-2.5 border-y border-white/5 text-xs">
                    <div>
                      <div className="text-[9px] text-white/40 font-mono uppercase tracking-wider mb-1">Entry Price</div>
                      <div className={`font-mono font-bold text-xs ${isFrozen ? 'text-indigo-400' : 'text-white'}`}>
                        {formatPrice(displayEntry)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] text-white/40 font-mono uppercase tracking-wider mb-1">Target TP</div>
                      <div className="font-mono font-bold text-xs text-emerald-400">
                        {formatPrice(s.analysis?.tp1 || s.analysis?.tp || 0)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] text-white/40 font-mono uppercase tracking-wider mb-1">Stop Loss</div>
                      <div className="font-mono font-bold text-xs text-rose-400">
                        {formatPrice(s.analysis?.sl || 0)}
                      </div>
                    </div>
                  </div>

                  {/* Confidence metrics & Lock edge button */}
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-white/40 font-mono uppercase tracking-wider">Score:</span>
                      <div className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold border ${getConfidenceBg(s.analysis?.confidence || 0)}`}>
                        {(s.analysis?.confidence || 0).toFixed(1)}%
                      </div>
                    </div>

                    <button
                      onClick={() => toggleFreeze(s.symbol)}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-3.5 rounded-lg text-[11px] font-mono border transition-all cursor-pointer hover:scale-105 active:scale-95
                        ${isFrozen 
                          ? 'bg-indigo-500 border-indigo-400/30 text-white font-bold' 
                          : 'bg-white/5 border-white/10 text-white/60 hover:text-white'
                        }`}
                    >
                      {isFrozen ? (
                        <>
                          <Lock className="w-3.5 h-3.5 text-indigo-200" />
                          <span>Locked</span>
                        </>
                      ) : (
                        <>
                          <Unlock className="w-3.5 h-3.5" />
                          <span>Lock Edge</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
