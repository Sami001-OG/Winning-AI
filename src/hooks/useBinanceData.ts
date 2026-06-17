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

  // Helper method for fallback fetch
  const fetchSnapshot = async () => {
    try {
      const res = await fetch(`/api/klines?symbol=${symbol}&interval=${interval}&limit=250`);
      if (res.ok) {
        const rawData = await res.json();
        // Backend /api/klines returns binance formatted array [[time, open, high, low, close, volume], ...]
        if (Array.isArray(rawData)) {
          const formatted = rawData.map((d: any[]) => ({
            time: Math.floor(d[0] / 1000),
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5]),
            isFinal: true
          }));
          dataCache[key] = formatted;
          setData(formatted);
          setError(null);
        }
      } else {
        // Fallback to direct binance api if backend proxy fails
        const directRes = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=250`);
        if (directRes.ok) {
           const rawData = await directRes.json();
           const formatted = rawData.map((d: any[]) => ({
             time: Math.floor(d[0] / 1000),
             open: parseFloat(d[1]),
             high: parseFloat(d[2]),
             low: parseFloat(d[3]),
             close: parseFloat(d[4]),
             volume: parseFloat(d[5]),
             isFinal: true
           }));
           dataCache[key] = formatted;
           setData(formatted);
           setError(null);
        } else {
           setError("Unable to load chart data (Proxy & Direct fallback failed)");
        }
      }
    } catch (e: any) {
      setError(`Data fetch failed: ${e.message}`);
    }
  };

  useEffect(() => {
    let isMounted = true;
    
    if (!dataCache[key] || dataCache[key].length === 0) {
      setData([]);
      fetchSnapshot(); // Immediately fetch snapshot instead of waiting for WS to hopefully send it
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
        if (candles && candles.length > 0) {
          dataCache[key] = candles;
          setData(candles);
          setError(null);
        }
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

    // Setup fallback polling in case WS totally fails or gets stuck
    const pollingFallback = setInterval(() => {
       if (!isConnected || !dataCache[key] || dataCache[key].length === 0) {
           fetchSnapshot();
       }
    }, 10000); // Check every 10 seconds

    return () => {
      isMounted = false;
      clearInterval(pollingFallback);
      wsSubscribers.delete(handleMessage);
      ws.removeEventListener('open', handleOpen);
      if (ws.readyState === WebSocket.OPEN) {
         ws.send(JSON.stringify({ type: 'unsubscribe', symbol, interval }));
      }
    };
  }, [symbol, interval, key]);

  return { data, indicators, error, isConnected };
};
