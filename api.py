"""FastAPI server: serves stored reports and a RAG chatbot (AI SDK UI Message Stream protocol) to React."""
import json
import re
import threading
import uuid

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import db
import events
import llm
import prices
import scraper
import sentiment

app = FastAPI()
db.init_schema()


@app.on_event("startup")
def _startup():
    db.purge_old(days=14)
    llm.configure_litellm(db.get_litellm_base_url(), db.get_litellm_api_key())


# Populated by the background watchlist event scan (POST /api/events/scan) - polled by
# GET /api/events/status so the frontend can show scan progress. Manual trigger only; the old
# automatic movers scan on startup is gone (still runnable standalone via `python main.py`).
_event_scan_state = {"running": False, "done": 0, "total": 0}


def _run_event_scan(list_name):
    _event_scan_state.update(running=True, done=0, total=0)
    try:
        events.scan(list_name, on_progress=lambda d, t: _event_scan_state.update(done=d, total=t))
    except Exception:
        pass
    finally:
        _event_scan_state["running"] = False


@app.post("/api/events/scan")
def trigger_event_scan(list_name: str | None = None):
    if _event_scan_state["running"]:
        raise HTTPException(status_code=409, detail="An event scan is already running")
    threading.Thread(target=_run_event_scan, args=(list_name,), daemon=True).start()
    return {"ok": True}


@app.get("/api/events/status")
def event_scan_status():
    return _event_scan_state


@app.get("/api/events")
def events_feed(
    list_name: str | None = None, symbol: str | None = None,
    from_date: str | None = None, to_date: str | None = None, limit: int = 100,
):
    return db.list_events(list_name=list_name, symbol=symbol, from_date=from_date, to_date=to_date, limit=limit)


# Populated by the background price-history sync (POST /api/prices/sync) - same manual-trigger +
# progress-polling pattern as the event scan. Syncs symbols one by one (see prices.sync_all) and
# incrementally (see prices.sync_symbol) - a symbol only ever backfills its full 1y once.
_price_sync_state = {"running": False, "done": 0, "total": 0}


def _run_price_sync(symbols):
    _price_sync_state.update(running=True, done=0, total=0)
    try:
        prices.sync_all(symbols, on_progress=lambda d, t: _price_sync_state.update(done=d, total=t))
    except Exception:
        pass
    finally:
        _price_sync_state["running"] = False


@app.post("/api/prices/sync")
def trigger_price_sync(list_name: str | None = None):
    if _price_sync_state["running"]:
        raise HTTPException(status_code=409, detail="A price sync is already running")
    symbols = db.watchlist_symbols(list_name)
    threading.Thread(target=_run_price_sync, args=(symbols,), daemon=True).start()
    return {"ok": True, "symbols": len(symbols)}


@app.get("/api/prices/sync/status")
def price_sync_status():
    return _price_sync_state


@app.get("/api/prices/ema-crossover")
def ema_crossover_scan(list_name: str | None = None, short: int = 20, long: int = 50):
    """EMA crossover signal for every symbol with enough synced history - no live fetch, reads
    price_history only, so this is cheap even across 30-50+ watchlisted symbols. Declared before
    /api/prices/{symbol} so this literal path isn't shadowed by the parameterized route."""
    results = []
    for symbol in db.watchlist_symbols(list_name):
        signal = prices.ema_crossover(symbol, short, long)
        if signal:
            results.append({"symbol": symbol, **signal})
    return results


@app.get("/api/prices/{symbol}")
def price_history(symbol: str, days: int = 365):
    return db.list_price_history(symbol.upper(), days)


@app.get("/api/prices/{symbol}/ema-crossover")
def price_ema_crossover(symbol: str, short: int = 20, long: int = 50):
    signal = prices.ema_crossover(symbol.upper(), short, long)
    if signal is None:
        raise HTTPException(status_code=404, detail=f"Not enough synced history for '{symbol}' yet - run a price sync first")
    return signal


# Per-symbol max-history collection state, since (unlike the watchlist scans above) this can be
# triggered independently for any number of symbols at once from their own detail pages.
_max_collect_state = {}


def _run_max_collect(symbol):
    _max_collect_state[symbol] = {"running": True}
    try:
        prices.collect_max_history(symbol)
    except Exception as e:
        print(f"max history collection failed for {symbol}: {e}")
    finally:
        _max_collect_state[symbol] = {"running": False}


@app.post("/api/prices/{symbol}/max/collect")
def trigger_max_collect(symbol: str):
    symbol = symbol.upper()
    if _max_collect_state.get(symbol, {}).get("running"):
        raise HTTPException(status_code=409, detail=f"Already collecting max history for '{symbol}'")
    threading.Thread(target=_run_max_collect, args=(symbol,), daemon=True).start()
    return {"ok": True}


@app.get("/api/prices/{symbol}/max/status")
def max_collect_status(symbol: str):
    return _max_collect_state.get(symbol.upper(), {"running": False})


@app.get("/api/prices/{symbol}/max")
def max_history(symbol: str):
    """Full collected history, or an empty list if "Collect max history" was never triggered for
    this symbol - the frontend hides the max-history section entirely in that case."""
    return db.list_max_history(symbol.upper())


# Allows the app to be reached through a Cloudflare Quick Tunnel (random *.trycloudflare.com
# per run) in addition to local dev - matters if the frontend/API are ever hit cross-origin
# rather than through Vite's same-origin proxy.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://.*\.trycloudflare\.com",
    allow_methods=["*"],
    allow_headers=["*"],
)

# ponytail: matches any all-caps 2-15 letter word as a candidate NSE symbol (NSE symbols are
# always uppercase). No validation against a real symbol list - relies on the live scrape
# coming back empty for junk input. Swap for a real symbol-list lookup if false positives bite.
TICKER_PATTERN = re.compile(r"\b[A-Z]{2,15}\b")

HISTORY_COMMAND = re.compile(
    r"^/history\s+(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s*$", re.IGNORECASE
)
HISTORY_USAGE = "Usage: `/history SYMBOL YYYY-MM-DD YYYY-MM-DD` — e.g. `/history TCS 2026-01-01 2026-03-01`"

SENTIMENT_COMMAND = re.compile(r"^/sentiment\s+(\S+)\s*$", re.IGNORECASE)
SENTIMENT_USAGE = "Usage: `/sentiment URL` — e.g. `/sentiment https://example.com/some-news-article`"


class ChatRequest(BaseModel):
    sessionId: str
    messages: list[dict]
    model: str | None = None


class AddStockRequest(BaseModel):
    symbol: str


class ActiveModelRequest(BaseModel):
    model: str


class SentimentRequest(BaseModel):
    url: str
    model: str | None = None


class WatchlistRequest(BaseModel):
    list_name: str


class WatchlistListRequest(BaseModel):
    name: str


class RenameWatchlistRequest(BaseModel):
    new_name: str


class ReorderWatchlistsRequest(BaseModel):
    names: list[str]


class LiteLLMConfigRequest(BaseModel):
    base_url: str
    api_key: str | None = None  # None (omitted) leaves the previously-saved key untouched


def _text(message):
    return "".join(p.get("text", "") for p in message.get("parts", []) if p.get("type") == "text")


def _sse(obj):
    return f"data: {json.dumps(obj)}\n\n"


def _cached(symbol, kind, ttl_minutes, fetch):
    """Cache-aside for live scraper calls (price/quote/chart/financials) - fetches once, reused
    for ttl_minutes, busted wholesale by POST /api/cache/clear."""
    data = db.get_cached(symbol, kind, ttl_minutes)
    if data is not None:
        return data
    data = fetch()
    db.set_cached(symbol, kind, data)
    return data


@app.post("/api/cache/clear")
def clear_cache():
    db.clear_cache()
    return {"ok": True}


def _live_scrape(symbol, model):
    """Scrapes+analyzes a symbol on demand from the user's prompt and caches it like a normal
    scan. Reuses the existing report instead of re-scraping if one was made within the last 24h -
    matters a lot for chat, where the same ticker can be mentioned across many turns."""
    if db.has_recent_item(symbol):
        return db.latest_item_markdown(symbol)
    news = scraper.get_news(symbol)
    financials = scraper.get_financials(symbol)
    if not news and not financials.get("sector"):
        return None
    markdown = llm.build_markdown(symbol, financials, news, model=model)
    db.insert_scraped_item(symbol, markdown, llm.embed(markdown))
    return markdown


def _analyze_url(url, model):
    """Scrapes an arbitrary news/blog URL, finds which NSE stocks it's about, and scores its
    sentiment with the local FinRoBERTa model. Whole-article sentiment, not per-ticker - fine for
    single-company articles; multi-company articles with opposing sentiment need per-snippet
    scoring, which isn't implemented yet."""
    try:
        article = scraper.scrape_article(url)
    except requests.RequestException as e:
        raise RuntimeError(f"Couldn't fetch that URL: {e}") from e
    if not article["text"]:
        raise HTTPException(status_code=422, detail="Couldn't extract article text from that URL")
    tickers = llm.extract_tickers(article["text"], model)
    score = sentiment.analyze(article["text"])
    reasoning = llm.explain_sentiment(article["text"], score["label"], model)
    return {"title": article["title"], "url": url, "tickers": tickers, "sentiment": score, "reasoning": reasoning}


@app.post("/api/sentiment")
def analyze_sentiment(req: SentimentRequest):
    try:
        return _analyze_url(req.url, req.model or db.get_active_model())
    except RuntimeError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@app.get("/api/models")
def models():
    return llm.get_models()


@app.get("/api/settings/active-model")
def get_active_model():
    return {"model": db.get_active_model()}


@app.put("/api/settings/active-model")
def set_active_model(req: ActiveModelRequest):
    db.set_active_model(req.model)
    return {"model": req.model}


@app.get("/api/settings/litellm")
def get_litellm_config():
    # never echo the api key back - the UI shows "•••• saved" instead of the real value
    return {"base_url": db.get_litellm_base_url(), "has_api_key": bool(db.get_litellm_api_key())}


@app.put("/api/settings/litellm")
def set_litellm_config(req: LiteLLMConfigRequest):
    db.set_litellm_config(req.base_url.rstrip("/"), req.api_key or None)
    llm.configure_litellm(db.get_litellm_base_url(), db.get_litellm_api_key())
    return {"ok": True}


@app.post("/api/stocks")
def add_stock(req: AddStockRequest):
    """Manually add a stock by symbol and scrape it live, same path the chat uses on-demand."""
    symbol = req.symbol.strip().upper()
    markdown = _live_scrape(symbol, db.get_active_model())
    if markdown is None:
        raise HTTPException(status_code=404, detail=f"No data found for '{symbol}' on NSE")
    return {"symbol": symbol, "content_markdown": markdown}


@app.delete("/api/stocks/{symbol}")
def delete_stock(symbol: str):
    symbol = symbol.upper()
    db.delete_symbol(symbol)
    db.remove_from_watchlist(symbol)
    return {"ok": True}


@app.get("/api/watchlist")
def watchlist():
    return db.list_watchlist()


@app.put("/api/watchlist/{symbol}")
def set_watchlist(symbol: str, req: WatchlistRequest):
    name = req.list_name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="list_name can't be empty")
    db.set_watchlist(symbol.upper(), name)
    return {"ok": True}


@app.delete("/api/watchlist/{symbol}")
def remove_watchlist(symbol: str):
    db.remove_from_watchlist(symbol.upper())
    return {"ok": True}


@app.get("/api/watchlists")
def watchlist_names():
    return db.list_watchlist_names()


@app.post("/api/watchlists")
def create_watchlist_list(req: WatchlistListRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name can't be empty")
    db.create_watchlist(name)
    return {"ok": True}


@app.post("/api/watchlists/reorder")
def reorder_watchlist_list(req: ReorderWatchlistsRequest):
    db.reorder_watchlists(req.names)
    return {"ok": True}


@app.put("/api/watchlists/{name}")
def rename_watchlist_list(name: str, req: RenameWatchlistRequest):
    new_name = req.new_name.strip()
    if not new_name:
        raise HTTPException(status_code=422, detail="new_name can't be empty")
    db.rename_watchlist(name, new_name)
    return {"ok": True}


@app.delete("/api/watchlists/{name}")
def delete_watchlist_list(name: str):
    if db.watchlist_symbols(name):
        raise HTTPException(status_code=400, detail=f"'{name}' still has stocks in it - move or remove them first")
    db.delete_watchlist(name)
    return {"ok": True}


@app.get("/api/stocks")
def stocks():
    """Tracked symbols with a price cached for 15min - was N live yahoo calls on every poll."""
    rows = db.list_symbols()
    for row in rows:
        try:
            row.update(_cached(row["symbol"], "price", 15, lambda s=row["symbol"]: scraper.get_price(s)))
        except Exception:
            row.update({"price": None, "changePercent": None})
    return rows


@app.get("/api/indices")
def indices():
    """NIFTY 50 + SENSEX, same cache-aside pattern as /api/stocks."""
    result = []
    for name in scraper.INDEX_SYMBOLS:
        try:
            quote = _cached(name, "index-price", 15, lambda n=name: scraper.get_index_price(n))
        except Exception:
            quote = {"price": None, "changePercent": None}
        result.append({"name": name, **quote})
    return result


@app.get("/api/indices/{name}/chart")
def index_chart(name: str, range: str = "1mo"):
    if name not in scraper.INDEX_SYMBOLS:
        raise HTTPException(status_code=404, detail=f"Unknown index '{name}'")
    if range not in scraper.CHART_RANGES:
        raise HTTPException(status_code=400, detail=f"range must be one of {list(scraper.CHART_RANGES)}")
    return _cached(name, f"index-chart:{range}", 15, lambda: scraper.get_index_chart(name, range))


def _cached_news(symbol):
    """Serves news from Postgres if scraped within the last day, otherwise re-scrapes and refreshes it."""
    cached = db.get_cached_news(symbol)
    if cached is not None:
        return cached
    try:
        fresh = scraper.get_news(symbol)
    except Exception:
        fresh = []
    for item in fresh:
        try:
            score = sentiment.analyze(f"{item['title']}. {item['summary']}")
            item["sentiment_label"], item["sentiment_score"] = score["label"], score["score"]
        except Exception:
            pass
    db.save_news(symbol, fresh)
    return fresh


@app.get("/api/stocks/{symbol}")
def stock_detail(symbol: str):
    try:
        quote = _cached(symbol, "quote", 15, lambda: scraper.get_quote(symbol))
    except Exception:
        quote = {}
    return {"quote": quote, "news": _cached_news(symbol), "reports": db.list_items_for_symbol(symbol)}


@app.get("/api/stocks/{symbol}/financials")
def stock_financials(symbol: str):
    symbol = symbol.upper()
    statements = _cached(symbol, "financials", 60 * 24, lambda: scraper.get_financial_statements(symbol))
    if statements is None:
        raise HTTPException(status_code=404, detail=f"No financial statements found for '{symbol}'")
    return statements


@app.get("/api/stocks/{symbol}/chart")
def stock_chart(symbol: str, range: str = "1mo"):
    if range not in scraper.CHART_RANGES:
        raise HTTPException(status_code=400, detail=f"range must be one of {list(scraper.CHART_RANGES)}")
    symbol = symbol.upper()
    from_db = prices.chart_from_history(symbol, range)
    if from_db is not None:
        return from_db
    return _cached(symbol, f"chart:{range}", 15, lambda: scraper.get_chart(symbol, range))


@app.get("/api/reports")
def reports(limit: int = 20):
    return db.list_recent_items(limit)


@app.delete("/api/reports/{item_id}")
def delete_report(item_id: int):
    db.delete_item(item_id)
    return {"ok": True}


@app.get("/api/chat/sessions")
def sessions():
    return db.list_sessions()

@app.delete("/api/chat/sessions/{session_id}")
def delete_session(session_id: str):
    db.delete_session(session_id)
    return {"ok": True}



@app.get("/api/chat/sessions/{session_id}/messages")
def messages(session_id: str):
    return [
        {"id": str(uuid.uuid4()), "role": m["role"], "parts": [{"type": "text", "text": m["content"]}]}
        for m in db.list_messages(session_id)
    ]


def _history_reply(user_text, model):
    """Handles the /history SYMBOL FROM TO slash command. Returns a reply string, or None if not that command."""
    if not user_text.strip().lower().startswith("/history"):
        return None
    match = HISTORY_COMMAND.match(user_text.strip())
    if not match:
        return HISTORY_USAGE
    symbol, start, end = match.group(1).upper(), match.group(2), match.group(3)
    history = scraper.get_history(symbol, start, end)
    if history is None:
        return f"No price data found for '{symbol}' between {start} and {end}."
    markdown = llm.build_history_markdown(symbol, history, model=model)
    db.insert_scraped_item(symbol, markdown, llm.embed(markdown))
    return markdown


def _sentiment_reply(user_text, model):
    """Handles the /sentiment URL slash command. Returns a reply string, or None if not that command."""
    if not user_text.strip().lower().startswith("/sentiment"):
        return None
    match = SENTIMENT_COMMAND.match(user_text.strip())
    if not match:
        return SENTIMENT_USAGE
    result = _analyze_url(match.group(1), model)
    if not result["tickers"]:
        tickers_line = "No NSE-listed tickers identified in this article."
    else:
        tickers_line = "\n".join(f"- **{t}**" for t in result["tickers"])
    return (
        f"**{result['title']}**\n\n"
        f"Sentiment: **{result['sentiment']['label']}** ({result['sentiment']['score']:.0%} confidence)\n\n"
        f"{result['reasoning']}\n\n"
        f"Related NSE stocks:\n{tickers_line}"
    )


# --- Chat agent (Ollama-native tool calling, no LangChain) ---------------------------------
# Read-only tools return data directly; the two scan tools start the same background threads
# the UI buttons use and return immediately - the agent must never block a chat reply on a
# multi-minute scan.

def _tool_get_price(symbol):
    return _cached(symbol.upper(), "price", 15, lambda: scraper.get_price(symbol.upper()))


def _tool_ema_crossover(symbol, short=20, long=50):
    signal = prices.ema_crossover(symbol.upper(), int(short), int(long))
    return signal or "no synced price history for this symbol - run a price sync first"


def _tool_list_watchlists():
    return db.list_watchlist()


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


# Tools that cost real time/bandwidth (a live scrape, a background scan/sync over the whole
# watchlist) never run automatically just because the model decided to call them - they're
# gated behind an explicit /confirm command the user has to type themselves. Read-only lookups
# (price, EMA, watchlist listing, stored-report search) run freely.
CONFIRM_TOOLS = {"scrape_stock", "scan_events", "sync_prices"}

REAL_TOOL_IMPLS = {
    "get_price": _tool_get_price,
    "get_ema_crossover": _tool_ema_crossover,
    "list_watchlists": _tool_list_watchlists,
    "search_reports": _tool_search_reports,
    "scrape_stock": _tool_scrape_stock,
    "scan_events": _tool_scan_events,
    "sync_prices": _tool_sync_prices,
}


def _guarded(name, fn):
    if name not in CONFIRM_TOOLS:
        return fn

    def wrapped(**kwargs):
        args_str = " ".join(f"{k}={v}" for k, v in kwargs.items())
        return {
            "requires_confirmation": True,
            "tool": name,
            "message": (
                f"This action ({name}) was NOT run - it costs real time/bandwidth, so it needs "
                f"the user's explicit confirmation. Tell the user exactly what you'd like to do "
                f"and that they can type `/confirm {name}{' ' + args_str if args_str else ''}` "
                "to proceed. Do not call this tool again in this turn."
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
    _fn("get_ema_crossover", "EMA crossover signal (golden/death cross) for a stock from stored history",
        {**_SYMBOL_PROP, "short": {"type": "integer"}, "long": {"type": "integer"}}, ["symbol"]),
    _fn("list_watchlists", "All watchlisted stocks and which named list each belongs to"),
    _fn("search_reports", "Search stored AI research reports semantically",
        {"query": {"type": "string"}}, ["query"]),
    _fn("scrape_stock", "Scrape news+financials for an NSE symbol and generate a fresh report. "
        "REQUIRES USER CONFIRMATION - does not run on the first call.", _SYMBOL_PROP, ["symbol"]),
    _fn("scan_events", "Scan watchlisted stocks for news/price/volume/corporate-action events (background). "
        "REQUIRES USER CONFIRMATION - does not run on the first call.", _LIST_PROP),
    _fn("sync_prices", "Sync daily price history for watchlisted stocks (background). "
        "REQUIRES USER CONFIRMATION - does not run on the first call.", _LIST_PROP),
]

AGENT_SYSTEM = (
    "You are a research assistant for NSE India stocks with tools. Use tools to answer - never "
    "invent prices, tickers, or data. Use scrape_stock when asked about a specific stock's "
    "news/fundamentals, search_reports for stored research, get_price for quick quotes. Use "
    "scan_events/sync_prices only when the user asks to scan, sync, or refresh. scrape_stock, "
    "scan_events, and sync_prices require the user's explicit confirmation and will NOT run on "
    "the first call - when a tool result says requires_confirmation, relay its message to the "
    "user verbatim-ish and stop; do not retry the same tool in this turn. Keep replies short "
    "and factual, use ₹ for currency, never $. No investment advice."
)

CONFIRM_COMMAND = re.compile(r"^/confirm\s+(\w+)(?:\s+(.*))?$", re.IGNORECASE)
CONFIRM_USAGE = "Usage: `/confirm <tool> [args]` - e.g. `/confirm scan_events` or `/confirm scrape_stock symbol=TCS`"


def _confirm_reply(user_text):
    """Handles the /confirm <tool> [key=value ...] slash command - the human-in-the-loop gate
    for CONFIRM_TOOLS. Runs the REAL tool implementation directly (bypassing the guard the agent
    itself is subject to), so a tool only ever executes here or via the read-only agent path."""
    if not user_text.strip().lower().startswith("/confirm"):
        return None
    match = CONFIRM_COMMAND.match(user_text.strip())
    if not match:
        return CONFIRM_USAGE
    name, arg_str = match.group(1), (match.group(2) or "").strip()
    if name not in CONFIRM_TOOLS:
        return f"'{name}' doesn't require confirmation (or isn't a tool) - nothing to do."
    kwargs = {}
    for part in arg_str.split():
        if "=" in part:
            k, v = part.split("=", 1)
            kwargs[k] = v
    try:
        result = REAL_TOOL_IMPLS[name](**kwargs)
    except Exception as e:
        return f"⚠️ `{name}` failed: {e}"
    return f"✅ Ran `{name}`:\n\n{result if isinstance(result, str) else json.dumps(result, default=str, ensure_ascii=False)}"


@app.post("/api/chat")
def post_chat(req: ChatRequest):
    is_new = len(req.messages) == 1
    db.ensure_session(req.sessionId)
    if req.model:
        db.set_session_model(req.sessionId, req.model)
    model = db.get_session_model(req.sessionId) or db.get_active_model()

    user_text = _text(req.messages[-1])

    use_agent = False
    try:
        reply = _confirm_reply(user_text)
        if reply is None:
            reply = _sentiment_reply(user_text, model)
        if reply is None:
            reply = _history_reply(user_text, model)
        if reply is None and (model.startswith("ollama/") or model.startswith("litellm/")):
            # local llama or a LiteLLM-routed model: tool-calling agent. Deferred into stream()
            # below so each tool call can be pushed to the UI as it happens, instead of a long
            # silent wait. OmniRoute keeps the original RAG path below (tool support varies
            # across its many upstream providers).
            use_agent = True
        if reply is None and not use_agent:
            # OmniRoute models: original RAG path (tool schema support varies per provider)
            live_reports = list(filter(None, (
                _live_scrape(symbol, model) for symbol in dict.fromkeys(TICKER_PATTERN.findall(user_text))
            )))

            query_embedding = llm.embed(user_text)
            matches = db.similarity_search(query_embedding, limit=5)
            stored = [m["content_markdown"] for m in matches if m["content_markdown"] not in live_reports]
            context = "\n\n---\n\n".join(live_reports + stored) or None

            history = [{"role": m["role"], "content": _text(m)} for m in req.messages]
            reply = llm.chat(history, context, model=model)
    except RuntimeError as e:
        # model-call failure (OmniRoute down / upstream exhausted) - show it in the chat, not a 500
        reply = f"⚠️ {e}"

    db.add_message(req.sessionId, "user", user_text)
    if not use_agent:
        db.add_message(req.sessionId, "assistant", reply)

    def stream():
        yield _sse({"type": "start", "messageId": str(uuid.uuid4())})

        final_reply = reply
        if use_agent:
            history = [{"role": m["role"], "content": _text(m)} for m in req.messages]
            messages = [{"role": "system", "content": AGENT_SYSTEM}] + history
            try:
                for event in llm.run_agent_stream(messages, AGENT_TOOLS, AGENT_TOOL_IMPLS, model):
                    if event[0] == "tool":
                        _, call_id, name, args = event
                        yield _sse({"type": "tool-input-available", "toolCallId": call_id,
                                    "toolName": name, "input": args})
                    elif event[0] == "tool_result":
                        _, call_id, result = event
                        yield _sse({"type": "tool-output-available", "toolCallId": call_id,
                                    "output": result})
                    else:
                        final_reply = event[1]
            except RuntimeError as e:
                final_reply = f"⚠️ {e}"
            db.add_message(req.sessionId, "assistant", final_reply)

        text_id = str(uuid.uuid4())
        yield _sse({"type": "text-start", "id": text_id})
        yield _sse({"type": "text-delta", "id": text_id, "delta": final_reply})
        yield _sse({"type": "text-end", "id": text_id})
        if is_new:
            try:
                title = llm.auto_title(user_text, model=model)
            except RuntimeError:
                title = user_text[:40]
            db.set_session_title(req.sessionId, title)
            yield _sse({"type": "data-title", "data": {"title": title}})
        yield _sse({"type": "finish"})
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        stream(), media_type="text/event-stream", headers={"x-vercel-ai-ui-message-stream": "v1"}
    )
