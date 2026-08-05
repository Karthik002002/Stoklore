from fastapi import APIRouter
from fastapi import File, HTTPException, UploadFile

import db
import prices
import scraper
import stocks_master

from app.deps import _cached
from app.schemas import AddStockRequest
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
    """Tracked symbols with a price cached for 15min - was N live yahoo calls on every poll."""
    rows = db.list_symbols()
    for row in rows:
        try:
            row.update(_cached(row["symbol"], "price", 15, lambda s=row["symbol"]: scraper.get_price(s)))
        except Exception:
            row.update({"price": None, "changePercent": None})
    return rows


@router.get("/api/stocks/search")
def search_stocks(q: str = "", limit: int = 30):
    """Symbol search for the chat @ tag menu - every scraped symbol, not just watchlisted ones."""
    return db.search_symbols(q, min(limit, 30))


@router.get("/api/stocks-master")
def stocks_master_search(q: str = "", limit: int = 30):
    """Search endpoint for the full NSE listed-equity master (Settings > Manage stocks), separate
    from /api/stocks/search above which only covers previously-scraped symbols. Always capped at
    30 - this table has 2000+ rows, nowhere near safe to return unbounded."""
    return {"stocks": db.search_stocks_master(q, min(limit, 30)), "total": db.count_stocks_master()}


@router.post("/api/stocks-master/import")
async def stocks_master_import(file: UploadFile = File(...)):
    """Bulk (re)import from an NSE EQUITY_L.csv export - upserts, so re-running with a fresh
    download just refreshes the list."""
    rows = stocks_master.parse_csv(await file.read())
    if not rows:
        raise HTTPException(status_code=422, detail="no valid rows found in CSV")
    db.upsert_stocks_master(rows)
    return {"imported": len(rows), "total": db.count_stocks_master()}


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
