"""Default "Collect max history" source - wraps scraper.get_daily_bars' existing yfinance path.
Was the only source before price_sources existed; kept as its own plugin (rather than a hardcoded
special case) so the registry in __init__.py doesn't need to treat it differently from any
alternate source added later."""
from app.core import scraper

from .errors import SourceError


def fetch_max(symbol):
    """Full available daily history (yfinance period='max'). Returns oldest-first list of
    {date, open, high, low, close, volume} dicts - date as an ISO string, matching
    price_history_max's schema directly."""
    try:
        return scraper.get_daily_bars(symbol, period="max")
    except Exception as e:
        raise SourceError(f"yfinance: {e}") from e
