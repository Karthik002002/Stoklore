from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter
from fastapi import HTTPException

from app.core import db, scraper

from app.deps import _cached

router = APIRouter(tags=["indices"])

IST = ZoneInfo("Asia/Kolkata")

@router.get("/api/indices")
def indices():
    """NIFTY 50 + SENSEX, same cache-aside pattern as /api/stocks."""
    result = []
    for name in scraper.INDEX_SYMBOLS:
        try:
            quote = _cached(name, "index-price", 15, lambda n=name: scraper.get_index_price(n))
        except Exception:
            quote = {"price": None, "changePercent": None}
        result.append({"name": name, **quote})
    return result


@router.get("/api/indices/{name}/chart")
def index_chart(name: str, range: str = "1mo"):
    if name not in scraper.INDEX_SYMBOLS:
        raise HTTPException(status_code=404, detail=f"Unknown index '{name}'")
    if range not in scraper.CHART_RANGES:
        raise HTTPException(status_code=400, detail=f"range must be one of {list(scraper.CHART_RANGES)}")
    return _cached(name, f"index-chart:{range}", 15, lambda: scraper.get_index_chart(name, range))


@router.get("/api/market-movers")
def market_movers(refresh: bool = False):
    """NSE's top gainers/losers for every index bucket, fetched at most once per session.

    The table is a post-close snapshot - it stops moving once the session ends - so the stored row
    is served for the rest of the day and NSE is only asked again when the calendar date in IST has
    moved past the stored session date (or `refresh=1` forces it). If that refetch fails, the last
    stored snapshot is returned rather than an error: a day-old movers table is still the honest
    answer, and the response carries the date it belongs to so the UI can say which session it is.
    """
    stored = db.get_latest_movers()
    today = datetime.now(IST).date()
    # Gated on when it was FETCHED, not on the session it describes: on a weekend or holiday the
    # newest session NSE has is already days old, and comparing trade_date to today would refetch
    # the same unchanged table on every single request. Once per calendar day, either way.
    if not refresh and stored and stored["fetched_at"].astimezone(IST).date() >= today:
        return {**stored["payload"], "fetched_at": stored["fetched_at"], "stale": False}

    try:
        payload = scraper.get_top_movers()
    except Exception as exc:
        if stored:
            return {**stored["payload"], "fetched_at": stored["fetched_at"], "stale": True}
        raise HTTPException(status_code=502, detail=f"NSE movers fetch failed: {exc}") from exc

    trade_date = payload.get("trade_date") or today.isoformat()
    db.save_movers(trade_date, payload)
    saved = db.get_latest_movers()
    return {**payload, "fetched_at": saved["fetched_at"] if saved else None, "stale": False}


@router.get("/api/macro-indices")
def macro_indices():
    """NSE's full Live Analysis -> Index Performances table (all 100+ NSE-published indices
    grouped by category). Cached for 5min; NSE's site itself polls /api/allIndices at the same
    cadence, so a shorter cache just hammers their edge for no freshness gain."""
    return _cached("NSE", "macro-indices", 5, scraper.get_all_indices)
