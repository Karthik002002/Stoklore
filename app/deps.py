"""Shared request-layer helpers: SSE framing and the cache-aside wrapper every live
scraper call goes through. Imported by routers and services alike - it depends on nothing in
either, which is what keeps it cycle-free."""
import json

import db

def _sse(obj):
    return f"data: {json.dumps(obj)}\n\n"


def _cached(symbol, kind, ttl_minutes, fetch):
    """Cache-aside for live scraper calls (price/quote/chart/financials) - fetches once, reused
    for ttl_minutes, busted wholesale by POST /api/cache/clear."""
    data = db.get_cached(symbol, kind, ttl_minutes)
    if data is not None:
        return data
    data = fetch()
    db.set_cached(symbol, kind, data)
    return data
