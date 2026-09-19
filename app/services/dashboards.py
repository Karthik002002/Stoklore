"""Dashboards: grids of panels over the app's data, built and arranged by the user.

A dashboard is {name, panels, variables, settings}. A panel is {id, type, title, query, options,
layout: {x, y, w, h}} on a 12-column grid. What a panel draws comes from its query, run through
dashboard_query.shape - this module only knows where rows come from.

**Sources are the extension point.** Each one names its time field and its parameters and returns
flat dicts. Workflow data, runs and notifications are the first three; price history, the trade
journal, alerts or holdings are one entry each here, and no panel changes when they arrive.
"""
import uuid
from datetime import datetime

from app.core import db, scraper
from app.core.config import IST
from app.services import dashboard_query as dq
from app.services import journal_math as jm

PANEL_TYPES = ("timeseries", "stat", "table", "bar", "pie", "heatmap", "treemap", "health", "notifications")
#: What each panel type asks the query layer for.
TYPE_SHAPE = {
    "timeseries": "timeseries",
    "stat": "stat",
    "table": "rows",
    "bar": "aggregate",
    "pie": "aggregate",
    "heatmap": "heatmap",
    "treemap": "treemap",
    "health": "rows",
    "notifications": "rows",
}
DEFAULT_SETTINGS = {"from": "now-7d", "to": "now", "refresh": 0}


def _iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


def _names():
    return {w["id"]: w["name"] for w in db.list_workflows()}


# --- sources ------------------------------------------------------------------------------------------


def _series_rows(params, since, until):
    workflow_id = params.get("workflow_id")
    if not workflow_id:
        return []
    series = params.get("series") or next(iter(db.list_series_names(workflow_id)), None)
    if not series:
        return []
    rows = db.read_series(workflow_id, series, limit=dq.MAX_LIMIT, since=since, until=until)
    return [{"collected_at": _iso(r["collected_at"]), "run_id": r["run_id"], **(r["row"] or {})} for r in rows]


def _run_rows(params, since, until):
    names = _names()
    rows = db.workflow_runs_between(params.get("workflow_id") or None, since, until, limit=2000)
    return [
        {
            "created_at": _iso(r["created_at"]),
            "workflow": names.get(r["workflow_id"], "(deleted workflow)"),
            "status": r["status"],
            "seconds": float(r["seconds"]) if r["seconds"] is not None else None,
            "error": r["error"],
            "finished_at": _iso(r["finished_at"]),
            "run_id": r["id"],
            "workflow_id": r["workflow_id"],
        }
        for r in rows
    ]


def _notification_rows(params, since, until):
    names = _names()
    rows = db.workflow_notifications_between(params.get("workflow_id") or None, since, until, limit=1000)
    out = []
    for r in rows:
        meta = r.get("meta") or {}
        out.append({
            "triggered_at": _iso(r["triggered_at"]),
            "workflow": names.get(meta.get("workflow_id"), "(workflow)"),
            "event": meta.get("event") or "output",
            "message": r["message"],
            "unread": r["acknowledged_at"] is None,
            "delivered": meta.get("delivered") is not False,
            "workflow_id": meta.get("workflow_id"),
            "run_id": meta.get("run_id"),
            "notification_id": r["id"],
        })
    return out


def _num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


#: A daily bar belongs to the session's close, and stamping it 15:30 IST (rather than a bare date)
#: keeps every time in the query layer timezone-aware.
def _session_close(day):
    return f"{day.isoformat() if hasattr(day, 'isoformat') else day}T15:30:00+05:30"


def _movers_payload():
    # The router owns NSE's once-a-day movers snapshot (fetch, store, fall back to the last one), so
    # a dashboard refreshing every 5 seconds reads that snapshot instead of asking NSE again.
    from app.routers.indices import market_movers

    try:
        return market_movers()
    except Exception as e:  # noqa: BLE001 - an HTTPException or an NSE outage; the panel says so
        raise ValueError(f"NSE's movers aren't available right now: {getattr(e, 'detail', e)}") from e


def _mover_rows(params, since, until):
    payload = _movers_payload()
    groups = payload.get("groups") or []
    keys = [g["key"] for g in groups]
    wanted = params.get("bucket") or ("allSec" if "allSec" in keys else (keys[0] if keys else None))
    at = _iso(payload.get("fetched_at")) or datetime.now(IST).isoformat()
    out = []
    for group in groups:
        if group["key"] != wanted:
            continue
        for side, rows in (("gainer", group.get("gainers") or []), ("loser", group.get("losers") or [])):
            for r in rows:
                out.append({
                    "fetched_at": at,
                    "symbol": r.get("symbol"),
                    "side": side,
                    "changePercent": _num(r.get("perChange")),
                    "ltp": _num(r.get("ltp")),
                    "change": _num(r.get("change")),
                    "prev_price": _num(r.get("prev_price")),
                    "volume": _num(r.get("trade_quantity")),
                    "turnover": _num(r.get("turnover")),
                    "bucket": group.get("label"),
                    "trade_date": payload.get("trade_date"),
                    "corporate_action": r.get("ca_purpose"),
                })
    return out


def _indices_payload():
    from app.deps import _cached

    return _cached("NSE", "macro-indices", 5, scraper.get_all_indices)


def _index_rows(params, since, until):
    payload = _indices_payload()
    at = datetime.now(IST).isoformat()
    seen, out = set(), []
    for group in payload.get("groups") or []:
        if params.get("category") and group["key"] != params["category"]:
            continue
        for i in group.get("indices") or []:
            # An index sits in several categories (NIFTY 50 is broad AND derivatives-eligible); across
            # all categories it counts once.
            if not params.get("category") and i.get("name") in seen:
                continue
            seen.add(i.get("name"))
            out.append({
                "fetched_at": at,
                "name": i.get("name"),
                "category": group["key"],
                "percentChange": _num(i.get("percentChange")),
                "last": _num(i.get("last")),
                "change": _num(i.get("change")),
                "perChange30d": _num(i.get("perChange30d")),
                "perChange365d": _num(i.get("perChange365d")),
                "advances": _num(i.get("advances")),
                "declines": _num(i.get("declines")),
                "unchanged": _num(i.get("unchanged")),
                "pe": _num(i.get("pe")),
                "pb": _num(i.get("pb")),
                "dy": _num(i.get("dy")),
                "yearHigh": _num(i.get("yearHigh")),
                "yearLow": _num(i.get("yearLow")),
            })
    return out


def _watchlist_price_rows(params, since, until):
    out = []
    for r in db.watchlist_latest_prices(params.get("list_name") or None):
        close, prev = _num(r["close"]), _num(r["prev_close"])
        volume, avg = _num(r["volume"]), _num(r["avg_volume_20"])
        out.append({
            "date": _session_close(r["date"]) if r["date"] else None,
            "symbol": r["symbol"],
            "list_name": r["list_name"],
            "changePercent": round((close - prev) / prev * 100, 2) if close and prev else None,
            "close": close,
            "prev_close": prev,
            "change": round(close - prev, 2) if close and prev else None,
            "volume": volume,
            "avg_volume_20": round(avg) if avg else None,
            "volume_ratio": round(volume / avg, 2) if volume and avg else None,
        })
    return out


def _symbols(params):
    if params.get("symbol"):
        return [params["symbol"].upper()]
    return db.watchlist_symbols(params.get("list_name") or None)


def _price_rows(params, since, until):
    out = []
    for r in db.price_bars_between(_symbols(params), since, until):
        close, prev = _num(r["close"]), _num(r["prev_close"])
        out.append({
            "date": _session_close(r["date"]),
            "symbol": r["symbol"],
            "close": close,
            "changePercent": round((close - prev) / prev * 100, 2) if close and prev else None,
            "open": _num(r["open"]),
            "high": _num(r["high"]),
            "low": _num(r["low"]),
            "volume": _num(r["volume"]),
        })
    return out


def _event_rows(params, since, until):
    rows = db.list_events(
        list_name=params.get("list_name") or None,
        symbol=(params.get("symbol") or "").upper() or None,
        from_date=since.date().isoformat() if since else None,
        to_date=until.date().isoformat() if until else None,
        limit=2000,
    )
    return [
        {
            "event_time": _iso(r["event_time"]),
            "symbol": r["symbol"],
            "event_type": r["event_type"],
            "headline": r["headline"],
            "sentiment": r["sentiment_label"],
            "sentiment_score": _num(r["sentiment_score"]),
            "list_name": r["list_name"],
            "url": r["url"],
            "event_id": r["id"],
        }
        for r in rows
        if r["event_time"]
    ]


def _trade_source(tags):
    """Where a journal row came from. Paper, Bar Replay and live exits file themselves into the same
    table with a tag, which is what lets one source cover all four."""
    for tag in ("live", "paper", "replay"):
        if tag in (tags or []):
            return tag
    return "journal"


def _journal_rows(params, since, until):
    accounts = {a["id"]: a for a in db.list_trade_accounts(kind=None)}
    trades = sorted(db.list_manual_trades(), key=lambda t: (t["traded_at"], t["id"]))
    out, equity, peak = [], {}, {}
    for t in trades:
        account = accounts.get(t["account_id"])
        name = account["name"] if account else "Unassigned"
        closed = t["exit_price"] is not None
        gross, net = jm.pnl(t), jm.net_pnl(t, account)
        # The equity curve runs over the WHOLE history, per account, before the range is applied:
        # "last 30 days" of an equity curve should start where the account actually stood, not at 0.
        # Per account rather than overall, so filtering to one account leaves a curve that is still
        # right - an overall running total would carry the other accounts' trades inside it.
        if closed and net is not None:
            equity[name] = round(equity.get(name, 0) + net, 2)
            peak[name] = max(peak.get(name, 0), equity[name])
        # The market at entry and MAE/MFE, frozen on the row when it was journaled (trade_context.py).
        ctx = t.get("trade_context") or {}
        # After the equity step, before the row: trades outside the range still move the curve.
        if (since and t["traded_at"] < since) or (until and t["traded_at"] > until):
            continue
        held = (t["exited_at"] - (t.get("entried_at") or t["traded_at"])).total_seconds() / 86400 \
            if closed and t.get("exited_at") else None
        out.append({
            "traded_at": _iso(t["traded_at"]),
            "exited_at": _iso(t.get("exited_at")),
            "symbol": t["symbol"],
            "direction": t["direction"],
            "account": name,
            "source": _trade_source(t["tags"]),
            "setup": t.get("setup") or "No setup",
            "emotion": t.get("emotion") or "Not logged",
            "tags": ", ".join(t["tags"] or []),
            "status": "closed" if closed else "open",
            "result": (t.get("result") or jm.auto_result(t)) if closed else "open",
            "quantity": t["quantity"],
            "entry_price": t["entry_price"],
            "exit_price": t["exit_price"],
            "stop_loss": t["stop_loss"],
            "target": t["target"],
            "turnover": round(t["entry_price"] * t["quantity"], 2),
            "gross_pnl": gross,
            "costs": jm.costs(t, account),
            "net_pnl": net,
            "return_pct": jm.return_pct(t),
            "net_return_pct": jm.net_return_pct(t, account),
            # Averages to a win rate - the journal's own definition: a closed trade with gross P&L
            # above zero, over all closed trades.
            "win_pct": (100 if (gross or 0) > 0 else 0) if closed else None,
            "r_multiple": jm.r_multiple(t),
            "realised_rr": jm.realised_rr(t),
            "planned_rr": jm.planned_rr(t),
            "risk_amount": jm.risk_amount(t),
            "ideal_risk": t.get("ideal_risk_amount"),
            "holding_days": round(held, 2) if held is not None else None,
            "weekday": jm.weekday(t["traded_at"]),
            "session": jm.session(t["traded_at"]),
            "trend": ctx.get("trend"),
            "vol_regime": ctx.get("vol_regime"),
            "with_trend": ctx.get("with_trend"),
            "extended": ctx.get("extended"),
            "volume_spike": (ctx.get("vol_spike") or {}).get("max_ratio"),
            "mae_pct": ctx.get("mae_pct"),
            "mfe_pct": ctx.get("mfe_pct"),
            "mae_r": ctx.get("mae_r"),
            "mfe_r": ctx.get("mfe_r"),
            "account_equity": equity.get(name) if closed else None,
            "account_drawdown": round(equity[name] - peak[name], 2) if closed and name in equity else None,
            "trade_id": t["id"],
        })
    return out


def _backtest_rows(params, since, until):
    symbol = (params.get("symbol") or "").upper() or None
    return [
        {
            "created_at": _iso(b["created_at"]),
            "symbol": b["symbol"],
            "strategy": f"EMA {b['short_period']}/{b['long_period']}",
            "total_return_pct": _num(b["total_return_pct"]),
            "win_rate": _num(b["win_rate"]),
            "num_trades": b["num_trades"],
            "from_date": _iso(b["from_date"]),
            "to_date": _iso(b["to_date"]),
            "lessons": b["lessons"],
            "backtest_id": b["id"],
        }
        for b in db.list_backtests(symbol)
    ]


SOURCES = {
    "journal_trades": {
        "label": "Trade journal",
        "description": "Every journaled trade - hand-logged, paper, Bar Replay and live - with gross and net "
                       "P&L, R, costs, MAE/MFE, the market at entry and each account's equity curve.",
        "time_field": "traded_at",
        "params": [],
        "rows": _journal_rows,
    },
    "ema_backtests": {
        "label": "Saved backtests",
        "description": "EMA-crossover backtests you saved: return, win rate and trade count per symbol.",
        "time_field": "created_at",
        "params": [{"name": "symbol", "label": "Symbol (blank = all)", "required": False}],
        "rows": _backtest_rows,
    },
    "workflow_series": {
        "label": "Workflow data",
        "description": "What a workflow's Collect data nodes gathered, run by run.",
        "time_field": "collected_at",
        "params": [
            {"name": "workflow_id", "label": "Workflow", "required": True},
            {"name": "series", "label": "Series", "required": False},
        ],
        "rows": _series_rows,
    },
    "workflow_runs": {
        "label": "Workflow runs",
        "description": "Every run: outcome, duration and error.",
        "time_field": "created_at",
        "params": [{"name": "workflow_id", "label": "Workflow (blank = all)", "required": False}],
        "rows": _run_rows,
    },
    "workflow_notifications": {
        "label": "Workflow notifications",
        "description": "Everything workflows filed: failures, outputs, successes.",
        "time_field": "triggered_at",
        "params": [{"name": "workflow_id", "label": "Workflow (blank = all)", "required": False}],
        "rows": _notification_rows,
    },
    "market_indices": {
        "label": "NSE indices",
        "description": "Every NSE index: today's move, 30-day and 1-year returns, breadth, valuation. Refreshed every 5 minutes.",
        "time_field": "fetched_at",
        "snapshot": True,
        "params": [{"name": "category", "label": "Category (blank = all)", "required": False}],
        "rows": _index_rows,
    },
    "market_movers": {
        "label": "NSE movers",
        "description": "NSE's top gainers and losers for one index cut - the day's snapshot.",
        "time_field": "fetched_at",
        "snapshot": True,
        "params": [{"name": "bucket", "label": "Index cut (blank = all securities)", "required": False}],
        "rows": _mover_rows,
    },
    "watchlist_prices": {
        "label": "Watchlist prices",
        "description": "Each watchlisted stock's latest close, its daily change and volume against the 20-day average.",
        "time_field": "date",
        "snapshot": True,
        "params": [{"name": "list_name", "label": "Watchlist (blank = all)", "required": False}],
        "rows": _watchlist_price_rows,
    },
    "price_history": {
        "label": "Price history",
        "description": "Daily bars - close, change and volume - for one stock or a watchlist.",
        "time_field": "date",
        "params": [
            {"name": "symbol", "label": "Symbol (blank = the watchlist)", "required": False},
            {"name": "list_name", "label": "Watchlist (blank = all)", "required": False},
        ],
        "rows": _price_rows,
    },
    "stock_events": {
        "label": "Stock events",
        "description": "Corporate events and news the scans found - type, headline and sentiment.",
        "time_field": "event_time",
        "params": [
            {"name": "symbol", "label": "Symbol (blank = all)", "required": False},
            {"name": "list_name", "label": "Watchlist (blank = all)", "required": False},
        ],
        "rows": _event_rows,
    },
}

#: The order sources appear in the panel editor - market data first.
SOURCE_ORDER = ("market_indices", "market_movers", "watchlist_prices", "price_history", "stock_events",
                "journal_trades", "ema_backtests",
                "workflow_series", "workflow_runs", "workflow_notifications")


def catalogue():
    return [
        {"id": key, "label": SOURCES[key]["label"], "description": SOURCES[key]["description"],
         "time_field": SOURCES[key]["time_field"], "snapshot": bool(SOURCES[key].get("snapshot")),
         "params": SOURCES[key]["params"]}
        for key in SOURCE_ORDER
    ]


def param_options(source, params):
    """Choices for each parameter, given the ones already picked - the editor's dropdowns."""
    if source not in SOURCES:
        raise ValueError(f"unknown source '{source}'")
    params = params or {}
    names = {p["name"] for p in SOURCES[source]["params"]}
    option = lambda values: [{"value": v, "label": label} for v, label in values]  # noqa: E731
    out = {}
    if "workflow_id" in names:
        out["workflow_id"] = option((w["id"], w["name"]) for w in db.list_workflows())
    if "series" in names and params.get("workflow_id"):
        out["series"] = option((s, s) for s in db.list_series_names(params["workflow_id"]))
    if "list_name" in names:
        lists = [n if isinstance(n, str) else n.get("name") for n in db.list_watchlist_names()]
        out["list_name"] = option((n, n) for n in lists if n)
    if "symbol" in names:
        out["symbol"] = option((s, s) for s in sorted(db.watchlist_symbols(params.get("list_name") or None)))
    if "bucket" in names:
        try:
            out["bucket"] = option((g["key"], g["label"]) for g in _movers_payload().get("groups") or [])
        except ValueError:
            out["bucket"] = []
    if "category" in names:
        out["category"] = option((g["key"], g["key"].title()) for g in _indices_payload().get("groups") or [])
    return out


def _window(time_from, time_to, now=None):
    now = now or datetime.now(IST)
    return dq.parse_time(time_from, now), dq.parse_time(time_to, now)


def _fetch(query, variables, time_from, time_to):
    source = SOURCES.get((query or {}).get("source"))
    if not source:
        raise ValueError(f"unknown source '{(query or {}).get('source')}'")
    # A snapshot - today's movers, the latest close - is what it is whatever the range says; filtering
    # it by "last hour" would only ever blank the panel.
    since, until = (None, None) if source.get("snapshot") else _window(time_from, time_to)
    params = {k: dq.resolve(v, variables) for k, v in (query.get("params") or {}).items()}
    return source["rows"](params, since, until), {**query, "time_field": source["time_field"]}


def run_query(query, variables=None, time_from="now-7d", time_to="now"):
    rows, q = _fetch(query, variables, time_from, time_to)
    return dq.shape(rows, q, variables)


def drill(query, point, variables=None, time_from="now-7d", time_to="now"):
    rows, q = _fetch(query, variables, time_from, time_to)
    return dq.drill(rows, q, point, variables)


def fields(query, variables=None, time_from=None, time_to=None):
    rows, _ = _fetch(query, variables, time_from, time_to)
    return dq.columns(rows)


def values(query, field, variables=None, time_from=None, time_to=None):
    """Distinct values of one field - a variable's dropdown."""
    rows, _ = _fetch(query, variables, time_from, time_to)
    return sorted({dq._s(r.get(field)) for r in rows if r.get(field) not in (None, "")})[:500]


def validate(panels, variables):
    """None, or what's wrong - said at save time rather than as a blank panel."""
    if not isinstance(panels, list):
        return "panels must be a list"
    ids = set()
    for p in panels:
        if p.get("type") not in PANEL_TYPES:
            return f"unknown panel type '{p.get('type')}'"
        if not p.get("id") or p["id"] in ids:
            return "every panel needs a unique id"
        ids.add(p["id"])
        layout = p.get("layout") or {}
        try:
            if not (0 <= int(layout["x"]) and int(layout["w"]) >= 1 and int(layout["x"]) + int(layout["w"]) <= 12):
                return f"panel '{p.get('title')}' doesn't fit the 12-column grid"
            if int(layout["y"]) < 0 or int(layout["h"]) < 1:
                return f"panel '{p.get('title')}' has an invalid height"
        except (KeyError, TypeError, ValueError):
            return f"panel '{p.get('title')}' is missing its position"
        if (p.get("query") or {}).get("source") not in SOURCES:
            return f"panel '{p.get('title')}' has no data source"
    if not isinstance(variables, list):
        return "variables must be a list"
    names = [v.get("name") for v in variables]
    if any(not n or not n.replace("_", "").isalnum() for n in names) or len(set(names)) != len(names):
        return "variable names must be unique letters, digits or _"
    return None


def validate_home(items):
    """None, or what's wrong with the home board: pins on a 12-column grid, each pointing at a whole
    dashboard (`panel_id` null) or one panel of it. Pins are references, not copies - editing the
    panel in its dashboard is what changes it on home too."""
    if not isinstance(items, list):
        return "items must be a list"
    ids = set()
    for item in items:
        if not isinstance(item, dict) or not item.get("id") or item["id"] in ids:
            return "every pin needs a unique id"
        ids.add(item["id"])
        if not isinstance(item.get("dashboard_id"), str) or not item["dashboard_id"]:
            return "every pin needs a dashboard"
        if item.get("panel_id") is not None and not isinstance(item["panel_id"], str):
            return "a pin's panel must be an id"
        layout = item.get("layout") or {}
        try:
            x, y, w, h = (int(layout[k]) for k in ("x", "y", "w", "h"))
        except (KeyError, TypeError, ValueError):
            return "every pin needs a position"
        if x < 0 or w < 1 or x + w > 12 or y < 0 or h < 1:
            return "a pin doesn't fit the 12-column grid"
    return None


# --- building dashboards ------------------------------------------------------------------------------


def _new_id():
    return uuid.uuid4().hex[:8]


def panel(ptype, title, query, x, y, w, h, **options):
    return {
        "id": _new_id(),
        "type": ptype,
        "title": title,
        "query": {"shape": TYPE_SHAPE[ptype], **query},
        "options": options,
        "layout": {"x": x, "y": y, "w": w, "h": h},
    }


def _runs(**q):
    return {"source": "workflow_runs", "params": {}, **q}


def _notes(**q):
    return {"source": "workflow_notifications", "params": {}, **q}


FAILED = [{"field": "status", "op": "eq", "value": "failed"}]


def _workflow_health():
    return {
        "name": "Workflow health",
        "description": "Every workflow at a glance - outcomes, durations, failures and what they filed.",
        "variables": [],
        "panels": [
            panel("stat", "Runs", _runs(bucket="day"), 0, 0, 3, 4, unit=""),
            panel("stat", "Failed runs", _runs(bucket="day", filters=FAILED), 3, 0, 3, 4, tone="bad"),
            panel("stat", "Avg duration", _runs(value="seconds", agg="avg", bucket="day"), 6, 0, 3, 4, unit="s"),
            panel("pie", "Outcomes", _runs(group_by="status"), 9, 0, 3, 8),
            panel("timeseries", "Duration by workflow", _runs(value="seconds", group_by="workflow", agg="max"),
                  0, 4, 9, 8, unit="s"),
            panel("bar", "Failures by workflow", _runs(group_by="workflow", filters=FAILED, limit=10), 9, 8, 3, 8),
            panel("health", "Every run", _runs(limit=120), 0, 12, 9, 4),
            panel("notifications", "Latest notifications", _notes(limit=30), 0, 16, 6, 9),
            panel("table", "Recent failures", _runs(filters=FAILED, limit=50), 6, 16, 6, 9),
        ],
    }


def _notifications_overview():
    return {
        "name": "Notifications overview",
        "description": "What workflows told you, by workflow, by kind and by day.",
        "variables": [],
        "panels": [
            panel("stat", "Filed", _notes(bucket="day"), 0, 0, 4, 4),
            panel("stat", "Unread", _notes(bucket="day", filters=[{"field": "unread", "op": "eq", "value": "true"}]),
                  4, 0, 4, 4),
            panel("stat", "Failures", _notes(bucket="day", filters=[{"field": "event", "op": "eq", "value": "failure"}]),
                  8, 0, 4, 4, tone="bad"),
            panel("bar", "By workflow", _notes(group_by="workflow", limit=10), 0, 4, 6, 8),
            panel("pie", "By kind", _notes(group_by="event"), 6, 4, 6, 8),
            panel("heatmap", "Per workflow per day", _notes(group_by="workflow", bucket="day"), 0, 12, 12, 8),
            panel("notifications", "Latest", _notes(limit=50), 0, 20, 12, 9),
        ],
    }


def _src(source, **q):
    params = q.pop("params", {})
    return {"source": source, "params": params, **q}


def _eq(field, value):
    return {"field": field, "op": "eq", "value": value}


def _market_pulse():
    idx = lambda **q: _src("market_indices", **q)  # noqa: E731
    sectoral = {"category": "SECTORAL INDICES"}
    broad = {"category": "BROAD MARKET INDICES"}
    return {
        "name": "Market pulse",
        "description": "Where the market is today: the headline indices, every sector as a heatmap, breadth, "
                       "and which sectors lead over a month and a year.",
        "category": "Market",
        "variables": [],
        "settings": {"refresh": 300},
        "panels": [
            panel("stat", "NIFTY 50", idx(filters=[_eq("name", "NIFTY 50")], value="percentChange"), 0, 0, 3, 4, unit="%"),
            panel("stat", "NIFTY BANK", idx(filters=[_eq("name", "NIFTY BANK")], value="percentChange"), 3, 0, 3, 4, unit="%"),
            panel("stat", "NIFTY 500 advancing", idx(filters=[_eq("name", "NIFTY 500")], value="advances"), 6, 0, 3, 4),
            panel("stat", "NIFTY 500 declining", idx(filters=[_eq("name", "NIFTY 500")], value="declines"), 9, 0, 3, 4, tone="bad"),
            panel("treemap", "Sectors today", idx(params=sectoral, group_by="name", value="percentChange"), 0, 4, 8, 11, unit="%"),
            panel("bar", "Broad market today", idx(params=broad, group_by="name", value="percentChange", limit=18), 8, 4, 4, 11, unit="%"),
            panel("bar", "Sectors over 30 days", idx(params=sectoral, group_by="name", value="perChange30d", limit=21), 0, 15, 6, 10, unit="%"),
            panel("bar", "Sectors over a year", idx(params=sectoral, group_by="name", value="perChange365d", limit=21), 6, 15, 6, 10, unit="%"),
            panel("table", "Every index", idx(limit=200), 0, 25, 12, 10),
        ],
    }


def _market_movers():
    mov = lambda **q: _src("market_movers", **q)  # noqa: E731
    return {
        "name": "Market movers",
        "description": "NSE's biggest gainers and losers today: a heatmap sized by turnover, the extremes, "
                       "where the money traded, and corporate actions behind the moves.",
        "category": "Market",
        "variables": [],
        "settings": {"refresh": 300},
        "panels": [
            panel("stat", "Gainers", mov(filters=[_eq("side", "gainer")]), 0, 0, 3, 4),
            panel("stat", "Losers", mov(filters=[_eq("side", "loser")]), 3, 0, 3, 4, tone="bad"),
            panel("stat", "Best move", mov(value="changePercent", agg="max"), 6, 0, 3, 4, unit="%"),
            panel("stat", "Worst move", mov(value="changePercent", agg="min"), 9, 0, 3, 4, unit="%"),
            panel("treemap", "Movers by turnover", mov(group_by="symbol", value="changePercent", size="turnover", limit=40),
                  0, 4, 8, 12, unit="%"),
            panel("bar", "Top gainers", mov(filters=[_eq("side", "gainer")], group_by="symbol", value="changePercent", limit=15),
                  8, 4, 4, 12, unit="%"),
            panel("bar", "Top losers", mov(filters=[_eq("side", "loser")], group_by="symbol", value="changePercent", sort="asc", limit=15),
                  0, 16, 4, 10, unit="%"),
            panel("bar", "Highest turnover", mov(group_by="symbol", value="turnover", limit=15), 4, 16, 4, 10),
            panel("table", "Corporate actions behind moves",
                  mov(filters=[{"field": "corporate_action", "op": "set", "value": ""}], limit=50), 8, 16, 4, 10),
            panel("table", "All movers", mov(limit=100), 0, 26, 12, 10),
        ],
    }


def _watchlist_heatmap():
    prices = lambda **q: _src("watchlist_prices", params={"list_name": "$list"}, **q)  # noqa: E731
    return {
        "name": "Watchlist heatmap",
        "description": "Your watchlists at a glance: today's move for every stock as a heatmap, what's up and "
                       "down, volume surges, and 30 days of daily moves.",
        "category": "Market",
        "variables": [{"name": "list", "label": "Watchlist", "query": {"source": "watchlist_prices", "params": {}},
                       "field": "list_name", "default": dq.ALL}],
        "settings": {"from": "now-30d"},
        "panels": [
            panel("stat", "Advancing", prices(filters=[{"field": "changePercent", "op": "gt", "value": "0"}]), 0, 0, 3, 4),
            panel("stat", "Declining", prices(filters=[{"field": "changePercent", "op": "lt", "value": "0"}]), 3, 0, 3, 4, tone="bad"),
            panel("stat", "Average move", prices(value="changePercent", agg="avg"), 6, 0, 3, 4, unit="%"),
            panel("stat", "Biggest volume surge", prices(value="volume_ratio", agg="max"), 9, 0, 3, 4, unit="× avg"),
            panel("treemap", "Today's move", prices(group_by="symbol", value="changePercent"), 0, 4, 8, 12, unit="%"),
            panel("bar", "Best and worst", prices(group_by="symbol", value="changePercent", limit=20), 8, 4, 4, 12, unit="%"),
            panel("heatmap", "Daily moves, 30 days",
                  _src("price_history", params={"list_name": "$list"}, group_by="symbol", value="changePercent", agg="last",
                       bucket="day"), 0, 16, 12, 10, unit="%"),
            panel("bar", "Volume vs 20-day average", prices(group_by="symbol", value="volume_ratio", limit=20), 0, 26, 4, 10, unit="×"),
            panel("table", "Prices", prices(limit=200), 4, 26, 8, 10),
        ],
    }


def _stock_deep_dive():
    bars = lambda **q: _src("price_history", params={"symbol": "$symbol"}, **q)  # noqa: E731
    events = lambda **q: _src("stock_events", params={"symbol": "$symbol"}, **q)  # noqa: E731
    return {
        "name": "Stock deep-dive",
        "description": "One stock, picked from the dropdown: its price and volume over time, how it moved each "
                       "day, and every event and headline behind it.",
        "category": "Market",
        "variables": [{"name": "symbol", "label": "Symbol", "query": {"source": "watchlist_prices", "params": {}},
                       "field": "symbol", "default": dq.ALL}],
        "settings": {"from": "now-90d"},
        "panels": [
            panel("stat", "Close", bars(value="close", agg="last", bucket="day"), 0, 0, 3, 4, unit="₹"),
            panel("stat", "Day's move", bars(value="changePercent", agg="avg", bucket="day"), 3, 0, 3, 4, unit="%"),
            panel("stat", "Events in range", events(bucket="day"), 6, 0, 3, 4),
            panel("stat", "Volume", bars(value="volume", agg="sum", bucket="day"), 9, 0, 3, 4),
            panel("timeseries", "Close", bars(group_by="symbol", value="close", agg="last", bucket="day"), 0, 4, 8, 10, unit="₹"),
            panel("pie", "Events by type", events(group_by="event_type"), 8, 4, 4, 10),
            panel("timeseries", "Volume", bars(group_by="symbol", value="volume", agg="last", bucket="day"), 0, 14, 8, 8),
            panel("bar", "Sentiment by type", events(group_by="event_type", value="sentiment_score", agg="avg"), 8, 14, 4, 8),
            panel("table", "Events and headlines", events(limit=200), 0, 22, 12, 10),
        ],
    }


def _events_radar():
    ev = lambda **q: _src("stock_events", params={"list_name": "$list"}, **q)  # noqa: E731
    return {
        "name": "Events radar",
        "description": "What's happening across your stocks: event volume per stock per day, the kinds of "
                       "events, sentiment, and the latest headlines.",
        "category": "Market",
        "variables": [{"name": "list", "label": "Watchlist", "query": {"source": "watchlist_prices", "params": {}},
                       "field": "list_name", "default": dq.ALL}],
        "settings": {"from": "now-30d"},
        "panels": [
            panel("stat", "Events", ev(bucket="day"), 0, 0, 4, 4),
            panel("stat", "Negative headlines", ev(bucket="day", filters=[_eq("sentiment", "negative")]), 4, 0, 4, 4, tone="bad"),
            panel("stat", "Positive headlines", ev(bucket="day", filters=[_eq("sentiment", "positive")]), 8, 0, 4, 4),
            panel("heatmap", "Events per stock per day", ev(group_by="symbol", bucket="day"), 0, 4, 12, 10),
            panel("treemap", "Where the news is (colour = avg sentiment)",
                  ev(group_by="symbol", value="sentiment_score", agg="avg"), 0, 14, 6, 10),
            panel("pie", "By type", ev(group_by="event_type"), 6, 14, 3, 10),
            panel("bar", "Most-covered stocks", ev(group_by="symbol", limit=15), 9, 14, 3, 10),
            panel("table", "Latest events", ev(limit=200), 0, 24, 12, 10),
        ],
    }


def _trading_journal():
    # $account and $source narrow every panel; left on All they drop out (dashboard_query.ALL).
    scope = [_eq("account", "$account"), _eq("source", "$source")]
    closed = [*scope, _eq("status", "closed")]
    trades = lambda closed_only=True, filters=(), **q: _src(  # noqa: E731
        "journal_trades", filters=[*(closed if closed_only else scope), *filters], **q)
    return {
        "name": "Trading journal",
        "description": "Your journal on a dashboard: P&L after costs, win rate, R, each account's equity curve, "
                       "and where the money is made or lost - by setup, day, session, symbol and emotion.",
        "category": "Trading",
        "variables": [
            {"name": "account", "label": "Account", "query": {"source": "journal_trades", "params": {}},
             "field": "account", "default": dq.ALL},
            {"name": "source", "label": "Source", "query": {"source": "journal_trades", "params": {}},
             "field": "source", "default": dq.ALL},
        ],
        "settings": {"from": "now-90d"},
        "panels": [
            panel("stat", "Net P&L this week", trades(value="net_pnl", agg="sum", bucket="week"), 0, 0, 2, 4, unit="₹"),
            panel("stat", "Net P&L in range", trades(value="net_pnl", agg="sum", bucket="all"), 2, 0, 2, 4, unit="₹"),
            panel("stat", "Win rate this month", trades(value="win_pct", agg="avg", bucket="month"), 4, 0, 2, 4, unit="%"),
            panel("stat", "Avg R this month", trades(value="r_multiple", agg="avg", bucket="month"), 6, 0, 2, 4,
                  unit="R"),
            panel("stat", "Trades this week", trades(closed_only=False, bucket="week"), 8, 0, 2, 4),
            panel("stat", "Costs this month", trades(value="costs", agg="sum", bucket="month"), 10, 0, 2, 4,
                  unit="₹", tone="bad"),
            panel("timeseries", "Equity curve by account",
                  trades(group_by="account", value="account_equity", agg="last", bucket="day"), 0, 4, 8, 10, unit="₹"),
            panel("pie", "Results", trades(group_by="result"), 8, 4, 4, 10),
            panel("bar", "Net P&L by setup", trades(group_by="setup", value="net_pnl", agg="sum"), 0, 14, 4, 9, unit="₹"),
            panel("bar", "Net P&L by weekday", trades(group_by="weekday", value="net_pnl", agg="sum"), 4, 14, 4, 9,
                  unit="₹"),
            panel("bar", "Net P&L by session", trades(group_by="session", value="net_pnl", agg="sum"), 8, 14, 4, 9,
                  unit="₹"),
            panel("heatmap", "Net P&L per symbol per week",
                  trades(group_by="symbol", value="net_pnl", agg="sum", bucket="week"), 0, 23, 8, 10, unit="₹"),
            panel("bar", "Avg net P&L by emotion", trades(group_by="emotion", value="net_pnl", agg="avg"), 8, 23, 4, 10,
                  unit="₹"),
            panel("treemap", "Symbols - size by turnover, colour by net return",
                  {**trades(group_by="symbol", value="net_return_pct", agg="avg"), "size": "turnover"}, 0, 33, 6, 11,
                  unit="%"),
            # How far trades went against you, in R, per setup: the stop-placement question.
            panel("bar", "Avg MAE (R) by setup", trades(group_by="setup", value="mae_r", agg="avg"), 6, 33, 3, 11,
                  unit="R", tone="bad"),
            panel("bar", "Avg MFE (R) by setup", trades(group_by="setup", value="mfe_r", agg="avg"), 9, 33, 3, 11,
                  unit="R"),
            panel("table", "Trades", trades(closed_only=False, limit=200), 0, 44, 12, 10),
        ],
    }


TEMPLATES = {
    "trading-journal": _trading_journal,
    "market-pulse": _market_pulse,
    "market-movers": _market_movers,
    "watchlist-heatmap": _watchlist_heatmap,
    "stock-deep-dive": _stock_deep_dive,
    "events-radar": _events_radar,
    "workflow-health": _workflow_health,
    "notifications-overview": _notifications_overview,
}


def templates():
    return [
        {"id": key, "category": built.get("category", "Workflows"),
         **{k: v for k, v in built.items() if k in ("name", "description")}}
        for key, built in ((key, build()) for key, build in TEMPLATES.items())
    ]


def _pick_group(cols, rows):
    """The field that names things - `symbol` when there is one, else the first text field with a
    handful of distinct values. None when nothing groups."""
    text = [c["name"] for c in cols if c["type"] == "text" and c["name"] != "run_id"]
    if "symbol" in text:
        return "symbol"
    for name in text:
        distinct = {dq._s(r.get(name)) for r in rows}
        if 2 <= len(distinct) <= 60:
            return name
    return None


def from_workflow(workflow):
    """A dashboard built from what one workflow actually collected - a stat and a line per number, a
    table of rows, a top-10, a heatmap, and its health - with a variable for the field that names
    things, so the whole board narrows to one symbol from one dropdown."""
    workflow_id = workflow["id"]
    series = next(iter(db.list_series_names(workflow_id)), None)
    runs = _runs(params={"workflow_id": workflow_id})
    notes = _notes(params={"workflow_id": workflow_id})
    panels, variables, y = [], [], 0

    if series:
        params = {"workflow_id": workflow_id, "series": series}
        rows = _series_rows(params, None, None)
        cols = dq.columns(rows)
        numbers = [c["name"] for c in cols if c["type"] == "number"][:3]
        group = _pick_group(cols, rows)
        filters = [{"field": group, "op": "eq", "value": f"${group}"}] if group else []
        data = lambda **q: {"source": "workflow_series", "params": params, "filters": filters, **q}  # noqa: E731
        if group:
            variables.append({
                "name": group, "label": group,
                "query": {"source": "workflow_series", "params": params}, "field": group, "default": dq.ALL,
            })
        for i, number in enumerate(numbers):
            panels.append(panel("stat", f"{number} (latest, avg)", data(value=number, agg="avg"),
                                i * 4, y, 4, 4))
        y += 4 if numbers else 0
        if numbers:
            panels.append(panel("timeseries", f"{numbers[0]} over runs",
                                data(value=numbers[0], group_by=group, agg="last"), 0, y, 8, 9))
            panels.append(panel("bar", f"Top 10 by {numbers[0]}",
                                data(value=numbers[0], group_by=group or "run_id", agg="last", limit=10),
                                8, y, 4, 9))
            y += 9
        panels.append(panel("table", f"{series} rows", data(limit=500), 0, y, 8 if group else 12, 9))
        if group:
            panels.append(panel("pie", f"Rows by {group}", data(group_by=group, limit=12), 8, y, 4, 9))
        y += 9
        if numbers and group:
            size = next((c["name"] for c in cols if c["type"] == "number"
                         and any(w in c["name"].lower() for w in ("cap", "turnover", "volume"))), None)
            panels.append(panel("treemap", f"{numbers[0]} by {group}" + (f", sized by {size}" if size else ""),
                                data(value=numbers[0], group_by=group, agg="last", size=size), 0, y, 12, 10))
            y += 10
            panels.append(panel("heatmap", f"{numbers[0]} by {group} per day",
                                data(value=numbers[0], group_by=group, agg="avg", bucket="day"), 0, y, 12, 9))
            y += 9

    panels.append(panel("health", "Runs", {**runs, "limit": 120}, 0, y, 12, 4))
    y += 4
    panels.append(panel("stat", "Avg duration", {**runs, "value": "seconds", "agg": "avg", "bucket": "day"},
                        0, y, 4, 4, unit="s"))
    panels.append(panel("notifications", "Notifications", {**notes, "limit": 30}, 4, y, 8, 8))
    return {
        "name": f"{workflow['name']} dashboard",
        "description": f"Built from the '{workflow['name']}' workflow" + (f" and its '{series}' series." if series else "."),
        "variables": variables,
        "panels": panels,
    }


def create(built):
    dashboard_id = str(uuid.uuid4())
    db.save_dashboard(dashboard_id, built["name"], built.get("description"), built["panels"],
                      built.get("variables") or [], {**DEFAULT_SETTINGS, **(built.get("settings") or {})})
    return db.get_dashboard(dashboard_id)
