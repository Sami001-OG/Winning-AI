import { useState, useEffect } from 'react';
import { AnalysisResult } from '../types';

interface TradeSignal {
  symbol: string;
  analysis: AnalysisResult;
  lastPrice: number;
  entryDirection: 'up' | 'down' | 'none';
}

export function useSignalScanner() {
  const [signals, setSignals] = useState<TradeSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    let isMounted = true;
    
    const fetchSignals = async () => {
      try {
        const res = await fetch('/api/top-trades');
        if (!res.ok) throw new Error('Failed to fetch from backend');
        const data = await res.json();
        
        if (!isMounted) return;
        setSignals(data.signals || []);
        setLastUpdate(new Date());
        setLoading(false);
      } catch (err: any) {
        if (isMounted) {
          console.error("Signal scanner error:", err);
          setError(err.message);
          setLoading(false);
        }
      }
    };

    fetchSignals();
    const intervalId = setInterval(fetchSignals, 5000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, []);

  return { signals, loading, error, lastUpdate, setSignals };
}

