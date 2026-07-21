"""Syncs durable daily price history (price_history table) and computes EMA crossovers from it.

Sync is incremental: a symbol's first sync backfills 1y, every sync after that only fetches the
gap since the latest stored date - so scanning many symbols never re-downloads a year of data.
"""
from datetime import date, datetime, timedelta

import db
import scraper


def sync_symbol(symbol):
    """Backfills or gap-fills one symbol's price_history. Returns the number of bars fetched (0
    if already up to date - the common case once a symbol has been synced before)."""
    latest = db.latest_price_date(symbol)
    if latest is None:
        bars = scraper.get_daily_bars(symbol)
    else:
        start = latest + timedelta(days=1)
        if start > date.today():
            return 0
        bars = scraper.get_daily_bars(symbol, start=start.isoformat())
    db.insert_price_bars(symbol, bars)
    return len(bars)


def sync_all(symbols, on_progress=None):
    """Syncs symbols one by one (not concurrently) - keeps Yahoo Finance calls sequential and
    avoids rate-limit issues when syncing 30-50+ symbols. on_progress(done, total) as elsewhere."""
    total_bars = 0
    for i, symbol in enumerate(symbols, 1):
        try:
            total_bars += sync_symbol(symbol)
        except Exception as e:
            print(f"skipped {symbol}: {e}")
        if on_progress:
            on_progress(i, len(symbols))
    return total_bars


def collect_max_history(symbol):
    """Fetches a symbol's entire available daily history (yfinance period='max') and stores it in
    price_history_max - separate from the 1y price_history table synced by sync_symbol/sync_all.
    Explicitly user-triggered per symbol (e.g. a "Collect max history" button), not part of the
    regular watchlist scan. Returns the number of bars stored."""
    bars = scraper.get_daily_bars(symbol, period="max")
    db.insert_max_bars(symbol, bars)
    return len(bars)


def chart_from_history(symbol, range_key):
    """Builds the same {bars, interval, visibleFrom} shape as scraper.get_chart, but from stored
    price_history - only for the daily-bar ranges price_history actually covers (1mo/6mo/ytd/1y).
    Returns None if that range isn't daily, or the DB doesn't have data back far enough yet
    (1d/5d are intraday, 5y/max need more/less history than the 1y backfill) - the caller falls
    back to a live scraper.get_chart call in that case."""
    if range_key not in scraper.RANGE_DAYS:
        return None
    interval = scraper.CHART_RANGES[range_key][1]
    if interval != "1d":
        return None

    cutoff = date(date.today().year, 1, 1) if range_key == "ytd" else date.today() - timedelta(days=scraper.RANGE_DAYS[range_key])
    warmup_start = cutoff - timedelta(days=scraper.WARMUP_DAYS[range_key])

    earliest = db.earliest_price_date(symbol)
    if earliest is None or earliest > warmup_start:
        return None

    rows = db.price_history_since(symbol, warmup_start)
    if not rows:
        return None

    bars = [
        {
            "time": int(datetime.combine(r["date"], datetime.min.time()).timestamp()),
            "open": r["open"], "high": r["high"], "low": r["low"], "close": r["close"], "volume": r["volume"],
        }
        for r in rows
    ]
    return {"bars": bars, "interval": interval, "visibleFrom": int(datetime.combine(cutoff, datetime.min.time()).timestamp())}


def ema_crossover(symbol, short=20, long=50):
    """Returns {crossover: 'bullish'|'bearish'|None, shortEma, longEma} from stored closes -
    'bullish' = short EMA crossed above long EMA on the latest bar (golden cross), 'bearish' =
    crossed below (death cross). None (both the dict's crossover field and the return value) if
    there isn't enough stored history yet - sync_symbol(symbol) first."""
    closes = db.price_closes(symbol, limit=long + 5)
    if len(closes) < long + 2:
        return None

    import pandas as pd
    series = pd.Series(closes)
    short_ema = series.ewm(span=short, adjust=False).mean()
    long_ema = series.ewm(span=long, adjust=False).mean()
    prev_diff = short_ema.iloc[-2] - long_ema.iloc[-2]
    curr_diff = short_ema.iloc[-1] - long_ema.iloc[-1]

    crossover = None
    if prev_diff <= 0 and curr_diff > 0:
        crossover = "bullish"
    elif prev_diff >= 0 and curr_diff < 0:
        crossover = "bearish"

    return {"crossover": crossover, "shortEma": round(short_ema.iloc[-1], 2), "longEma": round(long_ema.iloc[-1], 2)}
