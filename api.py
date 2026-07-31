"""FastAPI server: serves stored reports and a RAG chatbot (AI SDK UI Message Stream protocol) to React."""
import asyncio
import base64
import csv
import io
import json
import os
import re
import threading
import time
import uuid
from datetime import date, datetime, timedelta, timezone

import requests
from fastapi import FastAPI, File, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import backtest
import broker
import db
import events
import kite
import llm
import price_sources
import prices
import rules
import scraper
import sentiment
import stocks_master

app = FastAPI()
db.init_schema()

# Manual-trade screenshot uploads - local disk only, matches the app's "nothing leaves your
# machine" design. Served straight back out at /uploads/<filename>.
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.on_event("startup")
def _startup():
    db.purge_old(days=14)
    llm.configure_litellm(db.get_litellm_base_url(), db.get_litellm_api_key())
    threading.Thread(target=_auto_event_scan_loop, daemon=True).start()


# Populated by the background watchlist event scan (POST /api/events/scan, or the daily automatic
# one below) - polled by GET /api/events/status so the frontend can show scan progress.
_event_scan_state = {"running": False, "done": 0, "total": 0}


def _run_event_scan(list_name):
    _event_scan_state.update(running=True, done=0, total=0)
    try:
        events.scan(list_name, on_progress=lambda d, t: _event_scan_state.update(done=d, total=t))
    except Exception:
        pass
    finally:
        _event_scan_state["running"] = False


# Runs the full-watchlist event scan once per NSE trading day (Asia/Kolkata calendar date), with
# no human trigger needed. Checked hourly rather than scheduled for a fixed time - cheap, and
# means a server that was down at the target time still catches up within the hour of coming
# back up. The last-run date is persisted (db.get/set_last_event_scan_date) so a same-day restart
# doesn't fire it twice.
def _auto_event_scan_loop():
    from zoneinfo import ZoneInfo
    ist = ZoneInfo("Asia/Kolkata")
    while True:
        today = datetime.now(ist).date().isoformat()
        if events.should_auto_scan(db.get_last_event_scan_date(), today) and not _event_scan_state["running"]:
            db.set_last_event_scan_date(today)
            _run_event_scan(None)
        time.sleep(3600)


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


@app.get("/api/events/attention")
def events_attention(
    list_name: str | None = None, symbol: str | None = None,
    baseline_days: int = 30, recent_days: int = 3,
):
    """Per-symbol event-coverage volume vs. that symbol's own baseline - see db.attention_scores.
    Powers the Events page's "Unusual attention" panel: which watchlisted stocks are getting more
    coverage than usual right now, not just what the latest single headline says."""
    return db.attention_scores(
        list_name=list_name, symbol=symbol, baseline_days=baseline_days, recent_days=recent_days
    )


# Cogencis's general news feed is refetched wholesale (not per-symbol) at most once a day - a
# lock keeps concurrent requests from re-triggering the paginated scrape at the same time.
_top_news_lock = threading.Lock()


def _isins_in(text):
    """Extracts ISIN codes from Cogencis's 'isins' field, e.g. "INE099Z01011 MISHDHAT.BS
    MISHDHAT.NS, INE258A01016 BEML.BS BEML.NS" -> {"INE099Z01011", "INE258A01016"}."""
    return {group.strip().split()[0] for group in (text or "").split(",") if group.strip()}


def _cached_isin(symbol):
    """ISIN never changes for a listed security, so this is a permanent cache - only ever one
    live yfinance call per symbol, ever."""
    isin = db.get_isin_cache(symbol)
    if isin:
        return isin
    try:
        isin = scraper.get_isin(symbol)
    except Exception:
        isin = None
    if isin:
        db.set_isin_cache(symbol, isin)
    return isin


@app.get("/api/top-news")
def top_news(force: bool = False):
    """Cogencis's general "what's moving" feed (not scoped to one stock), cached wholesale for
    24h (force=true bypasses the cache and re-scrapes, for a manual Reload button). On a cold
    cache, paginates 5 pages of 20 (latest 100 stories) with a 2s gap between requests. Each story
    comes back tagged with which of your watchlisted stocks it affects, matched by ISIN -
    recomputed fresh every call so watchlist changes show up immediately even against cached
    stories."""
    with _top_news_lock:
        cached = None if force else db.get_cached_top_news()
        if cached is None:
            token = db.get_cogencis_token()
            if not token:
                raise HTTPException(status_code=400,
                                     detail="Cogencis isn't configured - add a token in Settings > Cogencis")
            items = []
            for page in range(1, 6):
                items += scraper.get_cogencis_top_news(token, page_no=page, page_size=20)
                if page < 5:
                    time.sleep(2)
            db.save_top_news(items)
            cached = db.get_cached_top_news()

    symbol_by_isin = {}
    for symbol in db.watchlist_symbols():
        isin = _cached_isin(symbol)
        if isin:
            symbol_by_isin[isin] = symbol

    return [
        {**item, "affected_symbols": sorted(
            symbol_by_isin[i] for i in _isins_in(item["isins"]) if i in symbol_by_isin
        )}
        for item in cached
    ]


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


@app.get("/api/prices/sources")
def price_sources_list():
    """Available "Collect max history" plugins (see price_sources/) - the frontend populates its
    source selector from this instead of hardcoding names, so adding a new plugin needs no
    frontend change either. Declared before /api/prices/{symbol} so this literal path isn't
    shadowed by the parameterized route (same reasoning as ema_crossover_scan above)."""
    return {"sources": list(price_sources.SOURCES), "default": price_sources.DEFAULT_SOURCE}


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
# triggered independently for any number of symbols at once from their own detail pages. `error`
# surfaces a failed source/symbol to the UI instead of just logging it - the whole point of the
# price_sources plugin split is that one source failing is visible and isolated, not silent.
_max_collect_state = {}


def _run_max_collect(symbol, source):
    _max_collect_state[symbol] = {"running": True, "error": None}
    try:
        prices.collect_max_history(symbol, source)
        _max_collect_state[symbol] = {"running": False, "error": None}
    except (price_sources.SourceError, ValueError) as e:
        _max_collect_state[symbol] = {"running": False, "error": str(e)}
    except Exception as e:
        _max_collect_state[symbol] = {"running": False, "error": f"unexpected error: {e}"}


@app.post("/api/prices/{symbol}/max/collect")
def trigger_max_collect(symbol: str, source: str = price_sources.DEFAULT_SOURCE):
    symbol = symbol.upper()
    if source not in price_sources.SOURCES:
        raise HTTPException(status_code=422, detail=f"unknown price source '{source}'")
    if _max_collect_state.get(symbol, {}).get("running"):
        raise HTTPException(status_code=409, detail=f"Already collecting max history for '{symbol}'")
    threading.Thread(target=_run_max_collect, args=(symbol, source), daemon=True).start()
    return {"ok": True}


@app.get("/api/prices/{symbol}/max/status")
def max_collect_status(symbol: str):
    return _max_collect_state.get(symbol.upper(), {"running": False, "error": None})


# Multi-symbol collection, one at a time with a minimum gap between requests (same "sequential,
# not concurrent" spirit as sync_all's watchlist scan) - a single shared state dict since only
# one bulk run makes sense at a time, unlike the per-symbol state above.
BULK_COLLECT_INTERVAL_SECONDS = 5

_bulk_collect_state = {"running": False, "done": 0, "total": 0, "current_symbol": None, "results": []}


def _run_bulk_collect(symbols, source):
    _bulk_collect_state.update(running=True, done=0, total=len(symbols), current_symbol=None, results=[])
    for i, symbol in enumerate(symbols):
        _bulk_collect_state["current_symbol"] = symbol
        try:
            prices.collect_max_history(symbol, source)
            _bulk_collect_state["results"].append({"symbol": symbol, "ok": True, "error": None})
        except (price_sources.SourceError, ValueError) as e:
            # Caught per-symbol, not around the whole loop - one bad symbol/source failure never
            # stops the rest of the batch from running.
            _bulk_collect_state["results"].append({"symbol": symbol, "ok": False, "error": str(e)})
        except Exception as e:
            _bulk_collect_state["results"].append({"symbol": symbol, "ok": False, "error": f"unexpected error: {e}"})
        _bulk_collect_state["done"] = i + 1
        if i < len(symbols) - 1:
            time.sleep(BULK_COLLECT_INTERVAL_SECONDS)
    _bulk_collect_state["running"] = False
    _bulk_collect_state["current_symbol"] = None


@app.post("/api/prices/max/collect-bulk")
def trigger_bulk_max_collect(req: BulkMaxCollectRequest):
    if req.source not in price_sources.SOURCES:
        raise HTTPException(status_code=422, detail=f"unknown price source '{req.source}'")
    if _bulk_collect_state["running"]:
        raise HTTPException(status_code=409, detail="A bulk collection is already running")
    symbols = [s.strip().upper() for s in req.symbols if s.strip()]
    if not symbols:
        raise HTTPException(status_code=422, detail="symbols can't be empty")
    threading.Thread(target=_run_bulk_collect, args=(symbols, req.source), daemon=True).start()
    return {"ok": True, "total": len(symbols)}


@app.get("/api/prices/max/collect-bulk/status")
def bulk_max_collect_status():
    return _bulk_collect_state


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

RULE_COMMAND = re.compile(r"^/rule\s+(.+)$", re.IGNORECASE)
RULE_USAGE = ("Usage: `/rule RULE_NAME [SYMBOL]` — e.g. `/rule buy dip` checks it against your whole "
              "watchlist, `/rule buy dip MIDHANI` checks just MIDHANI (set up rules in Settings > Watch rules)")


class ChatRequest(BaseModel):
    sessionId: str
    messages: list[dict]
    model: str | None = None


class AddStockRequest(BaseModel):
    symbol: str


class ScrapeRequest(BaseModel):
    url: str


class ActiveModelRequest(BaseModel):
    model: str


class SentimentRequest(BaseModel):
    url: str


class BulkMaxCollectRequest(BaseModel):
    symbols: list[str]
    source: str = price_sources.DEFAULT_SOURCE
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


class CogencisConfigRequest(BaseModel):
    token: str


class WatchRuleRequest(BaseModel):
    name: str
    text: str


class ActiveBrokerRequest(BaseModel):
    broker: str


class DhanConfigRequest(BaseModel):
    client_id: str
    access_token: str


class KiteConfigRequest(BaseModel):
    api_key: str
    api_secret: str


class BacktestRunRequest(BaseModel):
    symbol: str
    short: int = 20
    long: int = 50
    from_date: str | None = None
    to_date: str | None = None


class BacktestSaveRequest(BacktestRunRequest):
    lessons: str | None = None


class BacktestLessonsRequest(BaseModel):
    lessons: str


class AutoBacktestScriptRequest(BaseModel):
    name: str
    script: str


class ManualTradeRequest(BaseModel):
    symbol: str
    direction: str  # "long" | "short"
    quantity: float
    entry_price: float
    exit_price: float | None = None
    stop_loss: float | None = None
    target: float | None = None
    is_open: bool = False
    result: str | None = None  # "profit" | "loss" | "neutral"
    emotion: str | None = None
    tags: list[str] = []
    notes: str | None = None
    traded_at: str | None = None  # ISO datetime; omitted -> now()
    image_filename: str | None = None  # already-uploaded file (e.g. from the Bulk Trades import)
    setup: str | None = None  # freeform strategy/setup label, e.g. "Breakout" - see manual-backtesting plan
    ideal_risk_amount: float | None = None  # planned risk in rupees, for Expected-R / risk-deviation


class ManualBacktestSettingsRequest(BaseModel):
    setups: list[str] = []
    risk_deviation_tolerance_pct: float = 10
    opening_balance: float = 0


class BalanceAdjustmentRequest(BaseModel):
    amount: float
    type: str  # "add" | "subtract"
    reason: str | None = None
    notes: str | None = None
    adjusted_at: str | None = None  # ISO datetime; omitted -> now()


class ActivityPingRequest(BaseModel):
    kind: str  # "analyze" | "review"


class ActivitySettingsRequest(BaseModel):
    qualifiers: dict[str, bool]
    daily_goal_minutes: int


@app.get("/api/watch-rules")
def watch_rules():
    return db.list_watch_rules()


@app.post("/api/watch-rules")
def create_watch_rule(req: WatchRuleRequest):
    name = req.name.strip()
    text = req.text.strip()
    if not name or not text:
        raise HTTPException(status_code=422, detail="name and rule text can't be empty")
    criteria = llm.parse_watch_rule(text, db.get_active_model())
    if not criteria:
        raise HTTPException(status_code=422, detail="couldn't recognize any criteria in that rule - "
                             "try mentioning P/E, an EMA crossover, or recent negative events")
    db.create_watch_rule(name, text, criteria.get("max_pe"), criteria.get("ema_short"),
                          criteria.get("ema_long"), criteria.get("no_negative_events_days"))
    return {"ok": True, "criteria": criteria}


@app.delete("/api/watch-rules/{rule_id}")
def delete_watch_rule(rule_id: int):
    db.delete_watch_rule(rule_id)
    return {"ok": True}


@app.get("/api/watch-rules/{rule_id}/check")
def check_watch_rule(rule_id: int, symbol: str | None = None):
    """A rule isn't tied to one stock - checks it against `symbol` if given, else against every
    watchlisted stock (a screener: which stocks currently meet this rule)."""
    rule = db.get_watch_rule_by_id(rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="watch rule not found")
    if symbol:
        return {"symbol": symbol.upper(), **rules.evaluate(rule, symbol.upper())}
    return [{"symbol": s, **rules.evaluate(rule, s)} for s in db.watchlist_symbols()]


def _run_backtest(req):
    if req.short >= req.long:
        raise HTTPException(status_code=422, detail="Short period must be less than the long period")
    result = backtest.run_ema_crossover(req.symbol.upper(), req.short, req.long, req.from_date, req.to_date)
    if result is None:
        raise HTTPException(status_code=404,
                             detail=f"Not enough synced price history for '{req.symbol}' yet - run a price sync first")
    return result


@app.post("/api/backtest/run")
def backtest_run(req: BacktestRunRequest):
    """Runs a backtest without saving it - the interactive preview before deciding to keep it."""
    return _run_backtest(req)


@app.get("/api/backtests")
def backtests(symbol: str | None = None):
    return db.list_backtests(symbol.upper() if symbol else None)


@app.post("/api/backtest")
def backtest_save(req: BacktestSaveRequest):
    """Re-runs the backtest and persists it (with an optional lessons-learned note) - a
    separate call from /api/backtest/run so previewing a backtest never writes a row by itself."""
    result = _run_backtest(req)
    symbol = req.symbol.upper()
    backtest_id = db.create_backtest(
        symbol, req.short, req.long, req.from_date, req.to_date,
        result["summary"]["total_return_pct"], result["summary"]["win_rate"],
        result["summary"]["num_trades"], result["trades"], req.lessons,
    )
    return {"id": backtest_id, "symbol": symbol, **result}


@app.put("/api/backtest/{backtest_id}/lessons")
def backtest_update_lessons(backtest_id: int, req: BacktestLessonsRequest):
    db.update_backtest_lessons(backtest_id, req.lessons)
    return {"ok": True}


@app.delete("/api/backtest/{backtest_id}")
def backtest_delete(backtest_id: int):
    db.delete_backtest(backtest_id)
    return {"ok": True}


# Auto backtest Pine Script templates - execution is client-side (PineTS in the browser, against
# /api/prices/{symbol}), so this is plain CRUD over the saved script text, nothing to run here.
@app.get("/api/backtest/auto/scripts")
def auto_backtest_scripts():
    return db.list_auto_backtest_scripts()


@app.post("/api/backtest/auto/scripts")
def create_auto_backtest_script(req: AutoBacktestScriptRequest):
    if not req.name.strip() or not req.script.strip():
        raise HTTPException(status_code=422, detail="name and script can't be empty")
    return {"id": db.create_auto_backtest_script(req.name.strip(), req.script)}


@app.get("/api/backtest/auto/scripts/{script_id}")
def get_auto_backtest_script(script_id: int):
    script = db.get_auto_backtest_script(script_id)
    if script is None:
        raise HTTPException(status_code=404, detail="script not found")
    return script


@app.put("/api/backtest/auto/scripts/{script_id}")
def update_auto_backtest_script(script_id: int, req: AutoBacktestScriptRequest):
    if not req.name.strip() or not req.script.strip():
        raise HTTPException(status_code=422, detail="name and script can't be empty")
    db.update_auto_backtest_script(script_id, req.name.strip(), req.script)
    return {"ok": True}


@app.delete("/api/backtest/auto/scripts/{script_id}")
def delete_auto_backtest_script(script_id: int):
    db.delete_auto_backtest_script(script_id)
    return {"ok": True}


DIRECTIONS = {"long", "short"}
RESULTS = {"profit", "loss", "neutral"}


def _validate_manual_trade(req):
    if req.direction not in DIRECTIONS:
        raise HTTPException(status_code=422, detail="direction must be 'long' or 'short'")
    if req.result is not None and req.result not in RESULTS:
        raise HTTPException(status_code=422, detail="result must be 'profit', 'loss', or 'neutral'")


@app.get("/api/manual-trades")
def manual_trades(request: Request):
    trades = db.list_manual_trades()
    for t in trades:
        # Full URL (not just the bare filename) so the frontend never has to know or guess the
        # /uploads mount path itself - one source of truth, here, for where images actually live.
        t["image_url"] = f"{request.base_url}uploads/{t['image_filename']}" if t["image_filename"] else None
    return trades


@app.post("/api/manual-trades")
def create_manual_trade(req: ManualTradeRequest):
    _validate_manual_trade(req)
    trade_id = db.create_manual_trade(
        req.symbol.strip().upper(), req.direction, req.quantity, req.entry_price, req.exit_price,
        req.stop_loss, req.target, req.is_open, req.result, req.emotion, req.tags, req.notes,
        req.traded_at, req.image_filename, req.setup, req.ideal_risk_amount,
    )
    return {"id": trade_id}


@app.put("/api/manual-trades/{trade_id}")
def update_manual_trade(trade_id: int, req: ManualTradeRequest):
    _validate_manual_trade(req)
    db.update_manual_trade(
        trade_id, req.symbol.strip().upper(), req.direction, req.quantity, req.entry_price,
        req.exit_price, req.stop_loss, req.target, req.is_open, req.result, req.emotion, req.tags,
        req.notes, req.traded_at, req.setup, req.ideal_risk_amount,
    )
    return {"ok": True}


@app.delete("/api/manual-trades/{trade_id}")
def delete_manual_trade(trade_id: int):
    db.delete_manual_trade(trade_id)
    return {"ok": True}


ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


@app.post("/api/manual-trades/{trade_id}/image")
async def upload_manual_trade_image(trade_id: int, file: UploadFile = File(...)):
    # ponytail: re-uploading (editing a trade's screenshot) orphans the old file on disk instead
    # of deleting it - add cleanup if upload volume ever makes that worth doing.
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=422, detail="unsupported image type - use PNG, JPEG, WEBP, or GIF")
    ext = os.path.splitext(file.filename or "")[1]
    filename = f"{trade_id}-{uuid.uuid4().hex}{ext}"
    with open(os.path.join(UPLOAD_DIR, filename), "wb") as f:
        f.write(await file.read())
    db.update_manual_trade_image(trade_id, filename)
    return {"filename": filename}


@app.post("/api/manual-trades/bulk/analyze")
async def analyze_bulk_trade_image(file: UploadFile = File(...), model: str | None = None):
    """One chart screenshot -> extracted trade fields, for the Bulk Trades import. The frontend
    fires one of these per selected image (not sequentially), so analysis across a batch happens
    in parallel. The image is saved to disk immediately - not gated on the user actually
    confirming the extracted fields - so it isn't re-uploaded when the trade is created.
    ponytail: a cancelled/abandoned bulk import orphans these files on disk, same tradeoff as the
    single re-upload path above."""
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=422, detail="unsupported image type - use PNG, JPEG, WEBP, or GIF")
    raw = await file.read()
    ext = os.path.splitext(file.filename or "")[1]
    filename = f"bulk-{uuid.uuid4().hex}{ext}"
    with open(os.path.join(UPLOAD_DIR, filename), "wb") as f:
        f.write(raw)
    try:
        fields = llm.analyze_trade_screenshot(
            base64.b64encode(raw).decode(), file.content_type, model or db.get_active_model()
        )
    except RuntimeError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return {"filename": filename, **fields}


@app.get("/api/settings/manual-backtest")
def get_manual_backtest_settings():
    return db.get_manual_backtest_settings()


@app.put("/api/settings/manual-backtest")
def set_manual_backtest_settings(req: ManualBacktestSettingsRequest):
    settings = {
        "setups": [s.strip() for s in req.setups if s.strip()],
        "risk_deviation_tolerance_pct": req.risk_deviation_tolerance_pct,
        "opening_balance": req.opening_balance,
    }
    db.set_manual_backtest_settings(settings)
    return settings


@app.get("/api/manual-trades/balance-adjustments")
def balance_adjustments():
    return db.list_balance_adjustments()


@app.post("/api/manual-trades/balance-adjustments")
def create_balance_adjustment(req: BalanceAdjustmentRequest):
    if req.type not in {"add", "subtract"}:
        raise HTTPException(status_code=422, detail="type must be 'add' or 'subtract'")
    adjustment_id = db.create_balance_adjustment(req.amount, req.type, req.reason, req.notes, req.adjusted_at)
    return {"id": adjustment_id}


@app.delete("/api/manual-trades/balance-adjustments/{adjustment_id}")
def delete_balance_adjustment(adjustment_id: int):
    db.delete_balance_adjustment(adjustment_id)
    return {"ok": True}


MANUAL_TRADE_EXPORT_FIELDS = [
    "id", "symbol", "direction", "setup", "quantity", "entry_price", "exit_price", "stop_loss",
    "target", "ideal_risk_amount", "is_open", "result", "emotion", "tags", "notes", "traded_at",
]


@app.get("/api/manual-trades/export")
def export_manual_trades(format: str = "csv"):
    trades = db.list_manual_trades()
    if format == "json":
        body = json.dumps(trades, default=str, indent=2)
        media_type, filename = "application/json", "manual-trades.json"
    elif format == "csv":
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=MANUAL_TRADE_EXPORT_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for t in trades:
            writer.writerow({**t, "tags": ", ".join(t["tags"])})
        body, media_type, filename = buf.getvalue(), "text/csv", "manual-trades.csv"
    else:
        raise HTTPException(status_code=422, detail="format must be 'csv' or 'json'")
    return Response(body, media_type=media_type, headers={"Content-Disposition": f"attachment; filename={filename}"})


# --- Consistency/streak tracking (Profile modal) -----------------------------------------------
# Self-directed accountability nudge: tracks daily usage time + which "qualifying" actions (trade
# logged / backtest run / watchlist-events reviewed) happened each day, purely to compute a
# streak and surface it back to the same user - nothing here is sent anywhere else.

ACTIVITY_DAYS_WINDOW = 371
# A single heartbeat is clamped so a stale tab regaining focus after hours away can't credit a
# whole afternoon in one call - the frontend sends small (~20s) increments anyway, this is just
# a server-side backstop.
MAX_HEARTBEAT_SECONDS = 300


@app.websocket("/ws/activity")
async def activity_socket(ws: WebSocket):
    """One persistent connection per tab instead of a fresh HTTP request every ~20s - the
    frontend sends {"seconds": N} ticks over it while visible. db.add_activity_seconds is a
    blocking psycopg call; offloaded to a thread so it doesn't stall the event loop (and any
    other request) for the life of the connection."""
    await ws.accept()
    try:
        while True:
            data = await ws.receive_json()
            seconds = data.get("seconds")
            if isinstance(seconds, (int, float)) and seconds > 0:
                await asyncio.to_thread(db.add_activity_seconds, min(int(seconds), MAX_HEARTBEAT_SECONDS))
    except (WebSocketDisconnect, ValueError):
        pass


@app.post("/api/activity/ping")
def activity_ping(req: ActivityPingRequest):
    if req.kind not in ("analyze", "review"):
        raise HTTPException(status_code=422, detail="kind must be 'analyze' or 'review'")
    db.ping_activity("analyzed" if req.kind == "analyze" else "reviewed")
    return {"ok": True}


@app.get("/api/activity/summary")
def activity_summary():
    qualifiers = db.get_activity_qualifiers()
    activity_by_date = {r["date"]: r for r in db.list_activity_days(ACTIVITY_DAYS_WINDOW)}
    traded = db.traded_dates(ACTIVITY_DAYS_WINDOW) if qualifiers.get("trade") else set()

    today = date.today()
    start = today - timedelta(days=ACTIVITY_DAYS_WINDOW - 1)

    days = []
    d = start
    while d <= today:
        row = activity_by_date.get(d)
        qualifies = (
            (qualifiers.get("trade") and d in traded)
            or (qualifiers.get("analyze") and bool(row and row["analyzed"]))
            or (qualifiers.get("review") and bool(row and row["reviewed"]))
        )
        days.append({
            "date": d.isoformat(),
            "seconds_active": row["seconds_active"] if row else 0,
            "qualifies": bool(qualifies),
        })
        d += timedelta(days=1)

    # Current streak counts through today only if today already qualifies - otherwise today is
    # still "pending" (not yet a miss) and the streak is whatever it was through yesterday.
    streak_days = days if days[-1]["qualifies"] else days[:-1]
    current_streak = 0
    for day in reversed(streak_days):
        if not day["qualifies"]:
            break
        current_streak += 1

    best_streak = run = 0
    for day in days:
        run = run + 1 if day["qualifies"] else 0
        best_streak = max(best_streak, run)

    # Full missed days counting back from yesterday (today doesn't count as a miss until it's
    # actually over) - capped since past ~30 the guilt-banner tier is already maxed out anyway.
    # If today already qualifies, the gap is closed right now - no need to keep citing whatever
    # streak was missed before today happened.
    days_missed_in_a_row = 0
    if not days[-1]["qualifies"]:
        for day in reversed(days[:-1]):
            if day["qualifies"] or days_missed_in_a_row >= 30:
                break
            days_missed_in_a_row += 1

    last_7 = days[-7:]
    avg_seconds_7d = round(sum(d["seconds_active"] for d in last_7) / len(last_7)) if last_7 else 0

    today_row = activity_by_date.get(today)
    today_breakdown = {
        "traded": today in traded,
        "analyzed": bool(today_row and today_row["analyzed"]),
        "reviewed": bool(today_row and today_row["reviewed"]),
    }

    return {
        "days": days,
        "today_qualifies": days[-1]["qualifies"],
        "today_breakdown": today_breakdown,
        "current_streak": current_streak,
        "best_streak": best_streak,
        "days_missed_in_a_row": days_missed_in_a_row,
        "avg_seconds_today": days[-1]["seconds_active"],
        "avg_seconds_7d": avg_seconds_7d,
        "daily_goal_minutes": db.get_activity_daily_goal_minutes(),
        "qualifiers": qualifiers,
    }


@app.get("/api/settings/activity")
def get_activity_settings():
    return {
        "qualifiers": db.get_activity_qualifiers(),
        "daily_goal_minutes": db.get_activity_daily_goal_minutes(),
    }


@app.put("/api/settings/activity")
def set_activity_settings(req: ActivitySettingsRequest):
    if not any(req.qualifiers.values()):
        raise HTTPException(status_code=422, detail="at least one qualifying action must stay enabled")
    if req.daily_goal_minutes <= 0:
        raise HTTPException(status_code=422, detail="daily_goal_minutes must be positive")
    db.set_activity_qualifiers(req.qualifiers)
    db.set_activity_daily_goal_minutes(req.daily_goal_minutes)
    return {"ok": True}


def _text(message):
    return "".join(p.get("text", "") for p in message.get("parts", []) if p.get("type") == "text")


# Replayed tool output only needs to be recognizable to the model, not full-precision - a
# scrape_stock call returns a whole markdown report, and a few of those replayed on every later
# turn would blow past context limits fast. A fresh call within the same turn (llm.py's
# run_agent_stream) still gets the untruncated result; this cap is history-replay only.
_HISTORY_TOOL_OUTPUT_CHARS = 1500
# How many of the most recent messages get replayed to the model each turn - a sliding window so
# a long session's token cost stays bounded instead of growing every single turn.
MAX_HISTORY_MESSAGES = 20


def _history_text(message):
    """Renders one client message as plain text for the LLM's conversation history - text plus
    a rendering of any tool calls/results, not just the final reply. Without this, a completed
    tool call's actual data (e.g. web_search hits) vanishes from context on the next turn and
    the model re-runs the same tool instead of building on what it already found. Tool output is
    wrapped the same DATA-not-instructions way a live result is (llm._wrap_tool_result), so
    replayed results carry the same injection guard as a fresh call."""
    segments = []
    for p in message.get("parts", []):
        ptype = p.get("type", "")
        if ptype == "text" and p.get("text"):
            segments.append(p["text"])
        elif (ptype == "dynamic-tool" or ptype.startswith("tool-")) and p.get("state") == "output-available":
            name = p.get("toolName") or ptype.removeprefix("tool-")
            output = p.get("output")
            text = output if isinstance(output, str) else json.dumps(output, default=str, ensure_ascii=False)
            if len(text) > _HISTORY_TOOL_OUTPUT_CHARS:
                text = text[:_HISTORY_TOOL_OUTPUT_CHARS] + "…(truncated)"
            segments.append(llm._wrap_tool_result(name, text))
    return "\n\n".join(segments)


def _windowed_history(messages):
    """Last MAX_HISTORY_MESSAGES messages, rendered for the model - a sliding window so a long
    session doesn't send unbounded, ever-growing history on every turn."""
    return [{"role": m["role"], "content": _history_text(m)} for m in messages[-MAX_HISTORY_MESSAGES:]]


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


def _embed_or_none(markdown):
    """Embeddings always need local Ollama regardless of the active chat model - if it's not
    running, the report itself (already scraped/generated) shouldn't be thrown away over it, just
    stored without a vector (skips similarity_search, everything else about it still works)."""
    try:
        return llm.embed(markdown)
    except RuntimeError:
        return None


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
    db.insert_scraped_item(symbol, markdown, _embed_or_none(markdown))
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


@app.get("/api/settings/cogencis")
def get_cogencis_config():
    # never echo the token back - the UI shows "•••• saved" instead of the real value
    return {"has_token": bool(db.get_cogencis_token())}


@app.put("/api/settings/cogencis")
def set_cogencis_config(req: CogencisConfigRequest):
    db.set_cogencis_token(req.token)
    return {"ok": True}


SUPPORTED_BROKERS = {"dhan", "kite"}


@app.get("/api/settings/broker")
def get_broker_config():
    return {
        "active_broker": db.get_active_broker(),
        "dhan": {"has_credentials": bool(db.get_dhan_credentials())},
        "kite": {
            "has_credentials": bool(db.get_kite_credentials()),
            "logged_in_today": bool(db.get_kite_session()),
        },
    }


@app.put("/api/settings/broker")
def set_broker_config(req: ActiveBrokerRequest):
    if req.broker not in SUPPORTED_BROKERS:
        raise HTTPException(status_code=422, detail=f"'{req.broker}' isn't supported yet")
    db.set_active_broker(req.broker)
    return {"ok": True}


@app.put("/api/settings/dhan")
def set_dhan_config(req: DhanConfigRequest):
    db.set_dhan_credentials(req.client_id.strip(), req.access_token.strip())
    return {"ok": True}


@app.put("/api/settings/kite")
def set_kite_config(req: KiteConfigRequest):
    db.set_kite_credentials(req.api_key.strip(), req.api_secret.strip())
    return {"ok": True}


@app.get("/api/kite/login-url")
def kite_login_url():
    creds = db.get_kite_credentials()
    if not creds:
        raise HTTPException(status_code=400,
                             detail="Kite isn't configured - add your API key and secret in Settings > Kite")
    return {"url": kite.login_url(creds["api_key"])}


# The frontend runs on its own dev-server origin (run.sh's fixed port 5180), separate from this
# API's - a relative RedirectResponse below would redirect within this API's own origin instead.
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5180")


@app.get("/api/kite/callback")
def kite_callback(request_token: str | None = None, status: str | None = None):
    """Where Kite's login redirect lands (register this exact URL - http://localhost:8010/api/kite/callback
    - as the app's Redirect URL at developers.kite.trade/apps). Exchanges request_token for a
    day-valid access_token server-side, then bounces the browser back into the app."""
    creds = db.get_kite_credentials()
    if not creds:
        raise HTTPException(status_code=400, detail="Kite isn't configured")
    if status != "success" or not request_token:
        return RedirectResponse(f"{FRONTEND_URL}/holdings?broker=kite&kite_login=failed")
    try:
        access_token = kite.generate_session(creds["api_key"], creds["api_secret"], request_token)
    except kite.KiteError:
        return RedirectResponse(f"{FRONTEND_URL}/holdings?broker=kite&kite_login=failed")
    db.set_kite_session(access_token)
    return RedirectResponse(f"{FRONTEND_URL}/holdings?broker=kite&kite_login=success")


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


@app.get("/api/holdings")
def holdings(broker_id: str | None = None, force: bool = False):
    return _get_holdings(broker_id, force)


SCRAPE_OUTPUT_FILE = "scraped.json"


@app.post("/api/scrape")
def scrape_url(req: ScrapeRequest):
    """Scrapes an arbitrary URL's HTML (requests + BeautifulSoup, via scraper.scrape_article)
    and writes {url, title, text} to one JSON file, overwritten each call."""
    data = {"url": req.url, **scraper.scrape_article(req.url)}
    with open(SCRAPE_OUTPUT_FILE, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return data


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
def remove_watchlist(symbol: str, list_name: str | None = None):
    """Removes from one list, or from every list (used when deleting the stock) when omitted."""
    db.remove_from_watchlist(symbol.upper(), list_name)
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


@app.get("/api/stocks/search")
def search_stocks(q: str = "", limit: int = 30):
    """Symbol search for the chat @ tag menu - every scraped symbol, not just watchlisted ones."""
    return db.search_symbols(q, min(limit, 30))


@app.get("/api/stocks-master")
def stocks_master_search(q: str = "", limit: int = 30):
    """Search endpoint for the full NSE listed-equity master (Settings > Manage stocks), separate
    from /api/stocks/search above which only covers previously-scraped symbols. Always capped at
    30 - this table has 2000+ rows, nowhere near safe to return unbounded."""
    return {"stocks": db.search_stocks_master(q, min(limit, 30)), "total": db.count_stocks_master()}


@app.post("/api/stocks-master/import")
async def stocks_master_import(file: UploadFile = File(...)):
    """Bulk (re)import from an NSE EQUITY_L.csv export - upserts, so re-running with a fresh
    download just refreshes the list."""
    rows = stocks_master.parse_csv(await file.read())
    if not rows:
        raise HTTPException(status_code=422, detail="no valid rows found in CSV")
    db.upsert_stocks_master(rows)
    return {"imported": len(rows), "total": db.count_stocks_master()}


@app.delete("/api/stocks-master/{symbol}")
def stocks_master_delete(symbol: str):
    db.delete_stock_master(symbol.upper())
    return {"ok": True}


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
    """Serves news from Postgres if scraped within the last day, otherwise re-scrapes and refreshes it.
    Merges in Cogencis news (Settings > Cogencis) when a token is configured - it's keyed by ISIN
    rather than NSE symbol and often surfaces different sources than yfinance, so both are kept
    (deduped by url) rather than one replacing the other."""
    cached = db.get_cached_news(symbol)
    if cached is not None:
        return cached
    try:
        fresh = scraper.get_news(symbol)
    except Exception:
        fresh = []

    token = db.get_cogencis_token()
    if token:
        try:
            isin = scraper.get_isin(symbol)
            if isin:
                fresh += scraper.get_cogencis_news(isin, token)
        except Exception:
            pass  # token likely expired/invalid - yfinance news still shown

    seen_urls = set()
    deduped = []
    for item in fresh:
        if item["url"] and item["url"] in seen_urls:
            continue
        seen_urls.add(item["url"])
        deduped.append(item)
    deduped.sort(key=lambda i: i["published_at"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    fresh = deduped

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


# Screener's page is a single scrape covering fundamentals + 12y statements + filings, so it's
# cached as one blob. 6h TTL: the statements only move quarterly, but the announcements list is
# intraday-fresh, and this is a full HTML fetch+parse (not a cheap JSON call) to redo on a whim.
@app.get("/api/stocks/{symbol}/screener")
def stock_screener(symbol: str):
    symbol = symbol.upper()
    data = _cached(symbol, "screener", 60 * 6, lambda: scraper.get_screener_data(symbol))
    if data is None:
        raise HTTPException(status_code=404, detail=f"No screener.in page found for '{symbol}'")
    return data


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


@app.delete("/api/chat/sessions/{session_id}/messages")
def clear_session_messages(session_id: str):
    db.clear_messages(session_id)
    return {"ok": True}


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
    db.insert_scraped_item(symbol, markdown, _embed_or_none(markdown))
    return markdown


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


def _rule_reply(user_text):
    """Handles the /rule RULE_NAME [SYMBOL] slash command. A rule isn't tied to one stock: with no
    symbol it's checked against every watchlisted stock (a screener - which ones meet it right
    now); with a trailing symbol, just that one. Returns a reply string, or None if not that
    command."""
    if not user_text.strip().lower().startswith("/rule"):
        return None
    match = RULE_COMMAND.match(user_text.strip())
    if not match:
        return RULE_USAGE
    rest = match.group(1).strip()
    tokens = rest.split()
    symbol, name = None, rest
    if len(tokens) > 1 and tokens[-1].upper() in db.watchlist_symbols():
        symbol, name = tokens[-1].upper(), " ".join(tokens[:-1])
    rule = db.get_watch_rule(name)
    if rule is None:
        return f"No watch rule named '{name}' - set one up in Settings > Watch rules."
    if symbol:
        return _format_rule_check(rule["name"], symbol, rules.evaluate(rule, symbol))
    results = [{"symbol": s, **rules.evaluate(rule, s)} for s in db.watchlist_symbols()]
    return _format_rule_check_all(rule["name"], results)


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

CONFIRM_COMMAND = re.compile(r"^/confirm\s+(\w+)(?:\s+(.*))?$", re.IGNORECASE)
CONFIRM_USAGE = "Usage: `/confirm <tool> [args]` - e.g. `/confirm scan_events` or `/confirm scrape_stock symbol=TCS`"


def _parse_confirm(user_text):
    """Parses the /confirm <tool> [key=value ...] slash command - the human-in-the-loop gate for
    CONFIRM_TOOLS, sent either by the user typing it or by the UI's Confirm button. Returns
    (tool_name, kwargs) to run, or None if user_text isn't a /confirm command. Raises ValueError
    (usage/lookup errors) for a malformed or unknown command - caller turns that into a reply."""
    if not user_text.strip().lower().startswith("/confirm"):
        return None
    match = CONFIRM_COMMAND.match(user_text.strip())
    if not match:
        raise ValueError(CONFIRM_USAGE)
    name, arg_str = match.group(1), (match.group(2) or "").strip()
    if name not in CONFIRM_TOOLS:
        raise ValueError(f"'{name}' doesn't require confirmation (or isn't a tool) - nothing to do.")
    kwargs = {}
    for part in arg_str.split():
        if "=" in part:
            k, v = part.split("=", 1)
            kwargs[k] = v
    return name, kwargs


@app.post("/api/chat")
def post_chat(req: ChatRequest):
    is_new = len(req.messages) == 1
    db.ensure_session(req.sessionId)
    if req.model:
        db.set_session_model(req.sessionId, req.model)
    model = db.get_session_model(req.sessionId) or db.get_active_model()

    user_text = _text(req.messages[-1])

    use_agent = False
    reply = None
    try:
        confirm_call = _parse_confirm(user_text)
    except ValueError as e:
        confirm_call = None
        reply = str(e)
    try:
        if reply is None and confirm_call is None:
            reply = _rule_reply(user_text)
        if reply is None and confirm_call is None:
            reply = _sentiment_reply(user_text, model)
        if reply is None and confirm_call is None:
            reply = _history_reply(user_text, model)
        if reply is None and confirm_call is None and (model.startswith("ollama/") or model.startswith("litellm/")):
            # local llama or a LiteLLM-routed model: tool-calling agent. Deferred into stream()
            # below so each tool call can be pushed to the UI as it happens, instead of a long
            # silent wait. OmniRoute keeps the original RAG path below (tool support varies
            # across its many upstream providers).
            use_agent = True
        if reply is None and confirm_call is None and not use_agent:
            # OmniRoute models: original RAG path (tool schema support varies per provider)
            live_reports = list(filter(None, (
                _live_scrape(symbol, model) for symbol in dict.fromkeys(TICKER_PATTERN.findall(user_text))
            )))

            query_embedding = llm.embed(user_text)
            matches = db.similarity_search(query_embedding, limit=5)
            stored = [m["content_markdown"] for m in matches if m["content_markdown"] not in live_reports]
            context = "\n\n---\n\n".join(live_reports + stored) or None

            history = _windowed_history(req.messages)
            reply = llm.chat(history, context, model=model)
    except RuntimeError as e:
        # model-call failure (OmniRoute down / upstream exhausted) - show it in the chat, not a 500
        reply = f"⚠️ {e}"

    db.add_message(req.sessionId, "user", user_text)
    if not use_agent and confirm_call is None:
        db.add_message(req.sessionId, "assistant", reply)

    def stream():
        yield _sse({"type": "start", "messageId": str(uuid.uuid4())})

        final_reply = reply
        if confirm_call:
            name, kwargs = confirm_call
            call_id = str(uuid.uuid4())
            yield _sse({"type": "tool-input-available", "toolCallId": call_id,
                        "toolName": name, "input": kwargs})
            try:
                result = REAL_TOOL_IMPLS[name](**kwargs)
                final_reply = f"Ran `{name}`."
            except Exception as e:
                result = {"error": str(e)}
                final_reply = f"⚠️ `{name}` failed: {e}"
            yield _sse({"type": "tool-output-available", "toolCallId": call_id, "output": result})
            db.add_message(req.sessionId, "assistant", final_reply)
        if use_agent:
            history = _windowed_history(req.messages)
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
