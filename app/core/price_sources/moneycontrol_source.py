"""Alternate "Collect max history" source, backed by moneycontrol_local.py's priceapi client -
swap this in (or add a third plugin the same way) if yfinance ever gets rate-limited/blocked.
Same fetch_max(symbol) contract as yfinance_source, so nothing outside price_sources needs to
know which one actually ran.

Caveat: moneycontrol's `symbol` param is its own scrip code, which isn't guaranteed to match the
plain NSE ticker for every stock (it happens to for the ones this was tested against) - there's
no symbol-mapping table here, so an unmapped symbol will just come back empty/404 rather than
silently fetching the wrong stock.
"""
from datetime import datetime, timezone

from app.core import moneycontrol_local

from .errors import SourceError

# moneycontrol's endpoint needs an explicit from/to range (no "give me everything" option like
# yfinance's period="max") - 2000-01-01 predates every NSE listing this app would track, so it
# approximates "as much history as they have" without needing a real listing date per symbol.
MAX_HISTORY_FROM = int(datetime(2000, 1, 1, tzinfo=timezone.utc).timestamp())


def fetch_max(symbol):
    """Full available daily history via moneycontrol's priceapi (resolution="1D"). Returns
    oldest-first list of {date, open, high, low, close, volume} dicts, same shape as
    yfinance_source.fetch_max - date is a UTC calendar date derived from each bar's unix
    timestamp."""
    to_ts = int(datetime.now(timezone.utc).timestamp())
    try:
        bars = moneycontrol_local.fetch_history(symbol, MAX_HISTORY_FROM, to_ts, resolution="1D")
    except Exception as e:
        raise SourceError(f"moneycontrol: {e}") from e
    return [
        {
            "date": datetime.fromtimestamp(b["time"], tz=timezone.utc).date().isoformat(),
            "open": b["open"],
            "high": b["high"],
            "low": b["low"],
            "close": b["close"],
            "volume": b["volume"],
        }
        for b in bars
    ]
