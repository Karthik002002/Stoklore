"""Every dashboard panel shape, against plain lists. No database, no clock:

    .venv/bin/python tests/dashboards.selfcheck.py

dashboard_query is pure - rows in, shapes out - so what a time series, a stat, a bar, a heatmap or a
drill-down actually computes is pinned here. The builders (templates, from-workflow) are checked
too, with the database stubbed, because a starter dashboard that fails validation is a broken first
impression.
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import dashboard_query as dq  # noqa: E402
from app.services import dashboards  # noqa: E402

UTC = timezone.utc
NOW = datetime(2026, 9, 17, 12, 0, tzinfo=UTC)


def row(minutes_ago, run, symbol, pct, **extra):
    return {"collected_at": (NOW - timedelta(minutes=minutes_ago)).isoformat(), "run_id": run,
            "symbol": symbol, "changePercent": pct, **extra}


ROWS = [
    # run r1, two days ago
    row(2 * 1440, "r1", "TCS", 1.0), row(2 * 1440 - 1, "r1", "INFY", -2.0),
    # run r2, yesterday
    row(1440, "r2", "TCS", 3.0), row(1440 - 1, "r2", "INFY", -1.0),
    # run r3, now
    row(5, "r3", "TCS", 5.0), row(4, "r3", "INFY", 4.0), row(3, "r3", "RAIN", 7.5),
]
Q = {"time_field": "collected_at"}

# --- variables and time ----------------------------------------------------------------------------
assert dq.resolve("$symbol", {"symbol": "TCS"}) == "TCS"
assert dq.resolve("$symbol", {"symbol": dq.ALL}) is None, "All drops the filter"
assert dq.resolve("$symbol", {}) is None, "an unset variable drops it too"
assert dq.resolve("Report for $symbol", {"symbol": "TCS"}) == "Report for TCS"
assert dq.parse_time("now-7d", NOW) == NOW - timedelta(days=7)
assert dq.parse_time("now-6h", NOW) == NOW - timedelta(hours=6)
assert dq.parse_time("now", NOW) == NOW and dq.parse_time(None, NOW) is None
assert dq.parse_time("2026-09-01T00:00:00Z", NOW) == datetime(2026, 9, 1, tzinfo=UTC)
assert dq.parse_time("now-30s", NOW) == NOW - timedelta(seconds=30)
try:
    dq.parse_time("yesterday-ish", NOW)
except ValueError as e:
    assert "now-7d" in str(e), "a bad range says which forms work"
else:
    raise AssertionError("an unreadable time is refused")

# --- filters ----------------------------------------------------------------------------------------
tcs = dq.apply_filters(ROWS, [{"field": "symbol", "op": "eq", "value": "$symbol"}], {"symbol": "tcs"})
assert len(tcs) == 3, "case-insensitive, variable-driven"
assert len(dq.apply_filters(ROWS, [{"field": "symbol", "op": "eq", "value": "$symbol"}], {"symbol": dq.ALL})) == 7
assert len(dq.apply_filters(ROWS, [{"field": "changePercent", "op": "gt", "value": "3"}])) == 3
assert len(dq.apply_filters(ROWS, [{"field": "symbol", "op": "in", "value": "TCS, RAIN"}])) == 4
assert dq.apply_filters([{"unread": True}], [{"field": "unread", "op": "eq", "value": "true"}]), "a boolean matches 'true'"
has = dq.apply_filters([{"ca": "Dividend"}, {"ca": None}, {"ca": "  "}, {}], [{"field": "ca", "op": "set", "value": ""}])
assert has == [{"ca": "Dividend"}], "'has a value' ignores the value and skips blanks"

# --- rows -------------------------------------------------------------------------------------------
out = dq.shape(ROWS, {**Q, "shape": "rows", "limit": 2})
assert [r["symbol"] for r in out["rows"]] == ["RAIN", "INFY"] and out["total"] == 7, "newest first, limited"
types = {c["name"]: c["type"] for c in out["columns"]}
assert types == {"collected_at": "time", "run_id": "text", "symbol": "text", "changePercent": "number"}, types

# --- time series: a run is one point, a group is one line ---------------------------------------------
ts = dq.shape(ROWS, {**Q, "shape": "timeseries", "value": "changePercent", "group_by": "symbol", "agg": "last"})
lines = {s["key"]: [p["value"] for p in s["points"]] for s in ts["series"]}
assert lines == {"INFY": [-2.0, -1.0, 4.0], "RAIN": [7.5], "TCS": [1.0, 3.0, 5.0]}, lines
one = dq.shape(ROWS, {**Q, "shape": "timeseries", "value": "changePercent", "agg": "avg"})
assert len(one["series"]) == 1 and [round(p["value"], 2) for p in one["series"][0]["points"]] == [-0.5, 1.0, 5.5]
counted = dq.shape(ROWS, {**Q, "shape": "timeseries", "bucket": "day"})
assert [p["value"] for p in counted["series"][0]["points"]] == [2, 2, 3], "no value = count rows per bucket"

# --- aggregate: bars and slices ---------------------------------------------------------------------
bars = dq.shape(ROWS, {**Q, "shape": "aggregate", "value": "changePercent", "group_by": "symbol", "agg": "last", "limit": 2})
assert [(i["key"], i["value"]) for i in bars["items"]] == [("RAIN", 7.5), ("TCS", 5.0)], bars
slices = dq.shape(ROWS, {**Q, "shape": "aggregate", "group_by": "symbol", "sort": "asc"})
assert [(i["key"], i["value"]) for i in slices["items"]][0] == ("RAIN", 1) and slices["total"] == 7

# --- stat: the latest bucket, and how it moved --------------------------------------------------------
stat = dq.shape(ROWS, {**Q, "shape": "stat", "value": "changePercent", "agg": "max",
                       "filters": [{"field": "symbol", "op": "eq", "value": "TCS"}]})
assert (stat["value"], stat["previous"], stat["change"]) == (5.0, 3.0, 2.0), stat
assert [p["value"] for p in stat["spark"]] == [1.0, 3.0, 5.0]
assert dq.shape([], {**Q, "shape": "stat"})["value"] is None, "no data is None, not 0"

# --- heatmap ----------------------------------------------------------------------------------------
heat = dq.shape(ROWS, {**Q, "shape": "heatmap", "value": "changePercent", "group_by": "symbol", "agg": "avg"})
assert len(heat["x"]) == 3 and heat["y"] == ["INFY", "RAIN", "TCS"]
assert {(c["y"], c["value"]) for c in heat["cells"] if c["x"] == heat["x"][-1]} == {("TCS", 5.0), ("INFY", 4.0), ("RAIN", 7.5)}

# --- treemap: a tile per group, sized and coloured ---------------------------------------------------
tm = dq.shape(ROWS + [row(2, "r3", "ZERO", 1.0, turnover=0)],
              {**Q, "shape": "treemap", "group_by": "symbol", "value": "changePercent", "agg": "last", "size": "turnover"})
assert tm["items"] == [], "no tile has a positive size when the size field is missing - nothing to draw"
sized = [dict(r, turnover={"TCS": 300, "INFY": 100, "RAIN": 50}[r["symbol"]]) for r in ROWS] + [row(2, "r3", "ZERO", 9.0, turnover=0)]
tm = dq.shape(sized, {**Q, "shape": "treemap", "group_by": "symbol", "value": "changePercent", "agg": "last", "size": "turnover"})
assert [(i["key"], i["size"], i["color"]) for i in tm["items"]] == [("TCS", 300, 5.0), ("INFY", 100, 4.0), ("RAIN", 50, 7.5)], tm
assert tm["color_max"] == 7.5, "the colour scale is the largest move, either way"
equal = dq.shape(ROWS, {**Q, "shape": "treemap", "group_by": "symbol", "value": "changePercent"})
assert {i["size"] for i in equal["items"]} == {1}, "no size field = equal tiles"

# --- drill-down: exactly the rows behind a mark ------------------------------------------------------
point = ts["series"][2]["points"][1]  # TCS in run r2
rows = dq.drill(ROWS, {**Q, "shape": "timeseries", "value": "changePercent", "group_by": "symbol"},
                {"group": "TCS", "bucket": point["time"]})
assert [(r["symbol"], r["run_id"]) for r in rows["rows"]] == [("TCS", "r2")], rows
assert len(dq.drill(ROWS, {**Q, "group_by": "symbol"}, {"group": "INFY"})["rows"]) == 3
# A group that is NOT the first row of its run. Timing the run from that group alone put the bucket a
# minute late, and drilling into RAIN's point found nothing - caught against a real database.
query = {**Q, "shape": "timeseries", "value": "changePercent", "group_by": "symbol"}
rain = next(s for s in ts["series"] if s["key"] == "RAIN")["points"][0]
assert [(r["symbol"], r["run_id"]) for r in dq.drill(ROWS, query, {"group": "RAIN", "bucket": rain["time"]})["rows"]] == [("RAIN", "r3")]
infy = next(s for s in ts["series"] if s["key"] == "INFY")["points"][1]
assert [(r["symbol"], r["run_id"]) for r in dq.drill(ROWS, query, {"group": "INFY", "bucket": infy["time"]})["rows"]] == [("INFY", "r2")]

try:
    dq.shape(ROWS, {**Q, "shape": "radar"})
except ValueError as e:
    assert "shape" in str(e)
else:
    raise AssertionError("an unknown shape is refused")

# --- builders ---------------------------------------------------------------------------------------
for key, build in dashboards.TEMPLATES.items():
    built = build()
    assert dashboards.validate(built["panels"], built["variables"]) is None, (key, dashboards.validate(built["panels"], built["variables"]))
    assert all(p["query"]["shape"] == dashboards.TYPE_SHAPE[p["type"]] for p in built["panels"]), key

dashboards.db.list_series_names = lambda workflow_id: ["prices"]
dashboards.db.read_series = lambda *a, **k: [
    {"run_id": r["run_id"], "collected_at": r["collected_at"], "row": {"symbol": r["symbol"], "changePercent": r["changePercent"]}}
    for r in ROWS
]
built = dashboards.from_workflow({"id": "wf1", "name": "Watchlist big moves"})
assert dashboards.validate(built["panels"], built["variables"]) is None, dashboards.validate(built["panels"], built["variables"])
assert built["variables"][0]["name"] == "symbol", "the field that names things becomes the dropdown"
kinds = [p["type"] for p in built["panels"]]
assert {"stat", "timeseries", "bar", "table", "pie", "heatmap", "health", "notifications"} <= set(kinds), kinds
assert any(f.get("value") == "$symbol" for p in built["panels"] for f in p["query"].get("filters") or []), \
    "data panels follow the symbol variable"

dashboards.db.list_series_names = lambda workflow_id: []
bare = dashboards.from_workflow({"id": "wf2", "name": "Event triage"})
assert dashboards.validate(bare["panels"], bare["variables"]) is None and {p["type"] for p in bare["panels"]} >= {"health", "notifications"}, \
    "a workflow that collects nothing still gets its health"

assert dashboards.validate([{"id": "a", "type": "stat", "query": {"source": "workflow_runs"}, "layout": {"x": 10, "y": 0, "w": 4, "h": 2}}], []), \
    "a panel past the 12th column is refused"

print("ok - dashboards: variables, time, filters, rows, timeseries, aggregate, stat, heatmap, drill, templates, from-workflow")
