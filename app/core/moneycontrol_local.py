"""OHLCV client for moneycontrol's undocumented priceapi endpoint - an alternate/fallback price
source alongside scraper.py's NSE/yfinance-backed one. Used as a plugin by
price_sources/moneycontrol_source.py (see that package for the "Collect max history" source
architecture); fetch_history() below is also usable standalone for ad-hoc pulls at any
resolution, with results cached to local_data/ (gitignored - fetched data, not code).

Run standalone:
    python moneycontrol_local.py MIDHANI 60 2026-04-25 2026-07-29
"""
import sys
import json
from datetime import datetime, timezone
from pathlib import Path

from app.core import netfetch

PRICEAPI_URL = "https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history"
# Only the endpoint-specific bits - the User-Agent and the rest of the browser header set come
# from netfetch's stealthy headers, kept consistent with the impersonated TLS fingerprint.
HEADERS = {
    "Accept": "*/*",
    "Origin": "https://www.moneycontrol.com",
    "Referer": "https://www.moneycontrol.com/",
}

LOCAL_DATA_DIR = Path(__file__).parent / "local_data"


def fetch_history(symbol, from_ts, to_ts, resolution="60", currency_code="INR", countback=5000):
    """Fetches OHLCV bars for `symbol` between unix timestamps `from_ts`/`to_ts` at `resolution`
    (moneycontrol's TradingView-style UDF codes - minutes as a bare number e.g. "1"/"5"/"60", or
    "1D"/"1W"/"1M" for daily/weekly/monthly). Returns oldest-first list of
    {time, open, high, low, close, volume} dicts, or [] if moneycontrol reports no data
    (response "s" field != "ok")."""
    params = {
        "symbol": symbol,
        "resolution": resolution,
        "from": from_ts,
        "to": to_ts,
        "countback": countback,
        "currencyCode": currency_code,
    }
    data = netfetch.get_json(PRICEAPI_URL, pool="moneycontrol", headers=HEADERS, params=params)
    if data.get("s") != "ok":
        return []
    return [
        {"time": t, "open": o, "high": h, "low": l, "close": c, "volume": v}
        for t, o, h, l, c, v in zip(data["t"], data["o"], data["h"], data["l"], data["c"], data["v"])
    ]


def save_history(symbol, resolution, bars):
    """Writes bars to local_data/<symbol>_<resolution>.json (gitignored). Overwrites any
    previous file for that symbol/resolution pair rather than merging - this is a personal
    scratch cache, not an incrementally-synced store like the app's own price_history table."""
    LOCAL_DATA_DIR.mkdir(exist_ok=True)
    path = LOCAL_DATA_DIR / f"{symbol}_{resolution}.json"
    path.write_text(json.dumps(bars, indent=2), encoding="utf-8")
    return path


def collect(symbol, from_ts, to_ts, resolution="60"):
    """Fetch + save in one call. Returns (bars, saved_path)."""
    bars = fetch_history(symbol, from_ts, to_ts, resolution)
    path = save_history(symbol, resolution, bars) if bars else None
    return bars, path


def _parse_date(s):
    return int(datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())


if __name__ == "__main__":
    if len(sys.argv) < 5:
        print("Usage: python moneycontrol_local.py SYMBOL RESOLUTION FROM_DATE TO_DATE")
        print("  e.g. python moneycontrol_local.py MIDHANI 60 2026-04-25 2026-07-29")
        raise SystemExit(1)
    symbol, resolution, from_date, to_date = sys.argv[1:5]
    bars, path = collect(symbol, _parse_date(from_date), _parse_date(to_date), resolution)
    print(f"{len(bars)} bars fetched")
    if path:
        print(f"saved to {path}")
