"""Live quote lookup shared by the paper-trading engine and its endpoints.

Lives in services (not the router) because api startup hands this function to paper.start() -
importing a router from main.py just to reach it would invert the dependency.
"""
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from app.core import db, scraper

from app.deps import _cached

# Upper bound on concurrent quote fetches. Deliberately small: this is for the handful of symbols
# on one screen, with a TTL cache in front of it - NOT the 30-50 symbol history sweeps that
# prices.sync_all and the bulk collector keep strictly sequential to stay under Yahoo's rate limit.
MAX_QUOTE_WORKERS = 8

# How old a stored price may be before the display path calls it stale and refreshes it. Same
# window as the quote cache's TTL, so the two can't disagree about what counts as current.
QUOTE_TTL_MINUTES = 1

# Symbols with a refresh already in flight. Without this, every 10s poll from every open tab would
# queue another fetch for the same handful of symbols while the first ones are still running.
_refreshing = set()
_refresh_lock = threading.Lock()
_refresh_pool = ThreadPoolExecutor(max_workers=MAX_QUOTE_WORKERS, thread_name_prefix="quote-refresh")


def paper_price(symbol):
    """Latest price for a symbol, via the same TTL cache the rest of the app uses so the poller
    and the UI can't disagree about what 'now' is. Returns None when the quote fails - the caller
    treats that as "no update this tick" rather than an error.

    Blocking, and the only writer of the last-known-price store - order entry and the exit engine
    both go through here because they must act on a fresh price, never a remembered one.
    """
    try:
        quote = _cached(symbol, "quote", QUOTE_TTL_MINUTES, lambda: scraper.get_quote(symbol))
    except Exception:
        return None
    price = (quote or {}).get("currentPrice")
    if price is None:
        return None
    price = float(price)
    db.set_paper_price(symbol, price, (quote or {}).get("sector"))
    return price


def _refresh(symbol):
    try:
        paper_price(symbol)
    except Exception:
        pass
    finally:
        with _refresh_lock:
            _refreshing.discard(symbol)


def paper_quotes(symbols):
    """{symbol: {"price", "fetched_at", "stale"}} for the display path - answers from the stored
    last-known price without waiting on the network, and kicks off a background refresh for
    anything past QUOTE_TTL_MINUTES.

    This is the read side of the paper screens: they poll every few seconds, so a request that
    blocks on N live quotes makes the table late for the sake of a price the *next* poll would
    have shown anyway. Serving the stored price with its timestamp lets the UI render immediately
    and say how old the number is, which is the honest version of what the blocking call was
    pretending to do. Symbols never quoted before have nothing to show, so those are fetched
    inline - a first-ever load has no cache to fall back on.
    """
    unique = list(dict.fromkeys(symbols))
    if not unique:
        return {}

    stored = db.get_paper_prices(unique)
    missing = [s for s in unique if s not in stored]
    if missing:
        # paper_price writes what it fetched, so read the rows back rather than reconstructing
        # them here - that way the timestamp and sector come from the same place as every other
        # symbol's, instead of a second, subtly different code path.
        paper_prices(missing)
        stored.update(db.get_paper_prices(missing))

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=QUOTE_TTL_MINUTES)
    out = {}
    for symbol in unique:
        entry = stored.get(symbol)
        if entry is None:
            out[symbol] = None
            continue
        stale = entry["fetched_at"] < cutoff
        out[symbol] = {**entry, "stale": stale}
        if stale:
            with _refresh_lock:
                if symbol in _refreshing:
                    continue
                _refreshing.add(symbol)
            _refresh_pool.submit(_refresh, symbol)
    return out


def paper_prices(symbols):
    """{symbol: price or None} for several symbols at once.

    Same per-symbol path (and the same TTL cache) as paper_price, just fanned out instead of
    looped. A page listing N positions used to make N *sequential* network calls whenever the
    cache was cold, so its response time was N round trips - on a slow connection that is long
    enough for the browser to sit there with no rows at all. Fanned out it's one round trip.

    Every symbol is fetched independently and paper_price already swallows its own failures, so
    one dead symbol returns None for itself and never holds up or breaks the rest.
    """
    unique = list(dict.fromkeys(symbols))
    if not unique:
        return {}
    # Each worker opens its own DB connection (db.connect() per call, see app/deps.py), so the
    # cache-aside read/write underneath this is safe to run concurrently.
    with ThreadPoolExecutor(max_workers=min(MAX_QUOTE_WORKERS, len(unique))) as pool:
        return dict(zip(unique, pool.map(paper_price, unique)))
