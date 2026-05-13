import { useState, useEffect } from 'react';
import { Candle } from '../types';
import { fetchWithRetry } from '../utils/api';

const dataCache: Record<string, Candle[]> = {};

export const useBinanceData = (symbol: string, interval: string) => {
  const [data, setData] = useState<Candle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const key = `${symbol.toLowerCase()}_${interval}`;

  useEffect(() => {
    let isMounted = true;
    
    if (!dataCache[key]) {
      setData([]);
    } else {
      setData(dataCache[key]);
    }

    const fetchData = async () => {
      try {
        const response = await fetchWithRetry(`/api/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=500`);
        if (!response.ok) throw new Error('Failed to fetch data');
        
        // Wait, the backend already gives us data mapped as Candle objects!
        // Let's check backend /api/klines response
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
           throw new Error("Received non-JSON response from server");
        }
        const rawData = await response.json();
        
        // The backend proxy returns custom candle objects, not array of arrays!
        // Because fetchKlines returns klineCache slices, which are formatted as { time, open, high, low, close... }
        let candles: Candle[];
        
        if (Array.isArray(rawData) && rawData.length > 0) {
           if (Array.isArray(rawData[0])) {
               candles = rawData.map((k: any) => ({
                 time: Math.floor(k[0] / 1000),
                 open: parseFloat(k[1]),
                 high: parseFloat(k[2]),
                 low: parseFloat(k[3]),
                 close: parseFloat(k[4]),
                 volume: parseFloat(k[5]),
                 isFinal: true
               }));
           } else {
               candles = rawData as Candle[];
           }
        } else {
            candles = [];
        }

        if (isMounted) {
          dataCache[key] = candles;
          setData(candles);
          setIsConnected(true);
        }
      } catch (err: any) {
        if (isMounted) {
            setError(err.message);
            setIsConnected(false);
        }
      }
    };

    fetchData();
    const intervalId = setInterval(fetchData, 3000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [symbol, interval, key]);

  return { data, error, isConnected };
};
