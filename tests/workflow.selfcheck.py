"""The run-to-diagram shape. Plain asserts, no framework, no database:

    .venv/bin/python tests/workflow.selfcheck.py

workflow.build is pure (see app/services/workflow.py), so the cases worth pinning are the ones a
live run would take weeks to produce by accident: a fan-out of tools in one round, a run that
called nothing, a run still in flight, and a failed tool.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.workflow import build  # noqa: E402


def call(call_id, name, round_=0, seq=0, result=None, error=None, finished=True):
    return {"call_id": call_id, "name": name, "round": round_, "seq": seq, "args": {"symbol": "TCS"},
            "result": result, "error": error, "finished_at": "2026-09-12T10:00:00" if finished else None}


RUN = {"prompt": "How is TCS doing?", "status": "done", "reply": "It is up 2%."}

# --- a run that called nothing still draws ------------------------------------------------------
graph = build(RUN, [])
assert [n["id"] for n in graph["nodes"]] == ["trigger", "reply"]
assert [e["id"] for e in graph["edges"]] == ["trigger->reply"], "an answer with no tools is a real run"

# --- a straight chain ---------------------------------------------------------------------------
graph = build(RUN, [call("a", "get_price", round_=0), call("b", "search_reports", round_=1)])
ids = [n["id"] for n in graph["nodes"]]
assert ids == ["trigger", "call-a", "call-b", "reply"]
assert [e["id"] for e in graph["edges"]] == [
    "trigger->call-a", "call-a->call-b", "call-b->reply",
]
# One column per round, so x strictly increases down the chain.
xs = [n["position"]["x"] for n in graph["nodes"]]
assert xs == sorted(xs) and len(set(xs)) == 4, "each round is its own column"

# --- a fan-out: two tools asked for by ONE model turn --------------------------------------------
# This is the case `round` exists for. Ordering by seq alone would draw a->b in series and claim
# b waited for a, which is not what the agent did.
graph = build(RUN, [
    call("price", "get_price", round_=0, seq=0, result=[1, 2, 3]),
    call("news", "web_search", round_=0, seq=1, result={"results": [1, 2]}),
    call("merge", "search_reports", round_=1),
])
price = next(n for n in graph["nodes"] if n["id"] == "call-price")
news = next(n for n in graph["nodes"] if n["id"] == "call-news")
assert price["position"]["x"] == news["position"]["x"], "siblings share a column"
assert price["position"]["y"] != news["position"]["y"], "...and are stacked, not on top of each other"
assert price["data"]["items"] == 3 and news["data"]["items"] == 2, "a list's length is the item count"

edges = {e["id"] for e in graph["edges"]}
assert {"trigger->call-price", "trigger->call-news"} <= edges, "the fork"
assert {"call-price->call-merge", "call-news->call-merge"} <= edges, "...and the merge"
assert "call-price->call-news" not in edges, "siblings must never be chained to each other"

# The label is what the reference diagram shows on the wire.
assert next(e for e in graph["edges"] if e["id"] == "trigger->call-price")["label"] == "3 items"
assert next(e for e in graph["edges"] if e["id"] == "trigger->call-news")["label"] == "2 items"
assert build(RUN, [call("x", "get_price", result={"price": 1})])["edges"][0]["label"] == "1 item"

# --- in flight ------------------------------------------------------------------------------------
graph = build({**RUN, "status": "running", "reply": None},
              [call("a", "get_price", finished=False)])
running = next(n for n in graph["nodes"] if n["id"] == "call-a")
assert running["data"]["status"] == "running", "started but not finished is still running"
assert next(n for n in graph["nodes"] if n["id"] == "reply")["data"]["label"] == "Working…"
assert all(e["animated"] for e in graph["edges"]), "a live run's wires animate"

# --- a failed tool doesn't stop the diagram ---------------------------------------------------------
graph = build({**RUN, "status": "failed", "error": "boom"},
              [call("a", "get_price", error="upstream 500")])
assert next(n for n in graph["nodes"] if n["id"] == "call-a")["data"]["status"] == "error"
reply = next(n for n in graph["nodes"] if n["id"] == "reply")
assert reply["data"]["status"] == "error" and reply["data"]["label"] == "Failed"
assert reply["data"]["detail"] == "boom", "the failure is what the last node should say"

# Every edge must point at a node that exists - React Flow silently drops an edge that doesn't,
# so a broken graph would look like a missing dependency rather than a bug.
for graph in (build(RUN, []), build(RUN, [call("a", "x"), call("b", "y", round_=1)])):
    ids = {n["id"] for n in graph["nodes"]}
    for edge in graph["edges"]:
        assert edge["source"] in ids and edge["target"] in ids, f"dangling edge {edge['id']}"

print("ok - workflow: rounds as columns, fan-out/merge, item counts, running and failed runs")
