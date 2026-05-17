import { useState, useEffect } from 'react';
import { Candle, AnalysisResult } from '../types';

const dataCache: Record<string, Candle[]> = {};
let sharedWs: WebSocket | null = null;
export const wsSubscribers = new Set<(msg: any) => void>();

export function getSharedWs() {
  if (!sharedWs || sharedWs.readyState === WebSocket.CLOSED) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    sharedWs = new WebSocket(`${protocol}//${window.location.host}`);
    sharedWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        wsSubscribers.forEach(sub => sub(msg));
      } catch(e) {}
    };
  }
  return sharedWs;
}

export const useBinanceData = (symbol: string, interval: string) => {
  const [data, setData] = useState<Candle[]>([]);
  const [indicators, setIndicators] = useState<AnalysisResult | null>(null);
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

    const ws = getSharedWs();

    const handleOpen = () => {
      if (isMounted) setIsConnected(true);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'subscribe', symbol, interval }));
      }
    };

    if (ws.readyState === WebSocket.OPEN) {
      handleOpen();
    } else {
      ws.addEventListener('open', handleOpen);
    }

    const handleMessage = (msg: any) => {
      if (!isMounted) return;
      if (msg.type === 'market-data' && msg.symbol === symbol && msg.interval === interval) {
        const candles = msg.data;
        dataCache[key] = candles;
        setData(candles);
        if (msg.indicators) {
           setIndicators(msg.indicators);
        }
      } else if (msg.type === 'market-data-update' && msg.symbol === symbol && msg.interval === interval) {
        if (!dataCache[key] || dataCache[key].length === 0) return;
        const arr = dataCache[key];
        const candleToUpdate = msg.data;
        const last = arr[arr.length - 1];
        if (last && candleToUpdate.time === last.time) {
          arr[arr.length - 1] = candleToUpdate;
        } else if (last && candleToUpdate.time > last.time) {
          arr.push(candleToUpdate);
          if (arr.length > 1500) arr.shift();
        }
        setData([...arr]);
        if (msg.indicators) {
           setIndicators(msg.indicators);
        }
      }
    };
    
    wsSubscribers.add(handleMessage);

    return () => {
      isMounted = false;
      wsSubscribers.delete(handleMessage);
      ws.removeEventListener('open', handleOpen);
      if (ws.readyState === WebSocket.OPEN) {
         ws.send(JSON.stringify({ type: 'unsubscribe', symbol, interval }));
      }
    };
  }, [symbol, interval, key]);

  return { data, indicators, error, isConnected };
};
