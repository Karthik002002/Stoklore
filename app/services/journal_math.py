"""The trade journal's per-trade numbers, in Python - for dashboards, which are served from here.

These are a MIRROR, not a second opinion. The journal computes every one of them in the browser
(frontend/src/lib/manualTrades.ts and tradeCosts.ts), deliberately never stored, so an edit never
leaves a stale value behind. A dashboard runs its query server-side, so it needs the same numbers
here - and two implementations of "net P&L" that disagree by a rupee would make the dashboard and
the journal argue in front of you.

So every function below names the TypeScript it mirrors, and tests/journal_math.selfcheck.py runs
BOTH against the same trades (the TS through node) and fails on any difference. Change a formula on
one side and that check says so.
"""
import math
from datetime import datetime

from app.core.config import IST

#: A trade within this many rupees of flat is "neutral" - manualTrades.ts NEUTRAL_PNL_BAND.
NEUTRAL_PNL_BAND = 20

#: NSE cash-market sessions in IST minutes - manualTrades.ts NSE_SESSIONS.
NSE_SESSIONS = (("Opening", 9 * 60 + 15, 9 * 60 + 45),
                ("Mid-day", 9 * 60 + 45, 14 * 60 + 30),
                ("Closing", 14 * 60 + 30, 15 * 60 + 30))


def _js_round(x):
    """Math.round: the nearest integer, halves toward +infinity (-2.5 -> -2, 2.5 -> 3). Python's
    round() sends halves to even instead, and mirroring the journal to the paisa means rounding the
    way it does."""
    return math.floor(x + 0.5)


def _round(value, places=2):
    factor = 10 ** places
    return _js_round(value * factor) / factor


def _num(value):
    try:
        n = float(value)
    except (TypeError, ValueError):
        return 0.0
    return n if n == n and n not in (float("inf"), float("-inf")) else 0.0


def pnl(t):
    """Gross P&L - tradePnl."""
    if t.get("exit_price") is None:
        return None
    diff = t["exit_price"] - t["entry_price"]
    return _round((-diff if t["direction"] == "short" else diff) * t["quantity"])


def return_pct(t):
    """Gross return on the price move - tradeReturnPct."""
    if t.get("exit_price") is None or not t.get("entry_price"):
        return None
    pct = (t["exit_price"] - t["entry_price"]) / t["entry_price"] * 100
    return _round(-pct if t["direction"] == "short" else pct)


def planned_rr(t):
    """Target distance over stop distance - tradeRR."""
    if t.get("stop_loss") is None or t.get("target") is None:
        return None
    risk = abs(t["entry_price"] - t["stop_loss"])
    if risk == 0:
        return None
    return _round(abs(t["target"] - t["entry_price"]) / risk)


def realised_rr(t):
    """What the exit returned per unit of stop distance, signed - tradeRRDisplay's fallback."""
    if t.get("stop_loss") is None or t.get("exit_price") is None:
        return None
    risk = abs(t["entry_price"] - t["stop_loss"])
    if risk == 0:
        return None
    move = t["exit_price"] - t["entry_price"]
    return _round((-move if t["direction"] == "short" else move) / risk)


def r_multiple(t):
    """P&L over the risk planned at entry - expectedR."""
    gross = pnl(t)
    if gross is None or not t.get("ideal_risk_amount"):
        return None
    return _round(gross / t["ideal_risk_amount"])


def risk_amount(t):
    """Rupees at stake between entry and stop - actualRiskAmount."""
    if t.get("stop_loss") is None:
        return None
    return _round(abs(t["entry_price"] - t["stop_loss"]) * t["quantity"])


def auto_result(t, band=NEUTRAL_PNL_BAND):
    """profit / loss / neutral from P&L, None when unknown - autoResult."""
    if not _num(t.get("quantity")) > 0:
        return None
    gross = pnl(t)
    if gross is None:
        return None
    if gross > band:
        return "profit"
    if gross < -band:
        return "loss"
    return "neutral"


def side_cost(account, price, qty):
    """One side's slippage + brokerage + charges - tradeCosts.ts sideCost."""
    a = account or {}
    shares = _num(qty)
    turnover = _num(price) * shares
    if (a.get("slippage_type") or "per_share") == "bps":
        slippage = turnover * _num(a.get("slippage_value")) / 10000
    else:
        slippage = _num(a.get("slippage_value")) * shares
    brokerage = _num(a.get("brokerage_flat")) + turnover * _num(a.get("brokerage_pct")) / 100
    charges = turnover * _num(a.get("other_charges_pct")) / 100
    return slippage + brokerage + charges


def costs(t, account):
    """Entry side always, exit side once closed; None with no account to price it - tradeCosts.total."""
    if not account:
        return None
    total = side_cost(account, t["entry_price"], t["quantity"])
    if t.get("exit_price") is not None:
        total += side_cost(account, t["exit_price"], t["quantity"])
    return _round(total)


def net_pnl(t, account):
    """Gross P&L minus the round trip's costs - tradeNetPnl."""
    gross = pnl(t)
    if gross is None:
        return None
    c = costs(t, account)
    return gross if c is None else _round(gross - c)


def net_return_pct(t, account):
    """Net P&L over the capital the position tied up - tradeNetReturnPct."""
    net = net_pnl(t, account)
    invested = _num(t.get("entry_price")) * _num(t.get("quantity"))
    if net is None or not invested:
        return None
    return _js_round(net / invested * 10000) / 100


def _ist(value):
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value.astimezone(IST) if value.tzinfo else value.replace(tzinfo=IST)


def session(traded_at):
    """Which NSE session the trade was taken in, in IST - sessionFor."""
    t = _ist(traded_at)
    minutes = t.hour * 60 + t.minute
    return next((name for name, start, end in NSE_SESSIONS if start <= minutes < end), "After hours")


def weekday(traded_at):
    return _ist(traded_at).strftime("%A")
