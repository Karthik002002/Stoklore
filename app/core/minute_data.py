"""Intraday bars for Bar Replay's 15m/1H/4H timeframes, from the HuggingFace dataset
`xxparthparekhxx/indian-stock-market-minute-data` (2,535 NSE symbols, 2022-01 -> 2026-01, ~715M
minute rows in 8 x ~1.5GB parquet shards), falling back to yfinance for symbols it doesn't cover.

Nothing is downloaded ahead of time. The shards are sorted by symbol, so DuckDB's parquet reader
prunes on row-group statistics and pulls only the matching ranges over HTTP range requests -
a symbol extract touches a few MB of a 10.5GB dataset, not the whole thing.

    hf://datasets/<repo>/minute/*.parquet  ->  WHERE symbol = ?  ->  local_data/minute/<SYM>.parquet

The extract is cached to that local parquet on first use (RELIANCE: ~375k rows, 6.6MB, ~11s) and
every later request - any timeframe, any date - resamples off the local copy in well under a
second. `local_data/` is already gitignored. Delete a cached file to refetch it.

The `datasets` library route (`load_dataset(..., split="minute").filter(...)`) is the documented
one but materializes all 10.5GB before filtering; DuckDB was chosen to keep this a per-symbol
streaming read. Dataset columns: symbol, timestamp (UTC), open, high, low, close, volume, oi.
"""
import os
import threading
from pathlib import Path

import duckdb

from app.core import scraper

HF_GLOB = "hf://datasets/xxparthparekhxx/indian-stock-market-minute-data/minute/*.parquet"

CACHE_DIR = Path(os.environ.get("MINUTE_DATA_DIR", "local_data/minute"))

# NSE trades 09:15-15:30 IST, so buckets are anchored to 09:15 rather than midnight - otherwise
# the 1H/4H candles straddle the open (an 09:00 bucket holding only 09:15-09:59). 24h divides by
# 1h and 4h evenly, so this one origin keeps every later session aligned to 09:15 too.
BUCKET_ORIGIN = "TIMESTAMP '2022-01-03 09:15:00'"
BUCKETS = {
    "1m": "1 minutes",
    "5m": "5 minutes",
    "15m": "15 minutes",
    "1H": "60 minutes",
    "4H": "240 minutes",
}

# yfinance serves a shallow intraday window (1m only ~7d) and has no 4H interval - 60m bars are
# fetched and rolled up locally for that one.
YF_FALLBACK = {
    "1m": ("7d", "1m"),
    "5m": ("60d", "5m"),
    "15m": ("60d", "15m"),
    "1H": ("60d", "60m"),
    "4H": ("60d", "60m"),
}

# Newest-N cap on what any one request returns. The full 2022-2026 range is 375k bars at 1m -
# ~47MB of JSON, which is not something to ship (or hold in the browser) on a timeframe switch.
# The cap is in bars, not days, so it self-scales: ~80 sessions at 1m, ~400 at 5m, and the whole
# history from 15m up, which is the same "finer timeframe, shorter window" behavior every
# charting platform has. The limit is visible in the UI for free - DateJumpMenu's range comes
# from the bars themselves, so "First available date" just moves in.
# ponytail: newest-N only, so older stretches at 1m/5m are unreachable. Add a `from` date param
# and a pre-fetch date picker if replaying a specific old session at 1m is ever wanted.
MAX_BARS = 30_000

# ponytail: one global lock, so two symbols can't be extracted concurrently. Extracts are rare
# (once per symbol, ever) and network-bound; swap for a per-symbol lock if that ever bites.
_extract_lock = threading.Lock()


def _cache_path(symbol):
    return CACHE_DIR / f"{symbol.upper()}.parquet"


def is_cached(symbol):
    return _cache_path(symbol).exists()


def _extract(symbol):
    """Pulls one symbol's minute rows out of the remote shards into a local parquet. Timestamps
    are converted UTC -> IST and stored naive, so `epoch()` on them later yields the IST-shifted
    unix seconds lightweight-charts wants (same pre-shift as scraper._chart_bars).

    An uncovered symbol writes an empty parquet rather than nothing - that's the cached "not in
    this dataset" answer, so a miss costs one scan ever instead of one per request."""
    path = _cache_path(symbol)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".partial")
    duckdb.execute(
        f"""
        COPY (
            SELECT (timestamp AT TIME ZONE 'Asia/Kolkata') AS ts, open, high, low, close, volume
            FROM '{HF_GLOB}'
            WHERE symbol = ?
            ORDER BY ts
        ) TO '{tmp}' (FORMAT parquet)
        """,
        [symbol.upper()],
    )
    # Rename only once the extract fully succeeded - a crash mid-COPY would otherwise leave a
    # truncated file that looks like a complete (or empty = "uncovered") cache entry forever.
    tmp.replace(path)
    return path


def _resample(path, interval):
    # The LIMIT is on a DESC sort so it keeps the *newest* MAX_BARS buckets, then the outer query
    # flips them back to the oldest-first order every consumer expects.
    rows = duckdb.execute(
        f"""
        SELECT date, time, open, high, low, close, volume FROM (
            SELECT strftime(bucket, '%Y-%m-%d') AS date,
                   CAST(epoch(bucket) AS BIGINT) AS time,
                   open, high, low, close, volume
            FROM (
                SELECT time_bucket(INTERVAL '{BUCKETS[interval]}', ts, {BUCKET_ORIGIN}) AS bucket,
                       first(open ORDER BY ts)  AS open,
                       max(high)                AS high,
                       min(low)                 AS low,
                       last(close ORDER BY ts)  AS close,
                       sum(volume)              AS volume
                FROM read_parquet('{path}')
                GROUP BY bucket
            )
            ORDER BY time DESC
            LIMIT {MAX_BARS}
        )
        ORDER BY time
        """
    ).fetchall()
    return [
        {
            "date": date,
            "time": time,
            "open": round(o, 2),
            "high": round(h, 2),
            "low": round(l, 2),
            "close": round(c, 2),
            "volume": int(v),
        }
        for date, time, o, h, l, c, v in rows
    ]


def get_minute_bars(symbol, interval):
    """interval: '15m' | '1H' | '4H'. Returns {bars, source} where source is 'dataset' or
    'yfinance'. Bars are oldest-first {date, time, open, high, low, close, volume} - `date` the
    IST calendar day, `time` IST-shifted unix seconds. The first call for an uncached symbol
    blocks on the remote extract (~11s); later ones read the local parquet."""
    if interval not in BUCKETS:
        raise ValueError(f"interval must be one of {list(BUCKETS)}")
    symbol = symbol.upper()

    with _extract_lock:
        path = _cache_path(symbol) if is_cached(symbol) else _extract(symbol)

    bars = _resample(path, interval)
    if bars:
        return {"bars": bars, "source": "dataset"}

    # Empty cache entry = the dataset has no such symbol (delisted, an index it doesn't carry, a
    # renamed ticker). Yahoo's shallow intraday window is better than an empty chart.
    period, yf_interval = YF_FALLBACK[interval]
    bars = scraper.get_intraday_bars(symbol, period=period, interval=yf_interval)
    if interval == "4H":
        bars = _rollup_60m_to_4h(bars)
    return {"bars": bars, "source": "yfinance"}


def _rollup_60m_to_4h(bars):
    """Yahoo has no 4H interval - fold its 60m bars into 4 per bucket, anchored to the same 09:15
    origin the dataset path uses so both sources produce identically-aligned candles."""
    out = []
    for bar in bars:
        # 09:15 IST is 3:45 past midnight UTC-shifted-to-IST; bucket on that offset.
        bucket = bar["time"] - ((bar["time"] - 9 * 3600 - 15 * 60) % (4 * 3600))
        if out and out[-1]["time"] == bucket:
            last = out[-1]
            last["high"] = max(last["high"], bar["high"])
            last["low"] = min(last["low"], bar["low"])
            last["close"] = bar["close"]
            last["volume"] += bar["volume"]
        else:
            out.append({**bar, "time": bucket})
    return out


if __name__ == "__main__":
    # Self-check: bucket alignment is the only real logic here, and it's the thing that silently
    # produces wrong candles if it drifts. Runs offline against synthetic 60m bars.
    def _t(day, hour, minute=0):
        return (day * 24 + hour) * 3600 + minute * 60

    session = [
        {"date": "d", "time": _t(0, h, 15), "open": 10.0, "high": 10.0 + h, "low": 9.0,
         "close": 11.0 + h, "volume": 100}
        for h in (9, 10, 11, 12, 13, 14, 15)
    ]
    rolled = _rollup_60m_to_4h(session)
    assert [b["time"] for b in rolled] == [_t(0, 9, 15), _t(0, 13, 15)], rolled
    assert rolled[0]["open"] == 10.0 and rolled[0]["close"] == 23.0, rolled[0]
    assert rolled[0]["high"] == 22.0 and rolled[0]["volume"] == 400, rolled[0]
    assert rolled[1]["volume"] == 300 and rolled[1]["close"] == 26.0, rolled[1]
    print("ok - 4H rollup buckets at 09:15/13:15 with correct OHLCV")
