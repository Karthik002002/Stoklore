from fastapi import APIRouter
from fastapi import HTTPException

import scraper

from app.deps import _cached

router = APIRouter(tags=["indices"])

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


@router.get("/api/macro-indices")
def macro_indices():
    """NSE's full Live Analysis -> Index Performances table (all 100+ NSE-published indices
    grouped by category). Cached for 5min; NSE's site itself polls /api/allIndices at the same
    cadence, so a shorter cache just hammers their edge for no freshness gain."""
    return _cached("NSE", "macro-indices", 5, scraper.get_all_indices)
