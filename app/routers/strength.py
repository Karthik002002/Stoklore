"""Relative strength, base scan and sector rotation over the whole NSE main board, from the daily
bhavcopy cache (app/core/bhavcopy.py, computed by app/core/strength.py).

The cache fills itself: any request here starts a background sync of missing days (a year on the
first run - ~280 throttled requests - then the newest day each evening). Results are derived once per
cached day and held in memory, so the page is instant after the first read.
"""
import json
import threading
import time
from datetime import datetime

from fastapi import APIRouter, HTTPException

from app.core import alerts, bhavcopy, db, scraper, strength
from app.core.config import IST
from app.deps import _cached
from app.routers.indices import sectors as et_sectors

router = APIRouter(tags=["strength"])

# While the first backfill runs, results are served from this many days on, rated over the history
# collected so far and flagged `partial` - the page fills in instead of sitting on a spinner.
PARTIAL_MIN = 20

_memo = {"key": None, "bars": None, "stocks": None, "rrg": {}}
_memo_lock = threading.Lock()


def _bars():
    """The bhavcopy cache, re-read only when a new day lands - companies only. The bhavcopy puts ETFs
    under the same EQ series; the stocks master (NSE's company list) does not have them."""
    days = bhavcopy.cached_days()
    key = (len(days), days[-1] if days else None)
    with _memo_lock:
        if _memo["key"] != key:
            bars, _ = bhavcopy.load()
            companies = {r["symbol"] for r in db.stocks_master_names() if r["exchange"] == "NSE"}
            if companies:
                bars = {s: rows for s, rows in bars.items() if s in companies}
            _memo.update(key=key, bars=bars, stocks=None, rrg={})
        return _memo["bars"], key


def _nifty():
    """NIFTY 50 daily closes as [(date, close)] - the benchmark. One cached Yahoo request; the
    bhavcopy carries stocks only."""
    data = _cached("NIFTY", "index-chart:1y", 60, lambda: scraper.get_index_chart("NIFTY", "1y"))
    out = []
    for b in (data or {}).get("bars", []):
        # chart bars are IST wall-clock encoded as UTC seconds
        out.append((datetime.utcfromtimestamp(b["time"]).date(), b["close"]))
    return out


@router.get("/api/strength/status")
def status():
    days = bhavcopy.cached_days()
    missing = bhavcopy.missing_days()
    if missing:
        bhavcopy.sync()
    return {
        "days": len(days),
        "first": days[0] if days else None,
        "last": days[-1] if days else None,
        "missing": len(missing),
        "ready": len(days) >= strength.MIN_BARS,
        # enough to show something while the year fills in - ratings over the history there is
        "partial_ready": len(days) >= PARTIAL_MIN,
        "sync": bhavcopy.state,
    }


@router.post("/api/strength/sync")
def sync():
    return bhavcopy.sync()


@router.get("/api/strength/stocks")
def stocks():
    """Every rated stock: RS 1-99, returns, 52-week position, trend template (8 checks) and VCP read."""
    bars, key = _bars()
    days = key[0]
    if days < PARTIAL_MIN:
        bhavcopy.sync()
        raise HTTPException(status_code=409, detail="Price history is still being collected - see /api/strength/status")
    partial = days < strength.MIN_BARS
    if partial:
        bhavcopy.sync()
    return {"as_of": key[1], "days": days, "partial": partial, **_table(bars, days)}


def _table(bars, days):
    with _memo_lock:
        if _memo["stocks"] is None:
            closes = [c for _, c in _nifty()]
            # partial history: rate everything that has (nearly) all the days collected so far
            _memo["stocks"] = strength.stock_table(bars, closes, min_bars=min(strength.MIN_BARS, max(2, days - 2)))
        return _memo["stocks"]


@router.get("/api/strength/rrg")
def rrg(tf: str = "weekly"):
    """Sector rotation: each ET sector rebuilt from its members' bhavcopy closes (cap-weighted
    daily returns), against NIFTY 50. `tf` = weekly (positional) | daily (swing)."""
    if tf not in ("weekly", "daily"):
        raise HTTPException(status_code=400, detail="tf must be weekly or daily")
    bars, key = _bars()
    if key[0] < PARTIAL_MIN:
        raise HTTPException(status_code=409, detail="Price history is still being collected")
    with _memo_lock:
        if tf in _memo["rrg"]:
            return _memo["rrg"][tf]
    bench = _nifty()
    out = []
    for sec in et_sectors("NSE")["sectors"]:
        members, weights = {}, {}
        for m in sec["members"]:
            rows = bars.get(m.get("symbol") or "")
            if not rows or strength.split_gap([r[4] for r in rows]):
                continue
            members[m["symbol"]] = {r[0]: r[4] for r in rows}
            weights[m["symbol"]] = m.get("mcap_cr") or 1
        if len(members) < 3:
            continue  # too few clean members to stand in for the sector
        series = strength.sector_index(members, weights)
        b = bench
        if tf == "weekly":
            series, b = strength.weekly(series), strength.weekly(bench)
        tail = strength.rrg(series, b)
        if not tail:
            continue
        last = tail[-1]
        out.append({
            "id": sec["id"], "name": sec["name"], "members": len(members), "mcap_cr": sec["mcap_cr"],
            "tail": tail, "quadrant": strength.quadrant(last["ratio"], last["momentum"]),
        })
    result = {"as_of": key[1], "tf": tf, "sectors": out}
    with _memo_lock:
        _memo["rrg"][tf] = result
    return result


# --- evening refresh + VCP alerts ---------------------------------------------------------------
# The cache otherwise only grows when someone opens Leaders. A background tick pulls the day's file
# once it's published, and when a new day lands, writes an alert (kind 'scan') for each stock that
# passes the VCP read today but didn't on the last day checked. The first run only records the set -
# alerting on every existing setup at once would be noise, not news.

VCP_SEEN = bhavcopy.CACHE_DIR / "vcp_seen.json"
VCP_MIN_VALUE_CR = 1  # the page's default liquidity floor: illiquid bases aren't tradeable alerts
TICK = 15 * 60


def vcp_new(table, seen):
    """Symbols newly passing VCP (liquid ones only), given the previously seen set."""
    now = {r["symbol"] for r in table["stocks"] if r["vcp"] and r["avg_value_cr"] >= VCP_MIN_VALUE_CR}
    return now, sorted(now - set(seen))


def _vcp_alerts():
    bars, key = _bars()
    if key[0] < strength.MIN_BARS:
        return  # partial ratings aren't worth alerting on
    prev = json.loads(VCP_SEEN.read_text()) if VCP_SEEN.exists() else None
    if prev and prev.get("day") == str(key[1]):
        return
    table = _table(bars, key[0])
    now, new = vcp_new(table, (prev or {}).get("symbols", []))
    if prev is not None:
        rows = {r["symbol"]: r for r in table["stocks"]}
        for sym in new:
            r = rows[sym]
            alerts.record("scan", f"VCP setup: {sym} - RS {r['rs']}, pivot ₹{r['pivot']} ({r['to_pivot_pct']:+.1f}%)",
                          symbol=sym, meta={"scan": "vcp", "day": str(key[1]), "pivot": r["pivot"], "rs": r["rs"]})
    VCP_SEEN.write_text(json.dumps({"day": str(key[1]), "symbols": sorted(now)}))


def _loop():
    while True:
        try:
            if bhavcopy.missing_days():
                bhavcopy.sync()
            while bhavcopy.state["running"]:
                time.sleep(30)
            _vcp_alerts()
        except Exception:  # noqa: BLE001 - a bad tick must not kill the loop; next tick retries
            pass
        time.sleep(TICK)


def start():
    threading.Thread(target=_loop, daemon=True).start()
