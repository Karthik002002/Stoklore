"""Real-money order endpoints. The paper equivalents live in paper_trading.py and look similar on
purpose; the difference is that nothing here decides anything about a fill.

Two rules this module enforces that the paper one has no need for:

1. **Every mutating endpoint runs the guardrails**, in app/core/dhan_orders.py, and refuses with a
   list of reasons rather than a single message - an order can be wrong in three ways at once and
   the user should see all three before the second attempt.
2. **Nothing is retried.** A failed send returns `unconfirmed` and the correlation id, and the
   only supported next step is reconciling against the broker's book (`POST /api/live/recover`).
"""
from fastapi import APIRouter, HTTPException

from app.core import db, dhan_orders, live
from app.schemas import LiveModifyRequest, LiveOrderRequest, LiveSettingsRequest
from app.services.quotes import paper_price

router = APIRouter(tags=["live-trading"])


@router.get("/api/live/status")
def live_status():
    """Everything the screen needs to decide whether it may show a Buy button: whether trading is
    on, whether the kill switch is down, what today has cost so far, and whether anything was left
    unconfirmed by a request that timed out."""
    settings = db.get_live_trading_settings()
    unconfirmed = db.list_unconfirmed_intents()
    return {
        "configured": db.get_dhan_credentials() is not None,
        "sandbox": bool(db.get_dhan_api_base_url()),
        "base_url": dhan_orders.base_url(),
        # Deployable cash, so the order ticket can say what a position costs as a share of the
        # wallet rather than only in rupees. Cached for 30s - see live.available_balance.
        "balance": live.available_balance(),
        "settings": settings,
        "runtime": live.runtime_state(),
        "poller": live.state,
        "unconfirmed": [dict(i) for i in unconfirmed],
    }


@router.put("/api/live/settings")
def update_live_settings(req: LiveSettingsRequest):
    fields = req.model_dump(exclude_none=True)
    base_url = fields.pop("api_base_url", None)
    if base_url is not None:
        db.set_dhan_api_base_url(base_url)
    if fields:
        db.set_live_trading_settings(**fields)
    return db.get_live_trading_settings()


@router.get("/api/live/orders")
def live_orders(open_only: bool = False):
    return db.list_live_orders(open_only=open_only)


@router.get("/api/live/positions")
def live_positions():
    """The mirror, marked to the app's own quote cache. Dhan's live LTP feed is a separately-paid
    Data API plan (see app/core/broker.py), so the price shown here is the same delayed one the
    rest of the app uses - which is fine for a P&L readout and is NOT what any order is priced
    from: fills come back from the broker."""
    rows = [dict(p) for p in db.list_live_positions()]
    for row in rows:
        price = paper_price(row["symbol"]) if row.get("symbol") else None
        row["current_price"] = price
        if price is not None and row.get("net_qty"):
            entry = row.get("buy_avg") if row["net_qty"] > 0 else row.get("sell_avg")
            if entry:
                row["mark_pnl"] = round((price - entry) * row["net_qty"], 2)
    return rows


@router.post("/api/live/sync")
def live_sync():
    """Pull the broker's books now instead of waiting for the next poll - what the refresh button
    on the positions table calls."""
    if not db.get_dhan_credentials():
        raise HTTPException(status_code=409, detail="No Dhan credentials configured")
    try:
        return live.sync_once()
    except dhan_orders.DhanOrderError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.post("/api/live/orders")
def place_live_order(req: LiveOrderRequest):
    """Send one order. 422 carries every guardrail that refused it, as a list."""
    if req.direction not in ("long", "short"):
        raise HTTPException(status_code=422, detail="direction must be 'long' or 'short'")
    intent = req.model_dump()
    intent["symbol"] = req.symbol.strip().upper()
    intent["product"] = req.product or db.get_live_trading_settings()["product"]

    result = live.place_intent(intent)
    if not result["ok"]:
        # 409, not 422, when the send itself was never answered: the request was fine, the world
        # is uncertain, and the client must reconcile rather than fix and resubmit.
        raise HTTPException(
            status_code=409 if result.get("unconfirmed") else 422,
            detail={"errors": result["errors"], "correlation_id": result.get("correlation_id")},
        )
    return result


@router.put("/api/live/orders/{order_id}")
def modify_live_order(order_id: str, req: LiveModifyRequest):
    """Move a leg of a working order - what dragging the stop or target line on the chart calls.

    Which fields Dhan accepts depends on the leg and how far the order has got; `modify_payload`
    refuses the illegal combinations before anything is sent.
    """
    creds = db.get_dhan_credentials()
    if not creds:
        raise HTTPException(status_code=409, detail="No Dhan credentials configured")
    if live.runtime_state()["halted"]:
        raise HTTPException(status_code=409, detail="Trading is halted for today")
    try:
        payload = dhan_orders.modify_payload(
            creds["client_id"], order_id, req.leg,
            price=req.price, quantity=req.quantity, targetPrice=req.target_price,
            stopLossPrice=req.stop_price, trailingJump=req.trailing_jump,
            orderType="LIMIT" if req.price else None,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    try:
        answer = dhan_orders.modify(creds, order_id, payload, super_order=True)
    except dhan_orders.DhanOrderError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    live.sync_once(creds)
    return answer


@router.delete("/api/live/orders/{order_id}")
def cancel_live_order(order_id: str, leg: str | None = None):
    creds = db.get_dhan_credentials()
    if not creds:
        raise HTTPException(status_code=409, detail="No Dhan credentials configured")
    try:
        answer = dhan_orders.cancel(creds, order_id, leg)
    except dhan_orders.DhanOrderError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    live.sync_once(creds)
    return answer


@router.post("/api/live/positions/{security_id}/close")
def close_live_position(security_id: str):
    """Flatten a position at market. Direction and size come off the mirror, never from the
    caller: "close this" must not depend on the screen remembering which way round it was."""
    creds = db.get_dhan_credentials()
    if not creds:
        raise HTTPException(status_code=409, detail="No Dhan credentials configured")
    position = next((p for p in db.list_live_positions() if p["security_id"] == security_id), None)
    if not position or not position["net_qty"]:
        raise HTTPException(status_code=404, detail="No open position for that security")

    intent = dhan_orders.exit_intent(position, "", creds["client_id"])
    intent["symbol"] = position["symbol"]
    intent["reference_price"] = paper_price(position["symbol"])
    result = live.place_intent(intent, super_order=False)
    if not result["ok"]:
        raise HTTPException(
            status_code=409 if result.get("unconfirmed") else 422,
            detail={"errors": result["errors"], "correlation_id": result.get("correlation_id")},
        )
    return result


@router.post("/api/live/panic")
def live_panic():
    """Kill switch: halt for the rest of the day and cancel everything still working.

    It deliberately does NOT close open positions. Cancelling an unfilled order takes back an
    intention; liquidating a position is a trade, and a panic button that trades on your behalf is
    a different and much worse feature.
    """
    return live.panic()


@router.post("/api/live/resume")
def live_resume():
    live.resume()
    return live.runtime_state()


@router.post("/api/live/recover")
def live_recover(correlation_id: str):
    """Find out what became of an order whose send never came back. This is the supported answer
    to a timeout - re-sending is not."""
    order = live.recover(correlation_id)
    if not order:
        raise HTTPException(
            status_code=404,
            detail="Nothing in the broker's book carries that id - the order never reached them",
        )
    return order
