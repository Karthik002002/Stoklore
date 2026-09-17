"""The workflow executor's pure half. Plain asserts, no framework, no database, no model:

    .venv/bin/python tests/workflow_engine.selfcheck.py

execute() takes an `on_node` callback and does no persistence itself, which is what lets a whole
graph run here against fake tools. The cases worth pinning are the ones that decide whether a
wired workflow means anything: dependency order, a node only seeing what it is wired to, template
types surviving (`{{ x }}` must hand a LIST to for_each, not the text of one), the fan-out, and
that one broken node doesn't take the run with it.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import workflow_engine as we  # noqa: E402

# --- templates ------------------------------------------------------------------------------------
ctx = {"a": {"price": 101.5, "tags": ["x", "y"]}, "b": [1, 2, 3], "c": "TCS"}

assert we.resolve("{{ a.price }}", ctx) == 101.5, "a lone reference keeps its type"
assert we.resolve("{{ b }}", ctx) == [1, 2, 3], "...including a list, which for_each depends on"
assert we.resolve("Price is {{ a.price }}", ctx) == "Price is 101.5", "interpolation stringifies"
assert we.resolve("{{ c }}/{{ a.price }}", ctx) == "TCS/101.5", "two references in one string"
assert we.resolve("{{ a.tags.1 }}", ctx) == "y", "an index walks into a list"
assert we.resolve("{{ nope.deep.path }}", ctx) is None, "a miss is None, not an exception"
assert we.resolve("x {{ nope }} y", ctx) == "x  y", "...and empty when interpolated"
assert we.resolve("plain", ctx) == "plain" and we.resolve(7, ctx) == 7, "non-templates pass through"
assert we.render({"s": "{{ c }}", "n": ["{{ a.price }}"]}, ctx) == {"s": "TCS", "n": [101.5]}

# --- ordering -------------------------------------------------------------------------------------
nodes = [{"id": "c"}, {"id": "a"}, {"id": "b"}]
edges = [{"source": "a", "target": "b"}, {"source": "b", "target": "c"}]
assert [n["id"] for n, _ in we.topo_order(nodes, edges)] == ["a", "b", "c"]

# A fork and a merge: both branches come after the split and before the join.
nodes = [{"id": n} for n in ("split", "price", "news", "merge")]
edges = [{"source": "split", "target": "price"}, {"source": "split", "target": "news"},
         {"source": "price", "target": "merge"}, {"source": "news", "target": "merge"}]
order = [n["id"] for n, _ in we.topo_order(nodes, edges)]
assert order.index("split") < order.index("price") < order.index("merge")
assert order.index("split") < order.index("news") < order.index("merge")
assert dict(( n["id"], sorted(p)) for n, p in we.topo_order(nodes, edges))["merge"] == ["news", "price"]

try:
    we.topo_order([{"id": "a"}, {"id": "b"}], [{"source": "a", "target": "b"},
                                               {"source": "b", "target": "a"}])
    raise AssertionError("a cycle must be refused, not looped over forever")
except ValueError as e:
    assert "cycle" in str(e)

# An edge to a node that was deleted is ignored rather than crashing the run.
assert [n["id"] for n, _ in we.topo_order([{"id": "a"}], [{"source": "ghost", "target": "a"}])] == ["a"]

# --- executing a graph ------------------------------------------------------------------------------
calls = []


def fake_tool(**kwargs):
    calls.append(kwargs)
    return {"price": 100 + len(calls), "symbol": kwargs.get("symbol")}


we.TOOLS = {"get_price": fake_tool, "boom": lambda **k: (_ for _ in ()).throw(RuntimeError("upstream 500"))}
# Retries are real seconds. Off by default here so the suite stays instant; the retry behaviour
# itself is checked deliberately at the bottom of this file.
we.RETRY_DELAYS = ()
we.llm._generate = lambda prompt, model: f"[said] {prompt}"
we.db.get_active_model = lambda: "test-model"
filed = []
we.alerts.record = lambda kind, message, symbol=None, meta=None: filed.append(message)


def node(node_id, kind, **data):
    return {"id": node_id, "kind": kind, "data": {**data}}


def run(nodes, edges):
    seen = []
    we.execute({"graph": {"nodes": nodes, "edges": edges}},
               on_node=lambda *a: seen.append(a))
    return {s[0]: s for s in seen}


# The reference shape: trigger -> a list -> fan out per item -> summarise -> file it.
seen = run(
    [
        node("t", "trigger"),
        node("symbols", "agent", prompt="list them"),
        node("price", "tool", tool="get_price", for_each="{{ list }}", args={"symbol": "{{ item }}"}),
        node("say", "agent", prompt="Prices: {{ price }}"),
        node("out", "output", message="{{ say }}"),
    ],
    [{"source": "t", "target": "symbols"}, {"source": "symbols", "target": "price"},
     {"source": "price", "target": "say"}, {"source": "say", "target": "out"}],
)
# for_each referenced `{{ list }}`, which isn't in scope. That is a wiring mistake, and it fails the
# node saying so - it must neither iterate over something else nor run once with `item` missing.
assert "isn't wired" in (seen["price"][4] or ""), seen["price"][4]

calls.clear()
seen = run(
    [
        node("syms", "tool", tool="get_price", args={"symbol": "SEED"}),
        node("price", "tool", tool="get_price", for_each="{{ syms.list }}",
             args={"symbol": "{{ item }}"}),
    ],
    [{"source": "syms", "target": "price"}],
)
assert "nothing at 'list'" in (seen["price"][4] or "") and len(calls) == 1, \
    "a for_each path that misses fails the node before its tool is called"

# The real bug this guards: a parent that returns a list, looped over by a field it doesn't have.
# Before, the tool ran once with symbol=None and died on `.upper()`.
calls.clear()
we.TOOLS["watchlists"] = lambda **k: [{"symbol": "TCS", "list_name": "A"}, {"symbol": "INFY", "list_name": "A"}]
seen = run(
    [
        node("lists", "tool", tool="watchlists"),
        node("price", "tool", tool="get_price", for_each="{{ lists.symbols }}", args={"symbol": "{{ item }}"}),
    ],
    [{"source": "lists", "target": "price"}],
)
assert not calls, "get_price was never called with a missing symbol"
assert "already a list of 2" in seen["price"][4] and "{{ lists }}" in seen["price"][4] \
    and "{{ item.symbol }}" in seen["price"][4], seen["price"][4]

# A real fan-out, with the list coming from a parent.
we.TOOLS["listing"] = lambda **k: {"list": ["TCS", "INFY", "WIPRO"]}
calls.clear()
seen = run(
    [node("l", "tool", tool="listing"),
     node("p", "tool", tool="get_price", for_each="{{ l.list }}", args={"symbol": "{{ item }}"})],
    [{"source": "l", "target": "p"}],
)
assert [c["symbol"] for c in calls] == ["TCS", "INFY", "WIPRO"], "once per item, item in scope"
assert len(seen["p"][3]) == 3, "the node's output is the list of per-item results"

# Scope: a node only sees what it is WIRED to. Referencing an unconnected node resolves to
# nothing, so a missing edge shows up as missing data instead of quietly working anyway.
calls.clear()
seen = run(
    [node("a", "tool", tool="listing"), node("b", "tool", tool="get_price", args={"symbol": "{{ a.list }}"})],
    [],  # deliberately no edge
)
assert calls == [{"symbol": None}], "an unwired reference is None, not the other node's value"

# One failing node fails alone; the rest of the graph still runs and the run still completes.
seen = run(
    [node("bad", "tool", tool="boom"), node("good", "tool", tool="listing")],
    [],
)
assert seen["bad"][4] and "upstream 500" in seen["bad"][4], "the node records its own error"
assert seen["good"][4] is None, "an unrelated node is unaffected"

# A per-item failure inside a fan-out is that item's result, not the end of the run.
we.TOOLS["sometimes"] = lambda **k: (_ for _ in ()).throw(RuntimeError("no")) if k["symbol"] == "B" else "ok"
seen = run(
    [node("l2", "tool", tool="listing"),
     node("p2", "tool", tool="sometimes", for_each="{{ l2.list }}", args={"symbol": "{{ item }}"})],
    [{"source": "l2", "target": "p2"}],
)
assert seen["p2"][4] is None, "the node itself succeeded"

# ...but when every item fails there is no data, only an outage. The node fails, so the next step
# can't "decide" from a list of errors that nothing moved.
we.TOOLS["never"] = lambda **k: (_ for _ in ()).throw(RuntimeError("feed down"))
seen = run(
    [node("l3", "tool", tool="listing"),
     node("p3", "tool", tool="never", for_each="{{ l3.list }}", args={"symbol": "{{ item }}"}),
     node("s3", "agent", prompt="{{ p3 }}")],
    [{"source": "l3", "target": "p3"}, {"source": "p3", "target": "s3"}],
)
assert "every item failed" in (seen["p3"][4] or "") and "feed down" in seen["p3"][4], seen["p3"][4]

# An output node files to the alerts feed, with its template already resolved.
filed.clear()
run([node("o", "output", message="done: {{ nothing }}")], [])
assert filed == ["done: "], "output files the rendered message"

# --- conditions: the gate that buys silence ---------------------------------------------------
# A workflow that files something every morning is another inbox. These pin the third outcome -
# skipped - which is what makes "only tell me when it matters" expressible.
we.TOOLS["big"] = lambda **k: {"pct": 7.5}
we.TOOLS["small"] = lambda **k: {"pct": 0.4}


def gated(tool, op="gt", right="5"):
    return run(
        [node("src", "tool", tool=tool),
         node("gate", "condition", left="{{ src.pct }}", op=op, right=right),
         node("say", "agent", prompt="about {{ gate }}"),
         node("out", "output", message="{{ say }}")],
        [{"source": "src", "target": "gate"}, {"source": "gate", "target": "say"},
         {"source": "say", "target": "out"}],
    )


seen = gated("big")
assert seen["gate"][3]["passed"] is True
assert seen["say"][3] != {"skipped": True}, "a passing gate lets the branch run"

filed.clear()
seen = gated("small")
assert seen["gate"][3]["passed"] is False
# Everything downstream is skipped, not failed: nothing went wrong, there was just nothing to say.
assert seen["say"][3] == {"skipped": True}, "a failed gate skips its child"
assert seen["out"][3] == {"skipped": True}, "...and the child's child, transitively"
assert seen["say"][4] is None, "skipped is not an error"
assert filed == [], "a gated-off workflow files nothing - that is the entire point"

# Comparisons, including the ones that have to cope with a missing field.
assert gated("big", "lt", "5")["gate"][3]["passed"] is False
assert gated("big", "gte", "7.5")["gate"][3]["passed"] is True
we.TOOLS["empty"] = lambda **k: {}
assert gated("empty", "gt", "5")["gate"][3]["passed"] is False, "a missing number must not pass a threshold"
assert gated("empty", "not_empty")["gate"][3]["passed"] is False
assert gated("big", "not_empty")["gate"][3]["passed"] is True
# `contains` reads the LEFT value as text, which is how "did the scan mention anything negative"
# is asked of a tool that answers with prose.
we.TOOLS["news"] = lambda **k: {"pct": "TCS: negative sentiment on the filing"}
assert gated("news", "contains", "negative")["gate"][3]["passed"] is True
assert gated("news", "contains", "upgrade")["gate"][3]["passed"] is False

# A run where every branch was gated says so, rather than reporting an empty success.
_, text, _ = we.execute({"graph": {
    "nodes": [node("s", "tool", tool="small"),
              node("g", "condition", left="{{ s.pct }}", op="gt", right="5"),
              node("a", "agent", prompt="x")],
    "edges": [{"source": "s", "target": "g"}, {"source": "g", "target": "a"}]}})
assert "Nothing crossed the line" in text

# --- collect: what makes a chart possible ---------------------------------------------------------
we.TOOLS["many"] = lambda **k: [{"symbol": "TCS", "price": 1}, {"symbol": "INFY", "price": 2}]
_, _, collected = we.execute({"graph": {
    "nodes": [node("m", "tool", tool="many"),
              node("c", "collect", series="prices", rows="{{ m }}")],
    "edges": [{"source": "m", "target": "c"}]}})
assert collected == [("prices", [{"symbol": "TCS", "price": 1}, {"symbol": "INFY", "price": 2}])], (
    "a list collects as many rows - eight symbols is eight rows, not one row holding a list"
)

# A scalar is still one row, so a series is always a table.
_, _, collected = we.execute({"graph": {
    "nodes": [node("s", "tool", tool="small"), node("c", "collect", series="s", rows="{{ s.pct }}")],
    "edges": [{"source": "s", "target": "c"}]}})
assert collected == [("s", [{"value": 0.4}])]

# A gated-off collect stores nothing - silence must not quietly poison the series with blanks.
_, _, collected = we.execute({"graph": {
    "nodes": [node("s", "tool", tool="small"),
              node("g", "condition", left="{{ s.pct }}", op="gt", right="5"),
              node("c", "collect", series="s", rows="{{ s }}")],
    "edges": [{"source": "s", "target": "g"}, {"source": "g", "target": "c"}]}})
assert collected == [], "a skipped collect appends nothing"

# --- retries: the difference between "the 9am scan works" and "works on a good day" ----------------
attempts = {"n": 0}


def flaky(**kwargs):
    attempts["n"] += 1
    if attempts["n"] < 3:
        raise RuntimeError("upstream 503")
    return {"ok": True}


we.TOOLS["flaky"] = flaky
we.RETRY_DELAYS = (0, 0, 0)  # same number of attempts, no real waiting
seen = run([node("f", "tool", tool="flaky")], [])
assert attempts["n"] == 3 and seen["f"][4] is None, "a transient failure is retried, not reported"

attempts["n"] = 0
we.TOOLS["always"] = lambda **k: (_ for _ in ()).throw(RuntimeError("gone"))
seen = run([node("a", "tool", tool="always")], [])
assert seen["a"][4] and "gone" in seen["a"][4], "a permanent failure still fails, after the retries"

# A condition is pure and a collect is a local write - neither fails for a reason a second attempt
# would fix, so neither is retried.
assert "condition" not in we.RETRYABLE and "collect" not in we.RETRYABLE

print("ok - workflow engine: templates, order, cycles, scope, fan-out, failure, conditions, collect, retries")

# --- a failed quote is neither cached nor handed on -------------------------------------------
import app.deps as deps  # noqa: E402
from app.services import agent  # noqa: E402

stored = []
deps.db.get_cached = lambda *a: None
deps.db.set_cached = lambda sym, kind, data: stored.append(data)
assert deps._cached("X", "price", 15, lambda: {"price": None, "changePercent": None})["price"] is None
assert stored == [], "an all-null quote is a failed fetch - caching it served blanks for 15 minutes"
deps._cached("X", "movers", 15, lambda: [])
deps._cached("X", "price", 15, lambda: {"price": 10, "changePercent": None})
assert stored == [[], {"price": 10, "changePercent": None}], "real answers, even empty lists, still cache"
deps.db.get_cached = lambda *a: {"price": None, "changePercent": None}
assert deps._cached("X", "price", 15, lambda: {"price": 5, "changePercent": 1})["price"] == 5, \
    "a blank already in the cache is a miss, not 15 more minutes of nulls"

agent.scraper.get_price = lambda s: {"price": None, "changePercent": None}
try:
    agent._tool_get_price("coforge")
    raise AssertionError("a null price must fail, not reach the model as 'no move'")
except ValueError as e:
    assert "COFORGE" in str(e)
agent.scraper.get_price = lambda s: {"price": 1793.0, "changePercent": 1.49}
assert agent._tool_get_price("coforge") == {"symbol": "COFORGE", "price": 1793.0, "changePercent": 1.49}
print("price guard checks passed")
