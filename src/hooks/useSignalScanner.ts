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
        
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const data = await res.json();
          if (!isMounted) return;
          setSignals(data.signals || []);
          setLastUpdate(new Date());
          setError(null);
        } else {
          // If we receive HTML (e.g. from Vite SPA fallback or cloud proxy), ignore it silently and retry later
          throw new Error('Received non-JSON response, likely server rebooting...');
        }
        setLoading(false);
      } catch (err: any) {
        if (isMounted) {
          setError(err.message !== 'Received non-JSON response, likely server rebooting...' ? err.message : null);
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

