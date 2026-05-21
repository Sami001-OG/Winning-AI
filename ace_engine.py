#!/usr/bin/env python3
import os
import sys
import argparse
import math
import pandas as pd
import numpy as np
from datetime import datetime

# ==============================================================================
# TECHNICAL INDICATORS SECTION (Pure pandas/numpy)
# ==============================================================================

def calculate_ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()

def calculate_sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(window=period).mean()

def calculate_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss.replace(0, 1e-9)
    return 100 - (100 / (1 + rs))

def calculate_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    h_l = df['high'] - df['low']
    h_pc = (df['high'] - df['close'].shift(1)).abs()
    l_pc = (df['low'] - df['close'].shift(1)).abs()
    tr = pd.concat([h_l, h_pc, l_pc], axis=1).max(axis=1)
    return tr.rolling(window=period).mean()

def calculate_adx(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high = df['high']
    low = df['low']
    close = df['close']
    
    # DM+, DM-
    up_move = high.diff()
    down_move = -low.diff()
    
    p_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    m_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
    
    # TR
    h_l = high - low
    h_pc = (high - close.shift(1)).abs()
    l_pc = (low - close.shift(1)).abs()
    tr = pd.concat([h_l, h_pc, l_pc], axis=1).max(axis=1)
    
    # Smooths
    smooth_tr = tr.rolling(window=period).mean()
    smooth_p_dm = pd.Series(p_dm, index=df.index).rolling(window=period).mean()
    smooth_m_dm = pd.Series(m_dm, index=df.index).rolling(window=period).mean()
    
    p_di = 100 * (smooth_p_dm / smooth_tr.replace(0, 1e-9))
    m_di = 100 * (smooth_m_dm / smooth_tr.replace(0, 1e-9))
    
    dx = 100 * (p_di - m_di).abs() / (p_di + m_di).replace(0, 1e-9)
    adx = dx.rolling(window=period).mean()
    return adx

# ==============================================================================
# ACE-v2 ADAPTIVE CONFLUENCE SCORING ENGINE
# ==============================================================================

def analyze_ace_v2(df: pd.DataFrame, index: int, streak: int = 0) -> dict:
    """
    Computes ACE-v2 score, confidence, and signals for a specific candle index.
    """
    if len(df) < 50:
        return {"signal": "NO TRADE", "confidence": 0.0}

    # Extract dynamic technical variables at index row
    row = df.iloc[index]
    
    # Calculate indicators if they aren't pre-computed
    close_val = row['close']
    high_val = row['high']
    low_val = row['low']
    
    # Local Indicator Sets for Scoring
    adx = df['adx'].iloc[index]
    atr = df['atr'].iloc[index]
    rsi = df['rsi'].iloc[index]
    
    ema20 = df['ema20'].iloc[index]
    ema50 = df['ema50'].iloc[index]
    ema200 = df['ema200'].iloc[index]
    
    vol = row['volume']
    vol_sma = df['vol_sma'].iloc[index]

    # --- 1. Continuous Regime Transition ---
    # R_trend = 1.0 is pure trend, R_trend = 0.0 is pure range
    r_trend = np.clip((adx - 20) / 15.0, 0.0, 1.0)

    # --- 2. Convex Combination Weights ---
    # Base Weights (sum = 1.0)
    w_base = {
        "regime": 0.10,
        "trend": 0.15,
        "timing": 0.15,
        "confirm": 0.10,
        "structure": 0.25,
        "volatility": 0.25
    }
    
    # Convex adjustments (Trend weight climbs / timing fades)
    w_adj = {}
    w_adj["regime"] = w_base["regime"]
    w_adj["trend"] = w_base["trend"] * (1.0 + 0.20 * r_trend)
    w_adj["structure"] = w_base["structure"] * (1.0 + 0.10 * r_trend)
    w_adj["timing"] = w_base["timing"] * (1.0 - 0.15 * r_trend)
    w_adj["confirm"] = w_base["confirm"]
    w_adj["volatility"] = w_base["volatility"]
    
    # Renormalize to ensure sum to 1.0
    total_adj = sum(w_adj.values())
    w_final = {k: v / total_adj for k, v in w_adj.items()}

    # --- 3. Compute Sub-Layer Scores ---
    # Score returns values in [-1.0, 1.0]

    # Layer 1: Regime Direction based on High/Low ADX momentum
    di_diff = (df['p_di'].iloc[index] - df['m_di'].iloc[index]) if 'p_di' in df.columns else 0.0
    score_regime = np.clip(di_diff / 20.0, -1.0, 1.0) if adx > 20 else 0.0

    # Layer 2: EMA Trend Alignment
    score_trend = 0.0
    if close_val > ema20 > ema50 > ema200:
        score_trend = 1.0
    elif close_val < ema20 < ema50 < ema200:
        score_trend = -1.0
    elif close_val > ema50:
        score_trend = 0.5
    elif close_val < ema50:
        score_trend = -0.5

    # Layer 3: Entry Timing (RSI Oversold/Overbought Pullbacks)
    score_timing = 0.0
    if r_trend > 0.5: # In a strong trend, look for shallow pullbacks
        if score_trend > 0:
            score_timing = 1.0 if (45 <= rsi <= 60) else (-0.5 if rsi > 70 else 0.0)
        else:
            score_timing = -1.0 if (40 <= rsi <= 55) else (0.5 if rsi < 30 else 0.0)
    else: # Mean reversion in Range
        if rsi < 35:
            score_timing = 1.0
        elif rsi > 65:
            score_timing = -1.0

    # Layer 4: Volume confirmation
    score_confirm = 0.0
    if vol > vol_sma * 1.25:
        score_confirm = 1.0 if close_val > df['close'].iloc[index - 1] else -1.0

    # Layer 5: Market Structure (BOS, Breaks of Structure/liquidity sweeps)
    # Simple Local Pivot Break Detection
    score_structure = 0.0
    recent_high = df['high'].iloc[max(0, index - 10):index].max()
    recent_low = df['low'].iloc[max(0, index - 10):index].min()
    if close_val > recent_high:
        score_structure = 1.0 # Breakout structure
    elif close_val < recent_low:
        score_structure = -1.0

    # Layer 6: Volatility / Order Flow
    score_volatility = 0.0
    avg_atr = df['atr'].iloc[max(0, index - 20):index].mean()
    if atr > avg_atr * 1.15:
        score_volatility = 1.0 if (close_val > ema20) else -1.0

    # --- 4. Convex Calculation for Raw Score ---
    s_raw = (
        w_final["regime"] * score_regime +
        w_final["trend"] * score_trend +
        w_final["timing"] * score_timing +
        w_final["confirm"] * score_confirm +
        w_final["structure"] * score_structure +
        w_final["volatility"] * score_volatility
    )

    # --- 5. Sigmoid Confidence Squashing ---
    # Squashes score into [0, 100]
    k_slope = 8.0
    theta_offset = 0.40 # Operational center
    confidence = 100.0 / (1.0 + math.exp(-k_slope * (abs(s_raw) - theta_offset)))

    # Threshold Signalling
    signal = 'NO TRADE'
    tier = 'STANDBY'
    
    if confidence >= 65.0:
        signal = 'LONG' if s_raw > 0 else 'SHORT'
        if confidence >= 88.0:
            tier = 'ELITE'
        elif confidence >= 78.0:
            tier = 'STRONG'
        else:
            tier = 'WATCH'

    # --- 6. Quarter-Kelly Sizing Calculations ---
    # Target 58.4% Win Rate, Reward-to-Risk ratio is 2.0 (based on exit rules)
    win_rate = 0.584
    rr_ratio = 2.0
    quarter_kelly_base = 0.25 * (win_rate - (1.0 - win_rate) / rr_ratio)
    
    # Sizing modifier based on streak count
    if streak > 0:
        streak_modifier = 1.0 + min(streak * 0.10, 0.50)
    elif streak < 0:
        streak_modifier = 1.0 - min(abs(streak) * 0.15, 0.75)
    else:
        streak_modifier = 1.0
        
    position_sizing = quarter_kelly_base * streak_modifier

    # --- 7. Exit Targets & Risk Config ---
    # SL uses dynamic ATR multiplier
    mu_atr_mult = 1.75 if atr > avg_atr * 1.25 else 1.50
    sl_distance = mu_atr_mult * atr
    
    tp_sl_rules = {}
    if signal != 'NO TRADE':
        sl_price = close_val - sl_distance if signal == 'LONG' else close_val + sl_distance
        risk = abs(close_val - sl_price)
        
        # 3 Scale-out Targets
        tp1 = close_val + risk if signal == 'LONG' else close_val - risk
        tp2 = close_val + (risk * 2.0) if signal == 'LONG' else close_val - (risk * 2.0)
        tp3 = close_val + (risk * 3.5) if signal == 'LONG' else close_val - (risk * 3.5)
        
        tp_sl_rules = {
            "entry": close_val,
            "sl": sl_price,
            "tp1_50pct": tp1,
            "tp2_30pct": tp2,
            "tp3_20pct": tp3
        }

    return {
        "timestamp": str(df['timestamp'].iloc[index]) if 'timestamp' in df.columns else str(index),
        "close": close_val,
        "adx": adx,
        "r_trend": r_trend,
        "raw_score": s_raw,
        "confidence": confidence,
        "tier": tier,
        "signal": signal,
        "position_sizing": max(0.01, position_sizing),
        "tp_sl": tp_sl_rules,
        "weights": w_final
    }

# ==============================================================================
# CLI EXECUTION SYSTEM (Scan & Backtest Engine)
# ==============================================================================

def load_and_prepare_df(csv_path: str) -> pd.DataFrame:
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"CSV resource at {csv_path} not found.")
        
    df = pd.read_csv(csv_path)
    # Ensure correct headers
    df.columns = [col.lower().strip() for col in df.columns]
    
    # Calculate Indicators
    df['ema20'] = calculate_ema(df['close'], 20)
    df['ema50'] = calculate_ema(df['close'], 50)
    df['ema200'] = calculate_ema(df['close'], 200)
    df['rsi'] = calculate_rsi(df['close'], 14)
    df['atr'] = calculate_atr(df, 14)
    df['adx'] = calculate_adx(df, 14)
    df['vol_sma'] = calculate_sma(df['volume'], 20)
    
    # Extract DM details for Regime score indicator
    df['p_dm'] = df['high'].diff()
    df['m_dm'] = -df['low'].diff()
    df['p_dm'] = np.where((df['p_dm'] > df['m_dm']) & (df['p_dm'] > 0), df['p_dm'], 0.0)
    df['m_dm'] = np.where((df['m_dm'] > df['p_dm']) & (df['m_dm'] > 0), df['m_dm'], 0.0)
    df['smooth_tr'] = (df['high'] - df['low']).rolling(window=14).mean()
    df['smooth_p_dm'] = df['p_dm'].rolling(window=14).mean()
    df['smooth_m_dm'] = df['m_dm'].rolling(window=14).mean()
    df['p_di'] = 100 * (df['smooth_p_dm'] / df['smooth_tr'].replace(0, 1e-9))
    df['m_di'] = 100 * (df['smooth_m_dm'] / df['smooth_tr'].replace(0, 1e-9))
    
    # Drop warmups
    df = df.dropna().reset_index(drop=True)
    return df

def run_scan(csv_path: str):
    df = load_and_prepare_df(csv_path)
    if len(df) == 0:
        print("❌ Error: No valid candle data loaded.")
        return
        
    latest_idx = len(df) - 1
    res = analyze_ace_v2(df, latest_idx)
    
    print("\n" + "="*50)
    print("📈 ACE-v2 SCANNER — LATEST COMPLETED BAR PROFILE 📈")
    print("="*50)
    print(f"Timestamp:   {res['timestamp']}")
    print(f"Close Price: ${res['close']:,.2f}")
    print(f"ADX (14):    {res['adx']:.2f}")
    print(f"Regime (R):  {res['r_trend']:.2f} ({'Trending' if res['r_trend'] > 0.5 else 'Ranging'})")
    print(f"Raw Score:   {res['raw_score']:.4f}")
    print(f"Confidence:  {res['confidence']:.2f}%")
    print(f"Conviction:  {res['tier']}")
    print(f"Engine Rule: {res['signal']}")
    print(f"Quarter-Kelly Allocation: {res['position_sizing']*100:.2f}%")
    
    if res['signal'] != 'NO TRADE':
        print("-"*50)
        print("🎯 Sniper Execution Setup:")
        print(f"  SL:  ${res['tp_sl']['sl']:.2f}")
        print(f"  TP1 (50% scale): ${res['tp_sl']['tp1_50pct']:.2f}")
        print(f"  TP2 (30% scale): ${res['tp_sl']['tp2_30pct']:.2f}")
        print(f"  TP3 (20% runner): ${res['tp_sl']['tp3_20pct']:.2f}")
    print("="*50 + "\n")

def run_backtest(csv_path: str, min_tier: str):
    df = load_and_prepare_df(csv_path)
    
    tier_hierarchy = {"WATCH": 1, "STRONG": 2, "ELITE": 3}
    min_tier_val = tier_hierarchy.get(min_tier, 1)
    
    active_position = None
    historical_trades = []
    
    # Track the streak configuration
    streak = 0
    total_capital = 10000.0 # Standard USD
    capital_curve = []
    
    print(f"\n🔍 Running Backtest (Min Tier: {min_tier}) on dataset...")
    
    for i in range(50, len(df)):
        # Calculate capital curve
        capital_curve.append(total_capital)
        
        # Handle Active Trades
        if active_position:
            # Evaluate High and Low candle details.
            high_price = df['high'].iloc[i]
            low_price = df['low'].iloc[i]
            close_price = df['close'].iloc[i]
            
            # LONG Check
            if active_position['direction'] == 'LONG':
                # SL Trigger
                if low_price <= active_position['current_sl']:
                    pnl_pct = (active_position['current_sl'] - active_position['entry']) / active_position['entry']
                    # Leverage 10x
                    trade_pnl = active_position['size_usd'] * pnl_pct * 10.0
                    total_capital += trade_pnl
                    
                    active_position['pnl_usd'] = trade_pnl
                    active_position['status'] = 'FAILED' if pnl_pct < 0 else 'SUCCESS'
                    active_position['exit_price'] = active_position['current_sl']
                    historical_trades.append(active_position)
                    
                    streak = streak - 1 if pnl_pct < 0 else streak + 1
                    active_position = None
                    continue
                
                # Check scale outs
                if not active_position['tp1_hit'] and high_price >= active_position['tp1']:
                    active_position['tp1_hit'] = True
                    # Book 50%
                    realized_pnl = (active_position['tp1'] - active_position['entry']) / active_position['entry'] * active_position['size_usd'] * 0.5 * 10
                    total_capital += realized_pnl
                    active_position['pnl_usd'] += realized_pnl
                    # Secure to breakeven
                    active_position['current_sl'] = active_position['entry']
                    
                if active_position['tp1_hit'] and not active_position['tp2_hit'] and high_price >= active_position['tp2']:
                    active_position['tp2_hit'] = True
                    realized_pnl = (active_position['tp2'] - active_position['entry']) / active_position['entry'] * active_position['size_usd'] * 0.3 * 10
                    total_capital += realized_pnl
                    active_position['pnl_usd'] += realized_pnl
                    
                if high_price >= active_position['tp3']:
                    # Complete
                    rem_weight = 0.2 if active_position['tp2_hit'] else (0.5 if active_position['tp1_hit'] else 1.0)
                    realized_pnl = (active_position['tp3'] - active_position['entry']) / active_position['entry'] * active_position['size_usd'] * rem_weight * 10
                    total_capital += realized_pnl
                    active_position['pnl_usd'] += realized_pnl
                    active_position['status'] = 'SUCCESS'
                    active_position['exit_price'] = active_position['tp3']
                    historical_trades.append(active_position)
                    
                    streak = streak + 1 if streak >= 0 else 1
                    active_position = None
                    continue
                    
            # SHORT Check
            else:
                # SL Trigger
                if high_price >= active_position['current_sl']:
                    pnl_pct = (active_position['entry'] - active_position['current_sl']) / active_position['entry']
                    trade_pnl = active_position['size_usd'] * pnl_pct * 10.0
                    total_capital += trade_pnl
                    
                    active_position['pnl_usd'] = trade_pnl
                    active_position['status'] = 'FAILED' if pnl_pct < 0 else 'SUCCESS'
                    active_position['exit_price'] = active_position['current_sl']
                    historical_trades.append(active_position)
                    
                    streak = streak - 1 if pnl_pct < 0 else streak + 1
                    active_position = None
                    continue
                
                # Check scale outs
                if not active_position['tp1_hit'] and low_price <= active_position['tp1']:
                    active_position['tp1_hit'] = True
                    realized_pnl = (active_position['entry'] - active_position['tp1']) / active_position['entry'] * active_position['size_usd'] * 0.5 * 10
                    total_capital += realized_pnl
                    active_position['pnl_usd'] += realized_pnl
                    active_position['current_sl'] = active_position['entry']
                    
                if active_position['tp1_hit'] and not active_position['tp2_hit'] and low_price <= active_position['tp2']:
                    active_position['tp2_hit'] = True
                    realized_pnl = (active_position['entry'] - active_position['tp2']) / active_position['entry'] * active_position['size_usd'] * 0.3 * 10
                    total_capital += realized_pnl
                    active_position['pnl_usd'] += realized_pnl
                    
                if low_price <= active_position['tp3']:
                    # Complete
                    rem_weight = 0.2 if active_position['tp2_hit'] else (0.5 if active_position['tp1_hit'] else 1.0)
                    realized_pnl = (active_position['entry'] - active_position['tp3']) / active_position['entry'] * active_position['size_usd'] * rem_weight * 10
                    total_capital += realized_pnl
                    active_position['pnl_usd'] += realized_pnl
                    active_position['status'] = 'SUCCESS'
                    active_position['exit_price'] = active_position['tp3']
                    historical_trades.append(active_position)
                    
                    streak = streak + 1 if streak >= 0 else 1
                    active_position = None
                    continue
        
        # If no active positions, scan for signals
        if not active_position:
            res = analyze_ace_v2(df, i, streak)
            if res['signal'] != 'NO TRADE':
                curr_tier_val = tier_hierarchy.get(res['tier'], 1)
                if curr_tier_val >= min_tier_val:
                    # Execute active trade simulations
                    alloc = res['position_sizing'] # Fraction of total bankroll
                    size_usd = total_capital * alloc
                    
                    active_position = {
                        "direction": res['signal'],
                        "entry": res['close'],
                        "current_sl": res['tp_sl']['sl'],
                        "tp1": res['tp_sl']['tp1_50pct'],
                        "tp2": res['tp_sl']['tp2_30pct'],
                        "tp3": res['tp_sl']['tp3_20pct'],
                        "size_usd": size_usd,
                        "tp1_hit": False,
                        "tp2_hit": False,
                        "pnl_usd": 0.0,
                        "status": "OPEN",
                        "timestamp": res['timestamp']
                    }
                    
    # Backtest Finished
    print("\n" + "="*50)
    print("📈 ACE-v2 SIMULATED BACKTEST RESULTS 📈")
    print("="*50)
    print(f"Total Trades Taken: {len(historical_trades)}")
    
    if len(historical_trades) > 0:
        winning_trades = [t for t in historical_trades if t['pnl_usd'] > 0]
        win_rate = (len(winning_trades) / len(historical_trades)) * 100.0
        
        gross_profits = sum([t['pnl_usd'] for t in winning_trades])
        gross_losses = sum([abs(t['pnl_usd']) for t in historical_trades if t['pnl_usd'] <= 0])
        profit_factor = gross_profits / (gross_losses if gross_losses > 0 else 1.0)
        
        print(f"Win Rate:           {win_rate:.2f}%")
        print(f"Profit Factor:      {profit_factor:.2f}")
        print(f"Starting balance:   $10,000.00")
        print(f"Ending balance:     ${total_capital:,.2f}")
        print(f"Total Net PnL:       {(total_capital - 10000.0)/10000.0*100.0:+.2f}%")
    else:
        print("No trades triggered for backtest specifications.")
    print("="*50 + "\n")

# ==============================================================================
# MAIN LAUNCHER ENTRY POINT
# ==============================================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ACE-v2 Adaptive Confluence Engine")
    subparsers = parser.add_subparsers(dest="command")
    
    # 'scan' command
    scan_parser = subparsers.add_parser("scan", help="Check live signal on latest completed bar")
    scan_parser.add_argument("--csv", required=True, help="Path to OHLCV 15m CSV data file")
    
    # 'backtest' command
    back_parser = subparsers.add_parser("backtest", help="Simulate historical trading backtest suite")
    back_parser.add_argument("--csv", required=True, help="Path to OHLCV 15m CSV data file")
    back_parser.add_argument("--min-tier", default="STRONG", choices=["WATCH", "STRONG", "ELITE"], help="Minimum signal tier to fire")
    
    args = parser.parse_args()
    
    if args.command == "scan":
        run_scan(args.csv)
    elif args.command == "backtest":
        run_backtest(args.csv, args.min_tier)
    else:
        parser.print_help()
