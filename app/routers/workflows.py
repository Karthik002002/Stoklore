"""Saved workflows: CRUD, the node catalogue the editor's palette is built from, and running one.

A workflow runs with nobody watching, which is the whole difference from the chat agent - so
everything here is about what was decided IN ADVANCE: the graph, the trigger, and whether it is
enabled. Nothing in a run asks a question.
"""
import threading
import uuid

from fastapi import APIRouter, HTTPException

from app.core import db
from app.schemas import WorkflowRequest
from app.services.agent import AGENT_TOOLS
from app.services.workflow_engine import (
    NODE_KINDS,
    OPERATORS,
    TRIGGER_KINDS,
    topo_order,
    workflow_engine_run,
)
from app.services.workflow_templates import TEMPLATES, TEMPLATES_BY_ID

router = APIRouter(tags=["workflows"])


@router.get("/api/workflows/catalogue")
def catalogue():
    """What the editor's palette offers. Tool nodes come from the agent's own schemas, so a tool
    added there appears here without a second list to keep in step."""
    return {
        "node_kinds": list(NODE_KINDS),
        "trigger_kinds": list(TRIGGER_KINDS),
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
    return [
        {"id": t["id"], "name": t["name"], "description": t["description"],
         "trigger": t["trigger"], "nodes": len(t["graph"]["nodes"])}
        for t in TEMPLATES
    ]


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


@router.get("/api/workflows")
def list_workflows():
    return db.list_workflows()


@router.get("/api/workflows/{workflow_id}")
def get_workflow(workflow_id: str):
    workflow = db.get_workflow(workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="no such workflow")
    return workflow


@router.put("/api/workflows/{workflow_id}")
def save_workflow(workflow_id: str, req: WorkflowRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="a workflow needs a name")
    if req.trigger.get("kind") not in TRIGGER_KINDS:
        raise HTTPException(status_code=422, detail=f"unknown trigger '{req.trigger.get('kind')}'")
    # Refuse a cycle at SAVE time, not at 9am on a schedule with nobody looking.
    try:
        topo_order(req.graph.get("nodes") or [], req.graph.get("edges") or [])
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    db.save_workflow(workflow_id, name, req.description, req.graph, req.trigger, req.enabled,
                     retain_runs=req.retain_runs)
    return db.get_workflow(workflow_id)


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
def workflow_series(workflow_id: str, series: str | None = None, limit: int = 1000):
    """A collected series as rows, newest first, plus which series this workflow has and which of
    their columns are numeric - the chart needs to know what it can plot, and only the data can
    answer that."""
    names = db.list_series_names(workflow_id)
    chosen = series or (names[0] if names else None)
    rows = db.read_series(workflow_id, chosen, limit) if chosen else []
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
