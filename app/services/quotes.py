"""Live quote lookup shared by the paper-trading engine and its endpoints.

Lives in services (not the router) because api startup hands this function to paper.start() -
importing a router from main.py just to reach it would invert the dependency.
"""
import scraper

from app.deps import _cached

def paper_price(symbol):
    """Latest price for a symbol, via the same TTL cache the rest of the app uses so the poller
    and the UI can't disagree about what 'now' is. Returns None when the quote fails - the caller
    treats that as "no update this tick" rather than an error."""
    try:
        quote = _cached(symbol, "quote", 1, lambda: scraper.get_quote(symbol))
    except Exception:
        return None
    price = (quote or {}).get("currentPrice")
    return float(price) if price is not None else None
