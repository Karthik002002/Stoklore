"""Background jobs and their progress state: watchlist event scans, price syncs, and
max-history collection.

State dicts live here rather than in the routers because two callers poll them - the status
endpoints and the chat agent's scan tools - and a router importing another router to read a
dict is exactly the coupling this refactor removes.
"""
import threading
import time
from datetime import datetime

import db
import events
import price_sources
import prices

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
