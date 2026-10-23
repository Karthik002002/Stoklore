"""Microcap universe snapshot - see app/core/microcap.py. Pulled weekly in the background (and on
demand), stored whole in microcap_snapshots, served from there."""
import threading
import time
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core import alerts, db, microcap
from app.routers import strength as strength_router

router = APIRouter(tags=["microcaps"])

REFRESH_DAYS = 7  # fundamentals move quarterly; weekly keeps prices/RS honest without hammering screener
TICK = 3600
state = {"running": False, "error": None, "started_at": None}
_lock = threading.Lock()


def _strength_rows():
    """The bhavcopy strength table, or [] while price history is still being collected."""
    bars, key = strength_router._bars()
    if key[0] < strength_router.PARTIAL_MIN:
        return []
    return strength_router._table(bars, key[0])["stocks"]


def run():
    """One full pull. Returns False if one is already running."""
    with _lock:
        if state["running"]:
            return False
        state.update(running=True, error=None, started_at=time.time())
    try:
        rows = microcap.fetch_universe(db.get_screener_cookie())
        if not rows:
            raise ValueError("screener.in returned no companies for the microcap query")
        own = microcap.ownership(db.list_shareholding_filings(since=date.today() - timedelta(days=800)))
        stocks = microcap.build(rows, _strength_rows(), own)
        prev = db.get_latest_microcaps()
        db.save_microcaps(date.today(), {
            "band_cr": [microcap.MCAP_MIN_CR, microcap.MCAP_MAX_CR],
            "count": len(stocks),
            "stocks": stocks,
        })
        _check_theses(stocks, prev["payload"]["stocks"] if prev else [])
    except Exception as exc:  # noqa: BLE001 - reported on /status, retried next tick
        state["error"] = str(exc)
    finally:
        state["running"] = False
    return True


QUARTER_LABELS = {
    "sales_qtr_cr": "sales ₹Cr",
    "np_qtr_cr": "profit ₹Cr",
    "qtr_sales_yoy": "sales YoY %",
    "qtr_profit_yoy": "profit YoY %",
}


def _check_theses(stocks, prev_stocks):
    """After a pull: a new results quarter on a thesis stock, and any thesis limit newly broken, each
    land in the Alerts feed. A breach is alerted once, when it first appears - not every week."""
    now = {s["key"]: s for s in stocks}
    before = {s.get("key") or s.get("symbol") or s.get("bse_code"): s for s in prev_stocks}
    for t in db.list_microcap_theses():
        key, row = t["key"], now.get(t["key"])
        diff = microcap.quarter_diff(before.get(key), row)
        if diff:
            parts = ", ".join(f"{QUARTER_LABELS[f]} {a} → {b}" for f, (a, b) in diff.items())
            alerts.record("scan", f"New quarter for {key}: {parts}", symbol=row.get("symbol"),
                          meta={"scan": "microcap-quarter", "diff": diff})
        breaches = microcap.thesis_breaches(t, row)
        new = [b for b in breaches if b not in (t["last_breaches"] or [])]
        if new:
            alerts.record("scan", f"Thesis check for {key}: {'; '.join(new)}",
                          symbol=(row or {}).get("symbol"), meta={"scan": "microcap-thesis", "breaches": new})
        if breaches != (t["last_breaches"] or []):
            db.set_microcap_thesis_breaches(key, breaches)


@router.get("/api/microcaps")
def microcaps():
    snap = db.get_latest_microcaps()
    if not snap:
        raise HTTPException(status_code=404, detail="No microcap snapshot yet - POST /api/microcaps/refresh")
    return {"as_of": snap["as_of"], "fetched_at": snap["fetched_at"], **snap["payload"]}


@router.get("/api/microcaps/status")
def status():
    snap = db.get_latest_microcaps()
    return {**state, "as_of": snap["as_of"] if snap else None, "has_cookie": bool(db.get_screener_cookie())}


@router.post("/api/microcaps/refresh")
def refresh():
    if state["running"]:
        return {"started": False, "running": True}
    threading.Thread(target=run, daemon=True).start()
    return {"started": True}


class ThesisIn(BaseModel):
    note: str = ""
    min_roce: float | None = None
    max_pe: float | None = None
    max_promoter_drop: float | None = None


@router.get("/api/microcaps/theses")
def theses():
    """Every thesis, with how the stock has moved since it was written and what it breaks now."""
    snap = db.get_latest_microcaps()
    now = {s["key"]: s for s in (snap["payload"]["stocks"] if snap else [])}
    return [
        {**t, "since": microcap.since_baseline(t, now.get(t["key"])),
         "breaches": microcap.thesis_breaches(t, now.get(t["key"])) if snap else []}
        for t in db.list_microcap_theses()
    ]


@router.put("/api/microcaps/theses/{key}")
def save_thesis(key: str, body: ThesisIn):
    snap = db.get_latest_microcaps()
    row = next((s for s in (snap["payload"]["stocks"] if snap else []) if s["key"] == key), None)
    if row is None:
        raise HTTPException(status_code=404, detail=f"{key} isn't in the latest microcap snapshot")
    return db.save_microcap_thesis(key, body.note, body.min_roce, body.max_pe, body.max_promoter_drop, row)


@router.delete("/api/microcaps/theses/{key}")
def delete_thesis(key: str):
    db.delete_microcap_thesis(key)
    return {"ok": True}


def _stale():
    snap = db.get_latest_microcaps()
    return not snap or (date.today() - snap["as_of"]).days >= REFRESH_DAYS


def _loop():
    while True:
        try:
            # no cookie = the register wall every time; don't spend requests on it
            if db.get_screener_cookie() and _stale() and not state["running"]:
                run()
                if isinstance(state["error"], str) and "login" in state["error"].lower():
                    time.sleep(TICK * 23)  # expired cookie: try once a day, not hourly
        except Exception:  # noqa: BLE001 - a bad tick must not kill the loop
            pass
        time.sleep(TICK)


def start():
    threading.Thread(target=_loop, daemon=True).start()
