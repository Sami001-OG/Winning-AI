import { useState, useEffect } from 'react';
import { Candle, AnalysisResult } from '../types';

const dataCache: Record<string, Candle[]> = {};
let sharedWs: WebSocket | null = null;
export const wsSubscribers = new Set<(msg: any) => void>();

function initWs() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${window.location.host}`);
  
  ws.onopen = () => {
    // Tell all components to re-subscribe if needed
    wsSubscribers.forEach(sub => sub({ type: 'ws-reconnected' }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      wsSubscribers.forEach(sub => sub(msg));
    } catch(e) {}
  };
  
  ws.onclose = () => {
    console.log("WebSocket closed. Reconnecting...");
    setTimeout(() => {
      sharedWs = null;
      getSharedWs();
    }, 2000);
  };
  
  ws.onerror = () => {
    ws.close();
  };

  return ws;
}

export function getSharedWs() {
  if (!sharedWs || sharedWs.readyState === WebSocket.CLOSED || sharedWs.readyState === WebSocket.CLOSING) {
    sharedWs = initWs();
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
      if (msg.type === 'ws-reconnected') {
         const currentWs = getSharedWs();
         if (currentWs.readyState === WebSocket.OPEN) {
            currentWs.send(JSON.stringify({ type: 'subscribe', symbol, interval }));
         }
      } else if (msg.type === 'market-data' && msg.symbol === symbol && msg.interval === interval) {
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
