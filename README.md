# Endellion Trading Bot

A high-performance trading bot designed for automated signal detection and Telegram notifications on Binance Futures.

## Features

- **24/7 Market Monitoring**: Scans top 100 USDT leveraged pairs on Binance.
- **Multi-Timeframe Analysis**: Analyzes 4h, 15m, and 5m timeframes for high-confidence signals.
- **Instant Telegram Alerts**: Pushes trade signals and updates directly to Telegram.
- **Trade Management**: Monitors active trades for Take Profit (TP) and Stop Loss (SL) triggers.
- **Smart Filtering**: Includes cooldown periods and continuous signal spam prevention.

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
