# 🌟 Endellion Trading Bot

Hey there! 👋 Welcome to the **Endellion Trading Bot**. This is a high-performance, automated trading engine built for Binance Futures. We designed it to do one thing really well: relentlessly scan the markets to find high-probability trade setups using a multi-timeframe approach, so you don't have to stare at charts all day.

---

## 🛠 Indicators in Use

The engine leverages robust, institutional-grade technical indicators mathematically calculated via the `technicalindicators` library:

### Trend & Momentum
- **EMA (Exponential Moving Average):** Dynamic periods (10, 20, 30, 50, 100, 200) depending on the timeframe. Used for trend alignment and dynamic support/resistance.
- **MACD (Moving Average Convergence Divergence):** (12, 26, 9). Used for momentum expansion/exhaustion and detecting bullish/bearish divergences.
- **Supertrend:** (7, 3). Used as a strict directional trend filter on higher timeframes.
- **RSI (Relative Strength Index):** (14). Used for momentum oscillator, overbought/oversold conditions, and divergence detection.
- **ADX & DI (Average Directional Index):** (14). Used to gauge the strength of a trend and momentum displacement.

### Volatility & Risk Management
- **Bollinger Bands:** (20, 2.5) on 1D/5m, (30, 2) on 4H/1H/15m. Used for volatility expansion (squeeze detection) and mean reversion.
- **ATR (Average True Range):** (14). Used dynamically for structural invalidation and setting Stop Loss (SL) and Take Profit (TP) levels.

### Volume & Order Flow
- **OBV (On-Balance Volume):** Used for volume flow confirmation and spotting accumulation/distribution.
- **Order Flow (Net Volume):** Analyzed via buying/selling pressure intensity on recent candles.
- **Volume Profile:** Calculates Point of Control (POC), Value Area High (VAH), and Value Area Low (VAL) to map deep institutional liquidity.

### Market Structure
- **Smart Money Concepts (SMC):** Detects micro and macro structural shifts, including Break of Structure (BOS), Change of Character (CHoCH), and Liquidity Grabs (Sweeps).

---

## 🏗 How It Thinks (Architecture & Methodology)

The bot isn't just mindlessly throwing alerts at you. We've evolved it from a basic signal generator into an **Elite Selection Engine**. Its main job is actually to *reject* mediocre setups so that only the highest quality trades make it to your screen. 

### 1. The Tiered Filtering Funnel (Top-to-Bottom Breakdown) 🌪️
To analyze over 300 symbols efficiently without driving the Binance API crazy, the bot runs pairs through a progressive gauntlet. Trades are only fired when the macro trend, medium-term momentum, and micro execution triggers are perfectly mathematically aligned.

1. **Liquidity Filter (300+ → 50):** First, we grab the top 300 USDT pairs and filter them down to the top 50 based on 24h volume. We only want to trade where the liquidity is.
2. **BTC King Filter:** All altcoins must respect Bitcoin's momentum. If BTC looks Bearish (`SHORT`), altcoin LONGs are immediately blocked.
3. **4H Bias Alignment (50 → ~12):** We check the 4-hour timeframe for the "big picture" trend. We require a strong conviction score (>= 3.0 out of 5 layers) to establish a firm LONG or SHORT bias based on EMA alignment and structure.
4. **1H Control Layer (Veto Check):** The momentum gatekeeper. Once a 4H bias exists, the 1H chart determines if the market has healthy momentum. It looks at MACD expansion/contraction and RSI limits to classify the state as `CONTINUATION`, `EXHAUSTION`, or a full `VETO` (if momentum is violently against our trade direction).
5. **15M Confirmation (12 → 6):** This is where setup validation occurs. We check the 15m chart for volume profile alignment, order flow, MACD/RSI divergence, and indicator health to build our core confidence score. The confidence must be **≥ 65%** for the signal to proceed. Dynamic TP and SL are calculated here based on structure and ATR.
6. **3M Sniper Entry (6 → 2-3):** Finally, we drop down to the 3-minute chart looking for precise entry triggers. The trade waits for precision confirmation like volume spikes, momentum shifts (ADX crossing), or a liquidity sweep. We calculate 3M VWAP and EMAs to provide precise limit order entries.

### 2. Hunting for the Elite 🎯
We are incredibly picky about what signals get sent out:
- **Sector Grouping:** If BTC, ETH, and three other Layer-1s all trigger a long at the exact same time, the bot groups them up, kills the weaker setups, and only sends you the best one.
- **The "King" Filter:** All altcoins must respect Bitcoin's momentum. If BTC looks terrible, altcoin LONGs are blocked. 
- **Liquidity Zones:** We wait for the trade to come to us. Setups that happen in the "middle of nowhere" are ignored; we want to react near major 50-candle swing highs or lows.
- **Risk-to-Reward:** Every trade must have a clear path to TP1 that is at least as large as the Stop Loss (minimum 1:1 R:R).
- **Daily Limits:** Quality over quantity. The bot limits itself to a maximum of **5 signals per day**. If the market goes crazy and gives us 10 signals, the bot dynamically raises its standards and only sends the absolute top 3.

### 3. The Brains (Weighting Engine) 🧠
We didn’t just guess which indicators work best. The confidence scoring algorithm prioritizes what actually moves markets—real money and structure:

- **33% - Structure:** Break of Structure (BOS), fakeouts, and deep RSI/MACD divergences.
- **20% - Confirmation:** Volume and On-Balance Volume (OBV).
- **15% - Volatility & Order Flow:** The institutional footprint and net buying/selling pressure.
- **15% - Market Condition:** ADX and general volatility.
- **10% - Entry Timing:** RSI resets and liquidity sweeps.
- **7% - Trend:** Smoothing out the noise with EMAs.

### 4. Advanced Market Mechanics ⚙️
- **The Smart Money Trap (VSA):** We look for volume spread anomalies. Huge volume on a tiny candle body? That's absorption. If it happens at the top of a massive pump, we kill the LONG signal (don't buy the top!). If it happens at a swing low, we boost our confidence because smart money is accumulating.
- **Volatility Squeezes:** If a breakout happens while the Bollinger Bands are incredibly tight *and* the order flow agrees, we slap a massive multiplier on the confidence score. Expect an explosive move.
- **Institutional Spying:** We peak into Binance's premium endpoints to track Open Interest (Trend Fuel) and Funding Rates (Squeeze Hunting).

---

## ✨ Coolest Features

- **24/7 Market Watcher:** Non-stop scanning of Binance Futures.
- **Flawless TP/SL Tracking:** We loop through the exact highs and lows of the latest 3-minute candles so we never miss a wick hitting your targets or your stop loss.
- **Sniper Limit Entries:** We don't just blindly market buy. The bot calculates the 3M VWAP and EMA20 to give you exact limit order prices for safer pullback entries.
- **Telegram Delivered:** Gorgeous, fully-formatted HTML trade alerts sent instantly to your phone. You get the entry, TP targets, Stop Loss, confidence score, and a full written breakdown of exactly *why* the bot took the trade.
- **No Spam:** Built-in cooldowns mean you won't get bombarded by the same coin over and over.

---

## 🛠 Getting Set Up

To get this running, make sure you have these environment variables tucked safely into your `.env` file:

- `BINANCE_API_KEY`: Your Binance API key.
- `BINANCE_SECRET_KEY`: Your Binance API secret.
- `VITE_TELEGRAM_BOT_TOKEN`: Your Telegram bot token.
- `VITE_TELEGRAM_CHAT_ID`: Your Telegram chat ID.

## 🚀 Hosting & Keeping It Awake

This bot is currently hosted on **Render**:
🔗 **Live App:** [https://endellion-trade.onrender.com/](https://endellion-trade.onrender.com/)

**💡 A quick tip for free-tier hosting (Render / Vercel):**
Free servers usually go to sleep if nobody opens the webpage for about 15 minutes. Because this bot needs to run in the background 24/7 to scan markets, you need a way to keep it awake!

**How to run it 24/7 for free:**
1. Create a free account on a pinging service like [UptimeRobot](https://uptimerobot.com) or [cron-job.org](https://cron-job.org).
2. Set up a new HTTP(s) Monitor.
3. Have it ping your health endpoint every 5-10 minutes.
   - **URL to ping:** `https://endellion-trade.onrender.com/api/health`
4. That's it! The automated ping makes the server think someone is browsing the site, keeping the background scanner running permanently. 

## 💻 Running Locally

Want to tinker with the code yourself? Clone the repo and run:

```bash
npm install
npm run dev
```

Happy trading! 📈
