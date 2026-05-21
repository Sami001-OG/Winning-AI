# ACE-v2 — Adaptive Confluence Engine Specification

This document details the mathematical architecture and execution rules for the Adaptive Confluence Engine (v2) (ACE-v2), which serves as a highly robust replacement for multi-layered scoring strategies.

---

## 1. Continuous Regime Detection (No Steps, No Whipsaws)
Instead of switching between binary states (Trending vs. Ranging), ACE-v2 uses **ADX** over a specified period (default $N=14$) on a higher timeframe (e.g., 4H, 1H) to compute a continuous Trend Regime Probability $R_{trend} \in [0, 1]$:

$$R_{trend} = \text{clip}\left(\frac{\text{ADX} - 20}{15}, 0, 1\right)$$

- If $\text{ADX} \le 20$, then $R_{trend} = 0$ (Pure range).
- If $\text{ADX} \ge 35$, then $R_{trend} = 1$ (Pure trend).
- If $20 < \text{ADX} < 35$, the state transitions smoothly between 0 and 1, avoiding threshold-induced whipsaws.

---

## 2. Dynamic Weight Vector $\vec{w}$ (Convex Combination)
Let $\vec{w} = [w_{regime}, w_{trend}, w_{timing}, w_{confirm}, w_{structure}, w_{volatility}]^T$ be our vector of indicator weights. Rather than manually scaling weights with static multipliers which can violate constraints, we define base weights $\vec{w}_{base}$ and adjust them continuously using $R_{trend}$.

Given $\sum \vec{w}_{base} = 1.0$:

1. **Trend Components** $w_{trend}$ and $w_{structure}$ are scaled up with higher $R_{trend}$:
   $$w_{trend}^{adj} = w_{trend}^{base} \times (1.0 + 0.20 \times R_{trend})$$
   $$w_{structure}^{adj} = w_{structure}^{base} \times (1.0 + 0.10 \times R_{trend})$$

2. **Mean Reversion / Range Components** $w_{timing}$ are scaled down under high trend regimes:
   $$w_{timing}^{adj} = w_{timing}^{base} \times (1.0 - 0.15 \times R_{trend})$$

3. **Normalization (Convex Combination Constraint)**:
   To ensure the final weights form a valid convex combination (always summing to exactly 1.0), we compute:
   
   $$\sigma = \sum_{i} w_i^{adj}$$
   $$w_i^{final} = \frac{w_i^{adj}}{\sigma}$$

---

## 3. Layer Scoring
Individual indicator signals are mapped to a bounded score $s_i \in [-1.0, 1.0]$:
- $+1.0$: Highly Bullish
- $0.0$: Neutral
- $-1.0$: Highly Bearish

The combined Confluence Score $S_{raw}$ is the dot product of the weights and individual scores:

$$S_{raw} = \sum_{i} w_i^{final} \times s_i \in [-1.0, 1.0]$$

---

## 4. Sigmoid Squashing for Confidence
Traditional linear confidence algorithms run the risk of exceeding $100\%$ or dropping below $0\%$ under various additive conditions. ACE-v2 squashes the raw confidence using a modified sigmoid function centered on the entry threshold to yield a stable percentage Confidence $C \in [0, 100]$:

$$C = \frac{100}{1 + e^{-k \cdot (|S_{raw}| - \theta)}}$$

Where:
- $k \approx 8.0$ represents the steepness factor.
- $\theta \approx 0.50$ is the operational threshold scale.

### Signal Conviction Tiers
The confidence score is parsed into three actionable conviction levels:
- **WATCH**: $65\% \le C < 78\%$ — Setup is forming; alert scanner.
- **STRONG**: $78\% \le C < 88\%$ — Execution candidate; suitable for conservative parameters.
- **ELITE**: $C \ge 88\%$ — Maximum conviction setup; high position sizing candidate.

---

## 5. Anti-Fragile Quarter-Kelly Trade Sizing
To prevent capital death-spirals during rare drawdown streaks, position sizing utilizes the **Quarter-Kelly criterion** with a progressive streak modifier:

$$\text{Kelly Sizing } f^* = w - \frac{1 - w}{\text{Risk:Reward Ratio}}$$

Where $w$ is the running win rate (default $w = 0.584$).

$$\text{Sizing } = \text{Quarter-Kelly} \times M_{streak}$$

$$\text{Quarter-Kelly} = 0.25 \times f^*$$

### Streak Modifier ($M_{streak}$)
Let $S_{streak}$ represent the consecutive count of wins (positive) or losses (negative):
- If $S_{streak} > 0$ (Win streak): $M_{streak} = 1.0 + \text{clip}(S_{streak} \times 0.10, 0, 0.50)$ (Reward positive expectancy, cap at $1.5\times$).
- If $S_{streak} < 0$ (Loss streak): $M_{streak} = 1.0 - \text{clip}(|S_{streak}| \times 0.15, 0, 0.75)$ (Heavily reduce risk during drawdowns, scale down by up to $75\%$).

---

## 6. Dynamic ATR-Based Exit, Stop Loss, and TP Scaling
Stop Loss and Take Profit targets leverage the **Average True Range (ATR)** of the signal timeframe dynamically:

### Stop Loss (SL)
- **LONG**: $\text{Entry} - \mu \times \text{ATR}$
- **SHORT**: $\text{Entry} + \mu \times \text{ATR}$
- Where $\mu = 1.5$ in lower volatility markets, and scales dynamically up to $\mu = 2.0$ in high-volatility environments to avoid getting wicked out.

### Take Profit (TP) Scale-Out
The trade is split across 3 scale-out targets to secure profits incrementally:
1. **TP1 (50% Volume)**: $1:1$ R:R target. Once hit, **Move SL to Break-Even (entry)** to guarantee a risk-free trade.
2. **TP2 (30% Volume)**: $2:1$ R:R target (captures local liquidity pools).
3. **TP3 (20% Volume)**: $3.5:1$ to $4:1$ R:R target representing a higher timeframe trend runner.
