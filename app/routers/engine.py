"""A checkout of the C++ trading engine (the separate `hft` repo), driven from the /engine page.

Stoklore supplies what it already has - intraday bars and a UI - and the engine does the trading
logic, so a strategy backtested here is the same compiled code that trades on the VPS.

Runs are the engine's own JSON files, not table rows: `backtest --json` writes one per run and the
live engine rewrites `<paper|live>-<date>.json` every minute, both in one shape. Nothing here
touches the journal database except the settings below.

    <engine folder>/runs/<id>.json        backtests started from this page
    <engine folder>/runs/live/<id>.json   paper/live session reports, rsynced from the VPS

Where things live is per-install, so none of it is hardcoded: each location is a setting saved
from Settings > Algo engine, falling back to an env var, then to the default below. The name is
the user's own label for their engine - it's what the sidebar and page title call it.
"""
import itertools
import json
import os
import re
import secrets
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.core import db
from app.core import minute_data
from app.schemas import EngineBacktestRequest, EngineSettingsRequest

router = APIRouter(tags=["engine"])

# setting key -> (env var, default). The reports default matches REPORT_DIR in the engine's
# deploy/algo.env.example.
SETTINGS = {
    "engine_name": ("ENGINE_NAME", "Algo Engine"),
    "engine_dir": ("ENGINE_DIR", ""),
    "engine_vps": ("ENGINE_VPS", ""),
    "engine_vps_reports": ("ENGINE_VPS_REPORTS", "/var/lib/algo/reports"),
}
MAX_RUNS = 200
HEAVY = ("equity", "daily", "trades", "by_symbol")  # left out of the runs list
SAFE_ID = re.compile(r"^[A-Za-z0-9_&-][A-Za-z0-9_.&-]*$")
PARAM = re.compile(r"^[a-z_][a-z0-9_]*$")
VPS = re.compile(r"^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$")
REMOTE_DIR = re.compile(r"^/[A-Za-z0-9_./-]*$")  # goes through the remote shell, so no spaces/metachars


def _setting(key):
    env, default = SETTINGS[key]
    return db.get_setting_value(key) or os.environ.get(env) or default


def _root(required=True):
    """The engine checkout, or None when it isn't configured yet (and not required)."""
    raw = _setting("engine_dir")
    if not raw:
        if required:
            raise HTTPException(400, "Set the engine folder first (Settings > Algo engine)")
        return None
    return Path(raw).expanduser()


def _runs(root):
    return root / "runs", root / "runs" / "live"


def _engine(root, *args):
    binary = root / "build" / "backtest"
    if not binary.exists():
        raise HTTPException(503, f"Engine not built - run `make` in {root}")
    res = subprocess.run([str(binary), *args], cwd=root, capture_output=True, text=True, timeout=600)
    if res.returncode:
        raise HTTPException(500, res.stderr.strip() or f"engine exited {res.returncode}")
    return json.loads(res.stdout)


def _bars_csv(root, symbol, interval):
    try:
        bars = minute_data.get_minute_bars(symbol, interval)["bars"]
    except Exception as e:
        raise HTTPException(502, f"{symbol}: {e}") from e
    if not bars:
        raise HTTPException(404, f"No {interval} bars for {symbol}")
    path = root / "data" / f"{symbol}_{interval}.csv"
    path.parent.mkdir(exist_ok=True)
    with open(path, "w") as f:
        f.write("time,open,high,low,close,volume\n")
        f.writelines(f"{b['time']},{b['open']},{b['high']},{b['low']},{b['close']},{b['volume']}\n" for b in bars)
    return str(path)


# path -> (mtime, row). Reading every run file in full on each list call would re-parse megabytes
# of trades to show one table row per file.
_rows = {}


def _load(path):
    d = json.loads(path.read_text())
    d.setdefault("id", path.stem)  # live reports are named by the engine, not by us
    d.setdefault("created", datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat())
    return d


def _row(path):
    mtime = path.stat().st_mtime
    hit = _rows.get(path)
    if not hit or hit[0] != mtime:
        hit = _rows[path] = (mtime, {k: v for k, v in _load(path).items() if k not in HEAVY})
    return hit[1]


def _path(run_id):
    if SAFE_ID.match(run_id):
        for p in (d / f"{run_id}.json" for d in _runs(_root())):
            if p.exists():
                return p
    raise HTTPException(404, f"No run '{run_id}'")


@router.get("/api/engine/strategies")
def engine_strategies():
    return _engine(_root(), "--list")


@router.post("/api/engine/backtest")
def engine_backtest(req: EngineBacktestRequest):
    """One backtest per combination of the param lists, run in parallel. Blocks until all finish -
    each is milliseconds of C++; the only slow part is Stoklore's first extract of a new symbol."""
    root = _root()
    runs_dir = _runs(root)[0]
    strategies = {s["name"] for s in _engine(root, "--list")}
    if req.strategy not in strategies:
        raise HTTPException(422, f"Unknown strategy '{req.strategy}'")
    symbols = sorted({s.strip().upper() for s in req.symbols if s.strip()})
    if not symbols or not all(SAFE_ID.match(s) for s in symbols):
        raise HTTPException(422, "Give at least one valid NSE symbol")
    if req.interval not in minute_data.BUCKETS:
        raise HTTPException(422, f"interval must be one of {list(minute_data.BUCKETS)}")
    grid = {k: v for k, v in req.params.items() if v}
    if not all(PARAM.match(k) for k in grid):
        raise HTTPException(422, "Bad parameter name")
    combos = [dict(zip(grid, values)) for values in itertools.product(*grid.values())]
    if len(combos) > MAX_RUNS:
        raise HTTPException(422, f"{len(combos)} combinations - keep a sweep under {MAX_RUNS}")

    files = [_bars_csv(root, s, req.interval) for s in symbols]
    batch = time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(2)
    created = datetime.now(timezone.utc).isoformat()
    varied = sorted(k for k, v in grid.items() if len(set(v)) > 1)
    runs_dir.mkdir(parents=True, exist_ok=True)

    def run(i, combo):
        kv = [f"{k}={v:g}" for k, v in combo.items()]
        result = _engine(root, req.strategy, *files, *kv, f"cost_bps={req.cost_bps:g}", "--json")
        result.update(id=f"bt-{batch}-{i}", source="backtest", created=created, batch=batch,
                      label=(req.label or "").strip() or None, symbols=symbols, interval=req.interval,
                      varied=varied)
        path = runs_dir / f"{result['id']}.json"
        path.write_text(json.dumps(result))
        return _row(path)

    with ThreadPoolExecutor(os.cpu_count() or 4) as pool:
        rows = list(pool.map(run, range(len(combos)), combos))
    return {"batch": batch, "runs": rows}


@router.get("/api/engine/runs")
def engine_runs():
    root = _root(required=False)
    if not root:
        return []
    paths = [p for d in _runs(root) for p in d.glob("*.json")]
    return sorted((_row(p) for p in paths), key=lambda r: r["created"], reverse=True)


@router.get("/api/engine/runs/{run_id}")
def engine_run(run_id: str):
    return _load(_path(run_id))


@router.delete("/api/engine/runs/{run_id}")
def engine_delete_run(run_id: str):
    path = _path(run_id)
    path.unlink()
    _rows.pop(path, None)
    return {"ok": True}


@router.delete("/api/engine/batches/{batch}")
def engine_delete_batch(batch: str):
    """A whole sweep. Matches only this page's own `bt-<batch>-<n>` files, never live reports."""
    if not SAFE_ID.match(batch):
        raise HTTPException(404, "No such batch")
    paths = list(_runs(_root())[0].glob(f"bt-{batch}-*.json"))
    for p in paths:
        p.unlink()
        _rows.pop(p, None)
    return {"deleted": len(paths)}


@router.get("/api/engine/settings")
def engine_settings():
    root = _root(required=False)
    return {
        "name": _setting("engine_name"),
        "engine_dir": str(root) if root else "",
        "vps": _setting("engine_vps"),
        "vps_reports": _setting("engine_vps_reports"),
        "built": bool(root and (root / "build" / "backtest").exists()),
    }


@router.put("/api/engine/settings")
def engine_update_settings(req: EngineSettingsRequest):
    """Empty clears a setting back to its env var / default."""
    name, engine_dir = req.name.strip()[:40], req.engine_dir.strip()
    vps, reports = req.vps.strip(), req.vps_reports.strip()
    if engine_dir:
        path = Path(engine_dir).expanduser().resolve()
        if not path.is_dir():
            raise HTTPException(422, f"No such folder: {path}")
        engine_dir = str(path)
    if vps and not VPS.match(vps):
        raise HTTPException(422, "VPS must look like user@host")
    if reports and not REMOTE_DIR.match(reports):
        raise HTTPException(422, "VPS reports folder must be an absolute path like /var/lib/algo/reports")
    db.set_setting_value("engine_name", name)
    db.set_setting_value("engine_dir", engine_dir)
    db.set_setting_value("engine_vps", vps)
    db.set_setting_value("engine_vps_reports", reports)
    _rows.clear()
    return engine_settings()


@router.post("/api/engine/live/sync")
def engine_live_sync():
    """Pulls the VPS's paper/live session reports over ssh (the same key the engine's deploy uses)."""
    live_dir = _runs(_root())[1]
    vps = _setting("engine_vps")
    if not vps:
        raise HTTPException(400, "Set the VPS (user@host) first")
    live_dir.mkdir(parents=True, exist_ok=True)
    remote = _setting("engine_vps_reports").rstrip("/") + "/"
    res = subprocess.run(
        ["rsync", "-az", "-e", "ssh -o BatchMode=yes -o ConnectTimeout=10", f"{vps}:{remote}", f"{live_dir}/"],
        capture_output=True, text=True, timeout=120,
    )
    if res.returncode:
        raise HTTPException(502, res.stderr.strip() or "rsync failed")
    return {"reports": len(list(live_dir.glob("*.json")))}
