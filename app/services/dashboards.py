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

from app.core import db
from app.core.config import IST
from app.services import dashboard_query as dq

PANEL_TYPES = ("timeseries", "stat", "table", "bar", "pie", "heatmap", "health", "notifications")
#: What each panel type asks the query layer for.
TYPE_SHAPE = {
    "timeseries": "timeseries",
    "stat": "stat",
    "table": "rows",
    "bar": "aggregate",
    "pie": "aggregate",
    "heatmap": "heatmap",
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


SOURCES = {
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
}


def catalogue():
    return [
        {"id": key, "label": s["label"], "description": s["description"], "time_field": s["time_field"],
         "params": s["params"]}
        for key, s in SOURCES.items()
    ]


def param_options(source, params):
    """Choices for each parameter, given the ones already picked - the editor's dropdowns."""
    if source not in SOURCES:
        raise ValueError(f"unknown source '{source}'")
    out = {"workflow_id": [{"value": w["id"], "label": w["name"]} for w in db.list_workflows()]}
    if source == "workflow_series" and (params or {}).get("workflow_id"):
        out["series"] = [{"value": s, "label": s} for s in db.list_series_names(params["workflow_id"])]
    return out


def _window(time_from, time_to, now=None):
    now = now or datetime.now(IST)
    return dq.parse_time(time_from, now), dq.parse_time(time_to, now)


def _fetch(query, variables, time_from, time_to):
    source = SOURCES.get((query or {}).get("source"))
    if not source:
        raise ValueError(f"unknown source '{(query or {}).get('source')}'")
    since, until = _window(time_from, time_to)
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


TEMPLATES = {
    "workflow-health": _workflow_health,
    "notifications-overview": _notifications_overview,
}


def templates():
    return [{"id": key, **{k: v for k, v in build().items() if k in ("name", "description")}}
            for key, build in TEMPLATES.items()]


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
