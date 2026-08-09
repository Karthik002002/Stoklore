"""Zerodha Kite Connect client - personal portfolio data only (holdings, P&L, available margin).

Deliberately doesn't call any of Kite's market-data endpoints (/quote, /quote/ltp, /historical/*)
- /portfolio/holdings already returns each holding's last_price and pnl computed by Kite itself,
so there's no separate market-data call needed at all to show current price/P&L here.

Kite's session model differs from Dhan's: there's no long-lived pasteable token - access_token is
generated once per trading day via an interactive login redirect (see login_url/generate_session),
and expires at the next day's market reset. api.py's /api/kite/callback completes that exchange;
db.get_kite_session()/set_kite_session() track which calendar day a token was issued for.
"""
import hashlib

import requests

BASE_URL = "https://api.kite.trade"
LOGIN_URL = "https://kite.trade/connect/login"


class KiteError(Exception):
    pass


def login_url(api_key):
    return f"{LOGIN_URL}?api_key={api_key}&v=3"


def _headers(api_key, access_token):
    return {"Authorization": f"token {api_key}:{access_token}", "X-Kite-Version": "3"}


def generate_session(api_key, api_secret, request_token):
    """Exchanges a one-time request_token (from the login redirect) for a day-valid access_token."""
    checksum = hashlib.sha256(f"{api_key}{request_token}{api_secret}".encode()).hexdigest()
    try:
        res = requests.post(
            f"{BASE_URL}/session/token",
            headers={"X-Kite-Version": "3"},
            data={"api_key": api_key, "request_token": request_token, "checksum": checksum},
            timeout=15,
        )
    except requests.RequestException as e:
        raise KiteError(f"Couldn't reach Kite: {e}") from e
    if not res.ok:
        raise KiteError(f"Kite login failed ({res.status_code}): {res.text[:200]}")
    return res.json()["data"]["access_token"]


def _get(path, api_key, access_token):
    try:
        res = requests.get(f"{BASE_URL}{path}", headers=_headers(api_key, access_token), timeout=15)
    except requests.RequestException as e:
        raise KiteError(f"Couldn't reach Kite: {e}") from e
    if not res.ok:
        raise KiteError(f"Kite API error ({res.status_code}): {res.text[:200]}")
    return res.json()["data"]


def fetch_holdings(api_key, access_token):
    return _get("/portfolio/holdings", api_key, access_token)


def fetch_margins(api_key, access_token):
    return _get("/user/margins", api_key, access_token)


def get_portfolio(api_key, access_token):
    """Normalized snapshot: {available_balance, holdings: [{symbol, isin, qty, avg_price, ltp}]} -
    same shape broker.get_portfolio (Dhan) returns, so api.py's /api/holdings doesn't need to
    know which broker it's talking to."""
    holdings = fetch_holdings(api_key, access_token)
    margins = fetch_margins(api_key, access_token)

    positions = [
        {
            "symbol": h.get("tradingsymbol"),
            "isin": h.get("isin"),
            "qty": h.get("quantity", 0),
            "avg_price": h.get("average_price"),
            "ltp": h.get("last_price"),
        }
        for h in holdings
    ]

    available = margins.get("equity", {}).get("available", {})
    return {
        "available_balance": available.get("live_balance", available.get("cash")),
        "holdings": positions,
    }
