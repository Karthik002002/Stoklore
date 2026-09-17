"""Turning a source's rows into what a dashboard panel draws.

Pure: rows in, shapes out - no database, no clock (`now` is passed in) - so every panel shape is
checked in tests/dashboards.selfcheck.py against plain lists. Sources (app/services/dashboards.py)
only have to produce flat dicts with a time field; everything a panel does with them happens here,
which is what lets a new source plug in without touching a single panel.

A panel's query:

    source    which rows - see dashboards.SOURCES
    params    the source's own arguments (workflow_id, series); may be "$var"
    filters   [{field, op, value}]; value may be "$var", and a variable set to All drops the filter
    shape     rows | timeseries | aggregate | stat | heatmap
    value     the numeric field to plot or aggregate (none = count rows); a treemap's colour
    size      a treemap tile's area - a numeric field, or none for equal tiles
    group_by  split into a line, bar, slice or heatmap row per value of this field
    agg       last | first | avg | sum | min | max | count
    bucket    run | hour | day - how time is grouped
    sort      desc | asc,  limit
"""
import re
from datetime import datetime, timedelta, timezone

SHAPES = ("rows", "timeseries", "aggregate", "stat", "heatmap", "treemap")
AGGS = ("last", "first", "avg", "sum", "min", "max", "count")
BUCKETS = ("run", "hour", "day")

#: The "All" choice of a variable. A filter whose value resolves to it is dropped, not matched.
ALL = "__all__"
VAR = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)")
RELATIVE = re.compile(r"^now(?:-(\d+)([smhdw]))?$")
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
MAX_LIMIT = 5000


def _s(value):
    return "" if value is None else str(value)


def _num(value):
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


OPS = {
    # Case-insensitive, so a filter typed as "true" matches a boolean field and "rain" matches RAIN.
    "eq": lambda a, b: _s(a).lower() == _s(b).lower(),
    "ne": lambda a, b: _s(a).lower() != _s(b).lower(),
    "gt": lambda a, b: _num(a) is not None and _num(b) is not None and _num(a) > _num(b),
    "gte": lambda a, b: _num(a) is not None and _num(b) is not None and _num(a) >= _num(b),
    "lt": lambda a, b: _num(a) is not None and _num(b) is not None and _num(a) < _num(b),
    "lte": lambda a, b: _num(a) is not None and _num(b) is not None and _num(a) <= _num(b),
    "contains": lambda a, b: _s(b).lower() in _s(a).lower(),
    "in": lambda a, b: _s(a).lower() in [x.strip().lower() for x in _s(b).split(",")],
    # The value is ignored: the field just has to be there - a corporate action, an error, a note.
    "set": lambda a, _b: a not in (None, "") and _s(a).strip() != "",
}


def resolve(value, variables):
    """`$symbol` -> the variable's value. A value that is exactly one variable resolves to None when
    that variable is unset or All - which is what drops a filter on it."""
    if not isinstance(value, str):
        return value
    variables = variables or {}
    whole = VAR.fullmatch(value.strip())
    if whole:
        v = variables.get(whole.group(1))
        return None if v in (None, "", ALL) else v
    return VAR.sub(lambda m: _s(variables.get(m.group(1)) if variables.get(m.group(1)) != ALL else ""), value)


def parse_time(spec, now):
    """'now', 'now-7d' (s m h d w), or an ISO timestamp. None when there is no bound. Anything else
    is refused with the forms that work, not Python's own parse error."""
    if spec in (None, ""):
        return None
    text = str(spec).strip()
    match = RELATIVE.match(text)
    if match:
        if not match.group(1):
            return now
        unit = {"s": "seconds", "m": "minutes", "h": "hours", "d": "days", "w": "weeks"}[match.group(2)]
        return now - timedelta(**{unit: int(match.group(1))})
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError(
            f"'{text}' isn't a time - use now, now-30m, now-6h, now-7d, now-2w or a date like 2026-09-01"
        ) from None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=now.tzinfo)


def _time(row, field):
    value = row.get(field)
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def apply_filters(rows, filters, variables=None):
    active = []
    for f in filters or []:
        value = resolve(f.get("value"), variables)
        if value is None or f.get("op") not in OPS or not f.get("field"):
            continue
        active.append((f["field"], OPS[f["op"]], value))
    return [r for r in rows if all(op(r.get(field), value) for field, op, value in active)]


def _ordered(rows, time_field):
    return sorted(rows, key=lambda r: _time(r, time_field) or EPOCH)


def _bucketed(rows, time_field, bucket):
    """[(bucket_start, row)]. A run is one bucket however many rows it collected, placed at its
    earliest row - so eight symbols priced in one run are one point on the x-axis, not eight."""
    starts = {}
    if bucket == "run":
        for r in rows:
            t = _time(r, time_field)
            if t is None:
                continue
            key = r.get("run_id") or t.isoformat()
            if key not in starts or t < starts[key]:
                starts[key] = t
    out = []
    for r in rows:
        t = _time(r, time_field)
        if t is None:
            continue
        if bucket == "day":
            start = t.replace(hour=0, minute=0, second=0, microsecond=0)
        elif bucket == "hour":
            start = t.replace(minute=0, second=0, microsecond=0)
        else:
            start = starts[r.get("run_id") or t.isoformat()]
        out.append((start, r))
    return out


def aggregate(values, agg):
    if agg == "count":
        return len(values)
    nums = [n for n in (_num(v) for v in values) if n is not None]
    if not nums:
        return None
    if agg == "first":
        return nums[0]
    if agg == "avg":
        return sum(nums) / len(nums)
    if agg == "sum":
        return sum(nums)
    if agg == "min":
        return min(nums)
    if agg == "max":
        return max(nums)
    return nums[-1]


def _looks_time(value):
    return isinstance(value, str) and re.match(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}", value) is not None


def columns(rows):
    """[{name, type}] from the data itself - number when every present value is one, time for
    timestamps, text otherwise. A source's shape is whatever its rows hold, so it is never declared."""
    seen = {}
    for r in rows[:500]:
        for key, value in r.items():
            if value is None:
                continue
            kinds = seen.setdefault(key, set())
            if isinstance(value, bool) or isinstance(value, (dict, list)):
                kinds.add("text")
            elif isinstance(value, (int, float)):
                kinds.add("number")
            elif isinstance(value, datetime) or _looks_time(value):
                kinds.add("time")
            else:
                kinds.add("text")
    return [{"name": k, "type": next(iter(t)) if len(t) == 1 else "text"} for k, t in seen.items()]


def _limit(query, default=1000):
    try:
        return max(1, min(int(query.get("limit") or default), MAX_LIMIT))
    except (TypeError, ValueError):
        return default


def shape(rows, query, variables=None):
    q = query or {}
    kind = q.get("shape") or "rows"
    if kind not in SHAPES:
        raise ValueError(f"unknown panel shape '{kind}'")
    time_field = q.get("time_field") or "time"
    value = q.get("value") or None
    group_by = q.get("group_by") or None
    agg = q.get("agg") if q.get("agg") in AGGS else "last"
    # No value to aggregate means counting rows, whatever agg says.
    how = agg if value else "count"
    bucket = q.get("bucket") if q.get("bucket") in BUCKETS else ("day" if kind == "heatmap" else "run")
    desc = (q.get("sort") or "desc") == "desc"
    limit = _limit(q)

    rows = _ordered(apply_filters(rows, q.get("filters"), variables), time_field)
    group_of = lambda r: _s(r.get(group_by)) if group_by else (value or "count")  # noqa: E731
    pick = lambda r: r.get(value) if value else 1  # noqa: E731

    if kind == "rows":
        ordered = list(reversed(rows)) if desc else rows
        return {"rows": ordered[:limit], "columns": columns(rows), "total": len(rows)}

    if kind == "timeseries":
        groups = {}
        for start, r in _bucketed(rows, time_field, bucket):
            groups.setdefault(group_of(r), {}).setdefault(start, []).append(pick(r))
        series = []
        for key in sorted(groups):
            points = [{"time": b.isoformat(), "value": aggregate(v, how)} for b, v in sorted(groups[key].items())]
            points = [p for p in points if p["value"] is not None]
            if points:
                series.append({"key": key, "points": points})
        return {"series": series[:limit]}

    if kind == "aggregate":
        groups = {}
        for r in rows:
            groups.setdefault(_s(r.get(group_by)) if group_by else "all", []).append(pick(r))
        items = [{"key": k, "value": aggregate(v, how), "count": len(v)} for k, v in groups.items()]
        items = [i for i in items if i["value"] is not None]
        items.sort(key=lambda i: i["value"], reverse=desc)
        return {"items": items[:limit], "total": sum(i["count"] for i in items)}

    if kind == "stat":
        per_bucket = {}
        for start, r in _bucketed(rows, time_field, bucket):
            per_bucket.setdefault(start, []).append(pick(r))
        points = [(b, aggregate(v, how)) for b, v in sorted(per_bucket.items())]
        points = [(b, v) for b, v in points if v is not None]
        current = points[-1][1] if points else None
        previous = points[-2][1] if len(points) > 1 else None
        return {
            "value": current,
            "previous": previous,
            "change": current - previous if current is not None and previous is not None else None,
            "at": points[-1][0].isoformat() if points else None,
            "spark": [{"time": b.isoformat(), "value": v} for b, v in points][-30:],
        }

    if kind == "treemap":
        # One tile per group: its area from `size` (equal when unset), its colour from `value`. The
        # tiles are laid out in the browser, against the panel's real size - a layout computed here
        # would be stretched the moment the panel isn't square.
        size_field = q.get("size") or None
        groups = {}
        for r in rows:
            groups.setdefault(_s(r.get(group_by)) if group_by else "all", []).append(r)
        items = []
        for key, members in groups.items():
            size = aggregate([m.get(size_field) for m in members], "last") if size_field else 1
            if size is None or size <= 0:
                continue
            color = aggregate([m.get(value) for m in members], agg) if value else None
            items.append({"key": key, "size": size, "color": color, "count": len(members)})
        items.sort(key=lambda i: i["size"], reverse=True)
        items = items[: _limit(q, 100)]
        colors = [abs(i["color"]) for i in items if i["color"] is not None]
        return {"items": items, "color_max": max(colors) if colors else None}

    cells, xs, ys = {}, set(), set()
    for start, r in _bucketed(rows, time_field, bucket):
        y = group_of(r)
        cells.setdefault((start, y), []).append(pick(r))
        xs.add(start)
        ys.add(y)
    keep_x = sorted(xs)[-60:]
    keep_y = sorted(ys)[:limit]
    out = [
        {"x": b.isoformat(), "y": y, "value": aggregate(v, how)}
        for (b, y), v in cells.items()
        if b in keep_x and y in keep_y
    ]
    return {"x": [b.isoformat() for b in keep_x], "y": keep_y, "cells": [c for c in out if c["value"] is not None]}


def drill(rows, query, point, variables=None):
    """The source rows behind one mark: a point, bar, slice, cell or stat. `point` is what was
    clicked - {group?, bucket?} - read with the panel's own filters, grouping and bucketing, so the
    drawer shows exactly the rows that made that mark."""
    q = query or {}
    time_field = q.get("time_field") or "time"
    point = point or {}
    rows = _ordered(apply_filters(rows, q.get("filters"), variables), time_field)
    bucket = q.get("bucket") if q.get("bucket") in BUCKETS else ("day" if q.get("shape") == "heatmap" else "run")
    # Buckets first, over every row - exactly as shape() drew them. A run's bucket is timed at its
    # earliest row across ALL groups; narrowing to one group first would re-time the run to that
    # group's own first row, and no row would match the point that was clicked.
    marked = _bucketed(rows, time_field, bucket)
    if point.get("group") is not None and q.get("group_by"):
        marked = [(start, r) for start, r in marked if _s(r.get(q["group_by"])) == _s(point["group"])]
    if point.get("bucket"):
        want = parse_time(point["bucket"], datetime.now(timezone.utc))
        marked = [(start, r) for start, r in marked if start == want]
    rows = [r for _, r in marked] if (point.get("bucket") or point.get("group") is not None) else rows
    rows = list(reversed(rows))[:1000]
    return {"rows": rows, "columns": columns(rows), "total": len(rows)}
