"""Shared request-layer helpers: SSE framing and the cache-aside wrapper every live
scraper call goes through. Imported by routers and services alike - it depends on nothing in
either, which is what keeps it cycle-free."""
import json

from app.core import db

def _sse(obj):
    return f"data: {json.dumps(obj)}\n\n"


def _cached(symbol, kind, ttl_minutes, fetch):
    """Cache-aside for live scraper calls (price/quote/chart/financials) - fetches once, reused
    for ttl_minutes, busted wholesale by POST /api/cache/clear."""
    data = db.get_cached(symbol, kind, ttl_minutes)
    if not _blank(data):
        return data
    data = fetch()
    if not _blank(data):
        db.set_cached(symbol, kind, data)
    return data


def _blank(data):
    """A failed fetch comes back as {"price": None, "changePercent": None}, not an exception.
    Caching it served that blank to every reader for the whole TTL - a watchlist workflow priced
    eight stocks from cache in 5ms, all null. Checked on read too, so a blank already stored is a
    miss rather than another 15 minutes of nulls."""
    return data is None or (isinstance(data, dict) and bool(data) and all(v is None for v in data.values()))
