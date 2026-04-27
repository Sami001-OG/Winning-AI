# 🌟 Endellion Trading Bot

Hey there! 👋 Welcome to the **Endellion Trading Bot**. This is a high-performance, automated trading engine built for Binance Futures. We designed it to do one thing really well: relentlessly scan the markets to find high-probability trade setups using a multi-timeframe approach, so you don't have to stare at charts all day.

---

## 🏗 How It Thinks (Architecture & Methodology)

The bot isn't just mindlessly throwing alerts at you. We've evolved it from a basic signal generator into an **Elite Selection Engine**. Its main job is actually to *reject* mediocre setups so that only the highest quality trades make it to your screen. 

### 1. The Tiered Filtering Funnel 🌪️
To analyze over 300 symbols efficiently without driving the Binance API crazy, the bot runs pairs through a progressive gauntlet:

1. **Liquidity Filter (300+ → 50):** First, we grab the top 300 USDT pairs and filter them down to the top 50 based on 24h volume. We only want to trade where the liquidity is.
2. **4H Bias Alignment (50 → ~12):** We check the 4-hour timeframe for the "big picture" trend. If a coin is fighting the macro trend, it gets tossed out.
3. **1H Control Layer (Veto Check):** A quick vibe-check on the 1-hour chart. If immediate momentum is violently against our trade direction, the setup gets vetoed.
4. **15M Confirmation (12 → 6):** This is where the heavy lifting happens. We check the 15m chart for momentum, structure, and indicator health to build our core confidence score.
5. **3M Sniper Entry (6 → 2-3):** Finally, we drop down to the 3-minute chart looking for precise entry triggers—like a liquidity sweep or break of structure—so we can get the best possible Risk-to-Reward (R:R).

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
