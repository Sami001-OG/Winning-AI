import { useState, useEffect, useRef } from 'react';
import { Candle } from '../types';

const wsCache: Record<string, WebSocket> = {};
const dataCache: Record<string, Candle[]> = {};
const listeners: Record<string, ((candle: Candle) => void)[]> = {};

export const useBinanceData = (symbol: string, interval: string) => {
  const [data, setData] = useState<Candle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const key = `${symbol.toLowerCase()}@kline_${interval}`;

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      if (dataCache[key]) {
        setData(dataCache[key]);
        return;
      }

      try {
        const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=500`);
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
    const listener = (candle: Candle) => {
      if (isMounted) {
        setData(prev => {
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
    listeners[key].push(listener);

    if (!wsCache[key]) {
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${key}`);
      wsCache[key] = ws;
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
            listeners[key].forEach(l => l(candle));
          }
        } catch (e) {
          console.error("Error parsing WS message", e);
        }
      };
    }

    return () => {
      isMounted = false;
      listeners[key] = listeners[key].filter(l => l !== listener);
      if (listeners[key].length === 0) {
        wsCache[key].close();
        delete wsCache[key];
        delete listeners[key];
        // Optionally clear dataCache? Probably not, it's useful for other charts.
      }
    };
  }, [symbol, interval, key]);

  return { data, error };
};
