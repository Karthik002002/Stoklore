"""One agent run, as a flow diagram.

The chat transcript says what the agent *concluded*; this says what it actually *did* - which
tools ran, in what order, what each one returned, and which of them ran off the same decision. It
is the n8n-style read of a run: a trigger, a chain of task nodes, a report at the end.

Pure: rows in, {nodes, edges} out. No database, no React, no layout library - which is what lets
the whole shape be checked in tests/workflow.selfcheck.py against fixtures instead of a live run.
The browser draws these with React Flow and never recomputes them, so the diagram and any future
consumer (an export, a summary) agree by construction.

**`round` is the whole trick.** The agent loop asks the model for tools, runs every tool it asked
for, feeds the results back, and asks again. Tools sharing a round were requested by ONE model
turn - they are siblings that fan out from the same decision, exactly like a split in an n8n
graph. Ordering them by `seq` alone would draw a straight line and lose that.
"""

#: Canvas geometry. A column per round, a row per branch within it - the layout is deterministic
#: so a run always draws the same way, and a node the user drags is theirs to keep (positions are
#: not stored, so reopening re-columns it).
COL_WIDTH = 260
ROW_HEIGHT = 130


def _status(call):
    if call.get("error"):
        return "error"
    return "done" if call.get("finished_at") else "running"


def _item_count(result):
    """What the edge label says. A list of hits is its length; anything else is one item - the
    same reading n8n's "N items" uses, and the honest answer for a scalar."""
    if isinstance(result, list):
        return len(result)
    if isinstance(result, dict):
        for key in ("results", "items", "data", "events", "stocks", "trades"):
            if isinstance(result.get(key), list):
                return len(result[key])
    return 1


def _node(node_id, label, kind, status, **data):
    return {
        "id": node_id,
        "type": "task",
        # Filled in by _layout once the columns are known - React Flow needs a position on every
        # node, and a node without one silently stacks at the origin.
        "position": {"x": 0, "y": 0},
        "data": {"label": label, "kind": kind, "status": status, **data},
    }


def _layout(columns):
    """Assigns positions column by column, each column's rows centred against the tallest one, so
    a fan-out reads as a fork rather than as everything hanging off the top edge."""
    tallest = max((len(c) for c in columns), default=1)
    for x, column in enumerate(columns):
        offset = (tallest - len(column)) / 2
        for y, node in enumerate(column):
            node["position"] = {"x": x * COL_WIDTH, "y": (y + offset) * ROW_HEIGHT}
    return [node for column in columns for node in column]


def build(run, calls):
    """`run` is a chat_runs row, `calls` its chat_tool_calls rows (any order). Returns React Flow's
    own {nodes, edges} shape.

    A run that called nothing still draws: trigger -> reply. That is a real and common answer
    ("the model knew it without looking anything up"), and a blank canvas would read as breakage.
    """
    prompt = (run.get("prompt") or "").strip()
    status = run.get("status") or "done"

    trigger = _node(
        "trigger",
        prompt[:60] + ("…" if len(prompt) > 60 else "") or "Prompt",
        "trigger",
        "done",
        detail=prompt,
    )
    columns = [[trigger]]

    by_round = {}
    for call in sorted(calls, key=lambda c: (c.get("round", 0), c.get("seq", 0))):
        by_round.setdefault(call.get("round", 0), []).append(call)

    edges = []
    previous = [trigger["id"]]
    for round_ in sorted(by_round):
        column = []
        for call in by_round[round_]:
            node_id = f"call-{call['call_id']}"
            column.append(
                _node(
                    node_id,
                    call["name"],
                    "tool",
                    _status(call),
                    args=call.get("args") or {},
                    result=call.get("result"),
                    error=call.get("error"),
                    items=_item_count(call.get("result")),
                )
            )
        # Every node of the previous column feeds every node of this one. The agent hands the
        # model ALL prior results before it picks the next tools, so a narrower edge set would
        # claim a dependency the loop doesn't actually have.
        for source in previous:
            for node in column:
                edges.append(_edge(source, node["id"], node["data"]["items"], node["data"]["status"]))
        columns.append(column)
        previous = [n["id"] for n in column]

    reply_status = {"running": "running", "failed": "error"}.get(status, "done")
    reply_text = (run.get("error") or run.get("reply") or "").strip()
    reply = _node(
        "reply",
        "Answer" if status == "done" else ("Failed" if status == "failed" else "Working…"),
        "reply",
        reply_status,
        detail=reply_text,
    )
    for source in previous:
        edges.append(_edge(source, reply["id"], 1, reply_status))
    columns.append([reply])

    return {"nodes": _layout(columns), "edges": edges}


def _edge(source, target, items, status):
    return {
        "id": f"{source}->{target}",
        "source": source,
        "target": target,
        "label": f"{items} item{'' if items == 1 else 's'}",
        # A live edge animates, a finished one doesn't - the canvas shows where a run is without
        # a separate progress widget.
        "animated": status == "running",
        "status": status,
    }
