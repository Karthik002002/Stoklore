"""Running a hand-wired workflow: no model deciding what to do, no human watching it happen.

The Chat tab is the agent choosing its own tools a turn at a time. A workflow is the opposite
contract - YOU wired the graph, so the same graph runs the same way every time, and the only
thing left to decide at run time is what the data says.

A workflow is nodes + edges (stored whole on `workflows.graph`). Four node kinds:

    trigger    what sets the workflow off - schedule, manual, or after the daily event scan
    tool       one of the agent's own tools (app/services/agent.py), with arguments you fill in
    agent      one LLM call: a prompt with upstream data pasted into it, producing text
    condition  a gate - everything downstream is SKIPPED unless the comparison holds
    collect    appends rows to a named series, so the workflow builds up data over time
    output     what to do with the result - file it to the alerts feed

The point of `condition` is silence. A workflow that files something every morning is another
inbox; one that files only when a number crosses a line is the thing that lets you stop looking.
So a failed condition does not fail the run - it marks the branch SKIPPED, which is a third
outcome next to done and error and is drawn as its own colour.

Nodes read their parents' results through `{{ nodeId.path.to.value }}` templates, which is the
whole "wiring" - an edge says what may be referenced, a template says what actually is.

**A node with `for_each` runs once per item** and its output is the list of those results. That is
the fan-out in an n8n graph ("8 items" on the wire): one `get_price` node over a watchlist is
eight calls, not one.

Execution is recorded as a normal run (chat_runs + chat_tool_calls), so a workflow execution gets
the existing flow diagram and run history for free - the picture of what a workflow did and the
picture of what a chat did are the same picture, drawn by app/services/workflow.py.

The pure half - `topo_order`, `resolve`, `render` - is checked in tests/workflow_engine.selfcheck.py.
"""
import json
import re
import time
import uuid
from datetime import datetime

from app.core import alerts, db, llm
from app.core.config import IST
from app.services.agent import REAL_TOOL_IMPLS

#: `{{ nodeId }}` or `{{ nodeId.a.b }}`, and `{{ item }}` / `{{ item.x }}` inside a for_each.
TEMPLATE = re.compile(r"\{\{\s*([A-Za-z0-9_\-.]+)\s*\}\}")

TRIGGER_KINDS = ("manual", "schedule", "event_scan")
NODE_KINDS = ("trigger", "tool", "agent", "condition", "collect", "output")

#: A node that failed for a transient reason - a rate limit, a 5xx, a dropped connection - is worth
#: asking again. These are the delays between attempts; the count of attempts is len() + 1.
RETRY_DELAYS = (1, 3, 8)
#: Node kinds worth retrying. A condition is pure and a collect is a local write; neither fails for
#: a reason that a second attempt would fix.
RETRYABLE = ("tool", "agent")

#: What a condition can ask. Deliberately small - the interesting comparisons in this app are a
#: number against a threshold and a substring against some text.
OPERATORS = {
    "gt": lambda a, b: _num(a) > _num(b),
    "gte": lambda a, b: _num(a) >= _num(b),
    "lt": lambda a, b: _num(a) < _num(b),
    "lte": lambda a, b: _num(a) <= _num(b),
    "eq": lambda a, b: _stringify(a).strip() == _stringify(b).strip(),
    "ne": lambda a, b: _stringify(a).strip() != _stringify(b).strip(),
    "contains": lambda a, b: _stringify(b).lower() in _stringify(a).lower(),
    # The gate an agent node pairs with: prompt it to answer with a sentinel when nothing qualifies,
    # then pass only when the sentinel is absent. A sentinel, not "none" - "none of the others" is
    # ordinary prose and would silence a real finding.
    "not_contains": lambda a, b: _stringify(b).lower() not in _stringify(a).lower(),
    "not_empty": lambda a, _b: bool(a) and a != [] and a != {},
}

#: A branch that a condition switched off. Not an error - nothing went wrong, the workflow simply
#: had nothing to say - which is the whole point of having conditions.
SKIPPED = object()

#: Workflows bypass the agent's confirm gate. Creating and enabling a workflow IS the
#: confirmation - given in advance, deliberately, for this exact graph - and a scheduled run has
#: nobody to ask at 9am. REAL_TOOL_IMPLS is the ungated table; AGENT_TOOL_IMPLS is the gated one
#: the chat agent gets.
TOOLS = REAL_TOOL_IMPLS


def topo_order(nodes, edges):
    """Nodes in dependency order, with each node's parents. Raises on a cycle rather than looping
    forever - the editor can draw one, and a workflow that hangs is worse than one that refuses.

    Returns [(node, [parent_id, ...]), ...].
    """
    by_id = {n["id"]: n for n in nodes}
    parents = {n["id"]: [] for n in nodes}
    for edge in edges:
        if edge["source"] in by_id and edge["target"] in by_id:
            parents[edge["target"]].append(edge["source"])

    ordered, done = [], set()
    while len(done) < len(by_id):
        ready = [i for i in by_id if i not in done and all(p in done for p in parents[i])]
        if not ready:
            raise ValueError("this workflow has a cycle - a node can't wait on itself")
        # Sorted so a graph always executes in the same order, which is what makes a run
        # reproducible and its diagram stable between runs.
        for node_id in sorted(ready):
            ordered.append((by_id[node_id], parents[node_id]))
            done.add(node_id)
    return ordered


def _dig(value, path):
    """Walks a dotted path into whatever a node returned. A miss is None, not an exception: a
    workflow shouldn't die because one API response was missing one optional field."""
    for key in path:
        if isinstance(value, dict):
            value = value.get(key)
        elif isinstance(value, list) and key.isdigit() and int(key) < len(value):
            value = value[int(key)]
        else:
            return None
        if value is None:
            return None
    return value


def _num(value):
    """A number out of whatever a tool returned. A value that isn't one compares as NaN-ish rather
    than raising: a threshold test against a missing field should be False, not a failed run."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return float("-inf")


def _stringify(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, default=str, ensure_ascii=False)


def resolve(template, context):
    """One template string against the run context.

    A string that is EXACTLY one reference keeps the referenced value's type - `{{ prices }}` hands
    a list to a for_each rather than the text of a list. Anything with surrounding text is a
    string, because that is the only thing "Report for {{ sym }}" can mean.
    """
    if not isinstance(template, str):
        return template
    whole = TEMPLATE.fullmatch(template.strip())
    if whole:
        head, *path = whole.group(1).split(".")
        return _dig(context.get(head), path)
    return TEMPLATE.sub(
        lambda m: _stringify(_dig(context.get(m.group(1).split(".")[0]), m.group(1).split(".")[1:])),
        template,
    )


def render(value, context):
    """resolve(), applied through a node's whole argument dict."""
    if isinstance(value, dict):
        return {k: render(v, context) for k, v in value.items()}
    if isinstance(value, list):
        return [render(v, context) for v in value]
    return resolve(value, context)


def _run_node(node, context, model):
    """One node's output. Everything a node can be is here, and nothing here touches the database -
    the recording happens in execute() so this stays readable as "what does this node compute"."""
    data = node.get("data") or {}
    kind = node.get("kind") or data.get("kind") or "tool"

    if kind == "trigger":
        return {"started_at": datetime.now(IST).isoformat()}

    if kind == "agent":
        prompt = resolve(data.get("prompt") or "", context)
        return llm._generate(prompt, model)

    if kind == "condition":
        left = resolve(data.get("left") or "", context)
        op = OPERATORS.get(data.get("op") or "gt")
        if op is None:
            raise ValueError(f"'{data.get('op')}' isn't a comparison this app knows")
        passed = bool(op(left, resolve(data.get("right") or "", context)))
        return {"passed": passed, "left": left}

    if kind == "collect":
        rows = resolve(data.get("rows") or "", context)
        # A list collects as many rows, anything else as one. The series is a table, and a tool
        # that answered with eight symbols should be eight rows in it, not one row holding a list.
        rows = rows if isinstance(rows, list) else [rows]
        return [r if isinstance(r, dict) else {"value": r} for r in rows if r is not None]

    if kind == "output":
        message = resolve(data.get("message") or "", context)
        alerts.record("workflow", message, symbol=data.get("symbol") or None,
                      meta={"workflow_node": node["id"]})
        return {"filed": message}

    name = data.get("tool")
    if name not in TOOLS:
        raise ValueError(f"'{name}' isn't a tool this app has")
    return TOOLS[name](**(render(data.get("args") or {}, context)))


def execute(workflow, run_id=None, on_node=None):
    """Runs a workflow start to finish. Returns (run_id, summary_text).

    `on_node(node_id, name, args, result, error, round_)` is called after each node - the executor
    itself does no persistence, which is what lets the self-check run a whole graph with no
    database behind it.
    """
    graph = workflow.get("graph") or {}
    nodes, edges = graph.get("nodes") or [], graph.get("edges") or []
    if not nodes:
        return run_id, "This workflow has no nodes yet.", []

    model = db.get_active_model()
    context, summary = {}, []

    collected = []

    for round_, (node, parents) in enumerate(topo_order(nodes, edges)):
        data = node.get("data") or {}
        kind = node.get("kind") or "tool"
        label = data.get("label") or data.get("tool") or kind or node["id"]

        # A node whose parent was skipped - or whose parent was a condition that said no - is
        # skipped too. That is how one gate silences a whole branch without every node below it
        # needing to know a condition exists.
        if any(_is_off(context.get(p)) for p in parents):
            context[node["id"]] = SKIPPED
            if on_node:
                on_node(node["id"], label, {}, {"skipped": True}, None, round_)
            continue

        # A node only sees what it is wired to. An unconnected node referencing another's output
        # is a wiring mistake, and resolving it anyway would hide that the edge is missing.
        scope = {p: context.get(p) for p in parents}
        each = resolve(data.get("for_each"), scope) if data.get("for_each") else None

        try:
            if each is None:
                result = _attempt(node, scope, model, kind)
            elif isinstance(each, list):
                # The fan-out. Each item runs with `item` in scope; one failure becomes that
                # item's result rather than ending the whole workflow, because "seven of eight
                # symbols answered" is a useful run and an exception is not.
                result = []
                for item in each:
                    try:
                        result.append(_attempt(node, {**scope, "item": item}, model, kind))
                    except Exception as e:  # noqa: BLE001
                        result.append({"error": str(e)})
            else:
                raise ValueError(f"for_each on '{label}' needs a list, got {type(each).__name__}")
            context[node["id"]] = result
            error = None
        except Exception as e:  # noqa: BLE001 - one bad node reports itself and stops the branch
            context[node["id"]] = None
            result, error = None, str(e)

        if kind == "collect" and not error:
            rows = result if isinstance(result, list) else [result]
            collected.append((data.get("series") or "data", [r for r in rows if isinstance(r, dict)]))

        if on_node:
            on_node(node["id"], label, render(data.get("args") or {}, scope), result, error, round_)
        if error:
            summary.append(f"{label}: failed - {error}")
        elif kind == "agent":
            summary.append(_stringify(result))

    text = "\n\n".join(s for s in summary if s)
    if not text:
        # Every branch was gated off. Saying so beats "Workflow finished", which reads like it
        # found nothing when in fact it decided there was nothing worth telling you.
        gated = any(_is_off(v) for v in context.values())
        text = "Nothing crossed the line - no alert." if gated else "Workflow finished."
    return run_id, text, collected


def _is_off(value):
    """Whether a parent's result switches its children off - either it was skipped itself, or it is
    a condition that answered no."""
    return value is SKIPPED or (isinstance(value, dict) and value.get("passed") is False)


def _attempt(node, scope, model, kind):
    """_run_node, with retries for the kinds whose failures are usually somebody else's outage.

    A scheduled run has nobody to press the button again, so the retry is the difference between
    "the 9am scan works" and "the 9am scan works when the upstream is having a good day".
    """
    if kind not in RETRYABLE:
        return _run_node(node, scope, model)
    for delay in RETRY_DELAYS:
        try:
            return _run_node(node, scope, model)
        except Exception:  # noqa: BLE001 - the last attempt below is the one that raises
            time.sleep(delay)
    return _run_node(node, scope, model)


def workflow_engine_run(workflow, run_id=None):
    """Executes a workflow and records it as a run, so it shows up in the history and the flow
    diagram alongside every chat run.

    `run_id` is passed in by "Run now" - the endpoint hands the id to the browser before the work
    starts, so the page can watch a run that does not exist yet without polling for its id.
    """
    run_id = run_id or str(uuid.uuid4())
    db.create_run(run_id, None, f"Workflow: {workflow['name']}", db.get_active_model(),
                  workflow_id=workflow["id"])
    seq = {"n": 0}
    failed = []

    def record(node_id, label, args, result, error, round_):
        db.start_tool_call(run_id, node_id, round_, seq["n"], label, args)
        seq["n"] += 1
        db.finish_tool_call(run_id, node_id, result=result, error=error)
        if error:
            failed.append(label)

    try:
        _, summary, collected = execute(workflow, run_id, on_node=record)
        for series, rows in collected:
            if rows:
                db.append_series(workflow["id"], series, run_id, rows)
        # Pruned after every run rather than on a sweep: retention is "the last N runs", so the
        # moment there is a new run is exactly the moment an old one falls out of the window.
        if collected:
            db.prune_series(workflow["id"], workflow.get("retain_runs") or 30)

        if failed:
            # A node blowing up is caught per node so the rest of the graph still runs - but the
            # RUN is not a success, and recording it as one is how a workflow ends up quietly
            # producing nothing for a week while the history shows green.
            error = f"{len(failed)} node{'' if len(failed) == 1 else 's'} failed: {', '.join(failed[:3])}"
            db.finish_run(run_id, reply=summary, error=error)
            _report_failure(workflow, error)
        else:
            db.finish_run(run_id, reply=summary)
            db.set_fail_streak(workflow["id"], 0)
    except Exception as e:  # noqa: BLE001 - a cycle, or a graph that can't be ordered at all
        db.finish_run(run_id, error=str(e))
        _report_failure(workflow, str(e))
        summary = None
    return run_id, summary


def _report_failure(workflow, error):
    """A workflow that breaks has to say so. Nobody is watching a 9am run, and the failure mode
    this guards against is not a crash - it is a workflow that quietly produces nothing for a week
    while you assume no news is good news."""
    streak = (workflow.get("fail_streak") or 0) + 1
    db.set_fail_streak(workflow["id"], streak)
    alerts.record(
        "workflow",
        f"⚠️ '{workflow['name']}' failed: {error}"
        + (f" ({streak} runs in a row)" if streak > 1 else ""),
        meta={"workflow_id": workflow["id"], "fail_streak": streak},
    )
