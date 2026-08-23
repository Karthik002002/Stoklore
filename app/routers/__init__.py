"""The single aggregated router. app/main.py includes this one object and nothing else.

Two deliberate choices here:

**Paths stay absolute in each endpoint decorator** (`@router.get("/api/prices/{symbol}")`)
rather than being split into an `APIRouter(prefix=...)` plus a relative path. The domains in
this app don't map one-to-one onto URL prefixes - the manual-trades router also owns
`/api/trading-goals` and `/api/settings/manual-backtest`, and the activity router owns both
`/api/activity/*` and `/api/settings/activity` - so a prefix would only be honest for about
half of them. Mixing the two conventions reads worse than one consistent absolute path, and it is the
prefix-splitting step that silently changes URLs during a refactor like this. `tags` do the
OpenAPI grouping instead. To version the whole surface later, add `prefix="/api/v1"` to the
`APIRouter()` below once and strip `/api` from the decorators in one pass.

**Include order is significant.** FastAPI matches routes in registration order, so a literal
path must be registered before a parameterised sibling that would also match it -
`/api/stocks/search` before `/api/stocks/{symbol}`, `/api/prices/sources` before
`/api/prices/{symbol}`. Every such pair currently lives inside a single module, where the
original file order is preserved, so no cross-module ordering constraint exists today. Keep it
that way: put a new literal route in the same module as the `{param}` route it could collide
with, rather than relying on the order of this list.
"""
from fastapi import APIRouter

from app.routers import (
    activity,
    backtest,
    backup,
    chat,
    events,
    holdings,
    indices,
    kite_auth,
    manual_trades,
    paper_trading,
    prices,
    reports,
    sentiment,
    settings,
    stocks,
    system,
    top_news,
    trade_accounts,
    watch_rules,
    watchlists,
)

router = APIRouter()

# Ordered to mirror the original api.py, which keeps the OpenAPI page grouped the way the app
# actually reads: market data first, then the journal, then chat.
for _module in (
    backup,
    events,
    top_news,
    prices,
    watch_rules,
    backtest,
    manual_trades,
    paper_trading,
    trade_accounts,
    activity,
    system,
    sentiment,
    settings,
    kite_auth,
    holdings,
    stocks,
    watchlists,
    indices,
    reports,
    chat,
):
    router.include_router(_module.router)
