from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter
from fastapi import File, HTTPException, UploadFile

from app.core import db
from app.core import prices
from app.core import scraper
from app.core import bse_master
from app.core import stocks_master

from app.deps import _cached
from app.schemas import AddStockRequest
from app.services.quotes import MAX_QUOTE_WORKERS
from app.services.scraping import _cached_news, _live_scrape

router = APIRouter(tags=["stocks"])

@router.post("/api/stocks")
def add_stock(req: AddStockRequest):
    """Manually add a stock by symbol and scrape it live, same path the chat uses on-demand."""
    symbol = req.symbol.strip().upper()
    markdown = _live_scrape(symbol, db.get_active_model())
    if markdown is None:
        raise HTTPException(status_code=404, detail=f"No data found for '{symbol}' on NSE")
    return {"symbol": symbol, "content_markdown": markdown}


@router.delete("/api/stocks/{symbol}")
def delete_stock(symbol: str):
    symbol = symbol.upper()
    db.delete_symbol(symbol)
    db.remove_from_watchlist(symbol)
    return {"ok": True}


@router.get("/api/stocks")
def stocks():
    """Tracked symbols with a price cached for 15min - was N live yahoo calls on every poll.

    The cache misses are fetched concurrently rather than one after another: sequentially, a cold
    cache made this endpoint take N round trips, and the list sat empty in the browser for all of
    them. A symbol whose fetch fails still comes back with its DB row and a null price.
    """
    rows = db.list_symbols()

    def priced(row):
        try:
            return _cached(row["symbol"], "price", 15, lambda s=row["symbol"]: scraper.get_price(s))
        except Exception:
            return {"price": None, "changePercent": None}

    if rows:
        with ThreadPoolExecutor(max_workers=min(MAX_QUOTE_WORKERS, len(rows))) as pool:
            for row, price in zip(rows, pool.map(priced, rows)):
                row.update(price)
    return rows


@router.get("/api/stocks/search")
def search_stocks(q: str = "", limit: int = 30):
    """Symbol search for the chat @ tag menu - every scraped symbol, not just watchlisted ones."""
    return db.search_symbols(q, min(limit, 30))


@router.get("/api/stocks-master")
def stocks_master_search(q: str = "", limit: int = 30, board: str | None = None):
    """Search endpoint for the full NSE listed-equity master (Settings > Manage stocks), separate
    from /api/stocks/search above which only covers previously-scraped symbols. Always capped at
    30 - this table has 2000+ rows, nowhere near safe to return unbounded.

    `board` narrows to 'MAIN' or 'SME'; omitted, both boards are searched. Counts come back per
    board so a caller can show the split without a second request."""
    board = board.upper() if board else None
    if board not in (None, "MAIN", "SME"):
        raise HTTPException(status_code=400, detail="board must be MAIN or SME")
    counts = db.count_stocks_master()
    return {"stocks": db.search_stocks_master(q, min(limit, 30), board), **counts}


@router.post("/api/stocks-master/import")
async def stocks_master_import(file: UploadFile = File(...), board: str | None = None):
    """Bulk (re)import from an NSE EQUITY_L.csv export - main board or the SME (EMERGE) export,
    which has the same columns. Upserts, so re-running with a fresh download just refreshes the
    list. Each row's board is read from its SERIES code unless `board` forces one.

    The reply reports how many of the imported rows landed on each board: that is the only quick
    way to confirm an SME file was actually recognised as SME."""
    board = board.upper() if board else None
    if board not in (None, "MAIN", "SME"):
        raise HTTPException(status_code=400, detail="board must be MAIN or SME")
    rows = stocks_master.parse_csv(await file.read(), board)
    if not rows:
        raise HTTPException(status_code=422, detail="no valid rows found in CSV")
    db.upsert_stocks_master(rows)
    imported_sme = sum(1 for r in rows if r["board"] == "SME")
    return {
        "imported": len(rows),
        "imported_sme": imported_sme,
        "imported_main": len(rows) - imported_sme,
        **db.count_stocks_master(),
    }


@router.post("/api/stocks-master/import-bse")
def stocks_master_import_bse():
    """Pull BSE's active-equity scrip list and merge it into the same master (no file to upload -
    BSE serves the whole list as one JSON call, unlike NSE's CSV exports).

    The reply separates `merged` from `added` because those are the two different things that
    happen: `merged` is a company already listed on NSE gaining its BSE scrip code, `added` is a
    genuinely BSE-exclusive listing becoming a new row. A first import that reports thousands of
    merges and a few hundred adds is the expected shape - most of BSE is also on NSE.
    """
    try:
        rows = bse_master.fetch_scrips()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"BSE scrip list unavailable: {e}") from e
    if not rows:
        raise HTTPException(status_code=422, detail="BSE returned no usable scrips")
    result = db.upsert_bse_master(rows)
    return {"fetched": len(rows), **result, **db.count_stocks_master()}


@router.delete("/api/stocks-master/{symbol}")
def stocks_master_delete(symbol: str):
    db.delete_stock_master(symbol.upper())
    return {"ok": True}


@router.get("/api/stocks/{symbol}")
def stock_detail(symbol: str):
    try:
        quote = _cached(symbol, "quote", 15, lambda: scraper.get_quote(symbol))
    except Exception:
        quote = {}
    return {"quote": quote, "news": _cached_news(symbol), "reports": db.list_items_for_symbol(symbol)}


@router.get("/api/stocks/{symbol}/financials")
def stock_financials(symbol: str):
    symbol = symbol.upper()
    statements = _cached(symbol, "financials", 60 * 24, lambda: scraper.get_financial_statements(symbol))
    if statements is None:
        raise HTTPException(status_code=404, detail=f"No financial statements found for '{symbol}'")
    return statements


# Screener's page is a single scrape covering fundamentals + 12y statements + filings, so it's
# cached as one blob. 6h TTL: the statements only move quarterly, but the announcements list is
# intraday-fresh, and this is a full HTML fetch+parse (not a cheap JSON call) to redo on a whim.
@router.get("/api/stocks/{symbol}/screener")
def stock_screener(symbol: str):
    symbol = symbol.upper()
    data = _cached(symbol, "screener", 60 * 6, lambda: scraper.get_screener_data(symbol))
    if data is None:
        raise HTTPException(status_code=404, detail=f"No screener.in page found for '{symbol}'")
    return data


@router.get("/api/stocks/{symbol}/chart")
def stock_chart(symbol: str, range: str = "1mo"):
    if range not in scraper.CHART_RANGES:
        raise HTTPException(status_code=400, detail=f"range must be one of {list(scraper.CHART_RANGES)}")
    symbol = symbol.upper()
    from_db = prices.chart_from_history(symbol, range)
    if from_db is not None:
        return from_db
    return _cached(symbol, f"chart:{range}", 15, lambda: scraper.get_chart(symbol, range))
