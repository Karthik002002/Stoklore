"""Price alerts and the notification feed they share with the live-trading mirror.

Kept separate from watch_rules.py, which answers a research question on demand (P/E, EMA state,
recent negative events - each check a scrape or a computation). This is one number against one
level, swept every few seconds by the live poller.
"""
from fastapi import APIRouter, HTTPException

from app.core import alerts, db
from app.schemas import AlertRequest
from app.services.quotes import paper_price

router = APIRouter(tags=["alerts"])


@router.get("/api/alerts")
def list_alerts(active: bool | None = None, limit: int = 200):
    """Both kinds in one feed, newest first - armed price levels and everything the broker did."""
    return db.list_alerts(active=active, limit=limit)


@router.post("/api/alerts")
def create_alert(req: AlertRequest):
    symbol = req.symbol.strip().upper()
    if req.price <= 0:
        raise HTTPException(status_code=422, detail="alert price must be above 0")
    # Warn-free but useful: an alert already true when you set it fires on the next sweep, which
    # is correct ("tell me when it is above 100" when it is already 105 is a yes) but surprises
    # people, so the current price goes back in the response for the UI to say so.
    price = paper_price(symbol)
    alert_id = db.create_alert(
        kind="price", symbol=symbol, condition=req.condition, price=req.price,
        note=req.note, recurring=req.recurring,
    )
    return {"id": alert_id, "current_price": price,
            "already_true": price is not None and alerts.should_fire(
                {"kind": "price", "active": True, "condition": req.condition, "price": req.price},
                price,
            )}


@router.post("/api/alerts/acknowledge")
def acknowledge_alerts(ids: list[int] | None = None):
    db.acknowledge_alerts(ids)
    return {"ok": True}


@router.delete("/api/alerts/{alert_id}")
def delete_alert(alert_id: int):
    db.delete_alert(alert_id)
    return {"ok": True}
