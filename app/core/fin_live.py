"""Live value for CAS items between statements. A statement is a month old by the time it lands;
the units in it are not - so each item's positions (fin_items.holdings, saved at import) are
repriced with today's numbers:
  stocks / ETFs with an NSE symbol -> the app's quote cache (services.quotes.paper_quotes)
  everything else with an ISIN     -> AMFI's daily NAV file (every MF scheme, ETFs included)
  neither                          -> the statement's own price, counted as unpriced.
Nothing here is stored: the snapshot history stays statement / monthly-update values only.
"""
import threading
import time
from datetime import datetime

from app.core import netfetch

AMFI_NAV_URL = "https://portal.amfiindia.com/spages/NAVAll.txt"
NAV_TTL_SECONDS = 6 * 3600  # AMFI publishes once a day, after ~11pm

_nav_cache = {"at": 0.0, "navs": {}}
_nav_lock = threading.Lock()


def parse_navs(text):
    """{isin: (nav, 'YYYY-MM-DD')} from NAVAll.txt - 'code;isin growth;isin reinvest;name;...;nav;date'
    rows between section headings. The column count has changed before (Plan/Option were added),
    so NAV and date are read from the end and the ISINs from the front."""
    out = {}
    for line in text.splitlines():
        parts = line.split(";")
        if len(parts) < 6 or not parts[0].strip().isdigit():
            continue
        try:
            nav = float(parts[-2])
            day = datetime.strptime(parts[-1].strip(), "%d-%b-%Y").date().isoformat()
        except ValueError:
            continue  # 'N.A.' NAVs on wound-up schemes
        for isin in (parts[1].strip(), parts[2].strip()):
            if len(isin) == 12:
                out[isin] = (nav, day)
    return out


def amfi_navs():
    """ponytail: whole-file cache in process memory, refetched every 6h (~1.5 MB, one request) -
    a per-ISIN lookup would be 1 request per fund for no gain. A failed fetch keeps the last good
    copy, and an empty dict just leaves funds on their statement price."""
    with _nav_lock:
        if time.time() - _nav_cache["at"] < NAV_TTL_SECONDS:
            return _nav_cache["navs"]
        try:
            navs = parse_navs(netfetch.request(AMFI_NAV_URL, pool="amfi").body.decode("utf-8", "replace"))
            if navs:
                _nav_cache.update(at=time.time(), navs=navs)
        except Exception:
            _nav_cache["at"] = time.time() - NAV_TTL_SECONDS + 300  # retry in 5 min, not every poll
        return _nav_cache["navs"]


def nse_symbol(isin):
    """NSE symbol for an ISIN casparser's db didn't know (ETFs, mostly) via Yahoo's search, which
    indexes ISINs. Import-time only, one call per unresolved equity; None on any failure."""
    try:
        import yfinance as yf

        for q in yf.Search(isin, max_results=3).quotes:
            if (q.get("symbol") or "").endswith(".NS"):
                return q["symbol"][:-3]
    except Exception:
        pass
    return None


def revalue(items, quotes, navs):
    """items: fin_items rows with holdings. quotes: {symbol: {"price", "fetched_at"} | None}.
    navs: {isin: (nav, date)}. Returns {item_id: {value, statement_value, priced, count, as_of}}
    - as_of is the newest price used, ISO; unpriced positions keep their statement price."""
    out = {}
    for item in items:
        value = statement = 0.0
        priced, stamps = 0, []
        for p in item["holdings"]:
            q = quotes.get(p["symbol"]) if p.get("symbol") else None
            if q and q.get("price") is not None:
                price, stamp = q["price"], q["fetched_at"].isoformat()
            elif p["isin"] in navs:
                price, stamp = navs[p["isin"]]
            else:
                price, stamp = None, None
            statement += p["units"] * p["price"]
            value += p["units"] * (price if price is not None else p["price"])
            if price is not None:
                priced += 1
                stamps.append(stamp)
        out[item["id"]] = {"value": round(value, 2), "statement_value": round(statement, 2), "priced": priced,
                           "count": len(item["holdings"]), "as_of": max(stamps) if stamps else None}
    return out


if __name__ == "__main__":  # self-check: .venv/bin/python -m app.core.fin_live
    sample = (
        "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date\n"
        " \nOpen Ended Schemes(Equity Scheme - ELSS)\n\nAxis Mutual Fund\n"
        "120503;INF846K01EW2;-;Axis ELSS;Direct Plan;Growth Option;116.4062;23-Nov-2026\n"
        "100001;INF000000001;INF000000002;Old 6-col;12.5;22-Nov-2026\n"
        "100002;INF000000003;-;Wound up;Direct;Growth;N.A.;22-Nov-2026\n"
    )
    navs = parse_navs(sample)
    assert navs["INF846K01EW2"] == (116.4062, "2026-11-23")
    assert navs["INF000000002"] == (12.5, "2026-11-22") and "INF000000003" not in navs
    stamp = datetime(2026, 11, 24, 10, 0)
    items = [
        {"id": 1, "holdings": [
            {"isin": "INE1", "symbol": "RELIANCE", "units": 2, "price": 100},      # quote
            {"isin": "INF846K01EW2", "symbol": "NOSUCH", "units": 10, "price": 100},  # quote failed -> NAV
            {"isin": "INE9", "symbol": None, "units": 1, "price": 50},             # nothing -> statement
        ]},
    ]
    r = revalue(items, {"RELIANCE": {"price": 150.0, "fetched_at": stamp}, "NOSUCH": None}, navs)[1]
    assert r["value"] == round(300 + 1164.062 + 50, 2) and r["statement_value"] == 1250
    assert (r["priced"], r["count"]) == (2, 3) and r["as_of"] == stamp.isoformat()
    assert revalue([{"id": 2, "holdings": [{"isin": "X", "units": 1, "price": 5}]}], {}, {})[2]["as_of"] is None
    print("fin_live selfcheck: all passed")
