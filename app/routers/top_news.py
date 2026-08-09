from fastapi import APIRouter
import threading
import time

from fastapi import HTTPException

from app.core import db
from app.core import scraper

router = APIRouter(tags=["top-news"])

# Cogencis's general news feed is refetched wholesale (not per-symbol) at most once a day - a
# lock keeps concurrent requests from re-triggering the paginated scrape at the same time.
_top_news_lock = threading.Lock()


def _isins_in(text):
    """Extracts ISIN codes from Cogencis's 'isins' field, e.g. "INE099Z01011 MISHDHAT.BS
    MISHDHAT.NS, INE258A01016 BEML.BS BEML.NS" -> {"INE099Z01011", "INE258A01016"}."""
    return {group.strip().split()[0] for group in (text or "").split(",") if group.strip()}


def _cached_isin(symbol):
    """ISIN never changes for a listed security, so this is a permanent cache - only ever one
    live yfinance call per symbol, ever."""
    isin = db.get_isin_cache(symbol)
    if isin:
        return isin
    try:
        isin = scraper.get_isin(symbol)
    except Exception:
        isin = None
    if isin:
        db.set_isin_cache(symbol, isin)
    return isin


COGENCIS_PAGE_SIZE = 20


@router.get("/api/top-news")
def top_news(force: bool = False, offset: int = 0, limit: int = 30):
    """Cogencis's general "what's moving" feed (not scoped to one stock), cached and paginated
    (offset/limit) for infinite scroll. force=true (manual Reload button) wipes the cache and
    re-scrapes page 1 wholesale; a stale (>24h) cache does the same on next read. Beyond that,
    whenever a page request reaches past what's already cached, additional Cogencis pages are
    scraped on demand and appended (never replacing older cached stories) until there's enough to
    satisfy it, or Cogencis runs out of pages. Each story comes back tagged with which of your
    watchlisted stocks it affects, matched by ISIN - recomputed fresh every call so watchlist
    changes show up immediately even against cached stories."""
    with _top_news_lock:
        if force or not db.top_news_is_fresh():
            token = db.get_cogencis_token()
            if not token:
                raise HTTPException(status_code=400,
                                     detail="Cogencis isn't configured - add a token in Settings > Cogencis")
            db.save_top_news(scraper.get_cogencis_top_news(token, page_no=1, page_size=COGENCIS_PAGE_SIZE))

        have = db.count_top_news()
        needed = offset + limit
        if needed > have:
            token = db.get_cogencis_token()
            if token:
                next_page = have // COGENCIS_PAGE_SIZE + 1
                while have < needed:
                    new_items = scraper.get_cogencis_top_news(token, page_no=next_page, page_size=COGENCIS_PAGE_SIZE)
                    if not new_items:
                        break
                    db.append_top_news(new_items)
                    have = db.count_top_news()
                    next_page += 1
                    if have < needed:
                        time.sleep(2)

        page = db.get_top_news_page(offset, limit)
        total = db.count_top_news()

    symbol_by_isin = {}
    for symbol in db.watchlist_symbols():
        isin = _cached_isin(symbol)
        if isin:
            symbol_by_isin[isin] = symbol

    return {
        "items": [
            {**item, "affected_symbols": sorted(
                symbol_by_isin[i] for i in _isins_in(item["isins"]) if i in symbol_by_isin
            )}
            for item in page
        ],
        "total": total,
    }
