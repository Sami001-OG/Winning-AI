import { useState, useEffect, useRef } from 'react';
import { Candle } from '../types';
import { fetchWithRetry } from '../utils/api';

const wsCache: Record<string, WebSocket> = {};
const dataCache: Record<string, Candle[]> = {};
const listeners: Record<string, ((candle: Candle) => void)[]> = {};
const statusListeners: Record<string, ((status: boolean) => void)[]> = {};

export const useBinanceData = (symbol: string, interval: string) => {
  const [data, setData] = useState<Candle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const key = `${symbol.toLowerCase()}@kline_${interval}`;

  useEffect(() => {
    let isMounted = true;
    
    // Clear data immediately when key changes, unless we have it in cache
    if (!dataCache[key]) {
      setData([]);
    }

    const fetchData = async () => {
      if (dataCache[key]) {
        setData(dataCache[key]);
        // If we have cached data, we assume we're connected or connecting
        return;
      }

      try {
        // Use Futures API to match the rest of the app
        const response = await fetchWithRetry(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=500`);
        if (!response.ok) throw new Error('Failed to fetch data');
        
        const rawData = await response.json();
        const candles: Candle[] = rawData.map((k: any) => ({
          time: Math.floor(k[0] / 1000),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
          isFinal: true
        }));

        if (isMounted) {
          dataCache[key] = candles;
          setData(candles);
        }
      } catch (err: any) {
        if (isMounted) setError(err.message);
      }
    };

    fetchData();

    if (!listeners[key]) listeners[key] = [];
    if (!statusListeners[key]) statusListeners[key] = [];

    const listener = (candle: Candle) => {
      if (isMounted) {
        setData(prev => {
          // Ignore WS updates until historical data is loaded to prevent the "single gigantic candle" bug
          if (prev.length === 0) return prev;
          
          const newData = [...prev];
          const lastCandle = newData[newData.length - 1];
          if (lastCandle && lastCandle.time === candle.time) {
            newData[newData.length - 1] = candle;
          } else {
            newData.push(candle);
            if (newData.length > 500) newData.shift();
          }
          dataCache[key] = newData;
          return newData;
        });
      }
    };

    const statusListener = (status: boolean) => {
      if (isMounted) setIsConnected(status);
    };

    listeners[key].push(listener);
    statusListeners[key].push(statusListener);

    if (!wsCache[key]) {
      const connectWs = () => {
        const ws = new WebSocket(`wss://fstream.binance.com/market/ws/${key}`);
        wsCache[key] = ws;
        
        ws.onopen = () => {
          statusListeners[key]?.forEach(l => l(true));
        };
        
        ws.onclose = () => {
          statusListeners[key]?.forEach(l => l(false));
          // Reconnect after 5 seconds if there are still listeners
          setTimeout(() => {
            if (listeners[key] && listeners[key].length > 0) {
              connectWs();
            }
          }, 5000);
        };

        ws.onerror = (error) => {
          console.error(`WebSocket error for ${key}:`, error);
          statusListeners[key]?.forEach(l => l(false));
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            if (message.k) {
              const k = message.k;
              const candle: Candle = {
                time: Math.floor(k.t / 1000),
                open: parseFloat(k.o),
                high: parseFloat(k.h),
                low: parseFloat(k.l),
                close: parseFloat(k.c),
                volume: parseFloat(k.v),
                isFinal: k.x
              };
              listeners[key]?.forEach(l => l(candle));
            }
          } catch (e) {
            console.error("Error parsing WS message", e);
          }
        };
      };

      connectWs();
    } else {
      // If ws already exists, check its state and set immediately
      setIsConnected(wsCache[key].readyState === WebSocket.OPEN);
    }

    return () => {
      isMounted = false;
      if (listeners[key]) {
        listeners[key] = listeners[key].filter(l => l !== listener);
      }
      if (statusListeners[key]) {
        statusListeners[key] = statusListeners[key].filter(l => l !== statusListener);
      }
      
      if (listeners[key]?.length === 0) {
        wsCache[key]?.close();
        delete wsCache[key];
        delete listeners[key];
        delete statusListeners[key];
      }
    };
  }, [symbol, interval, key]);

  return { data, error, isConnected };
};
