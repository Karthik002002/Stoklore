"""Price alerts and the notification feed they share with the live-trading mirror.

Kept separate from watch_rules.py, which answers a research question on demand (P/E, EMA state,
recent negative events - each check a scrape or a computation). This is one number against one or
two levels, swept every few seconds by the live poller.

The condition vocabulary and everything it means lives in app/core/alerts.py; this module only
validates what arrives and hands it over.
"""
from fastapi import APIRouter, HTTPException

from app.core import alerts, db
from app.schemas import AlertRequest, AlertUpdateRequest
from app.services.quotes import paper_price

router = APIRouter(tags=["alerts"])

#: The two conditions the app shipped with, in the vocabulary it uses now. Accepted forever: they
#: are in saved rows, and an old client has no reason to stop working.
LEGACY_CONDITIONS = {"above": "greater", "below": "less"}


def _validate(condition, price, price2):
    """What has to be true before an alert is worth arming. Raises rather than silently correcting:
    a channel with one bound is a half-finished thought, not a defaulting opportunity."""
    if condition in alerts.CHANNEL_CONDITIONS:
        if price2 is None:
            raise HTTPException(status_code=422, detail=f"{condition} needs both channel bounds")
        if price <= 0 or price2 <= 0:
            raise HTTPException(status_code=422, detail="channel bounds must be above 0")
        if price == price2:
            raise HTTPException(status_code=422, detail="a channel needs two different bounds")
    elif condition in alerts.MOVE_CONDITIONS:
        if price <= 0:
            raise HTTPException(status_code=422, detail="a move has to be bigger than nothing")
        if condition.endswith("_pct") and price >= 100:
            raise HTTPException(status_code=422, detail="a move of 100% or more is not a useful alert")
    elif price <= 0:
        raise HTTPException(status_code=422, detail="alert price must be above 0")


@router.get("/api/alerts")
def list_alerts(active: bool | None = None, kind: str | None = None, limit: int = 200):
    """Both kinds in one feed, newest first - armed price conditions and everything the broker did.
    `kind=price` is the alerts page's table; the page's feed asks for everything."""
    return db.list_alerts(active=active, kind=kind, limit=limit)


@router.get("/api/alerts/conditions")
def alert_conditions():
    """What the UI builds its condition picker from, so the two can't drift apart: the labels, and
    which conditions need a second bound, measure a move, or depend on a previous observation."""
    return {
        "conditions": [
            {
                "value": key,
                "label": label,
                "channel": key in alerts.CHANNEL_CONDITIONS,
                "move": key in alerts.MOVE_CONDITIONS,
                "percent": key.endswith("_pct"),
                # Stateful ones can be missed by a poll that lands after the price came back -
                # the UI says so where it is chosen rather than in a help page nobody opens.
                "stateful": key in alerts.STATEFUL,
            }
            for key, label in alerts.CONDITION_LABELS.items()
        ],
        "triggers": list(alerts.TRIGGERS),
    }


@router.post("/api/alerts")
def create_alert(req: AlertRequest):
    symbol = req.symbol.strip().upper()
    condition = LEGACY_CONDITIONS.get(req.condition, req.condition)
    _validate(condition, req.price, req.price2)

    # The current price does two jobs here: it is what moving_* measures from, and it is how the
    # response can warn that an alert is already true. An alert armed on a symbol with no quote is
    # still armed - it just has nothing to measure from until the first sweep.
    price = paper_price(symbol)
    trigger_mode = "every_time" if req.recurring else req.trigger_mode

    alert_id = db.create_alert(
        kind="price", symbol=symbol, condition=condition, price=req.price, price2=req.price2,
        note=req.note, trigger_mode=trigger_mode, expires_at=req.expires_at,
        reference_price=price,
    )
    # A condition that is already satisfied fires on the next sweep, which is correct ("tell me
    # when it is above 100" when it is already 105 is a yes) but surprises people - so the answer
    # says so. Stateful conditions can't be already-true: they have nothing to have moved from.
    return {
        "id": alert_id,
        "current_price": price,
        "already_true": price is not None
        and alerts.condition_holds(
            {"condition": condition, "price": req.price, "price2": req.price2,
             "reference_price": price},
            price,
        ),
    }


@router.put("/api/alerts/{alert_id}")
def update_alert(alert_id: int, req: AlertUpdateRequest):
    """Edit, pause or resume one alert. Also how the table's pause switch works - `active` is just
    another field, so pausing and re-pointing are the same operation to the caller."""
    existing = next((a for a in db.list_alerts(limit=1000) if a["id"] == alert_id), None)
    if existing is None:
        raise HTTPException(status_code=404, detail="no such alert")
    if existing["kind"] != "price":
        raise HTTPException(status_code=422, detail="only price alerts can be edited")

    fields = req.model_dump(exclude_none=True)
    if "symbol" in fields:
        fields["symbol"] = fields["symbol"].strip().upper()
    if "condition" in fields:
        fields["condition"] = LEGACY_CONDITIONS.get(fields["condition"], fields["condition"])
    if {"condition", "price", "price2"} & fields.keys():
        _validate(
            fields.get("condition", existing["condition"]),
            fields.get("price", existing["price"]),
            fields.get("price2", existing["price2"]),
        )
    # Re-arming a move alert measures from here, not from wherever it was armed days ago.
    if fields.get("active") and existing["condition"] in alerts.MOVE_CONDITIONS:
        fields["reference_price"] = paper_price(existing["symbol"]) or existing["reference_price"]

    db.update_alert(alert_id, **fields)
    return next(a for a in db.list_alerts(limit=1000) if a["id"] == alert_id)


@router.post("/api/alerts/acknowledge")
def acknowledge_alerts(ids: list[int] | None = None):
    db.acknowledge_alerts(ids)
    return {"ok": True}


@router.delete("/api/alerts/{alert_id}")
def delete_alert(alert_id: int):
    db.delete_alert(alert_id)
    return {"ok": True}
