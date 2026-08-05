from fastapi import APIRouter
import threading

from fastapi import HTTPException

import db

from app.services.jobs import _event_scan_state, _run_event_scan

router = APIRouter(tags=["events"])

@router.post("/api/events/scan")
def trigger_event_scan(list_name: str | None = None):
    if _event_scan_state["running"]:
        raise HTTPException(status_code=409, detail="An event scan is already running")
    threading.Thread(target=_run_event_scan, args=(list_name,), daemon=True).start()
    return {"ok": True}


@router.get("/api/events/status")
def event_scan_status():
    return _event_scan_state


@router.get("/api/events")
def events_feed(
    list_name: str | None = None, symbol: str | None = None,
    from_date: str | None = None, to_date: str | None = None, limit: int = 100,
):
    return db.list_events(list_name=list_name, symbol=symbol, from_date=from_date, to_date=to_date, limit=limit)


@router.get("/api/events/attention")
def events_attention(
    list_name: str | None = None, symbol: str | None = None,
    baseline_days: int = 30, recent_days: int = 3,
):
    """Per-symbol event-coverage volume vs. that symbol's own baseline - see db.attention_scores.
    Powers the Events page's "Unusual attention" panel: which watchlisted stocks are getting more
    coverage than usual right now, not just what the latest single headline says."""
    return db.attention_scores(
        list_name=list_name, symbol=symbol, baseline_days=baseline_days, recent_days=recent_days
    )
