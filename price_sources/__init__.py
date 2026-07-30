"""Pluggable OHLCV sources for "Collect max history" (see prices.collect_max_history). Each
module here implements one function:

    fetch_max(symbol) -> list[{date, open, high, low, close, volume}]  (oldest-first, ISO dates)

and raises price_sources.errors.SourceError on failure - never a bare exception, so callers can
catch exactly that type and isolate one source's failure (rate-limited, banned, endpoint changed
shape, ...) without it affecting any other source or any other symbol's collection.

If an endpoint gets blocked or its shape changes: write a new module with the same fetch_max()
signature, add one line to SOURCES below. Nothing else in the app needs to change - the API
already takes `source` as a plain string key into this dict, and the frontend already lists
`GET /api/prices/sources` to populate its selector instead of hardcoding names.
"""
from . import moneycontrol_source, yfinance_source
from .errors import SourceError

SOURCES = {
    "yfinance": yfinance_source,
    "moneycontrol": moneycontrol_source,
}

DEFAULT_SOURCE = "yfinance"


def fetch_max(source, symbol):
    """Dispatches to the named source's fetch_max(symbol). Raises ValueError for an unknown
    source name (a caller/config bug, not a runtime failure - not wrapped in SourceError) and
    SourceError for the plugin's own fetch failures."""
    if source not in SOURCES:
        raise ValueError(f"unknown price source '{source}' - available: {', '.join(SOURCES)}")
    return SOURCES[source].fetch_max(symbol)


__all__ = ["SOURCES", "DEFAULT_SOURCE", "fetch_max", "SourceError"]
