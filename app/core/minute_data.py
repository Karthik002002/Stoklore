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

The dataset stops at 2026-01, so the cache is then TOPPED UP with every newer 1m bar: from
moneycontrol's chart feed (about a year of 1m history, so it covers the gap and today), or
yfinance's 7-day 1m window when moneycontrol has nothing for the symbol. At most once per
TOPUP_EVERY per symbol, appended to the same parquet - see _top_up.

Minute history can still have holes no feed fills: a stock the dataset doesn't carry (NSE SME
listings) has only moneycontrol's last year of 1m, and some stocks' moneycontrol 1m starts only days
ago, leaving months between the dataset's end and it. The official DAILY record is complete for
both, so it is cached beside the minutes (`<SYM>.daily.parquet`) and used two ways: 1D bars take a
missing day from it (fill_days), and every run can say how many sessions its bars lack
(missing_sessions) instead of hiding the hole.

The `datasets` library route (`load_dataset(..., split="minute").filter(...)`) is the documented
one but materializes all 10.5GB before filtering; DuckDB was chosen to keep this a per-symbol
streaming read. Dataset columns: symbol, timestamp (UTC), open, high, low, close, volume, oi.
"""
import bisect
import os
import statistics
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import duckdb
import pandas

from app.core import moneycontrol_local, scraper

HF_GLOB = "hf://datasets/xxparthparekhxx/indian-stock-market-minute-data/minute/*.parquet"
# The same dataset's daily split: one ~118MB file, every stock from 2000 (or its listing) to 2026-01,
# on the same price basis as the minutes. It is what 1D bars use before the minutes begin.
HF_DAY = "hf://datasets/xxparthparekhxx/indian-stock-market-minute-data/day/*.parquet"

# A remote extract takes seconds, and DuckDB draws a progress bar for anything that slow - thousands
# of lines of it in the server log. Off for the module's default connection.
duckdb.execute("SET enable_progress_bar = false")

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
    # Daily bars from the same minutes, so a 1D backtest runs on exactly the prices its intraday
    # siblings do. Stamped at the 09:15 open like every other bucket - which also keeps the engine's
    # strategies, which flatten from 15:00, from reading every daily bar as the end of a session.
    "1D": "1 day",
}

# yfinance serves a shallow intraday window (1m only ~7d) and has no 4H interval - 60m bars are
# fetched and rolled up locally for that one.
YF_FALLBACK = {
    "1m": ("7d", "1m"),
    "5m": ("60d", "5m"),
    "15m": ("60d", "15m"),
    "1H": ("60d", "60m"),
    "4H": ("60d", "60m"),
    "1D": ("max", "1d"),
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

# How stale a cached symbol may get before its newest bars are fetched again. Past the close nothing
# changes; during a session this bounds how old "today" can be on a chart or in a backtest.
TOPUP_EVERY = 6 * 3600
# moneycontrol answers with the newest `countback` bars whatever `from` says; 100k 1m bars reaches
# back about a year, past the dataset's last day, so one request closes the whole gap.
MC_COUNTBACK = 100_000
IST = timezone(timedelta(hours=5, minutes=30))
# The minute split's first session. A stock whose minutes start here is in the dataset; its earlier 1D
# history comes from the dataset's own daily split, never from moneycontrol's daily feed, which sits
# on a different corporate-action basis for some stocks (RELIANCE's 2022 prices differ by the Jio
# Financial demerger adjustment; the dataset's two splits agree to ~0.1%).
DATASET_START = "2022-01-03"
# A block of days filled from the daily feed must agree with the minutes on price across its seam:
# median close difference over the nearest shared days, either side.
SEAM_WINDOW = 10
SEAM_MAX_DIFF = 0.02
# A day both have whose closes agree (same price basis) but whose open/high/low from the minutes is
# this far off the official bar has a bad print in it (illiquid SME 1m feeds have them - DHARIWAL
# opened 2025-11-12 at 160 in the minutes, 255 officially). Its 1D bar is taken from the record.
BAD_PRINT = 0.05
SAME_BASIS = 0.01
# Splits and bonuses neither feed adjusted for (DHARIWAL: 386 -> 78.7 overnight on 2026-02-06, a
# 1:5, in both). NSE price bands keep a real open from gapping this far, so an overnight jump at least
# SPLIT_MIN_MOVE that lands within SPLIT_TOLERANCE of a corporate-action ratio is one. Ratios are
# price after / before, for the actions NSE stocks actually do - splits 1:2 1:4 1:5 1:10, bonuses
# 1:1 1:2 2:1 3:1 3:2 4:1 (a-for-b is b / (a + b)), consolidations. Kept deliberately sparse: every
# a-for-b up to 5 would cover nearly the whole 0.16-0.75 band, and then any big gap would "match".
SPLIT_MIN_MOVE = 0.25
SPLIT_TOLERANCE = 0.03
CA_RATIOS = sorted({1 / 2, 1 / 4, 1 / 5, 1 / 10, 2 / 3, 1 / 3, 2 / 5} | {2.0, 5.0, 10.0})

# ponytail: one global lock, so two symbols can't be extracted concurrently. Extracts are rare
# (once per symbol, ever) and network-bound; swap for a per-symbol lock if that ever bites.
_extract_lock = threading.Lock()


def _cache_path(symbol):
    return CACHE_DIR / f"{symbol.upper()}.parquet"


def _daily_path(symbol):
    return CACHE_DIR / f"{symbol.upper()}.daily.parquet"


def _dataset_day_path(symbol):
    return CACHE_DIR / f"{symbol.upper()}.dataset-day.parquet"


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


def _extract_day(symbol):
    """The symbol's rows from the dataset's daily split, once, into a local parquet (~4s). The
    dataset doesn't change, so neither does this file; an uncovered symbol (NSE SME listings) writes
    an empty one, the cached "not in the daily split" answer. Delete it to refetch."""
    path = _dataset_day_path(symbol)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".partial")
    duckdb.execute(
        f"""
        COPY (
            SELECT (timestamp AT TIME ZONE 'Asia/Kolkata')::DATE AS date, open::DOUBLE AS open,
                   high::DOUBLE AS high, low::DOUBLE AS low, close::DOUBLE AS close, volume::BIGINT AS volume
            FROM '{HF_DAY}'
            WHERE symbol = ?
            ORDER BY date
        ) TO '{tmp}' (FORMAT parquet)
        """,
        [symbol.upper()],
    )
    tmp.replace(path)
    return path


def _rows(bars, tz):
    """Source bars (unix `time` read in `tz`) -> parquet rows (naive IST ts, o, h, l, c, v). Keeps
    the regular 09:15-15:29 session only (moneycontrol also sends a 15:30 closing print the dataset
    never had), and only minutes that have finished - a bar fetched mid-minute would be frozen
    half-formed, since later top-ups only append what is newer than the last stored bar."""
    now = datetime.now(IST).replace(tzinfo=None, second=0, microsecond=0)
    rows = []
    for b in bars:
        ts = datetime.fromtimestamp(b["time"], tz).replace(tzinfo=None)
        if ts < now and (9, 15) <= (ts.hour, ts.minute) < (15, 30):
            rows.append((ts, b["open"], b["high"], b["low"], b["close"], int(b["volume"] or 0)))
    return rows


def _recent_rows(symbol):
    """The newest ~year of 1m rows: moneycontrol (true unix time), else yfinance (already
    IST-shifted, hence read as UTC). [] when neither has the symbol."""
    try:
        now = int(time.time())
        bars = moneycontrol_local.fetch_history(symbol, now - 400 * 86400, now, "1", countback=MC_COUNTBACK)
        if bars:
            return _rows(bars, IST)
    except Exception as e:  # noqa: BLE001 - a feed outage must not break charts or backtests
        print(f"minute top-up {symbol}: moneycontrol failed: {e}")
    try:
        return _rows(scraper.get_intraday_bars(symbol, period="7d", interval="1m"), timezone.utc)
    except Exception as e:  # noqa: BLE001
        print(f"minute top-up {symbol}: yfinance failed: {e}")
        return []


def _day_time(date):
    """A date's 09:15 open as IST-shifted epoch seconds, like every other bar's `time`."""
    return int(datetime.fromisoformat(date).replace(tzinfo=timezone.utc).timestamp()) + 9 * 3600 + 15 * 60


def _daily_feed(symbol):
    """The official daily bars, finished sessions only: moneycontrol (its whole history), else
    yfinance. [] when neither has the symbol. Today's bar is left out until the 15:30 close."""
    now = datetime.now(IST)
    today, closed = now.date().isoformat(), (now.hour, now.minute) >= (15, 30)
    bars = []
    try:
        mc = moneycontrol_local.fetch_history(symbol, 0, int(time.time()), "1D", countback=10_000)
        bars = [{**b, "date": datetime.fromtimestamp(b["time"], timezone.utc).date().isoformat()} for b in mc]
    except Exception as e:  # noqa: BLE001
        print(f"daily feed {symbol}: moneycontrol failed: {e}")
    if not bars:
        try:
            bars = scraper.get_intraday_bars(symbol, period="max", interval="1d")
        except Exception as e:  # noqa: BLE001
            print(f"daily feed {symbol}: yfinance failed: {e}")
    return [
        (b["date"], b["open"], b["high"], b["low"], b["close"], int(b["volume"] or 0))
        for b in bars
        if b["date"] < today or (b["date"] == today and closed)
    ]


def _refresh_daily(symbol):
    """Rewrites the daily sidecar. An empty answer still writes an empty file, so a symbol no feed
    has is asked once per TOPUP_EVERY rather than on every request; a failed fetch keeps the old one."""
    rows = _daily_feed(symbol)
    path = _daily_path(symbol)
    if not rows and path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.register("d", pandas.DataFrame(rows, columns=["date", "open", "high", "low", "close", "volume"]))
    tmp = path.with_suffix(".partial")
    con.execute(
        f"""COPY (SELECT date::DATE AS date, open::DOUBLE AS open, high::DOUBLE AS high, low::DOUBLE AS low,
                         close::DOUBLE AS close, volume::BIGINT AS volume FROM d ORDER BY date)
            TO '{tmp}' (FORMAT parquet)"""
    )
    con.close()
    tmp.replace(path)


def _read_daily(symbol, path=None):
    """Daily bars from a sidecar parquet - moneycontrol's record by default, or `path` (the
    dataset's daily split) - as bar dicts stamped at the 09:15 open."""
    path = path or _daily_path(symbol)
    if not path.exists():
        return []
    # one bar a date: the dataset's daily split repeats 2015-12-31 (same row in two year shards),
    # and a repeated time breaks every chart that draws it
    rows = duckdb.execute(
        f"""SELECT DISTINCT ON (date) strftime(date, '%Y-%m-%d'), open, high, low, close, volume
            FROM read_parquet('{path}') ORDER BY date"""
    ).fetchall()
    return [
        {"date": d, "time": _day_time(d), "open": round(o, 2), "high": round(h, 2), "low": round(l, 2),
         "close": round(c, 2), "volume": int(v)}
        for d, o, h, l, c, v in rows
    ]


def fill_days(minute, feed, dataset_start=DATASET_START):
    # dataset_start=None lifts the before-the-minutes rule: for a feed on the minutes' own basis
    # (the dataset's daily split) extending back is the point.
    """1D bars from the minutes, with each day they lack taken from the official daily `feed`, and
    each day spoiled by a bad print (BAD_PRINT) replaced by the feed's bar.
    Returns (bars, filled, repaired). A block of feed-only days is added only when:
      - it isn't before the first minute day of a stock that is in the dataset (minutes starting at
        `dataset_start`) - for those, earlier history would be a second adjustment basis;
      - the feed and the minutes agree on price near it (median close difference over the nearest
        SEAM_WINDOW shared days on each side at most SEAM_MAX_DIFF) - otherwise the seam is a fake
        jump the strategy would trade.
    With no minutes at all, the feed is the whole series."""
    if not minute:
        return list(feed), len(feed), 0
    official = {b["date"]: b for b in feed}
    repaired = 0

    def clean(b):
        nonlocal repaired
        o = official.get(b["date"])
        if not o or abs(b["close"] / o["close"] - 1) > SAME_BASIS:
            return b  # nothing to check against, or another price basis: leave the minutes' bar
        if max(abs(b[k] / o[k] - 1) for k in ("open", "high", "low")) > BAD_PRINT:
            repaired += 1
            return {**o, "time": b["time"]}
        return b

    minute = [clean(b) for b in minute]
    close = {b["date"]: b["close"] for b in minute}
    shared = [(b["date"], abs(b["close"] / close[b["date"]] - 1)) for b in feed if close.get(b["date"])]
    shared_days = [d for d, _ in shared]
    first = minute[0]["date"]
    blocks, block = [], []
    for b in feed:
        if b["date"] in close:
            if block:
                blocks.append(block)
                block = []
        else:
            block.append(b)
    if block:
        blocks.append(block)
    out, filled = list(minute), 0
    for blk in blocks:
        if dataset_start and blk[0]["date"] < first and first <= dataset_start:
            continue
        i = bisect.bisect_left(shared_days, blk[0]["date"])
        near = [diff for _, diff in shared[max(0, i - SEAM_WINDOW) : i + SEAM_WINDOW]]
        if near and statistics.median(near) > SEAM_MAX_DIFF:
            continue
        out += blk
        filled += len(blk)
    return sorted(out, key=lambda b: b["date"]), filled, repaired


def split_events(days):
    """Overnight jumps in 1D bars that are a corporate action rather than a market move (see
    SPLIT_MIN_MOVE). -> [(date the action took effect, price ratio)], oldest first."""
    out = []
    for a, b in zip(days, days[1:]):
        r = b["open"] / a["close"] if a["close"] else 1
        if abs(r - 1) < SPLIT_MIN_MOVE:
            continue
        near = min(CA_RATIOS, key=lambda x: abs(r / x - 1))
        if abs(r / near - 1) <= SPLIT_TOLERANCE:
            out.append((b["date"], round(near, 6)))
    return out


def unexplained_jumps(days, events):
    """Overnight jumps of at least SPLIT_MIN_MOVE that aren't a known ratio - left as they are,
    since adjusting on a guess is worse than not, but worth a look (a collapse, or an action with
    an unusual ratio). -> [(date, move)] with move as the price ratio."""
    known = {d for d, _ in events}
    return [
        (b["date"], round(b["open"] / a["close"], 3))
        for a, b in zip(days, days[1:])
        if a["close"] and abs(b["open"] / a["close"] - 1) >= SPLIT_MIN_MOVE and b["date"] not in known
    ]


def back_adjust(bars, events):
    """Prices before each event scaled by its ratio and volume inversely, so history reads as if the
    action had always been in force - the way charts show it, and the only way a strategy doesn't
    trade a split as a crash."""
    if not events:
        return bars
    out = []
    for bar in bars:
        f = 1.0
        for d, r in events:
            if bar["date"] < d:
                f *= r
        if f == 1.0:
            out.append(bar)
        else:
            out.append({**bar, **{k: round(bar[k] * f, 2) for k in ("open", "high", "low", "close")},
                        "volume": int(round(bar["volume"] / f))})
    return out


# symbol -> ((minute cache mtime, daily mtime), full 1D series, events): the 1D series is rebuilt only
# when either file changes, not on every intraday request that needs its events
_daily_cache = {}


def _full_days(symbol, path):
    """The whole 1D series: the minutes' own days, then the dataset's daily split for every day
    they lack (all of a stock's history before 2022 - same source, same basis), then moneycontrol's
    daily record for what neither has (SME stocks, days after the dataset ends)."""
    daily, dataset_day = _daily_path(symbol), _dataset_day_path(symbol)
    mtime = lambda f: f.stat().st_mtime if f.exists() else 0  # noqa: E731
    key = (path.stat().st_mtime, mtime(daily), mtime(dataset_day))
    hit = _daily_cache.get(symbol)
    if not hit or hit[0] != key:
        days, _, _ = fill_days(
            _resample(path, "1D", None), _read_daily(symbol, dataset_day), dataset_start=None
        )
        days, filled, repaired = fill_days(days, _read_daily(symbol))  # "patched" = moneycontrol's share only
        events = split_events(days)
        hit = _daily_cache[symbol] = (key, days, events, filled + repaired, unexplained_jumps(days, events))
    return hit[1:]


def missing_sessions(symbol, days, start=None, end=None):
    """Sessions the official daily record has in the range that `days` (the dates a run's bars
    cover) doesn't: a hole in the minute history, or a stock whose minutes start after it listed.
    -> (count, first missing, last missing); (0, None, None) when nothing's missing or there's no
    daily record to compare against."""
    feed = [b["date"] for b in _read_daily(symbol)]
    lo, hi = start or "", end or "9999"
    if days and min(days) <= DATASET_START:  # a dataset stock: history before the dataset was never expected
        lo = max(lo, DATASET_START)
    gone = [d for d in feed if lo <= d <= hi and d not in days]
    return (len(gone), gone[0], gone[-1]) if gone else (0, None, None)


def _top_up(symbol, path):
    """Appends every 1m bar newer than the cache's last one. Touches the file either way, so a
    symbol neither feed has is asked once per TOPUP_EVERY, not on every request."""
    last = duckdb.execute(f"SELECT max(ts) FROM read_parquet('{path}')").fetchone()[0]
    rows = [r for r in _recent_rows(symbol) if last is None or r[0] > last]
    if rows:
        con = duckdb.connect()
        con.register("new_rows", pandas.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"]))
        tmp = path.with_suffix(".partial")
        # cast to the dataset's own column types, so every top-up leaves the schema as it found it
        con.execute(
            f"""
            COPY (
                SELECT * FROM read_parquet('{path}')
                UNION ALL
                SELECT ts::TIMESTAMP, open::FLOAT, high::FLOAT, low::FLOAT, close::FLOAT, volume::BIGINT
                FROM new_rows
                ORDER BY ts
            ) TO '{tmp}' (FORMAT parquet)
            """
        )
        con.close()
        tmp.replace(path)
    _refresh_daily(symbol)
    os.utime(path)
    return len(rows)


def range_bounds(mode="all", years=None, start=None, end=None, today=None):
    """A history choice -> (start, end) ISO dates, inclusive, None meaning open-ended. `years`
    counts back from today by days (365.25 a year), so a leap day or a half year needs no special
    case. An end past today is today. Every stock's own history is different: these bounds are
    what was asked for, and each stock uses whatever of it it has."""
    today = today or datetime.now(IST).date()
    if mode == "years":
        return (today - timedelta(days=round(years * 365.25))).isoformat(), None
    if mode == "dates":
        if start and start > today:
            raise ValueError(f"the range starts after today ({start})")
        return (start.isoformat() if start else None), (min(end, today).isoformat() if end else None)
    return None, None


def _resample(path, interval, limit=MAX_BARS, start=None, end=None):
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
                WHERE ($start IS NULL OR ts >= $start::TIMESTAMP)
                  AND ($end IS NULL OR ts < $end::TIMESTAMP + INTERVAL 1 DAY)
                GROUP BY bucket
            )
            ORDER BY time DESC
            LIMIT {limit or 10**12}
        )
        ORDER BY time
        """,
        {"start": start, "end": end},
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


def get_minute_bars(symbol, interval, limit=MAX_BARS, start=None, end=None):
    """interval: one of BUCKETS. Returns {bars, source} where source is 'dataset' or 'yfinance'.
    Bars are oldest-first {date, time, open, high, low, close, volume} - `date` the IST calendar
    day, `time` IST-shifted unix seconds. The first call for an uncached symbol blocks on the
    remote extract (~11s) plus a top-up; later ones read the local parquet. `limit` caps the newest
    bars returned (None = all - for server-side callers, never for the browser). `start`/`end` are
    inclusive IST dates ("YYYY-MM-DD", see range_bounds); outside a stock's own history they just
    return less, or nothing."""
    if interval not in BUCKETS:
        raise ValueError(f"interval must be one of {list(BUCKETS)}")
    symbol = symbol.upper()

    with _extract_lock:
        path = _cache_path(symbol)
        if not path.exists():
            _extract(symbol)
            _top_up(symbol, path)
        elif time.time() - path.stat().st_mtime > TOPUP_EVERY:
            _top_up(symbol, path)
        if not _daily_path(symbol).exists():  # caches from before the daily record was kept
            _refresh_daily(symbol)
        # Only daily bars reach back before 2022, so only they pay for the one-time daily extract.
        if interval == "1D" and not _dataset_day_path(symbol).exists():
            _extract_day(symbol)

    # the whole 1D series (filled, repaired) and its corporate actions; built on the full history,
    # since a seam's or a split's neighbours may lie outside the range asked for
    full, events, patched, jumps = _full_days(symbol, path)
    adjusted = {"adjusted": [{"date": d, "ratio": r} for d, r in events], "jumps": [{"date": d, "move": m} for d, m in jumps]}
    if interval == "1D":
        days = [b for b in back_adjust(full, events) if (not start or b["date"] >= start) and (not end or b["date"] <= end)]
        if days:
            source = "dataset + daily record" if patched else "dataset"  # daily split counts as dataset
            return {"bars": days[-limit:] if limit else days, "source": source, **adjusted}

    bars = _resample(path, interval, limit, start, end)
    if bars:
        return {"bars": back_adjust(bars, events), "source": "dataset", **adjusted}
    if duckdb.execute(f"SELECT count(*) FROM read_parquet('{path}')").fetchone()[0]:
        return {"bars": [], "source": "dataset"}  # the stock is covered, just not in this range

    # Empty cache entry = the dataset has no such symbol (delisted, an index it doesn't carry, a
    # renamed ticker). Yahoo's shallow intraday window is better than an empty chart.
    period, yf_interval = YF_FALLBACK[interval]
    bars = scraper.get_intraday_bars(symbol, period=period, interval=yf_interval)
    if interval == "4H":
        bars = _rollup_60m_to_4h(bars)
    elif interval == "1D":  # Yahoo stamps a day at midnight; move it to the 09:15 open like the rest
        bars = [{**b, "time": b["time"] + 9 * 3600 + 15 * 60} for b in bars]
    bars = [b for b in bars if (not start or b["date"] >= start) and (not end or b["date"] <= end)]
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

    # Top-up rows: moneycontrol's true unix time lands on the IST wall clock (03:45 UTC = 09:15
    # IST), yfinance's pre-shifted time is read as UTC to land on the same clock, and a bar for the
    # minute still forming is dropped.
    bar = {"time": 1768880700, "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": None}
    assert _rows([bar], IST)[0] == (datetime(2026, 1, 20, 9, 15), 1, 2, 0.5, 1.5, 0), _rows([bar], IST)
    assert _rows([{**bar, "time": 1768880700 + 19800}], timezone.utc)[0][0] == datetime(2026, 1, 20, 9, 15)
    assert _rows([{**bar, "time": int(time.time())}], IST) == [], "the forming minute is not stored"
    assert _rows([{**bar, "time": 1768880700 + 6 * 3600 + 15 * 60}], IST) == [], "15:30 closing print dropped"
    print("ok - top-up rows land on the IST wall clock; forming minute and 15:30 print dropped")

    from datetime import date

    today = date(2026, 9, 29)
    assert range_bounds(today=today) == (None, None), "all available: open at both ends"
    assert range_bounds("years", 1, today=today) == ("2025-09-29", None)
    assert range_bounds("years", 0.5, today=today) == ("2026-03-30", None), "half a year, by days"
    assert range_bounds("years", 4, today=date(2028, 2, 29)) == ("2024-02-29", None), "leap day"
    assert range_bounds("dates", start=date(2023, 1, 1), end=date(2030, 1, 1), today=today) == (
        "2023-01-01",
        "2026-09-29",
    ), "an end past today is today"
    assert range_bounds("dates", end=date(2024, 6, 30), today=today) == (None, "2024-06-30"), "open start"
    try:
        range_bounds("dates", start=date(2027, 1, 1), today=today)
        raise AssertionError("a range starting after today must be refused")
    except ValueError:
        pass
    print("ok - history ranges: all, last n years, dates clipped to today")

    def day(d, c):
        return {"date": d, "time": 0, "open": c, "high": c, "low": c, "close": c, "volume": 1}

    feed = [day(f"2025-01-0{i}", 100) for i in range(1, 10)]
    # a stock the dataset doesn't carry: minutes only from the 6th, the feed from the 1st
    mins = [day(f"2025-01-0{i}", 100.2) for i in (6, 7, 8, 9)]
    got, n, _ = fill_days(mins, feed)
    assert n == 5 and [b["date"][-2:] for b in got] == ["01", "02", "03", "04", "05", "06", "07", "08", "09"]
    assert got[5]["close"] == 100.2, "a day the minutes have keeps the minutes' bar"
    # a hole in the middle is filled; the minutes' own days are left alone
    got, n, _ = fill_days([day("2025-01-01", 100), day("2025-01-09", 100)], feed)
    assert n == 7 and len(got) == 9
    # a dataset stock (minutes from the dataset's first day) is not extended further back
    got, n, _ = fill_days([day("2025-01-05", 100), day("2025-01-06", 100)], feed, dataset_start="2025-01-05")
    assert [b["date"][-2:] for b in got] == ["05", "06", "07", "08", "09"], "only the later days"
    # a feed on another price basis (5% off at the seam) is not spliced in
    got, n, _ = fill_days([day("2025-01-08", 105), day("2025-01-09", 105)], feed)
    assert n == 0 and len(got) == 2, "a fake 5% jump at the seam is refused"
    assert fill_days([], feed) == (feed, 9, 0), "no minutes at all: the feed is the series"
    got, n, _ = fill_days([day("2025-01-05", 100), day("2025-01-06", 100)], feed, dataset_start=None)
    assert n == 7 and got[0]["date"] == "2025-01-01", "a same-basis daily split extends a dataset stock back"
    assert fill_days(mins, []) == (mins, 0, 0), "no feed: nothing to fill"
    # a date repeated in a sidecar reads back once
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        dup = Path(tmp) / "dup.parquet"
        duckdb.execute(
            f"""COPY (SELECT * FROM (VALUES (DATE '2015-12-31', 1.0, 2.0, 0.5, 1.5, 10),
                                            (DATE '2015-12-31', 1.0, 2.0, 0.5, 1.5, 10),
                                            (DATE '2016-01-01', 1.5, 2.0, 1.0, 1.8, 10))
                     t(date, open, high, low, close, volume)) TO '{dup}' (FORMAT parquet)"""
        )
        assert [b["date"] for b in _read_daily("X", dup)] == ["2015-12-31", "2016-01-01"]
    # a bad print: close agrees, open 36% off -> the official bar; same basis, small noise -> kept
    tick = {**day("2025-01-09", 100), "open": 64.0, "time": 7}
    got, _, fixed = fill_days([day("2025-01-08", 100.3), tick], feed)
    by = {b["date"]: b for b in got}
    assert fixed == 1 and by["2025-01-09"]["open"] == 100 and by["2025-01-09"]["time"] == 7, by["2025-01-09"]
    assert by["2025-01-08"]["close"] == 100.3, "a clean day keeps the minutes' bar"
    # another basis (closes 5% apart): a wide open is not "repaired" onto the wrong basis
    got, _, fixed = fill_days([{**day("2025-01-09", 105), "open": 64.0}], feed)
    assert fixed == 0 and got[-1]["open"] == 64.0
    print("ok - 1D fill: missing days and bad prints from the daily record, never across a mismatched basis")

    walk = [day("2026-02-04", 380), day("2026-02-05", 386), {**day("2026-02-06", 78.7), "open": 78.7}, day("2026-02-09", 78)]
    assert split_events(walk) == [("2026-02-06", 0.2)], "DHARIWAL's 386 -> 78.7 is a 1:5"
    assert split_events([day("a", 100), {**day("b", 80), "open": 80}]) == [], "a 20% gap is a market move"
    assert split_events([day("a", 100), {**day("b", 62), "open": 62}]) == [], "a 38% gap far from any ratio isn't"
    assert split_events([day("a", 100), {**day("b", 51), "open": 51}]) == [("b", 0.5)], "a 1:1 bonus"
    adj = back_adjust(walk, [("2026-02-06", 0.2)])
    assert [b["close"] for b in adj] == [76.0, 77.2, 78.7, 78], "earlier prices scaled into today's terms"
    assert adj[0]["volume"] == 5 and adj[2]["volume"] == 1, "earlier volume scaled the other way"
    assert back_adjust(walk, []) is walk
    assert unexplained_jumps([day("a", 79.45), {**day("b", 41.8), "open": 41.8}], []) == [("b", 0.526)], "flagged, not adjusted"
    assert unexplained_jumps(walk, [("2026-02-06", 0.2)]) == [], "an adjusted split isn't also flagged"
    print("ok - unadjusted splits/bonuses found and back-adjusted")
