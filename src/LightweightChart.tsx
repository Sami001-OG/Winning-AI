import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickSeries } from 'lightweight-charts';
import { Trade } from './types';
import { useBinanceData } from './hooks/useBinanceData';

interface LightweightChartProps {
  symbol: string;
  interval: string;
  activeTrade?: Trade;
}

export const LightweightChart: React.FC<LightweightChartProps> = ({ symbol, interval, activeTrade }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const { data, error } = useBinanceData(symbol, interval);

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
    if (!seriesRef.current || !chartRef.current) return;
    seriesRef.current.setData(data);
    if (data.length > 0) {
      chartRef.current.timeScale().setVisibleLogicalRange({
        from: data.length - 100,
        to: data.length - 1,
      });
    }
  }, [data]);

  useEffect(() => {
    if (!seriesRef.current) return;

    // Clear existing lines safely
    try {
      if (tpLineRef.current) seriesRef.current.removePriceLine(tpLineRef.current);
    } catch (e) { console.warn(e); }
    
    try {
      if (slLineRef.current) seriesRef.current.removePriceLine(slLineRef.current);
    } catch (e) { console.warn(e); }
    
    try {
      if (entryLineRef.current) seriesRef.current.removePriceLine(entryLineRef.current);
    } catch (e) { console.warn(e); }

    tpLineRef.current = null;
    slLineRef.current = null;
    entryLineRef.current = null;

    if (activeTrade && activeTrade.status === 'PENDING') {
      try {
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
          lineWidth: 2,
          lineStyle: 3, // Dotted
          axisLabelVisible: true,
          title: 'ENTRY',
        });
      } catch (e) {
        console.error("Failed to create price lines:", e);
      }
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
