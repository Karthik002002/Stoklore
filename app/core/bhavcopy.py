"""NSE's daily bhavcopy - one file per trading day with the OHLC, volume and value of every listed
security - cached locally as a year of daily bars for the whole market.

Why this and not per-stock price requests: a market-wide relative-strength rating or base scan needs
a year of bars for ~2,000 stocks, and fetching those one ticker at a time runs straight into rate
limits. The bhavcopy is one request per DAY for every stock at once: ~250 requests to backfill a year
(throttled, in the background, once), then one more each evening.

Files land in local_data/bhavcopy/ (gitignored - fetched data, not code), one small gzipped CSV of
the equity rows per day. A day NSE has no file for (a holiday, a weekend) leaves an empty marker so
it's never asked for again. Nothing here writes to the database.

Prices are back-adjusted for the splits and bonuses in NSE's corporate-actions list (one request a
day, cached as corp_actions.json). Anything that list misses still shows as a gap, and strength.py
drops a stock with a split-like gap rather than reporting a fake crash.
"""
import csv
import gzip
import io
import json
import re
import threading
import time
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path

from app.core import netfetch, scraper
from app.core.config import IST

CACHE_DIR = Path("local_data/bhavcopy")
URL = "https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{d:%Y%m%d}_F_0000.csv.zip"
# The equity series worth ranking: main board (EQ) and trade-for-trade (BE). Bonds, ETFs, SME and the
# rest share the file and are dropped at parse time.
SERIES = {"EQ", "BE"}
# How far back a backfill reaches: 12 months of RS plus a 52-week window, with room for holidays.
HISTORY_DAYS = 400
# Seconds between file requests - a backfill is ~280 requests and must not look like a scrape storm.
PAUSE = 2.5
# The file for a day is published after the close; before this it would 404 and be marked missing.
PUBLISHED_AFTER = (18, 30)

state = {"running": False, "done": 0, "total": 0, "errors": 0, "last_error": None, "started": None, "finished": None}
_lock = threading.Lock()


def _path(d):
    return CACHE_DIR / f"{d:%Y-%m-%d}.csv.gz"


def parse(raw_csv):
    """Equity rows of one bhavcopy as [(symbol, open, high, low, close, volume, value)]."""
    out = []
    for r in csv.DictReader(io.StringIO(raw_csv)):
        if r.get("SctySrs") not in SERIES or r.get("FinInstrmTp") != "STK":
            continue
        try:
            out.append((r["TckrSymb"], float(r["OpnPric"]), float(r["HghPric"]), float(r["LwPric"]),
                        float(r["ClsPric"]), int(float(r["TtlTradgVol"] or 0)), float(r["TtlTrfVal"] or 0)))
        except (KeyError, ValueError):
            continue
    return out


def _fetch(d):
    """Download one day into the cache. True if it had data, False for a day NSE has none."""
    if _path(d).exists():  # another sync got here first
        return _path(d).stat().st_size > 0
    res = netfetch.request(URL.format(d=d), pool="nse", prime=scraper.NSE_BASE)
    if res.status == 404:
        _path(d).write_bytes(b"")  # holiday / no file: remembered, never asked again
        return False
    if res.status != 200:
        raise RuntimeError(f"{d}: HTTP {res.status}")
    body = res.body if isinstance(res.body, bytes) else res.body.encode("latin-1")
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        rows = parse(z.read(z.namelist()[0]).decode())
    buf = io.StringIO()
    csv.writer(buf).writerows(rows)
    _path(d).write_bytes(gzip.compress(buf.getvalue().encode()))
    return True


def last_published_day(now=None):
    """The newest weekday whose file should exist by now."""
    now = now or datetime.now(IST)
    d = now.date()
    if (now.hour, now.minute) < PUBLISHED_AFTER:
        d -= timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def missing_days(today=None):
    """Weekdays in the history window with nothing cached yet, oldest first."""
    end = today or last_published_day()
    d = end - timedelta(days=HISTORY_DAYS)
    out = []
    while d <= end:
        if d.weekday() < 5 and not _path(d).exists():
            out.append(d)
        d += timedelta(days=1)
    return out


def cached_days():
    """Days that have data (non-empty files), ascending."""
    if not CACHE_DIR.exists():
        return []
    return sorted(date.fromisoformat(p.name[:10]) for p in CACHE_DIR.glob("*.csv.gz") if p.stat().st_size > 0)


def _run(days):
    try:
        for d in days:
            try:
                _fetch(d)
            except Exception as e:  # one bad day must not stop the rest
                state["errors"] += 1
                state["last_error"] = str(e)
            state["done"] += 1
            time.sleep(PAUSE)
    finally:
        state["running"] = False
        state["finished"] = datetime.now(IST).isoformat()


def sync():
    """Fetch whatever is missing in the background - the whole year on first run, the newest day
    after that. Returns the state; a second call while one runs is a no-op."""
    with _lock:
        if state["running"]:
            return state
        # newest first: while a first backfill runs, the page rates what is in, and that should be the
        # most recent months rather than last year's
        days = missing_days()[::-1]
        if not days:
            return state
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        state.update(running=True, done=0, total=len(days), errors=0, last_error=None,
                     started=datetime.now(IST).isoformat(), finished=None)
        threading.Thread(target=_run, args=(days,), daemon=True).start()
        return state


CORP_ACTIONS = CACHE_DIR / "corp_actions.json"
CA_PATH = "/api/corporates-corporateActions?index=equities&from_date={a:%d-%m-%Y}&to_date={b:%d-%m-%Y}"


def ca_factor(subject):
    """Price divisor for one corporate action's subject line, or None if it isn't a split/bonus.
    'Bonus 1:4' (1 new per 4 held) -> 1.25; 'Face Value Split From Rs 10/- To Rs 2/-' -> 5."""
    s = (subject or "").lower()
    m = re.search(r"bonus\D*?(\d+)\s*:\s*(\d+)", s)
    if m and int(m[2]):
        return (int(m[1]) + int(m[2])) / int(m[2])
    if "split" in s or "splt" in s or "sub-division" in s:
        m = re.search(r"r[se]\.?\s*(\d+(?:\.\d+)?)\D+?r[se]\.?\s*(\d+(?:\.\d+)?)", s)
        if m and float(m[2]):
            return float(m[1]) / float(m[2])
    return None


def corp_actions():
    """{symbol: [(ex_date, factor), ...]} for the history window, refetched once a day. A failed
    fetch falls back to yesterday's copy (or nothing) - unadjusted stocks are caught by split_gap."""
    today = datetime.now(IST).date()
    cached = None
    if CORP_ACTIONS.exists():
        cached = json.loads(CORP_ACTIONS.read_text())
        if cached.get("fetched") == today.isoformat():
            return _ca_map(cached["rows"])
    try:
        rows = scraper._nse_json(CA_PATH.format(a=today - timedelta(days=HISTORY_DAYS), b=today)) or []
        rows = [{"symbol": r.get("symbol"), "subject": r.get("subject"), "exDate": r.get("exDate")} for r in rows]
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        CORP_ACTIONS.write_text(json.dumps({"fetched": today.isoformat(), "rows": rows}))
    except Exception:
        rows = (cached or {}).get("rows", [])
    return _ca_map(rows)


def _ca_map(rows):
    out = {}
    for r in rows:
        f = ca_factor(r.get("subject"))
        try:
            d = datetime.strptime(r.get("exDate") or "", "%d-%b-%Y").date()
        except ValueError:
            continue
        if f and f > 1 and r.get("symbol"):
            out.setdefault(r["symbol"], []).append((d, f))
    return out


def adjust(rows, actions):
    """Back-adjust one symbol's bars: prices before each ex-date divided by its factor, volume
    multiplied. Rows are (date, o, h, l, c, v) ascending."""
    if not actions:
        return rows
    out = []
    for r in rows:
        f = 1.0
        for d, k in actions:
            if r[0] < d:
                f *= k
        out.append(r if f == 1 else (r[0], r[1] / f, r[2] / f, r[3] / f, r[4] / f, int(r[5] * f)))
    return out


def load():
    """The cache as {symbol: [(date, open, high, low, close, volume), ...]} ascending, plus the list of
    trading days. Read fresh each call; strength.py caches what it derives from it."""
    days = cached_days()
    bars = {}
    for d in days:
        text = gzip.decompress(_path(d).read_bytes()).decode()
        for sym, o, h, low, c, v, _val in csv.reader(io.StringIO(text)):
            bars.setdefault(sym, []).append((d, float(o), float(h), float(low), float(c), int(v)))
    for sym, acts in corp_actions().items():
        if sym in bars:
            bars[sym] = adjust(bars[sym], acts)
    return bars, days
