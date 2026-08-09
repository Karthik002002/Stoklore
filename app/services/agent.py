"""The chat agent's tool layer: implementations, the confirmation gate, and the JSON tool
schemas handed to the model.

Separate from routers/chat.py so the tools can reach jobs/holdings/scraping services without
the chat router and those services importing each other.
"""
import threading
from datetime import date

import requests
from fastapi import HTTPException

from app.core import db
from app.core import llm
from app.core import prices
from app.core import rules
from app.core import scraper
from app.core import sentiment

from app.deps import _cached
from app.services.holdings import _get_holdings
from app.services.jobs import (
    _event_scan_state,
    _price_sync_state,
    _run_event_scan,
    _run_price_sync,
)
from app.services.scraping import _live_scrape

def _format_rule_check(rule_name, symbol, result):
    lines = [f"**{rule_name}** ({symbol}) — {'✅ met' if result['passed'] else '❌ not met'}"]
    for check in result["checks"]:
        lines.append(f"- {'✅' if check['passed'] else '❌'} {check['label']} — {check['detail']}")
    return "\n".join(lines)


def _format_rule_check_all(rule_name, results):
    passed = [r for r in results if r["passed"]]
    lines = [f"**{rule_name}** — met by {len(passed)}/{len(results)} watchlisted stock(s)"]
    lines += [f"- {'✅' if r['passed'] else '❌'} {r['symbol']}" for r in results]
    return "\n".join(lines)


# --- Chat agent (Ollama-native tool calling, no LangChain) ---------------------------------
# Read-only tools return data directly; the two scan tools start the same background threads
# the UI buttons use and return immediately - the agent must never block a chat reply on a
# multi-minute scan.

def _tool_get_price(symbol):
    return _cached(symbol.upper(), "price", 15, lambda: scraper.get_price(symbol.upper()))


def _tool_get_movers(count=25):
    """Live NSE gainers/losers/volume-gainers, straight from NSE's own API - not a web search,
    so the model gets real {symbol, changePercent, volume, avgVolume} rows to answer with."""
    return _cached("market", f"movers-{count}", 15, lambda: scraper.get_movers(int(count)))


def _tool_ema_crossover(symbol, short=20, long=50):
    signal = prices.ema_crossover(symbol.upper(), int(short), int(long))
    return signal or "no synced price history for this symbol - run a price sync first"


def _tool_list_watchlists():
    return db.list_watchlist()


def _tool_get_holdings():
    """Actual broker-synced positions (qty, entry vs current price, P&L) - distinct from the
    watchlist tools above, which only track symbols the user is following, not what they hold."""
    try:
        return _get_holdings()
    except HTTPException as e:
        return e.detail


def _tool_scrape_url(url):
    """Fetches a URL and returns its title+text for the model to analyze in this reply - nothing
    is written to a file or the DB, unlike POST /api/scrape. Only lives in this turn's context."""
    try:
        return scraper.scrape_article(url)
    except requests.RequestException as e:
        return f"couldn't fetch that URL: {e}"


def _tool_list_chat_sessions():
    """Titles of past chat sessions (from the History dropdown) - answers 'what have I asked
    about before' questions, which the model otherwise has no way to see beyond this session."""
    return [{"title": s["title"] or "Untitled", "date": s["created_at"].date().isoformat()}
            for s in db.list_sessions()]


def _tool_search_reports(query):
    matches = db.similarity_search(llm.embed(query), limit=3)
    return [m["content_markdown"] for m in matches] or "no stored reports matched"


def _tool_scrape_stock(symbol):
    markdown = _live_scrape(symbol.upper(), db.get_active_model())
    return markdown or f"no data found for '{symbol}' on NSE"


def _tool_scan_events(list_name=None):
    if _event_scan_state["running"]:
        return "an event scan is already running"
    threading.Thread(target=_run_event_scan, args=(list_name,), daemon=True).start()
    return "event scan started in the background - results will appear on the Events page shortly"


def _tool_sync_prices(list_name=None):
    if _price_sync_state["running"]:
        return "a price sync is already running"
    symbols = db.watchlist_symbols(list_name)
    threading.Thread(target=_run_price_sync, args=(symbols,), daemon=True).start()
    return f"price sync started in the background for {len(symbols)} symbols"


def _tool_web_search(query):
    return scraper.web_search(query) or "no results found"


def _tool_check_watch_rule(name, symbol=None):
    rule = db.get_watch_rule(name)
    if rule is None:
        return f"no watch rule named '{name}' - the user needs to set one up in Settings > Watch rules"
    if symbol:
        return _format_rule_check(rule["name"], symbol.upper(), rules.evaluate(rule, symbol.upper()))
    results = [{"symbol": s, **rules.evaluate(rule, s)} for s in db.watchlist_symbols()]
    return _format_rule_check_all(rule["name"], results)


def _tool_add_stock_event(symbol, headline, detail=None, url=None):
    """Lets the agent record an event it found via web_search/scrape_stock research, outside the
    fixed rule-based scan_events pipeline (news/price_move/volume_spike/corporate_action) - shows
    up on the Events page like any other event, tagged 'research' so its origin is clear."""
    symbol = symbol.upper()
    score = sentiment.analyze(f"{headline}. {detail or ''}")
    today = date.today().isoformat()
    dedup_key = url or headline
    inserted = db.insert_event(symbol, "research", dedup_key, headline, detail, url, today,
                                score["label"], score["score"])
    return f"event recorded for {symbol}" if inserted else "already recorded (duplicate)"


# scrape_stock adds a new stock (a live scrape + report generation) - gated behind an explicit
# /confirm command the user has to type themselves (or the UI's Confirm button). Everything else,
# including background scans/syncs over the whole watchlist, runs freely.
CONFIRM_TOOLS = {"scrape_stock"}

REAL_TOOL_IMPLS = {
    "get_price": _tool_get_price,
    "get_movers": _tool_get_movers,
    "get_ema_crossover": _tool_ema_crossover,
    "list_watchlists": _tool_list_watchlists,
    "get_holdings": _tool_get_holdings,
    "scrape_url": _tool_scrape_url,
    "list_chat_sessions": _tool_list_chat_sessions,
    "search_reports": _tool_search_reports,
    "scrape_stock": _tool_scrape_stock,
    "scan_events": _tool_scan_events,
    "sync_prices": _tool_sync_prices,
    "web_search": _tool_web_search,
    "add_stock_event": _tool_add_stock_event,
    "check_watch_rule": _tool_check_watch_rule,
}


def _guarded(name, fn):
    if name not in CONFIRM_TOOLS:
        return fn

    def wrapped(**kwargs):
        return {
            "requires_confirmation": True,
            "tool": name,
            "args": kwargs,
            "message": (
                f"This action ({name}) was NOT run - it costs real time/bandwidth, so it needs "
                f"the user's explicit confirmation first. Tell the user what you'd like to do; "
                "a Confirm/Cancel prompt will be shown to them. Do not call this tool again in "
                "this turn."
            ),
        }

    return wrapped


# What the agent actually gets to call - confirm-gated tools return the message above instead of
# running; /confirm re-invokes REAL_TOOL_IMPLS directly, bypassing the model for that one call.
AGENT_TOOL_IMPLS = {name: _guarded(name, fn) for name, fn in REAL_TOOL_IMPLS.items()}


def _fn(name, description, properties=None, required=None):
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties or {}, "required": required or []},
        },
    }


_SYMBOL_PROP = {"symbol": {"type": "string", "description": "NSE ticker symbol, e.g. TCS"}}
_LIST_PROP = {"list_name": {"type": "string", "description": "watchlist name; omit for all watchlists"}}

AGENT_TOOLS = [
    _fn("get_price", "Live price and day change % for an NSE stock", _SYMBOL_PROP, ["symbol"]),
    _fn("get_movers", "Live NSE market movers straight from NSE's own gainers/losers/volume-gainers "
        "API - real {symbol, changePercent, volume, avgVolume} rows, not search-engine links. Use "
        "this (not web_search) whenever asked for top gainers/losers/volume movers/most active "
        "stocks in the NSE market.", {"count": {"type": "integer", "description": "how many rows, default 25"}}),
    _fn("get_ema_crossover", "EMA crossover signal (golden/death cross) for a stock from stored history",
        {**_SYMBOL_PROP, "short": {"type": "integer"}, "long": {"type": "integer"}}, ["symbol"]),
    _fn("list_watchlists", "All watchlisted stocks and which named list each belongs to"),
    _fn("get_holdings", "The user's actual broker-synced portfolio: current positions with "
        "quantity, entry price, current price, and P&L, plus available account balance. Use "
        "this - not list_watchlists/scan_events - whenever asked to analyze/review 'my "
        "holdings', 'my portfolio', or 'what I own'; those other tools only cover watchlisted "
        "symbols being tracked for research, not stocks actually held."),
    _fn("scrape_url", "Fetches a web page (news article, blog post, press release) and returns "
        "its title and text for you to analyze in your reply. Call this whenever the user "
        "pastes/mentions a URL or @-tags one, or references 'this article'/'this link'. The "
        "content is used only for this reply - it is not saved anywhere.",
        {"url": {"type": "string", "description": "the URL to fetch"}}, ["url"]),
    _fn("list_chat_sessions", "Titles and dates of the user's past chat sessions (different "
        "conversations, shown in the History dropdown) - use this when asked what they've "
        "previously chatted about. This does NOT include this session's own messages, which "
        "are already in your conversation history above."),
    _fn("search_reports", "Search stored AI research reports semantically",
        {"query": {"type": "string"}}, ["query"]),
    _fn("scrape_stock", "Scrape news+financials for an NSE symbol and generate a fresh report. "
        "REQUIRES USER CONFIRMATION - does not run on the first call.", _SYMBOL_PROP, ["symbol"]),
    _fn("scan_events", "Scan watchlisted stocks for news/price/volume/corporate-action events (background).",
        _LIST_PROP),
    _fn("sync_prices", "Sync daily price history for watchlisted stocks (background).", _LIST_PROP),
    _fn("web_search", "Open-ended web search (DuckDuckGo) for anything not covered by the other "
        "tools - e.g. researching a stock's recent developments beyond its scraped news.",
        {"query": {"type": "string"}}, ["query"]),
    _fn("add_stock_event", "Records one real, dated event you found via web_search/scrape_stock "
        "research so it shows up on the Events page - only for events you've actually verified, "
        "never invented ones. Always pass the source url when you have one.",
        {**_SYMBOL_PROP, "headline": {"type": "string"}, "detail": {"type": "string"},
         "url": {"type": "string"}}, ["symbol", "headline"]),
    _fn("check_watch_rule", "Checks a user-defined watch rule (set up in Settings > Watch rules, "
        "not tied to any one stock) against live data and reports pass/fail per criterion - e.g. "
        "'is the buy dip rule met for MIDHANI'. Omit symbol to check it against every watchlisted "
        "stock instead (a screener - which ones currently meet it). Does not give advice, just "
        "reports whether the user's own criteria currently hold.",
        {"name": {"type": "string", "description": "the watch rule's name"},
         "symbol": {"type": "string", "description": "optional - omit to check the whole watchlist"}},
        ["name"]),
]

AGENT_SYSTEM = (
    "You are a research assistant for NSE India stocks with tools. Use tools to answer - never "
    "invent prices, tickers, or data. Use scrape_stock when asked about a specific stock's "
    "news/fundamentals, search_reports for stored research, get_price for quick quotes, "
    "get_movers for top gainers/losers/volume movers/most active NSE stocks - never use "
    "web_search for that, it only returns links and snippets, not the actual numbers. Whenever "
    "the user's message contains, pastes, or @-tags a URL, or refers to 'this article'/'this "
    "link', call scrape_url on it and analyze the returned content directly in your reply - "
    "don't just describe the link, and don't tell the user you can't access URLs. Use "
    "scan_events/sync_prices only when the user asks to scan, sync, or refresh the whole "
    "watchlist with the rule-based event pipeline. For open-ended research into one stock's "
    "recent developments, use web_search (and/or scrape_stock) yourself, then call "
    "add_stock_event for each real, dated event you find so it's recorded on the Events page - "
    "never call add_stock_event with something you haven't actually found via a tool. If the "
    "user asks whether it's a good time to buy/sell or wants a recommendation, you cannot give "
    "one - instead suggest check_watch_rule if they have a watch rule set up (Settings > Watch "
    "rules), which reports pass/fail against their own criteria without you making the call. "
    "scrape_stock adds a new stock and requires the user's explicit confirmation - it will NOT "
    "run on the first call; when a tool result says requires_confirmation, relay its message to "
    "the user verbatim-ish and stop, do not retry it in this turn. Every other tool "
    "(get_movers, scan_events, sync_prices, web_search, scrape_url, get_price, get_ema_crossover, "
    "list_watchlists, list_chat_sessions, search_reports, add_stock_event, check_watch_rule) runs "
    "freely - call them immediately, never ask the user for permission or say you're about to before calling one of "
    "these. A completed tool call's result is already in your conversation history on later "
    "turns - reuse it instead of re-calling the same tool for a follow-up question about the same "
    "data. Keep replies short and factual, use ₹ for currency, never $. No investment advice."
)
