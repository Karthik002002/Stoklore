"""Background jobs and their progress state: watchlist event scans, price syncs, and
max-history collection.

State dicts live here rather than in the routers because two callers poll them - the status
endpoints and the chat agent's scan tools - and a router importing another router to read a
dict is exactly the coupling this refactor removes.
"""
import threading
import time
from datetime import datetime

from app.core import db
from app.core import events
from app.core import price_sources
from app.core import prices
from app.core import shareholding

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


# --- Shareholding sweep ---------------------------------------------------------------------------
# Two phases, because the two data sources cost wildly different amounts (see app/core/
# shareholding.py). The master endpoint covers every listed company in ONE call per 90-day window,
# so a full 5-year backfill is ~20 requests. The per-filing XBRL is ~85-270 KB each, so it is
# fetched only for the filings that actually moved - a few dozen a quarter instead of 2,500.
#
# Re-running is free by design: filings are keyed on NSE's own record id, so a window already
# collected upserts the same rows, and a filing whose detail is already stored is skipped outright.

_shareholding_state = {"running": False, "phase": None, "done": 0, "total": 0, "new": 0, "details": 0, "error": None}

# How many XBRL fetches one run will do. A cap rather than "everything pending": the first run after
# a 5-year backfill has thousands of candidates, and hammering nsearchives for an hour is exactly
# the behaviour netfetch.py's throttle exists to avoid. What is left is picked up by tomorrow's run.
MAX_DETAILS_PER_RUN = 60


def _collect_shareholding_details(limit=MAX_DETAILS_PER_RUN):
    """Fetch the XBRL for filings that moved and don't have it yet. Returns how many were stored.

    The gate needs the PREVIOUS filing of the same symbol to compare against, which is why this
    walks per-symbol series rather than a flat 'detail is null' query.
    """
    filings = db.list_shareholding_filings()
    by_symbol = {}
    for f in filings:
        by_symbol.setdefault(f["symbol"], []).append(f)

    pending = []
    for symbol_filings in by_symbol.values():
        ordered = shareholding.latest_per_period(symbol_filings)
        for index, filing in enumerate(ordered):
            previous = ordered[index - 1] if index else None
            if filing.get("detail_fetched_at") is None and shareholding.needs_detail(filing, previous):
                pending.append(filing)
    # Newest first: a filing from this quarter is the one being looked at today.
    pending.sort(key=lambda f: f["period_date"], reverse=True)
    pending = pending[:limit]

    _shareholding_state.update(phase="detail", done=0, total=len(pending))
    stored = 0
    for index, filing in enumerate(pending):
        try:
            detail = shareholding.fetch_detail(filing["xbrl_url"])
            db.set_shareholding_detail(filing["record_id"], detail)
            stored += 1
        except Exception:
            # One unreadable filing (a withdrawn URL, a malformed XBRL) must not end the sweep.
            # It stays unstamped and is retried on the next run.
            pass
        _shareholding_state["done"] = index + 1
        _shareholding_state["details"] = stored
    return stored


def _run_shareholding_sync(years, with_detail=True, start=None, end=None):
    _shareholding_state.update(
        running=True, phase="master", done=0, total=0, new=0, details=0, error=None
    )
    try:
        # An explicit range wins over the years shorthand: "the last N years" is the common case,
        # a named span is the deliberate one.
        ranges = shareholding.windows_between(start, end) if start and end else shareholding.windows(years)
        _shareholding_state["total"] = len(ranges)
        for index, (start, end) in enumerate(ranges):
            try:
                rows = shareholding.fetch_window(start, end)
                _shareholding_state["new"] += db.upsert_shareholding_filings(rows)
            except Exception as e:
                # A window that fails is recorded and skipped - the newest windows are fetched
                # first, so a rate limit deep in a backfill still leaves the useful end collected.
                _shareholding_state["error"] = str(e)
            _shareholding_state["done"] = index + 1
        if with_detail:
            _collect_shareholding_details()
    except Exception as e:
        _shareholding_state["error"] = str(e)
    finally:
        _shareholding_state.update(running=False, phase=None)


def start_shareholding_sync(years=1, with_detail=True, start=None, end=None):
    """Kick the sweep in the background. No-op while one is already running - two sweeps would
    fight over the same NSE cookie pool for no benefit."""
    if _shareholding_state["running"]:
        return False
    threading.Thread(
        target=_run_shareholding_sync, args=(years, with_detail, start, end), daemon=True
    ).start()
    return True


def shareholding_status():
    return dict(_shareholding_state)


# Once per IST calendar day, checked hourly - same shape (and the same reasoning) as the event scan
# at the top of this file: cheap to check, and a machine that was asleep at the target hour still
# catches up within the hour of waking. Only the newest window is swept; the history behind it is
# already stored and filings don't change.
def _auto_shareholding_loop():
    from zoneinfo import ZoneInfo

    ist = ZoneInfo("Asia/Kolkata")
    while True:
        today = datetime.now(ist).date().isoformat()
        if db.get_last_shareholding_sync_date() != today and not _shareholding_state["running"]:
            db.set_last_shareholding_sync_date(today)
            _run_shareholding_sync(years=1, with_detail=True)
        time.sleep(3600)
