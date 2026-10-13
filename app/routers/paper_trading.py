from fastapi import APIRouter
from datetime import datetime

from fastapi import HTTPException

from app.core import db
from app.core import paper

from app.core.config import DIRECTIONS, IST
from app.schemas import (
    PaperMoveRequest,
    PaperCloseRequest,
    PaperModifyRequest,
    PaperOrderRequest,
    TradeAccountRequest,
)
from app.services.quotes import paper_price, paper_quotes

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
    """Open positions, each marked to the last known price. `pnl` is unrealized and null for a
    resting limit order that hasn't filled - it has no exposure yet, and reporting 0 would read as
    'flat' rather than 'not started'.

    `price_as_of` is when that price was actually fetched and `price_stale` says a fresh quote is
    on its way - together they let the screen show numbers immediately and still be honest about
    their age, instead of holding the whole table hostage to a slow feed.
    """
    positions = db.list_paper_positions(account_id)
    quotes = paper_quotes([p["symbol"] for p in positions])
    out = []
    for p in positions:
        quote = quotes.get(p["symbol"]) or {}
        price = quote.get("price")
        row = dict(p)
        row["current_price"] = price
        row["sector"] = quote.get("sector")
        row["price_as_of"] = quote.get("fetched_at")
        row["price_stale"] = quote.get("stale", price is None)
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
        initial_stop_loss=paper.nearest_stop([leg.model_dump() for leg in req.stop_losses], entry),
    )
    return {"id": position_id, "entry_price": entry, "status": status}


@router.put("/api/paper/positions/{position_id}")
def modify_paper_position(position_id: int, req: PaperModifyRequest):
    position = db.get_paper_position(position_id)
    if not position:
        raise HTTPException(status_code=404, detail="no such paper position")
    stops = [leg.model_dump() for leg in req.stop_losses]
    fields = {"stop_losses": stops, "targets": [leg.model_dump() for leg in req.targets]}
    # Moving a stop never touches the initial one; only a position that had NO stop gets one here,
    # from the first stop it is given.
    if position.get("initial_stop_loss") is None and stops:
        fields["initial_stop_loss"] = paper.nearest_stop(stops, position["entry_price"])
    db.update_paper_position(position_id, **fields)
    return {"ok": True}


def _paper_account(account_id):
    """The paper account a move goes to - refused if it isn't one. A paper trade filed under a journal
    or live account would turn practice into the record of real trading."""
    account = next((a for a in db.list_trade_accounts("paper") if a["id"] == account_id), None)
    if not account:
        raise HTTPException(status_code=422, detail="that isn't a paper account")
    return account


@router.put("/api/paper/positions/{position_id}/account")
def move_paper_position(position_id: int, req: PaperMoveRequest):
    """Move an open (or resting) paper position to another paper account. Nothing about the position
    changes but whose it is: its cash is committed against the new account from here on."""
    position = db.get_paper_position(position_id)
    if not position:
        raise HTTPException(status_code=404, detail="no such paper position")
    account = _paper_account(req.account_id)
    if position["account_id"] != req.account_id:
        db.update_paper_position(position_id, account_id=req.account_id)
    return {"ok": True, "account": account["name"]}


@router.put("/api/paper/trades/{trade_id}/account")
def move_paper_trade(trade_id: int, req: PaperMoveRequest):
    """Move a closed paper trade (a journal row tagged 'paper') to another paper account - its P&L
    then counts toward that account's balance and stats instead."""
    trade = db.get_manual_trade(trade_id)
    if not trade:
        raise HTTPException(status_code=404, detail="no such trade")
    if "paper" not in (trade.get("tags") or []):
        raise HTTPException(status_code=422, detail="only paper trades move between paper accounts")
    account = _paper_account(req.account_id)
    if trade["account_id"] != req.account_id:
        db.set_manual_trade_account(trade_id, req.account_id)
    return {"ok": True, "account": account["name"]}


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
    demand outside them, and how a test drives the engine without waiting.

    Reconciles first. The live sweep can only ever see the CURRENT price, so a level crossed while
    the app was shut is invisible to it - which is how a stopped-out position stays open for days.
    Doing the catch-up here means the Refresh button actually fixes that, instead of politely
    re-reading a price that agrees the stop is long gone.
    """
    caught_up = paper.reconcile()
    triggered = paper.poll_once(paper_price)
    return {"triggered": triggered, "caught_up": caught_up, "last_poll": paper.state["last_poll"]}
