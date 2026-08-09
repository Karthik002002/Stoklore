from fastapi import APIRouter
from datetime import datetime

from fastapi import HTTPException

from app.core import db
from app.core import paper

from app.core.config import DIRECTIONS, IST
from app.schemas import (
    PaperCloseRequest,
    PaperModifyRequest,
    PaperOrderRequest,
    TradeAccountRequest,
)
from app.services.quotes import paper_price

router = APIRouter(tags=["paper-trading"])

@router.get("/api/paper/accounts")
def paper_accounts():
    return db.list_trade_accounts(kind="paper")


@router.post("/api/paper/accounts")
def create_paper_account(req: TradeAccountRequest):
    account_id = db.create_trade_account(
        req.name.strip(), req.strategy, req.strategy_explanation, req.opening_balance,
        req.max_position_size, req.max_position_size_type, req.max_position_count, kind="paper",
    )
    return {"id": account_id}


@router.get("/api/paper/positions")
def paper_positions(account_id: int | None = None):
    """Open positions, each marked to the latest price. `pnl` is unrealized and null for a resting
    limit order that hasn't filled - it has no exposure yet, and reporting 0 would read as
    'flat' rather than 'not started'."""
    out = []
    for p in db.list_paper_positions(account_id):
        price = paper_price(p["symbol"])
        row = dict(p)
        row["current_price"] = price
        row["pnl"] = paper.unrealized_pnl(p, price)
        row["pnl_pct"] = (
            round(row["pnl"] / (p["entry_price"] * p["quantity"]) * 100, 2)
            if row["pnl"] is not None and p["entry_price"] and p["quantity"]
            else None
        )
        row["value"] = round(price * p["quantity"], 2) if price is not None else None
        out.append(row)
    return out


@router.post("/api/paper/orders")
def create_paper_order(req: PaperOrderRequest):
    if req.direction not in DIRECTIONS:
        raise HTTPException(status_code=422, detail="direction must be 'long' or 'short'")
    if req.quantity <= 0:
        raise HTTPException(status_code=422, detail="quantity must be greater than 0")

    legs = [leg.model_dump() for leg in req.stop_losses] + [leg.model_dump() for leg in req.targets]
    if any(leg["qty"] <= 0 for leg in legs):
        raise HTTPException(status_code=422, detail="every exit leg needs a quantity above 0")
    for side, name in ((req.stop_losses, "stop-loss"), (req.targets, "target")):
        covered = sum(leg.qty for leg in side)
        if covered > req.quantity:
            raise HTTPException(
                status_code=422,
                detail=f"{name} legs cover {covered} of {req.quantity} - more than the position size",
            )

    symbol = req.symbol.strip().upper()
    if req.order_type == "limit":
        if req.limit_price is None:
            raise HTTPException(status_code=422, detail="a limit order needs a limit price")
        entry, status, opened_at = req.limit_price, "pending", None
    else:
        entry = paper_price(symbol)
        if entry is None:
            raise HTTPException(status_code=502, detail=f"no live price available for '{symbol}'")
        status, opened_at = "open", datetime.now(IST).isoformat()

    # A level on the wrong side of entry would trigger on the very next tick - that's a typo, not
    # a plan. Unlike the journal (which records history that already happened, and so must accept
    # whatever the user says happened), this is an order being placed now.
    for leg in req.stop_losses:
        if leg.price >= entry if req.direction == "long" else leg.price <= entry:
            raise HTTPException(
                status_code=422, detail="stop-loss must be below entry for a long, above for a short"
            )
    for leg in req.targets:
        if leg.price <= entry if req.direction == "long" else leg.price >= entry:
            raise HTTPException(
                status_code=422, detail="target must be above entry for a long, below for a short"
            )

    position_id = db.create_paper_position(
        req.account_id, symbol, req.direction, req.order_type, status, req.quantity, entry,
        [leg.model_dump() for leg in req.stop_losses], [leg.model_dump() for leg in req.targets],
        req.notes, opened_at,
    )
    return {"id": position_id, "entry_price": entry, "status": status}


@router.put("/api/paper/positions/{position_id}")
def modify_paper_position(position_id: int, req: PaperModifyRequest):
    position = db.get_paper_position(position_id)
    if not position:
        raise HTTPException(status_code=404, detail="no such paper position")
    db.update_paper_position(
        position_id,
        stop_losses=[leg.model_dump() for leg in req.stop_losses],
        targets=[leg.model_dump() for leg in req.targets],
    )
    return {"ok": True}


@router.post("/api/paper/positions/{position_id}/close")
def close_paper_position(position_id: int, req: PaperCloseRequest):
    position = db.get_paper_position(position_id)
    if not position:
        raise HTTPException(status_code=404, detail="no such paper position")
    price = paper_price(position["symbol"])
    if price is None:
        raise HTTPException(status_code=502, detail="no live price available to close against")
    trade_ids = paper.close_position(position, price, req.quantity)
    return {"closed_at": price, "trade_ids": trade_ids}


@router.get("/api/paper/status")
def paper_status():
    """Engine heartbeat - drives the UI's live/stale pulse. `market_open` is what tells the user
    a stale timestamp is expected rather than a broken poller."""
    return {**paper.state, "market_open": paper.market_is_open(), "poll_seconds": paper.POLL_SECONDS}


@router.post("/api/paper/poll")
def paper_poll_now():
    """Force one sweep. The loop only runs during market hours; this is how the UI refreshes on
    demand outside them, and how a test drives the engine without waiting."""
    triggered = paper.poll_once(paper_price)
    return {"triggered": triggered, "last_poll": paper.state["last_poll"]}
