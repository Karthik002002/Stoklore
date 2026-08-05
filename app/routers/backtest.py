from fastapi import APIRouter
from fastapi import HTTPException

import backtest
import db

from app.schemas import (
    AutoBacktestScriptRequest,
    BacktestLessonsRequest,
    BacktestRunRequest,
    BacktestSaveRequest,
)

router = APIRouter(tags=["backtest"])

def _run_backtest(req):
    if req.short >= req.long:
        raise HTTPException(status_code=422, detail="Short period must be less than the long period")
    result = backtest.run_ema_crossover(req.symbol.upper(), req.short, req.long, req.from_date, req.to_date)
    if result is None:
        raise HTTPException(status_code=404,
                             detail=f"Not enough synced price history for '{req.symbol}' yet - run a price sync first")
    return result


@router.post("/api/backtest/run")
def backtest_run(req: BacktestRunRequest):
    """Runs a backtest without saving it - the interactive preview before deciding to keep it."""
    return _run_backtest(req)


@router.get("/api/backtests")
def backtests(symbol: str | None = None):
    return db.list_backtests(symbol.upper() if symbol else None)


@router.post("/api/backtest")
def backtest_save(req: BacktestSaveRequest):
    """Re-runs the backtest and persists it (with an optional lessons-learned note) - a
    separate call from /api/backtest/run so previewing a backtest never writes a row by itself."""
    result = _run_backtest(req)
    symbol = req.symbol.upper()
    backtest_id = db.create_backtest(
        symbol, req.short, req.long, req.from_date, req.to_date,
        result["summary"]["total_return_pct"], result["summary"]["win_rate"],
        result["summary"]["num_trades"], result["trades"], req.lessons,
    )
    return {"id": backtest_id, "symbol": symbol, **result}


@router.put("/api/backtest/{backtest_id}/lessons")
def backtest_update_lessons(backtest_id: int, req: BacktestLessonsRequest):
    db.update_backtest_lessons(backtest_id, req.lessons)
    return {"ok": True}


@router.delete("/api/backtest/{backtest_id}")
def backtest_delete(backtest_id: int):
    db.delete_backtest(backtest_id)
    return {"ok": True}


# Auto backtest Pine Script templates - execution is client-side (PineTS in the browser, against
# /api/prices/{symbol}), so this is plain CRUD over the saved script text, nothing to run here.
@router.get("/api/backtest/auto/scripts")
def auto_backtest_scripts():
    return db.list_auto_backtest_scripts()


@router.post("/api/backtest/auto/scripts")
def create_auto_backtest_script(req: AutoBacktestScriptRequest):
    if not req.name.strip() or not req.script.strip():
        raise HTTPException(status_code=422, detail="name and script can't be empty")
    return {"id": db.create_auto_backtest_script(req.name.strip(), req.script)}


@router.get("/api/backtest/auto/scripts/{script_id}")
def get_auto_backtest_script(script_id: int):
    script = db.get_auto_backtest_script(script_id)
    if script is None:
        raise HTTPException(status_code=404, detail="script not found")
    return script


@router.put("/api/backtest/auto/scripts/{script_id}")
def update_auto_backtest_script(script_id: int, req: AutoBacktestScriptRequest):
    if not req.name.strip() or not req.script.strip():
        raise HTTPException(status_code=422, detail="name and script can't be empty")
    db.update_auto_backtest_script(script_id, req.name.strip(), req.script)
    return {"ok": True}


@router.delete("/api/backtest/auto/scripts/{script_id}")
def delete_auto_backtest_script(script_id: int):
    db.delete_auto_backtest_script(script_id)
    return {"ok": True}
