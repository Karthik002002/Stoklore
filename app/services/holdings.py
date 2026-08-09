"""Broker holdings, normalized to one shape across Dhan and Kite.

Shared by GET /api/holdings and the chat agent's get_holdings tool.
"""
from fastapi import HTTPException

from app.core import broker
from app.core import db
from app.core import kite
from app.core import scraper

from app.core.config import SUPPORTED_BROKERS
from app.deps import _cached

HOLDINGS_CACHE_TTL_MINUTES = 5


def _get_holdings(broker_id=None, force=False):
    """Shared by GET /api/holdings and the chat agent's get_holdings tool - one holdings-fetch
    path so both ever see the same cached-vs-live behavior. Raises HTTPException on failure."""
    active = broker_id or db.get_active_broker()
    if active not in SUPPORTED_BROKERS:
        raise HTTPException(status_code=422, detail=f"'{active}' isn't supported yet")

    cached = None if force else db.get_cached(active, "holdings", HOLDINGS_CACHE_TTL_MINUTES)
    if cached is not None:
        return cached

    if active == "dhan":
        creds = db.get_dhan_credentials()
        if not creds:
            raise HTTPException(status_code=400,
                                 detail="Dhan isn't configured - add your client ID and access token in Settings > Broker")
        try:
            data = broker.get_portfolio(creds["client_id"], creds["access_token"])
        except broker.DhanError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
    else:
        creds = db.get_kite_credentials()
        if not creds:
            raise HTTPException(status_code=400,
                                 detail="Kite isn't configured - add your API key and secret in Settings > Kite")
        session = db.get_kite_session()
        if not session:
            raise HTTPException(status_code=400,
                                 detail="Not logged in to Kite today - connect in Settings > Kite")
        try:
            data = kite.get_portfolio(creds["api_key"], session["access_token"])
        except kite.KiteError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e

    # Neither Dhan's holdings endpoint nor a paid market-data plan gives a live price - reuse this
    # app's existing yfinance price cache instead, same one /api/stocks already hits. Kite's own
    # holdings response already includes last_price, so this only fills in what's still missing.
    for h in data["holdings"]:
        if h.get("ltp") is not None:
            continue
        try:
            h["ltp"] = _cached(h["symbol"], "price", 15, lambda s=h["symbol"]: scraper.get_price(s))["price"]
        except Exception:
            h["ltp"] = None

    db.set_cached(active, "holdings", data)
    return data
