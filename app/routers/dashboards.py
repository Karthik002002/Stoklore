"""Dashboards: CRUD, the query every panel runs, drill-down, and the editor's catalogue.

Literal paths (/sources, /query, /templates, /from-workflow) are registered before /{dashboard_id}
in this one module, so none of them can be read as an id.
"""
import uuid

from fastapi import APIRouter, HTTPException

from app.core import db
from app.schemas import (
    DashboardDrillRequest,
    DashboardParamsRequest,
    DashboardQueryRequest,
    DashboardRequest,
    DashboardValuesRequest,
    HomeBoardRequest,
)
from app.services import dashboards

router = APIRouter(tags=["dashboards"])


def _bad(e):
    return HTTPException(status_code=422, detail=str(e))


@router.get("/api/dashboards/sources")
def sources():
    return {"sources": dashboards.catalogue(), "panel_types": list(dashboards.PANEL_TYPES),
            "shapes": dashboards.TYPE_SHAPE}


@router.post("/api/dashboards/params")
def params(req: DashboardParamsRequest):
    try:
        return dashboards.param_options(req.source, req.params)
    except ValueError as e:
        raise _bad(e) from e


@router.post("/api/dashboards/fields")
def fields(req: DashboardQueryRequest):
    try:
        return dashboards.fields(req.query, req.variables, None, None)
    except ValueError as e:
        raise _bad(e) from e


@router.post("/api/dashboards/values")
def values(req: DashboardValuesRequest):
    try:
        return dashboards.values(req.query, req.field, req.variables, req.time_from, req.time_to)
    except ValueError as e:
        raise _bad(e) from e


@router.post("/api/dashboards/query")
def query(req: DashboardQueryRequest):
    """What one panel draws. Every panel asks separately, so one slow or broken panel never holds up
    or blanks the rest of the board."""
    try:
        return dashboards.run_query(req.query, req.variables, req.time_from, req.time_to)
    except ValueError as e:
        raise _bad(e) from e


@router.post("/api/dashboards/drill")
def drill(req: DashboardDrillRequest):
    try:
        return dashboards.drill(req.query, req.point, req.variables, req.time_from, req.time_to)
    except ValueError as e:
        raise _bad(e) from e


@router.get("/api/dashboards/templates")
def templates():
    return dashboards.templates()


@router.post("/api/dashboards/templates/{template_id}")
def create_from_template(template_id: str):
    build = dashboards.TEMPLATES.get(template_id)
    if build is None:
        raise HTTPException(status_code=404, detail="no such template")
    return dashboards.create(build())


@router.post("/api/dashboards/from-workflow/{workflow_id}")
def create_from_workflow(workflow_id: str):
    workflow = db.get_workflow(workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="no such workflow")
    return dashboards.create(dashboards.from_workflow(workflow))


@router.get("/api/dashboards")
def list_dashboards():
    return db.list_dashboards()


@router.post("/api/dashboards")
def create_dashboard(req: DashboardRequest):
    return save_dashboard(str(uuid.uuid4()), req)


@router.get("/api/dashboards/{dashboard_id}")
def get_dashboard(dashboard_id: str):
    dashboard = db.get_dashboard(dashboard_id)
    if dashboard is None:
        raise HTTPException(status_code=404, detail="no such dashboard")
    return dashboard


@router.put("/api/dashboards/{dashboard_id}")
def save_dashboard(dashboard_id: str, req: DashboardRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="a dashboard needs a name")
    error = dashboards.validate(req.panels, req.variables)
    if error:
        raise HTTPException(status_code=422, detail=error)
    settings = {**dashboards.DEFAULT_SETTINGS, **(req.settings or {})}
    db.save_dashboard(dashboard_id, name, req.description, req.panels, req.variables, settings)
    return db.get_dashboard(dashboard_id)


@router.delete("/api/dashboards/{dashboard_id}")
def delete_dashboard(dashboard_id: str):
    if not db.delete_dashboard(dashboard_id):
        raise HTTPException(status_code=404, detail="no such dashboard")
    return {"ok": True}


@router.get("/api/home-board")
def get_home_board():
    return db.get_home_board()


@router.put("/api/home-board")
def save_home_board(req: HomeBoardRequest):
    error = dashboards.validate_home(req.items)
    if error:
        raise HTTPException(status_code=422, detail=error)
    board = {"items": [{**i, "panel_id": i.get("panel_id") or None} for i in req.items]}
    db.set_home_board(board)
    return board
