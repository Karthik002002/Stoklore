"""Every shipped workflow template, checked for wiring AND run end to end against fake tools.
Plain asserts, no network, no database:

    .venv/bin/python tests/workflow_templates.selfcheck.py

Why this file exists: two of the first three templates were broken and nothing noticed. One fanned
out over `{{ lists.symbols }}` - but list_watchlists returns a list, which has no `.symbols`, so the
fan-out resolved to nothing. The other gated on the reply of scan_events, which starts a scan and
returns "started" at once, so its condition could never pass. Both ran "successfully" and did
nothing, which is the worst way a scheduled job can fail.

So the fakes below return exactly the shapes the real tools return (read from app/core/scraper.py,
app/services/agent.py and app/services/holdings.py), and every template has to actually DO its job
against them: fan-outs must fan out, gates must open on interesting data, alerts must get filed.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core import scraper  # noqa: E402
from app.services import workflow_engine as we  # noqa: E402
from app.services.agent import AGENT_TOOLS, REAL_TOOL_IMPLS  # noqa: E402
from app.services.workflow_templates import CATEGORIES, QUIET, TEMPLATES  # noqa: E402

assert len(TEMPLATES) >= 15, f"expected at least 15 templates, have {len(TEMPLATES)}"
assert len({t["id"] for t in TEMPLATES}) == len(TEMPLATES), "template ids must be unique"

REQUIRED = {t["function"]["name"]: t["function"]["parameters"].get("required", []) for t in AGENT_TOOLS}
REFERENCED = ("prompt", "message", "left", "right", "rows", "for_each")

# --- static wiring --------------------------------------------------------------------------------
for t in TEMPLATES:
    tid, graph = t["id"], t["graph"]
    assert t["category"] in CATEGORIES and t["description"], tid
    assert t["trigger"]["kind"] in we.TRIGGER_KINDS, tid

    order = we.topo_order(graph["nodes"], graph["edges"])  # raises on a cycle
    ids = {n["id"] for n in graph["nodes"]}
    for edge in graph["edges"]:
        assert edge["source"] in ids and edge["target"] in ids, f"{tid}: dangling edge {edge}"

    for node, parents in order:
        kind, data = node["kind"], node["data"]
        assert kind in we.NODE_KINDS, f"{tid}/{node['id']}: unknown kind {kind}"

        if kind == "tool":
            assert data["tool"] in REAL_TOOL_IMPLS, f"{tid}: '{data['tool']}' is not a real tool"
            for arg in REQUIRED[data["tool"]]:
                assert data.get("args", {}).get(arg), f"{tid}/{node['id']}: missing required '{arg}'"
        if kind == "condition":
            assert data["op"] in we.OPERATORS, f"{tid}/{node['id']}: unknown op {data['op']}"
        if kind == "collect":
            assert data.get("series"), f"{tid}/{node['id']}: a collect needs a series name"

        # Every reference names a node this one is wired to (or `item`, inside its own fan-out). A
        # reference to an unwired node resolves to None at run time - silently.
        texts = [data.get(k) for k in REFERENCED] + list((data.get("args") or {}).values())
        for text in filter(None, texts):
            for ref in we.TEMPLATE.findall(str(text)):
                head = ref.split(".")[0]
                if head == "item":
                    assert data.get("for_each"), f"{tid}/{node['id']}: {{{{ item }}}} outside a for_each"
                else:
                    assert head in parents, (
                        f"{tid}/{node['id']}: references '{head}' but is wired to {parents}"
                    )

    # A screen template's URL is fetched server-side, so it must pass the same guard a pasted one does.
    for node in graph["nodes"]:
        if node["data"].get("tool") == "run_screen":
            scraper.screen_url(node["data"]["args"]["url"])

# --- running every template -----------------------------------------------------------------------
# Shaped exactly like the real returns, and deliberately "interesting": a >5% mover, a 3x volume
# spike, a negative event, a met rule - so every gate SHOULD open and every alerting template SHOULD
# file. A template that files nothing here is wired wrong.
FAKES = {
    "get_movers": lambda count=25: [
        {"symbol": "TCS", "changePercent": 6.2, "volume": 900000, "avgVolume": 200000},
        {"symbol": "INFY", "changePercent": -1.1, "volume": 100000, "avgVolume": 110000},
    ],
    "list_watchlists": lambda: [
        {"symbol": "TCS", "list_name": "Core"},
        {"symbol": "WABAG", "list_name": "Core"},
    ],
    "get_price": lambda symbol: {"symbol": symbol, "price": 101.5, "changePercent": 4.8},
    "get_ema_crossover": lambda symbol, short=20, long=50: {"crossover": "bullish", "short": 20},
    "web_search": lambda query: [{"title": f"{query} wins order", "url": "https://x.test", "snippet": "…"}],
    "check_watch_rule": lambda name, symbol=None: "**buy dip** — met by 1/2 watchlisted stock(s)\n- ✅ TCS\n- ❌ WABAG",
    "get_recent_events": lambda days=1, list_name=None: [
        {"symbol": "WABAG", "event_type": "news", "headline": "Order cancelled", "sentiment": "negative"},
    ],
    "get_holdings": lambda: {"holdings": [{"symbol": "TCS", "quantity": 10, "avg_price": 120.0, "ltp": 101.5}]},
    "run_screen": lambda url, max_pages=4: {
        "name": "Screen", "total": 2, "rows": [
            {"symbol": "GABRIEL", "bse_code": None, "name": "Gabriel India", "current_price": 1300.5},
            {"symbol": None, "bse_code": "538786", "name": "Citizen Solar", "current_price": 199.65},
        ],
    },
}
missing = [t["data"]["tool"] for tpl in TEMPLATES for t in tpl["graph"]["nodes"]
           if t["kind"] == "tool" and t["data"]["tool"] not in FAKES]
assert not missing, f"add a real-shaped fake for: {sorted(set(missing))}"

calls = []


def recorder(name, fn):
    def wrapped(**kwargs):
        calls.append((name, kwargs))
        return fn(**kwargs)
    return wrapped


we.TOOLS = {name: recorder(name, fn) for name, fn in FAKES.items()}
we.RETRY_DELAYS = ()
we.db.get_active_model = lambda: "test-model"
# An agent that found something - so the quiet gate should let it through.
we.llm._generate = lambda prompt, model: "TCS up 6.2% on 4.5x volume"
filed = []
we.alerts.record = lambda kind, message, symbol=None, meta=None: filed.append(message)

for t in TEMPLATES:
    tid = t["id"]
    calls.clear()
    filed.clear()
    errors, results = [], {}

    def on_node(node_id, label, args, result, error, round_):
        results[node_id] = result
        if error:
            errors.append(f"{node_id}: {error}")

    _, text, collected = we.execute(t, on_node=on_node)
    assert not errors, f"{tid}: node errors {errors}"

    kinds = {n["kind"] for n in t["graph"]["nodes"]}
    # Nothing got silently skipped on data that should have opened every gate.
    skipped = [k for k, v in results.items() if v == {"skipped": True}]
    assert not skipped, f"{tid}: skipped {skipped} on data that should have passed"

    if "output" in kinds:
        assert filed, f"{tid}: an alerting template filed nothing on interesting data"
    if "collect" in kinds:
        assert collected and all(rows for _, rows in collected), f"{tid}: collected nothing"

    # Fan-outs actually fan out: one call per watchlisted stock, with that stock's symbol.
    for node in t["graph"]["nodes"]:
        if node["data"].get("for_each") == "{{ lists }}":
            tool = node["data"]["tool"]
            fanned = [kw for name, kw in calls if name == tool]
            assert len(fanned) == 2, f"{tid}: {tool} ran {len(fanned)}x over a 2-stock watchlist"
            assert any("TCS" in str(kw) for kw in fanned) and any("WABAG" in str(kw) for kw in fanned), (
                f"{tid}: fan-out didn't pass each stock's symbol: {fanned}"
            )

# The watchlist price log in particular: every collected row has to say which stock it is.
_, _, collected = we.execute(next(t for t in TEMPLATES if t["id"] == "watchlist-prices"))
rows = collected[0][1]
assert [r["symbol"] for r in rows] == ["TCS", "WABAG"], f"price rows lost their symbol: {rows}"

# --- the quiet path -------------------------------------------------------------------------------
# The same alerting templates on a day nothing happened: the agent says the sentinel, and nothing is
# filed. This is the behaviour that makes arming them bearable.
we.llm._generate = lambda prompt, model: QUIET
quiet_ids = [t["id"] for t in TEMPLATES
             if any(n["data"].get("op") == "not_contains" for n in t["graph"]["nodes"])]
assert len(quiet_ids) >= 8, f"expected most alerting templates to be quiet-gated, got {quiet_ids}"
for tid in quiet_ids:
    filed.clear()
    we.execute(next(t for t in TEMPLATES if t["id"] == tid))
    assert not filed, f"{tid}: filed an alert on a {QUIET} day"

# ...and "none of the others" in real prose must NOT be mistaken for quiet.
we.llm._generate = lambda prompt, model: "TCS moved 6%; none of the others did."
filed.clear()
we.execute(next(t for t in TEMPLATES if t["id"] == "morning-movers"))
assert filed, "ordinary prose containing 'none' silenced a real finding"

print(f"ok - workflow templates: {len(TEMPLATES)} wired, run, fanned out, quiet-gated")
