"""Saved workflows: CRUD, the node catalogue the editor's palette is built from, and running one.

A workflow runs with nobody watching, which is the whole difference from the chat agent - so
everything here is about what was decided IN ADVANCE: the graph, the trigger, and whether it is
enabled. Nothing in a run asks a question.
"""
import threading
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException

from app.core import db
from app.core.config import IST
from app.schemas import (
    NotificationReadRequest,
    ScreenWorkflowRequest,
    TriggerPreviewRequest,
    WorkflowNotifyRequest,
    WorkflowRequest,
)
from app.services import workflow_notify, workflow_triggers
from app.services.agent import AGENT_TOOLS
from app.services.workflow_engine import (
    NODE_KINDS,
    OPERATORS,
    TRIGGER_KINDS,
    topo_order,
    workflow_engine_run,
)
from app.core import scraper
from app.services.workflow_templates import CATEGORIES, TEMPLATES, TEMPLATES_BY_ID, screen_graph

router = APIRouter(tags=["workflows"])


@router.get("/api/workflows/catalogue")
def catalogue():
    """What the editor's palette offers. Tool nodes come from the agent's own schemas, so a tool
    added there appears here without a second list to keep in step."""
    return {
        "node_kinds": list(NODE_KINDS),
        "trigger_kinds": list(TRIGGER_KINDS),
        "order_events": list(workflow_triggers.ORDER_EVENTS),
        "operators": list(OPERATORS),
        "tools": [
            {
                "name": t["function"]["name"],
                "description": t["function"]["description"],
                "parameters": list((t["function"].get("parameters") or {}).get("properties", {}).keys()),
                "required": (t["function"].get("parameters") or {}).get("required", []),
            }
            for t in AGENT_TOOLS
        ],
    }


@router.get("/api/workflows/templates")
def templates():
    """Working graphs to clone. The distance from an empty canvas to something useful is where a
    node editor usually dies, so the first workflow should be one you edit, not one you invent."""
    return {
        "categories": CATEGORIES,
        "templates": [
            {"id": t["id"], "name": t["name"], "category": t["category"],
             "description": t["description"], "trigger": t["trigger"],
             "nodes": len(t["graph"]["nodes"])}
            for t in TEMPLATES
        ],
    }


@router.post("/api/workflows/templates/{template_id}")
def create_from_template(template_id: str):
    template = TEMPLATES_BY_ID.get(template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="no such template")
    workflow_id = str(uuid.uuid4())
    # Cloned disabled on purpose: a template is a starting point, and arming something you have
    # not read yet is exactly the surprise this feature must not produce.
    db.save_workflow(workflow_id, template["name"], template["description"],
                     template["graph"], template["trigger"], False)
    return db.get_workflow(workflow_id)


@router.post("/api/workflows/from-screen")
def create_from_screen(req: ScreenWorkflowRequest):
    """A workflow from a pasted screener.in screen URL.

    The screen is fetched once, here, before anything is saved: a URL that isn't a screen, or a
    screen that has gone private, should fail while you are looking at it - not at 7pm tomorrow in
    a run nobody is watching. The first page also supplies the name and the query, so the saved
    workflow says what it screens for.
    """
    try:
        screen = scraper.get_screen(req.url, max_pages=1, session_cookie=db.get_screener_cookie())
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    name = screen["name"] or "screener.in screen"
    nodes, pairs = screen_graph(screen["url"], name, max_pages=req.max_pages)
    graph = {"nodes": nodes, "edges": [{"id": f"e-{a}-{b}", "source": a, "target": b} for a, b in pairs]}
    description = f"From screener.in: {screen['query']}" if screen.get("query") else f"From {screen['url']}"
    workflow_id = str(uuid.uuid4())
    # Disarmed, same as a template: it runs on someone else's query, and you should see what it
    # matches before it starts filing anything.
    db.save_workflow(workflow_id, name, description, graph,
                     {"kind": "schedule", "time": req.time}, False)
    return {
        "workflow": db.get_workflow(workflow_id),
        "preview": {"total": screen["total"], "columns": screen["columns"],
                    "rows": screen["rows"][:5], "query": screen.get("query")},
    }


def _shaped(workflows, with_unread=False):
    """Adds what only the server can work out: the trigger in words, when it next runs (holidays
    included), the effective notify rules, and - for the list - unread notification counts."""
    now = datetime.now(IST)
    names = {w["id"]: w["name"] for w in db.list_workflows()} if len(workflows) == 1 else {
        w["id"]: w["name"] for w in workflows
    }
    guarded = any((w.get("trigger") or {}).get("trading_days_only") or (w.get("trigger") or {}).get("kind") == "market"
                  for w in workflows)
    holidays = workflow_triggers.trading_holidays() if guarded else frozenset()
    unread = db.unread_workflow_notification_counts() if with_unread else {}
    return [
        {
            **w,
            "notify": workflow_notify.rules(w),
            "trigger_label": workflow_triggers.label(w.get("trigger") or {}, names),
            "next_run_at": workflow_triggers.next_run_at(w, now, holidays),
            "unread": unread.get(w["id"], 0),
        }
        for w in workflows
    ]


@router.get("/api/workflows")
def list_workflows():
    return _shaped(db.list_workflows(), with_unread=True)


@router.post("/api/workflows/trigger-preview")
def trigger_preview(req: TriggerPreviewRequest):
    """The trigger in words and its next five runs, before anything is saved - so "the 31st" or a
    cron typo shows its consequences while you're still looking at it."""
    error = workflow_triggers.validate(req.trigger)
    if error:
        return {"error": error, "label": None, "next": []}
    now = datetime.now(IST)
    holidays = workflow_triggers.trading_holidays()
    names = {w["id"]: w["name"] for w in db.list_workflows()}
    return {
        "error": None,
        "label": workflow_triggers.label(req.trigger, names),
        "next": [t.isoformat() for t in workflow_triggers.upcoming(req.trigger, now, 5, holidays)],
    }


@router.get("/api/workflows/notifications/recent")
def recent_notifications(since: datetime):
    """Delivered since `since`, for desktop notifications - rules already applied, so a muted
    workflow never pops up."""
    names = {w["id"]: w["name"] for w in db.list_workflows()}
    return [
        {**row, "workflow_name": names.get((row.get("meta") or {}).get("workflow_id"))}
        for row in db.recent_workflow_notifications(since)
    ]


@router.get("/api/workflows/{workflow_id}")
def get_workflow(workflow_id: str):
    workflow = db.get_workflow(workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="no such workflow")
    return _shaped([workflow])[0]


@router.put("/api/workflows/{workflow_id}")
def save_workflow(workflow_id: str, req: WorkflowRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="a workflow needs a name")
    trigger_error = workflow_triggers.validate(req.trigger)
    if trigger_error:
        raise HTTPException(status_code=422, detail=trigger_error)
    if req.trigger.get("kind") == "workflow_done" and req.trigger.get("workflow_id") == workflow_id:
        raise HTTPException(status_code=422, detail="a workflow can't be chained after itself")
    # Refuse a cycle at SAVE time, not at 9am on a schedule with nobody looking.
    try:
        topo_order(req.graph.get("nodes") or [], req.graph.get("edges") or [])
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    db.save_workflow(workflow_id, name, req.description, req.graph, req.trigger, req.enabled,
                     retain_runs=req.retain_runs)
    return get_workflow(workflow_id)


@router.put("/api/workflows/{workflow_id}/notify")
def save_notify(workflow_id: str, req: WorkflowNotifyRequest):
    """Delivery rules on their own endpoint, so saving the graph never resets them (and back)."""
    if db.get_workflow(workflow_id) is None:
        raise HTTPException(status_code=404, detail="no such workflow")
    clean, error = workflow_notify.validate(req.notify)
    if error:
        raise HTTPException(status_code=422, detail=error)
    db.set_workflow_notify(workflow_id, clean)
    return get_workflow(workflow_id)


@router.get("/api/workflows/{workflow_id}/notifications")
def workflow_notifications(workflow_id: str, unread: bool = False, limit: int = 200):
    return db.list_workflow_notifications(workflow_id, unread=unread, limit=limit)


@router.post("/api/workflows/{workflow_id}/notifications/read")
def read_notifications(workflow_id: str, req: NotificationReadRequest):
    return {"updated": db.mark_workflow_notifications_read(workflow_id, req.ids)}


@router.delete("/api/workflows/{workflow_id}/notifications/{alert_id}")
def delete_notification(workflow_id: str, alert_id: int):
    if not db.delete_workflow_notification(workflow_id, alert_id):
        raise HTTPException(status_code=404, detail="no such notification on this workflow")
    return {"ok": True}


@router.post("/api/workflows")
def create_workflow(req: WorkflowRequest):
    return save_workflow(str(uuid.uuid4()), req)


@router.delete("/api/workflows/{workflow_id}")
def delete_workflow(workflow_id: str):
    db.delete_workflow(workflow_id)
    return {"ok": True}


@router.post("/api/workflows/{workflow_id}/run")
def run_workflow(workflow_id: str):
    """Run now. Backgrounded like a chat run, so the browser gets a run id immediately and the
    execution survives leaving the page - a fan-out over a watchlist is not a two-second job."""
    workflow = db.get_workflow(workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="no such workflow")
    run_id = str(uuid.uuid4())
    threading.Thread(target=workflow_engine_run, args=(workflow, run_id), daemon=True).start()
    return {"run_id": run_id}


@router.get("/api/workflows/{workflow_id}/series")
def workflow_series(workflow_id: str, series: str | None = None, limit: int = 1000, run_id: str | None = None):
    """A collected series as rows, newest first, plus which series this workflow has and which of
    their columns are numeric - the chart needs to know what it can plot, and only the data can
    answer that."""
    names = db.list_series_names(workflow_id)
    chosen = series or (names[0] if names else None)
    rows = db.read_series(workflow_id, chosen, limit, run_id=run_id) if chosen else []
    shaped = [
        {"run_id": r["run_id"], "collected_at": r["collected_at"], **(r["row"] or {})} for r in rows
    ]
    numeric = sorted({
        key for row in shaped for key, value in row.items()
        if isinstance(value, (int, float)) and not isinstance(value, bool)
    })
    columns = sorted({key for row in shaped for key in row} - {"run_id", "collected_at"})
    return {"series": names, "selected": chosen, "rows": shaped,
            "columns": columns, "numeric": numeric}


@router.get("/api/workflows/{workflow_id}/health")
def workflow_health(workflow_id: str):
    """Is this workflow actually working? Duration and pass/fail per run, plus which node fails
    most - the thing you cannot see from a feed that has simply gone quiet."""
    health = db.workflow_health(workflow_id)
    runs = health["runs"]
    done = [r for r in runs if r["status"] == "done"]
    return {
        **health,
        "total": len(runs),
        "failed": sum(1 for r in runs if r["status"] == "failed"),
        "avg_seconds": round(sum(r["seconds"] or 0 for r in done) / len(done), 1) if done else None,
    }


@router.get("/api/workflows/{workflow_id}/runs")
def workflow_runs(workflow_id: str, limit: int = 20):
    with_rows = db.list_runs(limit=limit)
    return [r for r in with_rows if r.get("workflow_id") == workflow_id]
