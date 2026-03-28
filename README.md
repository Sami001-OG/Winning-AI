# Endellion Trading Bot

A high-performance, automated trading bot designed for Binance Futures, utilizing a tiered, multi-timeframe analysis funnel to identify high-probability trade signals.

## Architecture & Methodology

The bot operates on a robust, data-driven architecture designed to maximize signal quality while minimizing API load.

### 1. The Tiered Filtering Funnel
To efficiently analyze 300+ symbols without exceeding API rate limits, the bot employs a progressive filtering funnel:

1.  **Liquidity Filter (300+ → 50)**: Filters the top 300 USDT pairs by 24h volume, selecting the top 50 most liquid symbols.
2.  **4H Bias Alignment (30 → 12)**: Analyzes the 4h timeframe to determine the dominant market trend. Symbols not aligned with the higher timeframe trend are discarded.
3.  **15M Confirmation (12 → 6)**: Analyzes the 15m timeframe for setup quality, momentum, and confidence using the core indicator suite.
4.  **5M Entry Trigger (6 → 2-3)**: Validates the final entry trigger on the 5m timeframe (e.g., liquidity sweeps, BOS, displacement).

### 2. Multi-Timeframe Analysis
The bot utilizes a top-down approach:
- **4H (Trend Alignment)**: Aligns the trade with the major market bias.
- **15M (Confidence Finding)**: Identifies the setup and calculates confidence based on momentum and structure.
- **5M (Perfect Entry)**: Executes the entry based on short-term triggers.

### 3. Indicator & Analytical Suite
The bot leverages over 30 distinct technical tools to generate signals:

- **Core Indicators**: EMA, SMA, MACD, RSI, Bollinger Bands, ATR, ADX, OBV, CCI, Stochastic.
- **Structural Analysis**: Break of Structure (BOS), Liquidity Grabs, Fakeout Detection, Volume Spikes, ATR Expansion, Order Flow Analysis, RSI Divergence, Volume Profile (VAH/VAL/POC).
- **Pattern Recognition**: Candlestick patterns (Doji, Hammer, Engulfing) and Chart patterns (Triangles, Flags, Wedges, Head & Shoulders, Cup & Handle).

## Features

- **24/7 Market Monitoring**: Continuous scanning of liquid Binance Futures pairs.
- **Dynamic Risk Management**: Automatically calculates TP/SL levels based on ATR, market structure, and pattern-based strategies.
- **Instant Telegram Alerts**: Pushes trade signals and updates directly to Telegram with HTML formatting, including:
    - Trade direction, entry, TP1/TP2/TP3, and SL.
    - Confidence score.
    - Logic breakdown explaining why the signal was triggered.
- **Active Trade Monitoring**: Tracks open positions for TP/SL hits.
- **Smart Filtering**: Prevents notification spam using cooldown periods.

## Configuration

Ensure the following environment variables are set:

- `BINANCE_API_KEY`: Your Binance API key.
- `BINANCE_SECRET_KEY`: Your Binance API secret.
- `VITE_TELEGRAM_BOT_TOKEN`: Your Telegram bot token.
- `VITE_TELEGRAM_CHAT_ID`: Your Telegram chat ID.

## Running the Bot

To start the bot, use:

```bash
npm install
npm run dev
```
