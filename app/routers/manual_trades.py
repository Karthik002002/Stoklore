from fastapi import APIRouter
import base64
import csv
import io
import json
import os
import uuid
from datetime import datetime

from fastapi import File, HTTPException, Request, UploadFile
from fastapi.responses import Response

from app.core import db
from app.core import llm
from app.core import trade_context

from app.core.config import DIRECTIONS, IST, RESULTS, UPLOAD_DIR
from app.schemas import (
    BalanceAdjustmentRequest,
    ManualBacktestSettingsRequest,
    ManualTradeRequest,
    TradingGoalRequest,
)

router = APIRouter(tags=["manual-trades"])

def _validate_manual_trade(req):
    if req.direction not in DIRECTIONS:
        raise HTTPException(status_code=422, detail="direction must be 'long' or 'short'")
    if req.result is not None and req.result not in RESULTS:
        raise HTTPException(status_code=422, detail="result must be 'profit', 'loss', or 'neutral'")


@router.get("/api/manual-trades")
def manual_trades(request: Request):
    trades = db.list_manual_trades()
    for t in trades:
        # Full URL (not just the bare filename) so the frontend never has to know or guess the
        # /uploads mount path itself - one source of truth, here, for where images actually live.
        t["image_url"] = f"{request.base_url}uploads/{t['image_filename']}" if t["image_filename"] else None
    return trades


def _market_date(value):
    """The IST calendar date an ISO timestamp falls on, as a date object. traded_at is a
    timestamptz while price_history.date is a plain date, so the two have to be reconciled
    explicitly - left to the DB, a trade logged just after midnight IST lands on the wrong bar."""
    if not value:
        return datetime.now(IST).date()
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.date()
    return parsed.astimezone(IST).date()


def _trade_context(req):
    """The one-time snapshot stored on a trade: what the chart looked like at entry, plus MAE/MFE
    when the exit date is known. DB-only, so the N parallel POSTs the bulk-import dialog fires stay
    fast. Returns None for a symbol with no local bars, which is normal and not an error -
    price_history only covers symbols that have been synced.

    `market_at` rather than `traded_at` is what the bars are looked up against: Bar Replay journals
    its trades under the real wall-clock time (deliberately - see CloseTradeDialog), so scoring a
    2022 replay against traded_at would silently measure today's market instead."""
    entry_date = _market_date(req.market_at or req.traded_at)
    if entry_date is None:
        return None
    symbol = req.symbol.strip().upper()
    before, source = db.bars_before(symbol, entry_date, trade_context.LOOKBACK)
    if not before:
        return None

    exit_date = _market_date(req.exited_at) if req.exited_at else None
    holding = db.bars_between(symbol, entry_date, exit_date) if exit_date else []
    return trade_context.compute(
        before, holding, req.direction, req.entry_price, req.stop_loss, source
    )


def _fill_once_context(existing, req):
    """What (if anything) the snapshot should become on an edit. Returns None to leave it alone -
    db.update_manual_trade COALESCEs, so None is "don't touch".

    Fill-once is per-half, not per-row, because the two halves become knowable at different times:

    - No snapshot at all (or the symbol had no bars then and does now) -> compute the whole thing.
    - Entry context stored but no excursion, and an exit date has now arrived -> compute ONLY the
      excursion and merge it onto the stored entry context. Recomputing the entry half here would
      re-read bars that may since have been split-adjusted, quietly rewriting a point-in-time fact
      the user already has - so the original is carried across untouched.
    - Everything already present -> None. An ordinary edit never recomputes anything.

    Logging a trade open and closing it later is the ordinary workflow, so without the second case
    that entire path would never get MAE/MFE at all.
    """
    stored = existing.get("trade_context") if existing else None
    if not stored:
        return _trade_context(req)
    if "mae_pct" in stored or not req.exited_at:
        return None

    entry_date = _market_date(req.market_at or req.traded_at)
    exit_date = _market_date(req.exited_at)
    if entry_date is None or exit_date is None:
        return None
    holding = db.bars_between(req.symbol.strip().upper(), entry_date, exit_date)
    if not holding:
        return None
    return {
        **stored,
        **trade_context.excursion(holding, req.direction, req.entry_price, req.stop_loss),
    }


@router.post("/api/manual-trades")
def create_manual_trade(req: ManualTradeRequest):
    _validate_manual_trade(req)
    balance = db.account_balance_at(req.account_id, req.traded_at) if req.account_id else None
    trade_id = db.create_manual_trade(
        req.symbol.strip().upper(), req.direction, req.quantity, req.entry_price, req.exit_price,
        req.stop_loss, req.target, req.is_open, req.result, req.emotion, req.tags, req.notes,
        req.traded_at, req.image_filename, req.setup, req.ideal_risk_amount, req.account_id, balance,
        req.exited_at, _trade_context(req),
    )
    return {"id": trade_id}


@router.put("/api/manual-trades/{trade_id}")
def update_manual_trade(trade_id: int, req: ManualTradeRequest):
    _validate_manual_trade(req)
    # The account-balance snapshot is a one-time calculation: recomputed only when the trade
    # actually moves to a different account (where the old account's balance is meaningless), never
    # on an ordinary edit. db.update_manual_trade COALESCEs None onto the existing value.
    existing = db.get_manual_trade(trade_id)
    moved = existing and existing["account_id"] != req.account_id
    balance = db.account_balance_at(req.account_id, req.traded_at) if moved and req.account_id else None
    context = _fill_once_context(existing, req)
    db.update_manual_trade(
        trade_id, req.symbol.strip().upper(), req.direction, req.quantity, req.entry_price,
        req.exit_price, req.stop_loss, req.target, req.is_open, req.result, req.emotion, req.tags,
        req.notes, req.traded_at, req.setup, req.ideal_risk_amount, req.account_id, balance,
        req.exited_at, context,
    )
    return {"ok": True}


# --- Paper trading -----------------------------------------------------------------------------
# Open positions live in paper_positions; the moment one closes it becomes a manual_trades row
# tagged 'paper' under its paper account, so the Overview/Statistics/Goals machinery applies to
# paper trades with no parallel implementation. See paper.py.
@router.delete("/api/manual-trades/{trade_id}")
def delete_manual_trade(trade_id: int):
    db.delete_manual_trade(trade_id)
    return {"ok": True}


ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


@router.post("/api/manual-trades/{trade_id}/image")
async def upload_manual_trade_image(trade_id: int, file: UploadFile = File(...)):
    # ponytail: re-uploading (editing a trade's screenshot) orphans the old file on disk instead
    # of deleting it - add cleanup if upload volume ever makes that worth doing.
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=422, detail="unsupported image type - use PNG, JPEG, WEBP, or GIF")
    ext = os.path.splitext(file.filename or "")[1]
    filename = f"{trade_id}-{uuid.uuid4().hex}{ext}"
    with open(os.path.join(UPLOAD_DIR, filename), "wb") as f:
        f.write(await file.read())
    db.update_manual_trade_image(trade_id, filename)
    return {"filename": filename}


@router.post("/api/manual-trades/bulk/analyze")
async def analyze_bulk_trade_image(file: UploadFile = File(...), model: str | None = None):
    """One chart screenshot -> extracted trade fields, for the Bulk Trades import. The frontend
    fires one of these per selected image (not sequentially), so analysis across a batch happens
    in parallel. The image is saved to disk immediately - not gated on the user actually
    confirming the extracted fields - so it isn't re-uploaded when the trade is created.
    ponytail: a cancelled/abandoned bulk import orphans these files on disk, same tradeoff as the
    single re-upload path above."""
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=422, detail="unsupported image type - use PNG, JPEG, WEBP, or GIF")
    raw = await file.read()
    ext = os.path.splitext(file.filename or "")[1]
    filename = f"bulk-{uuid.uuid4().hex}{ext}"
    with open(os.path.join(UPLOAD_DIR, filename), "wb") as f:
        f.write(raw)
    try:
        fields = llm.analyze_trade_screenshot(
            base64.b64encode(raw).decode(), file.content_type, model or db.get_active_model()
        )
    except RuntimeError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return {"filename": filename, **fields}


@router.get("/api/settings/manual-backtest")
def get_manual_backtest_settings():
    return db.get_manual_backtest_settings()


@router.put("/api/settings/manual-backtest")
def set_manual_backtest_settings(req: ManualBacktestSettingsRequest):
    settings = {
        "setups": [s.strip() for s in req.setups if s.strip()],
        "risk_deviation_tolerance_pct": req.risk_deviation_tolerance_pct,
        "opening_balance": req.opening_balance,
    }
    db.set_manual_backtest_settings(settings)
    return settings


@router.get("/api/trading-goals")
def trading_goals():
    return db.get_trading_goals()


@router.put("/api/trading-goals")
def save_trading_goals(goals: list[TradingGoalRequest]):
    """Replaces the whole goal list - the UI always sends the full set, and there's no per-goal
    history to preserve (achievement is recomputed from trades, never stored)."""
    saved = [g.model_dump() for g in goals]
    db.set_trading_goals(saved)
    return saved


@router.get("/api/manual-trades/balance-adjustments")
def balance_adjustments():
    return db.list_balance_adjustments()


@router.post("/api/manual-trades/balance-adjustments")
def create_balance_adjustment(req: BalanceAdjustmentRequest):
    if req.type not in {"add", "subtract"}:
        raise HTTPException(status_code=422, detail="type must be 'add' or 'subtract'")
    adjustment_id = db.create_balance_adjustment(
        req.amount, req.type, req.reason, req.notes, req.adjusted_at, req.account_id
    )
    return {"id": adjustment_id}


@router.delete("/api/manual-trades/balance-adjustments/{adjustment_id}")
def delete_balance_adjustment(adjustment_id: int):
    db.delete_balance_adjustment(adjustment_id)
    return {"ok": True}


MANUAL_TRADE_EXPORT_FIELDS = [
    "id", "symbol", "direction", "setup", "quantity", "entry_price", "exit_price", "stop_loss",
    "target", "ideal_risk_amount", "is_open", "result", "emotion", "tags", "notes", "traded_at",
    "account_id", "account_balance_at_trade",
]


@router.get("/api/manual-trades/export")
def export_manual_trades(format: str = "csv"):
    trades = db.list_manual_trades()
    if format == "json":
        body = json.dumps(trades, default=str, indent=2)
        media_type, filename = "application/json", "manual-trades.json"
    elif format == "csv":
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=MANUAL_TRADE_EXPORT_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for t in trades:
            writer.writerow({**t, "tags": ", ".join(t["tags"])})
        body, media_type, filename = buf.getvalue(), "text/csv", "manual-trades.csv"
    else:
        raise HTTPException(status_code=422, detail="format must be 'csv' or 'json'")
    return Response(body, media_type=media_type, headers={"Content-Disposition": f"attachment; filename={filename}"})
