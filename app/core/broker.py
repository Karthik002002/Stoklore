"""Dhan API v2 client - fetches holdings and available margin for the Holdings page.

Kite isn't wired up yet (see api.py's broker settings endpoints and Settings.jsx's Broker tab) -
this module is Dhan-only for now, deliberately kept to plain functions returning a normalized
{available_balance, holdings: [...]} shape so a sibling kite.py can slot in later without
api.py's /api/holdings route needing to change.

Deliberately doesn't call Dhan's /marketfeed/ltp - that's a separately-paid "Data API" plan, and
calling it without that subscription fails outright (401, "Data APIs not Subscribed") rather than
degrading gracefully. Current price instead comes from the app's own yfinance price cache
(scraper.get_price, same one /api/stocks already uses) - see api.py's /api/holdings.

Field names follow Dhan's public v2 API docs (https://dhanhq.co/docs/v2/), including its
documented "availabelBalance" typo in /fundlimit - if Dhan changes these, this is the only file
that needs to change.
"""
import requests

BASE_URL = "https://api.dhan.co/v2"


class DhanError(Exception):
    pass


def _headers(client_id, access_token):
    return {"access-token": access_token, "client-id": client_id, "Content-Type": "application/json"}


def _get(path, client_id, access_token):
    try:
        res = requests.get(f"{BASE_URL}{path}", headers=_headers(client_id, access_token), timeout=15)
    except requests.RequestException as e:
        raise DhanError(f"Couldn't reach Dhan: {e}") from e
    if not res.ok:
        raise DhanError(f"Dhan API error ({res.status_code}): {res.text[:200]}")
    return res.json()


def fetch_holdings(client_id, access_token):
    return _get("/holdings", client_id, access_token)


def fetch_fund_limit(client_id, access_token):
    return _get("/fundlimit", client_id, access_token)


def get_portfolio(client_id, access_token):
    """Normalized snapshot: {available_balance, holdings: [{symbol, isin, qty, avg_price}]} -
    caller (api.py) fills in current price from its own price cache, not Dhan."""
    holdings = fetch_holdings(client_id, access_token)
    fund_limit = fetch_fund_limit(client_id, access_token)

    positions = [
        {
            "symbol": h.get("tradingSymbol"),
            "isin": h.get("isin"),
            "qty": h.get("totalQty", 0),
            "avg_price": h.get("avgCostPrice"),
        }
        for h in holdings
    ]

    return {
        "available_balance": fund_limit.get("availabelBalance", fund_limit.get("availableBalance")),
        "holdings": positions,
    }
