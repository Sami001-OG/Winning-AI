# Endellion Trading Bot

A high-performance, automated trading bot designed for Binance Futures, utilizing a tiered, multi-timeframe analysis funnel to identify high-probability trade signals.

## Architecture & Methodology

The bot operates on a robust, data-driven architecture designed to maximize signal quality while minimizing API load. It has evolved from a signal generator into an **Elite Selection Engine**, designed to eliminate mediocre setups and only pass the absolute highest-quality trades.

### 1. The Tiered Filtering Funnel
To efficiently analyze 300+ symbols without exceeding API rate limits, the bot employs a progressive filtering funnel:

1.  **Liquidity Filter (300+ → 50)**: Filters the top 300 USDT pairs by 24h volume, selecting the top 50 most liquid symbols.
2.  **4H Bias Alignment (50 → ~12)**: Analyzes the 4h timeframe to determine the dominant market trend. Symbols not aligned with the higher timeframe trend are discarded.
3.  **1H Control Layer (Veto Filter)**: Checks the 1H timeframe for immediate momentum. If the 1H is in "VETO" state (e.g., strong counter-trend momentum), the trade is blocked.
4.  **15M Confirmation (12 → 6)**: Analyzes the 15m timeframe for setup quality, momentum, and confidence using the core indicator suite.
5.  **3M Sniper Entry Trigger (6 → 2-3)**: Validates the final entry trigger on the 3m timeframe (e.g., liquidity sweeps, BOS, displacement) for maximum R:R.

### 2. Elite Signal Selection & Elimination
The bot aggressively filters out weak signals to maximize win rate:
- **Correlation Grouping**: Coins are grouped by sector (BTC, ETH, AI, MEME, L1). If multiple coins in the same sector trigger simultaneously, the bot kills the weaker signals and only sends the single highest-confidence trade.
- **King Filter (Macro Alignment)**: Altcoins are strictly bound to BTC's 1H trend. Altcoin LONGs are killed if BTC is bearish, and Altcoin SHORTs are killed unless BTC is also weak.
- **Liquidity Zone Filter**: Trades are only permitted if they occur within 2 ATR of a major 50-candle Swing High or Swing Low. Trades in the "middle of nowhere" are rejected.
- **R:R Filter**: The expected move to TP1 must be greater than or equal to the Stop Loss distance (Minimum 1:1 R:R).
- **Hard Daily Limit**: The bot is restricted to a maximum of **5 signals per day**. If the market generates more than 3 signals in a single scan, it dynamically raises the threshold and only keeps the top 3.

### 3. Brute-Force Optimized Weighting Engine
The core confidence scoring algorithm was optimized via brute-force backtesting over thousands of candles to find the mathematically highest win-rate distribution. The bot heavily prioritizes institutional order flow and structural breaks:

- **Structure (33%)**: Break of Structure (BOS), Fakeouts, RSI/MACD Divergence. Divergence is scaled by depth (e.g., Bullish divergence at RSI < 25 is weighted much higher than at RSI 40).
- **Confirmation (20%)**: Volume, OBV.
- **Volatility / Order Flow (15%)**: Institutional Footprint, Net Buying/Selling Pressure.
- **Market Condition (15%)**: ADX, Volatility.
- **Entry Timing (10%)**: RSI, Sweeps.
- **Trend (7%)**: EMAs.

### 4. Advanced Market Mechanics
- **VSA Absorption Filter (The Smart Money Trap)**: The bot detects Volume Spread Analysis anomalies. If volume spikes > 1.5x average but the candle body is tiny, it flags it as Absorption. If this happens at a swing high during a LONG signal, the trade is instantly killed (Retail Trap). If it happens at a swing low, confidence is boosted (Smart Money Accumulation).
- **Volatility Squeeze Multiplier**: The bot tracks the 50-period Bollinger Band Width. If a breakout occurs while the BB Width is in the bottom 20% (a severe squeeze) and order flow aligns, it applies a massive 1.2x confidence multiplier to catch explosive moves early.
- **Premium Upgrades (Institutional Order Flow)**: Queries premium Binance endpoints to confirm institutional participation (Trend Fuel via Open Interest, Squeeze Hunter via Funding Rates).

## Features

- **24/7 Market Monitoring**: Continuous scanning of liquid Binance Futures pairs.
- **Flawless TP/SL Tracking**: The Active Trade Monitoring system loops through the exact high and low of the last three 3-minute candles to ensure wicks are never missed, perfectly tracking TP1, TP2, TP3, and SL hits.
- **VWAP & EMA20 Limit Entries**: Instead of entering at market price, the bot calculates the 3M VWAP and EMA20 to provide a highly precise Limit Order entry price on pullbacks.
- **Dynamic Risk Management (Intraday Optimized)**: Blends three different strategies (Quick Secure 1:1, ATR Volatility Cap, and Market Structure Targets) to ensure targets are highly achievable within a single trading session.
- **Instant Telegram Alerts**: Pushes trade signals and updates directly to Telegram with HTML formatting, including:
    - Trade direction, limit entry, TP1/TP2/TP3, and SL.
    - Confidence score (capped at 100%).
    - Logic breakdown explaining why the signal was triggered, including premium metrics.
- **Smart Filtering**: Prevents notification spam using 4-hour cooldown periods per coin.

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
