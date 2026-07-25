"""Simple long-only EMA-crossover backtest over stored daily price_history.

One strategy for now (the same golden/death cross prices.ema_crossover already computes for the
live signal) - more strategies are a later update, not this one.
"""
import pandas as pd

import db


def run_ema_crossover(symbol, short, long, from_date=None, to_date=None):
    """Buys on a golden cross (short EMA crosses above long), sells on the next death cross.
    A position still open at the end of the window is marked to the last close rather than
    dropped. Returns None if there isn't enough stored price history - sync_symbol(symbol) first."""
    rows = db.list_price_history(symbol, days=100_000)  # every stored bar
    if from_date:
        rows = [r for r in rows if r["date"].isoformat() >= from_date]
    if to_date:
        rows = [r for r in rows if r["date"].isoformat() <= to_date]
    if len(rows) < long + 2:
        return None

    dates = [r["date"] for r in rows]
    closes = pd.Series([r["close"] for r in rows])
    diff = closes.ewm(span=short, adjust=False).mean() - closes.ewm(span=long, adjust=False).mean()

    trades = []
    entry_price, entry_date = None, None
    for i in range(1, len(diff)):
        golden = diff.iloc[i - 1] <= 0 and diff.iloc[i] > 0
        death = diff.iloc[i - 1] >= 0 and diff.iloc[i] < 0
        if entry_price is None and golden:
            entry_price, entry_date = closes.iloc[i], dates[i]
        elif entry_price is not None and death:
            trades.append(_trade(entry_date, dates[i], entry_price, closes.iloc[i]))
            entry_price, entry_date = None, None

    if entry_price is not None:
        trades.append(_trade(entry_date, dates[-1], entry_price, closes.iloc[-1], open_=True))

    wins = [t for t in trades if t["return_pct"] > 0]
    return {
        "trades": trades,
        "summary": {
            # Additive, not compounded - a deliberate simplification for a "keep it simple" v1,
            # fine for a handful of non-overlapping trades; switch to compounding if trade count
            # or overlap grows enough that the difference actually matters.
            "total_return_pct": round(sum(t["return_pct"] for t in trades), 2),
            "win_rate": round(len(wins) / len(trades) * 100, 1) if trades else 0.0,
            "num_trades": len(trades),
        },
    }


def _trade(entry_date, exit_date, entry_price, exit_price, open_=False):
    trade = {
        "entry_date": entry_date.isoformat(),
        "exit_date": exit_date.isoformat(),
        "entry_price": round(entry_price, 2),
        "exit_price": round(exit_price, 2),
        "return_pct": round((exit_price - entry_price) / entry_price * 100, 2),
    }
    if open_:
        trade["open"] = True
    return trade
