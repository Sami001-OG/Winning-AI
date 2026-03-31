# Endellion Trading Bot

A high-performance, automated trading bot designed for Binance Futures, utilizing a tiered, multi-timeframe analysis funnel to identify high-probability trade signals.

## Architecture & Methodology

The bot operates on a robust, data-driven architecture designed to maximize signal quality while minimizing API load.

### 1. The Tiered Filtering Funnel
To efficiently analyze 300+ symbols without exceeding API rate limits, the bot employs a progressive filtering funnel:

1.  **Liquidity Filter (300+ → 50)**: Filters the top 300 USDT pairs by 24h volume, selecting the top 50 most liquid symbols.
2.  **4H Bias Alignment (50 → ~12)**: Analyzes the 4h timeframe to determine the dominant market trend. Symbols not aligned with the higher timeframe trend are discarded.
3.  **15M Confirmation (12 → 6)**: Analyzes the 15m timeframe for setup quality, momentum, and confidence using the core indicator suite.
4.  **3M Sniper Entry Trigger (6 → 2-3)**: Validates the final entry trigger on the 3m timeframe (e.g., liquidity sweeps, BOS, displacement) for maximum R:R.

### 2. Multi-Timeframe Analysis
The bot utilizes a top-down approach:
- **4H (Trend Alignment)**: Aligns the trade with the major market bias.
- **15M (Confidence Finding)**: Identifies the setup and calculates confidence based on momentum and structure.
- **3M (Sniper Entry)**: Executes the entry based on short-term triggers to drastically improve Risk/Reward.

### 3. Indicator & Analytical Suite (Leading Focus)
The bot leverages over 30 distinct technical tools to generate signals, but heavily weights **Leading Indicators** over lagging ones to predict reversals before they happen:

- **Leading Indicators (Heavily Weighted)**: RSI Divergence, Break of Structure (BOS), Liquidity Grabs, Fakeout Detection, Volume Spikes, Order Flow Analysis, Volume Profile (VAH/VAL/POC).
- **Lagging Indicators (Confirmation Only)**: EMA, SMA, MACD, Bollinger Bands, ATR, ADX.
- **Pattern Recognition**: Candlestick patterns (Doji, Hammer, Engulfing) and Chart patterns (Triangles, Flags, Wedges, Head & Shoulders, Cup & Handle).

## Features

- **24/7 Market Monitoring**: Continuous scanning of liquid Binance Futures pairs.
- **Dynamic Risk Management (Intraday Optimized)**: The bot doesn't just use fixed percentages for Take Profit and Stop Loss. It uses a **Dynamic Intraday TP System** that blends three different strategies to ensure targets are highly achievable within a single trading session:
    1.  **Quick Secure (1:1 R:R):** TP1 is always set to a strict 1:1 Risk/Reward ratio. This ensures that the bot quickly secures profits and moves the stop loss to breakeven, drastically increasing the win rate of the first target.
    2.  **ATR Volatility Cap:** The bot calculates the maximum realistic distance the price can move in a single session based on current volatility (capped at 8x the 15m ATR). Even if the math suggests a massive target, the bot forces it down to reality.
    3.  **Market Structure Targets:** The bot looks back 50 candles to find major liquidity pools (Swing Highs, Swing Lows, and Volume Profile Value Areas). It attempts to place TP3 exactly at these structural magnets.
    *The Final Blend:* The bot calculates all three options and sets TP3 to the *most realistic* of the three, ensuring at least a 1:1 R:R but capping it at a maximum of 1:2 R:R or the ATR limit. TP2 is placed exactly halfway between TP1 and TP3. Stop losses are dynamically placed behind recent swing structures or beyond 2x ATR.
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

application link : https://endelliontrade.vercel.app/
