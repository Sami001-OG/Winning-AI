import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, Time, CandlestickSeries } from 'lightweight-charts';
import { Trade } from './types';

interface LightweightChartProps {
  symbol: string;
  interval: string;
  activeTrade?: Trade;
}

export const LightweightChart: React.FC<LightweightChartProps> = ({ symbol, interval, activeTrade }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tpLineRef = useRef<any>(null);
  const slLineRef = useRef<any>(null);
  const entryLineRef = useRef<any>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0A0A0A' },
        textColor: 'rgba(255, 255, 255, 0.5)',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      crosshair: {
        mode: 1, // Normal
        vertLine: {
          color: 'rgba(255, 255, 255, 0.2)',
          labelBackgroundColor: '#141414',
        },
        horzLine: {
          color: 'rgba(255, 255, 255, 0.2)',
          labelBackgroundColor: '#141414',
        },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;

    let isMounted = true;

    // Close existing websocket immediately to prevent race conditions
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Clear existing data immediately to prevent showing old symbol/interval data
    seriesRef.current.setData([]);

    const fetchData = async () => {
      try {
        setError(null);
        // Map interval
        const map: Record<string, string> = {
          '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d'
        };
        const binanceInterval = map[interval] || '15m';

        const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${binanceInterval}&limit=500`);
        if (!response.ok) throw new Error('Failed to fetch data');
        
        const data = await response.json();
        const candles = data.map((k: any) => ({
          time: (k[0] / 1000) as Time,
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
        }));

        if (isMounted && seriesRef.current && chartRef.current) {
          seriesRef.current.setData(candles);
          chartRef.current.timeScale().setVisibleLogicalRange({
            from: candles.length - 100,
            to: candles.length - 1,
          });
        }

        // Connect WebSocket
        if (wsRef.current) wsRef.current.close();
        
        const wsUrl = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${binanceInterval}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            if (message.k && isMounted && seriesRef.current) {
              const k = message.k;
              seriesRef.current.update({
                time: (k.t / 1000) as Time,
                open: parseFloat(k.o),
                high: parseFloat(k.h),
                low: parseFloat(k.l),
                close: parseFloat(k.c),
              });
            }
          } catch (e) {
            console.error("Error parsing WS message", e);
          }
        };

      } catch (err: any) {
        if (isMounted) setError(err.message);
      }
    };

    fetchData();

    return () => {
      isMounted = false;
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [symbol, interval]);

  useEffect(() => {
    if (!seriesRef.current) return;

    // Clear existing lines
    if (tpLineRef.current) seriesRef.current.removePriceLine(tpLineRef.current);
    if (slLineRef.current) seriesRef.current.removePriceLine(slLineRef.current);
    if (entryLineRef.current) seriesRef.current.removePriceLine(entryLineRef.current);

    tpLineRef.current = null;
    slLineRef.current = null;
    entryLineRef.current = null;

    if (activeTrade && activeTrade.status === 'PENDING') {
      tpLineRef.current = seriesRef.current.createPriceLine({
        price: activeTrade.tp,
        color: '#10b981',
        lineWidth: 2,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: 'TP',
      });

      slLineRef.current = seriesRef.current.createPriceLine({
        price: activeTrade.sl,
        color: '#f43f5e',
        lineWidth: 2,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: 'SL',
      });

      entryLineRef.current = seriesRef.current.createPriceLine({
        price: activeTrade.entry,
        color: '#3b82f6',
        lineWidth: 1,
        lineStyle: 3, // Dotted
        axisLabelVisible: true,
        title: 'ENTRY',
      });
    }
  }, [activeTrade]);

  return (
    <div className="w-full h-full relative">
      {error && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/50">
          <div className="text-rose-400 font-mono text-sm bg-rose-500/10 px-4 py-2 rounded border border-rose-500/20">
            {error}
          </div>
        </div>
      )}
      <div ref={chartContainerRef} className="w-full h-full" />
    </div>
  );
};
