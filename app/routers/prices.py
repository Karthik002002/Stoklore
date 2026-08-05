from fastapi import APIRouter
import threading

from fastapi import HTTPException

import db
import minute_data
import price_sources
import prices

from app.schemas import BulkMaxCollectRequest
from app.services.jobs import (
    _bulk_collect_state,
    _max_collect_state,
    _price_sync_state,
    _run_bulk_collect,
    _run_max_collect,
    _run_price_sync,
)

router = APIRouter(tags=["prices"])

@router.post("/api/prices/sync")
def trigger_price_sync(list_name: str | None = None):
    if _price_sync_state["running"]:
        raise HTTPException(status_code=409, detail="A price sync is already running")
    symbols = db.watchlist_symbols(list_name)
    threading.Thread(target=_run_price_sync, args=(symbols,), daemon=True).start()
    return {"ok": True, "symbols": len(symbols)}


@router.get("/api/prices/sync/status")
def price_sync_status():
    return _price_sync_state


@router.get("/api/prices/ema-crossover")
def ema_crossover_scan(list_name: str | None = None, short: int = 20, long: int = 50):
    """EMA crossover signal for every symbol with enough synced history - no live fetch, reads
    price_history only, so this is cheap even across 30-50+ watchlisted symbols. Declared before
    /api/prices/{symbol} so this literal path isn't shadowed by the parameterized route."""
    results = []
    for symbol in db.watchlist_symbols(list_name):
        signal = prices.ema_crossover(symbol, short, long)
        if signal:
            results.append({"symbol": symbol, **signal})
    return results


@router.get("/api/prices/sources")
def price_sources_list():
    """Available "Collect max history" plugins (see price_sources/) - the frontend populates its
    source selector from this instead of hardcoding names, so adding a new plugin needs no
    frontend change either. Declared before /api/prices/{symbol} so this literal path isn't
    shadowed by the parameterized route (same reasoning as ema_crossover_scan above)."""
    return {"sources": list(price_sources.SOURCES), "default": price_sources.DEFAULT_SOURCE}


@router.get("/api/prices/{symbol}")
def price_history(symbol: str, days: int = 365):
    return db.list_price_history(symbol.upper(), days)


@router.get("/api/prices/{symbol}/ema-crossover")
def price_ema_crossover(symbol: str, short: int = 20, long: int = 50):
    signal = prices.ema_crossover(symbol.upper(), short, long)
    if signal is None:
        raise HTTPException(status_code=404, detail=f"Not enough synced history for '{symbol}' yet - run a price sync first")
    return signal


@router.post("/api/prices/{symbol}/max/collect")
def trigger_max_collect(symbol: str, source: str = price_sources.DEFAULT_SOURCE):
    symbol = symbol.upper()
    if source not in price_sources.SOURCES:
        raise HTTPException(status_code=422, detail=f"unknown price source '{source}'")
    if _max_collect_state.get(symbol, {}).get("running"):
        raise HTTPException(status_code=409, detail=f"Already collecting max history for '{symbol}'")
    threading.Thread(target=_run_max_collect, args=(symbol, source), daemon=True).start()
    return {"ok": True}


@router.get("/api/prices/{symbol}/max/status")
def max_collect_status(symbol: str):
    return _max_collect_state.get(symbol.upper(), {"running": False, "error": None})


@router.post("/api/prices/max/collect-bulk")
def trigger_bulk_max_collect(req: BulkMaxCollectRequest):
    if req.source not in price_sources.SOURCES:
        raise HTTPException(status_code=422, detail=f"unknown price source '{req.source}'")
    if _bulk_collect_state["running"]:
        raise HTTPException(status_code=409, detail="A bulk collection is already running")
    symbols = [s.strip().upper() for s in req.symbols if s.strip()]
    if not symbols:
        raise HTTPException(status_code=422, detail="symbols can't be empty")
    threading.Thread(target=_run_bulk_collect, args=(symbols, req.source), daemon=True).start()
    return {"ok": True, "total": len(symbols)}


@router.get("/api/prices/max/collect-bulk/status")
def bulk_max_collect_status():
    return _bulk_collect_state


@router.get("/api/prices/{symbol}/max")
def max_history(symbol: str):
    """Full collected history, or an empty list if "Collect max history" was never triggered for
    this symbol - the frontend hides the max-history section entirely in that case."""
    return db.list_max_history(symbol.upper())


# Bar Replay's intraday timeframes. Sync (not the background-job + status-poll shape the daily
# max-history collection uses) because only the very first request per symbol is slow - it pulls
# that symbol out of the remote dataset into a local parquet (~11s) and everything after reads
# that cache in well under a second. Declared `def`, so FastAPI runs it in the threadpool and the
# one slow call doesn't block the event loop.
@router.get("/api/prices/{symbol}/intraday")
def intraday_history(symbol: str, interval: str = "15m"):
    try:
        return minute_data.get_minute_bars(symbol, interval)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"intraday fetch failed: {e}") from e
