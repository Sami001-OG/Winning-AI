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
              <h2 className="text-xl font-bold text-white">Live AI Scanner</h2>
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
    <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800 shadow-2xl relative">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-t-xl" />
      
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-indigo-500/20 rounded-lg flex items-center justify-center relative overflow-hidden">
            <div className="absolute inset-0 bg-indigo-500/20 animate-ping opacity-50" />
            <Activity className="w-5 h-5 text-indigo-400 relative z-10" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              Live AI Scanner
            </h2>
            <p className="text-sm text-zinc-400 flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              Backend connection active
            </p>
          </div>
        </div>

        <div className="text-right">
          <div className="text-xs font-mono text-zinc-500 mb-1">
            Scanner Sync: ~5s
          </div>
          <div className="text-xs text-zinc-400 flex items-center justify-end gap-2">
            <RefreshCw className="w-3 h-3 animate-spin"/>
            Updated: {lastUpdate.toLocaleTimeString()}
          </div>
        </div>
      </div>

      {error ? (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      ) : signals.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-zinc-500">
          <Activity className="w-12 h-12 text-zinc-700 mb-4" />
          <p>No active signals matching criteria</p>
          <p className="text-sm mt-2">Waiting for next scan cycle from backend...</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-zinc-400 text-xs uppercase tracking-wider border-b border-zinc-800">
                <th className="pb-3 px-4 font-semibold">Pair</th>
                <th className="pb-3 px-4 font-semibold text-right">Entry / Target</th>
                <th className="pb-3 px-4 font-semibold text-center">Score</th>
                <th className="pb-3 px-4 font-semibold">Action</th>
                <th className="pb-3 px-4 font-semibold">Lock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {signals.map((s, idx) => {
                const isFrozen = !!frozenEntries[s.symbol];
                const displayEntry = isFrozen ? frozenEntries[s.symbol] : (s.analysis?.suggestedEntry || s.lastPrice);
                
                const getConfidenceColor = (confidence: number) => {
                  if (confidence >= 85) return 'text-emerald-400 group-hover:text-emerald-600';
                  if (confidence >= 70) return 'text-yellow-400 group-hover:text-yellow-600';
                  return 'text-zinc-400 group-hover:text-black';
                };

                return (
                  <tr key={`${s.symbol}-${idx}`} className="group hover:bg-white/10 transition-colors duration-200">
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-3">
                        <div className="font-bold text-white group-hover:text-black text-lg transition-colors">
                          {s.symbol.replace('USDT', '')}
                        </div>
                        <div className="text-xs font-mono text-zinc-500 group-hover:text-black/60 px-2 py-1 bg-zinc-800 group-hover:bg-white/20 rounded-full transition-colors">
                          /USDT
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <div className="flex flex-col items-end space-y-1">
                        <div className={`font-mono text-lg transition-colors ${
                          isFrozen ? 'text-indigo-400 group-hover:text-indigo-600' : 'text-white group-hover:text-black'
                        }`}>
                          <div className="flex items-center justify-end space-x-2">
                            <span>{formatPrice(displayEntry)}</span>
                          </div>
                        </div>
                        <div className="flex items-center space-x-3 text-xs justify-end">
                           <div className="text-emerald-400 group-hover:text-emerald-600 flex items-center font-mono transition-colors">
                             <TrendingUp className="w-3 h-3 mr-1" />
                             {formatPrice(s.analysis?.tp1 || s.analysis?.tp || 0)}
                           </div>
                           <div className="text-zinc-600 group-hover:text-black/30">|</div>
                           <div className="text-red-400 group-hover:text-red-600 flex items-center font-mono transition-colors">
                             <TrendingDown className="w-3 h-3 mr-1" />
                             {formatPrice(s.analysis?.sl || 0)}
                           </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex flex-col items-center">
                        <span className={`font-bold ${getConfidenceColor(s.analysis?.confidence || 0)}`}>
                          {(s.analysis?.confidence || 0).toFixed(1)}%
                        </span>
                        <div className="w-24 h-1.5 bg-zinc-800 group-hover:bg-black/10 rounded-full mt-1.5 overflow-hidden">
                          <div 
                            className={`h-full rounded-full ${s.analysis?.confidence >= 85 ? 'bg-emerald-500' : s.analysis?.confidence >= 70 ? 'bg-yellow-500' : 'bg-white/20 group-hover:bg-black/20'}`}
                            style={{ width: `${s.analysis?.confidence || 0}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className={`flex items-center space-x-2 font-bold px-3 py-1.5 rounded-lg w-max shadow-lg mx-auto
                        ${s.analysis?.signal === 'LONG' 
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 group-hover:bg-emerald-500 group-hover:text-white group-hover:border-transparent' 
                          : s.analysis?.signal === 'SHORT'
                            ? 'bg-red-500/10 text-red-400 border border-red-500/20 group-hover:bg-red-500 group-hover:text-white group-hover:border-transparent'
                            : 'bg-zinc-800 text-zinc-400 group-hover:bg-zinc-700'
                        } transition-all duration-300`}>
                        {s.analysis?.signal === 'LONG' ? <TrendingUp className="w-4 h-4" /> : 
                         s.analysis?.signal === 'SHORT' ? <TrendingDown className="w-4 h-4" /> : 
                         <Minus className="w-4 h-4" />}
                        <span>{s.analysis?.signal || 'WAIT'}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-center">
                      <button
                        onClick={() => toggleFreeze(s.symbol)}
                        className={`p-2 rounded-lg transition-colors border shadow-sm mx-auto flex items-center justify-center
                          ${isFrozen 
                            ? 'bg-indigo-500 text-white border-transparent hover:bg-indigo-600' 
                            : 'bg-zinc-800 text-zinc-400 border-zinc-700 group-hover:border-zinc-300 group-hover:bg-white group-hover:text-black hover:bg-zinc-100'
                          }`}
                        title={isFrozen ? "Unlock Entry Price" : "Lock Entry Price"}
                      >
                        {isFrozen ? (
                          <Lock className="w-4 h-4" />
                        ) : (
                          <Unlock className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
