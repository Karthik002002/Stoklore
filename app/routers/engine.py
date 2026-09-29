"""A checkout of the C++ trading engine (the separate `hft` repo), driven from the /engine page.

Stoklore supplies what it already has - intraday bars and a UI - and the engine does the trading
logic, so a strategy backtested here is the same compiled code that trades on the VPS.

Runs are the engine's own JSON files, not table rows: `backtest --json` writes one per run and the
live engine rewrites `<paper|live>-<date>.json` every minute, both in one shape. Nothing here
touches the journal database except the settings below.

Bars are written for each run into a temporary folder, cut to the run's history range - two runs on
the same stock with different ranges must never share one CSV.

    <engine folder>/runs/<id>.json        backtests started from this page
    <engine folder>/runs/live/<id>.json   paper/live session reports, rsynced from the VPS
    <engine folder>/runs/sweeps/<id>.json parameter sweeps: one summary per parameter set, no trades
    <engine folder>/runs/autotune/<strategy>/<SYMBOL>/<id>.json  walk-forward tuning reports

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
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.core import autotune
from app.core import db
from app.core import minute_data
from app.schemas import EngineAutotuneRequest, EngineBacktestRequest, EngineSettingsRequest, EngineSweepRequest

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


def _hold(interval):
    """Engine flags for how long a position may live on these bars. Daily bars are positional by
    definition: under the intraday rules (square off at 15:15, close anything left at the next
    day's open) every 1D trade would be closed one bar after it opened."""
    return ["--overnight"] if interval == "1D" else []


def _history(rng):
    """The request's history choice -> (start, end) ISO dates, and the record a report keeps of it."""
    try:
        start, end = minute_data.range_bounds(rng.mode, rng.years, rng.start, rng.end)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    return start, end, {"mode": rng.mode, "years": rng.years, "start": start, "end": end}


def _coverage(symbol, got, start, end):
    """What one stock actually had inside the range - its own history decides, not the range: its
    span and sessions, sessions the official daily record has that its bars lack (a hole in the
    minute history), splits/bonuses back-adjusted, and big jumps left alone for a human to check."""
    bars = got["bars"]
    days = {b["date"] for b in bars}
    out = {"from": bars[0]["date"], "to": bars[-1]["date"], "sessions": len(days)}
    missing, first, last = minute_data.missing_sessions(symbol, days, start, end)
    if missing:
        out["missing"] = {"sessions": missing, "from": first, "to": last}
    in_range = lambda d: (not start or d >= start) and (not end or d <= end)  # noqa: E731
    for key in ("adjusted", "jumps"):
        hits = [x for x in got.get(key, []) if in_range(x["date"])]
        if hits:
            out[key] = hits
    return out


def _stock_bars(symbols, interval, start, end):
    """Each symbol's bars inside the range -> ({symbol: bars}, {symbol: coverage}, skipped). A stock with nothing there
    (listed later, delisted earlier, never covered) is skipped with the reason, not fatal. One at a
    time: minute_data reads through DuckDB's shared default connection, which isn't thread-safe."""
    got, coverage, skipped = {}, {}, []
    for s in symbols:
        try:
            res = minute_data.get_minute_bars(s, interval, limit=None, start=start, end=end)
        except Exception as e:  # noqa: BLE001 - one stock's data problem must not sink the others
            skipped.append({"symbol": s, "reason": f"bars unavailable: {e}"})
            continue
        if res["bars"]:
            got[s] = res["bars"]
            coverage[s] = _coverage(s, res, start, end)
        else:
            skipped.append({"symbol": s, "reason": "no bars in this range"})
    return got, coverage, skipped


def _nothing_left(skipped):
    return "Nothing to run - " + "; ".join(f"{x['symbol']}: {x['reason']}" for x in skipped)


def _bars_csv(folder, symbol, interval, bars):
    path = Path(folder) / f"{symbol}_{interval}.csv"  # the engine names the symbol from the file
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


def _check(root, strategy, symbols, interval):
    """Validates what every run needs; returns the cleaned symbol list."""
    if strategy not in {s["name"] for s in _engine(root, "--list")}:
        raise HTTPException(422, f"Unknown strategy '{strategy}'")
    symbols = sorted({s.strip().upper() for s in symbols if s.strip()})
    if not symbols or not all(SAFE_ID.match(s) for s in symbols):
        raise HTTPException(422, "Give at least one valid NSE symbol")
    if interval not in minute_data.BUCKETS:
        raise HTTPException(422, f"interval must be one of {list(minute_data.BUCKETS)}")
    return symbols


@router.get("/api/engine/strategies")
def engine_strategies():
    return _engine(_root(), "--list")


@router.post("/api/engine/backtest")
def engine_backtest(req: EngineBacktestRequest):
    """One backtest per combination of the param lists, run in parallel. Blocks until all finish -
    each is milliseconds of C++; the only slow part is Stoklore's first extract of a new symbol."""
    root = _root()
    runs_dir = _runs(root)[0]
    symbols = _check(root, req.strategy, req.symbols, req.interval)
    grid = {k: v for k, v in req.params.items() if v}
    if not all(PARAM.match(k) for k in grid):
        raise HTTPException(422, "Bad parameter name")
    combos = [dict(zip(grid, values)) for values in itertools.product(*grid.values())]
    if len(combos) > MAX_RUNS:
        raise HTTPException(422, f"{len(combos)} combinations - keep a sweep under {MAX_RUNS}")

    start, end, history = _history(req.range)
    got, coverage, skipped = _stock_bars(symbols, req.interval, start, end)
    if not got:
        raise HTTPException(422, _nothing_left(skipped))
    batch = time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(2)
    created = datetime.now(timezone.utc).isoformat()
    varied = sorted(k for k, v in grid.items() if len(set(v)) > 1)
    runs_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        files = [_bars_csv(tmp, s, req.interval, b) for s, b in got.items()]
        del got

        def run(i, combo):
            kv = [f"{k}={v:g}" for k, v in combo.items()]
            result = _engine(root, req.strategy, *files, *kv, f"cost_bps={req.cost_bps:g}", "--json", *_hold(req.interval))
            result.update(id=f"bt-{batch}-{i}", source="backtest", created=created, batch=batch,
                          label=(req.label or "").strip() or None, symbols=list(coverage), interval=req.interval,
                          varied=varied, history=history, coverage=coverage, skipped=skipped)
            path = runs_dir / f"{result['id']}.json"
            path.write_text(json.dumps(result))
            return _row(path)

        with ThreadPoolExecutor(os.cpu_count() or 4) as pool:
            rows = list(pool.map(run, range(len(combos)), combos))
    return {"batch": batch, "runs": rows, "skipped": skipped}


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


# --- parameter sweeps: calibration ----------------------------------------------------------------
# One engine process loads the bars once and runs every parameter set in parallel (backtest
# --sweep), so thousands of runs take seconds. A sweep keeps each run's summary and a small equity
# sparkline, not its trades - opening one runs it again as a normal backtest, with full detail.

VALUES = re.compile(r"^[0-9eE.,:+\- ]+$")  # "9" | "5,9,13" | "5:20:5" - the engine parses them


def _sweeps_dir(root):
    return root / "runs" / "sweeps"


def _sweep_path(sweep_id):
    path = _sweeps_dir(_root()) / f"{sweep_id}.json"
    if not SAFE_ID.match(sweep_id) or not path.exists():
        raise HTTPException(404, f"No sweep '{sweep_id}'")
    return path


def _sweep_row(path):
    """List view of a sweep: everything but the runs, plus its count and best run by net P&L."""
    mtime = path.stat().st_mtime
    hit = _rows.get(path)
    if not hit or hit[0] != mtime:
        d = json.loads(path.read_text())
        runs = d.pop("runs")
        best = max(runs, key=lambda r: r["summary"]["net"], default=None)
        d.update(count=len(runs), best={"params": best["params"], "summary": best["summary"]} if best else None)
        hit = _rows[path] = (mtime, d)
    return hit[1]


@router.post("/api/engine/sweep")
def engine_sweep(req: EngineSweepRequest):
    """mode "oat": each param with several values walks its range while the others hold their base
    value. mode "grid": every combination. A param with one value is fixed for the whole sweep."""
    root = _root()
    symbols = _check(root, req.strategy, req.symbols, req.interval)
    params = {k: v.strip() for k, v in req.params.items() if v.strip()}
    if not all(PARAM.match(k) for k in [*params, *req.base]):
        raise HTTPException(422, "Bad parameter name")
    if not all(VALUES.match(v) for v in params.values()):
        raise HTTPException(422, "Param values must be numbers, lists (5,9,13) or ranges (5:20:5)")
    start, end, history = _history(req.range)
    got, coverage, skipped = _stock_bars(symbols, req.interval, start, end)
    if not got:
        raise HTTPException(422, _nothing_left(skipped))
    args = [f"{k}={v}" for k, v in params.items()] + [f"base.{k}={v:g}" for k, v in req.base.items()]
    with tempfile.TemporaryDirectory() as tmp:
        files = [_bars_csv(tmp, s, req.interval, b) for s, b in got.items()]
        del got
        try:
            result = _engine(
                root, req.strategy, *files, *args, f"cost_bps={req.cost_bps:g}", f"--sweep={req.mode}", *_hold(req.interval)
            )
        except HTTPException as e:
            raise HTTPException(422 if e.status_code == 500 else e.status_code, e.detail) from e
    result.update(id=f"sw-{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}",
                  created=datetime.now(timezone.utc).isoformat(), label=(req.label or "").strip() or None,
                  symbols=list(coverage), interval=req.interval, cost_bps=req.cost_bps,
                  history=history, coverage=coverage, skipped=skipped)
    folder = _sweeps_dir(root)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{result['id']}.json").write_text(json.dumps(result))
    return result


@router.get("/api/engine/sweeps")
def engine_sweeps():
    root = _root(required=False)
    if not root:
        return []
    return sorted((_sweep_row(p) for p in _sweeps_dir(root).glob("*.json")), key=lambda r: r["created"], reverse=True)


@router.get("/api/engine/sweeps/{sweep_id}")
def engine_sweep_detail(sweep_id: str):
    return json.loads(_sweep_path(sweep_id).read_text())


@router.delete("/api/engine/sweeps/{sweep_id}")
def engine_delete_sweep(sweep_id: str):
    path = _sweep_path(sweep_id)
    path.unlink()
    _rows.pop(path, None)
    return {"ok": True}


# --- walk-forward tuning (docs/autotune-blueprint.md, Phase 1) ------------------------------------
# Report-only: nothing here deploys anything. One report per run, as a file like everything else.

AUTOTUNE_HEAVY = ("windows", "oos", "baseline", "promised", "cells")  # left out of the list
AUTOTUNE_WORKERS = 4  # walks at once; each engine sweep already uses every core


def _autotune_dir(root):
    return root / "runs" / "autotune"


def _autotune_path(report_id):
    if SAFE_ID.match(report_id):
        for p in _autotune_dir(_root()).glob(f"*/*/{report_id}.json"):
            return p
    raise HTTPException(404, f"No walk-forward '{report_id}'")


def _autotune_row(path):
    mtime = path.stat().st_mtime
    hit = _rows.get(path)
    if not hit or hit[0] != mtime:
        d = json.loads(path.read_text())
        row = {k: v for k, v in d.items() if k not in AUTOTUNE_HEAVY}
        row.update(oos=d["oos"]["summary"], baseline=d["baseline"]["summary"],
                   best_cell=d["cells"][0] if d.get("cells") else None)
        hit = _rows[path] = (mtime, row)
    return hit[1]


@router.post("/api/engine/autotune")
def engine_autotune(req: EngineAutotuneRequest):
    """One walk-forward per stock, tuned separately - parameters are per stock, never pooled - and
    saved as one batch. Streams NDJSON as it goes - `start` {batch, symbols}, then a `report` (the
    list row) or an `error` {symbol, error} per stock as each finishes, then `done` - since a year
    of 5m sessions in one-week steps is ~40 windows and a few seconds per stock, plus ~11s the
    first time a stock's bars are fetched. A stock that fails (no bars, too little history) is
    reported and the rest still run. Bad requests are still refused up front with a 4xx."""
    root = _root()
    symbols = _check(root, req.strategy, req.symbols, req.interval)
    params = {k: v.strip() for k, v in req.params.items() if v.strip()}
    if not all(PARAM.match(k) for k in params):
        raise HTTPException(422, "Bad parameter name")
    if not all(VALUES.match(v) for v in params.values()):
        raise HTTPException(422, "Param values must be numbers, lists (5,9,13) or ranges (5:20:5)")
    defaults = next(s["params"] for s in _engine(root, "--list") if s["name"] == req.strategy)
    batch = time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(2)
    created = datetime.now(timezone.utc).isoformat()

    start, end, history = _history(req.range)
    need, coverage = req.train + req.test, {}

    def walk(i, symbol, bars):
        try:
            report = autotune.walk_forward(
                lambda *a: _engine(root, *a, *_hold(req.interval)), bars, symbol=symbol, interval=req.interval, strategy=req.strategy,
                params=params, defaults=defaults, train=req.train, test=req.test, min_trades=req.min_trades,
                margin=req.margin, cost_bps=req.cost_bps,
            )
        except (ValueError, RuntimeError, HTTPException) as e:
            return {"symbol": symbol, "error": str(getattr(e, "detail", e))}
        report.update(id=f"wf-{batch}-{i}", batch=batch, created=created, history=history, coverage=coverage[symbol])
        folder = _autotune_dir(root) / req.strategy / symbol
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{report['id']}.json"
        path.write_text(json.dumps(report))
        return _autotune_row(path)

    def events():
        # Bars are loaded one stock at a time (see _stock_bars); only the walks - engine subprocesses,
        # no DuckDB - run in parallel.
        yield {"type": "start", "batch": batch, "symbols": len(symbols)}
        got, cov, skipped = _stock_bars(symbols, req.interval, start, end)
        coverage.update(cov)
        for x in skipped:
            yield {"type": "error", "symbol": x["symbol"], "error": x["reason"]}
        loaded = []
        for symbol, bars in got.items():
            days = autotune.sessions_of(bars)
            if len(days) < need:  # a stock listed late, or a short range: say what it had, and what would fit
                fit = len(days) - 3 * req.test  # a train that leaves room for three test windows
                hint = f"; a train of {fit} or less would walk it in 3+ windows" if fit >= 20 else ""
                yield {"type": "error", "symbol": symbol, "error": f"only {len(days)} sessions in this range ({days[0]} → {days[-1]}) - "
                                                                   f"a walk needs train + test = {need}{hint}"}
            else:
                loaded.append((symbol, bars))
        del got
        if loaded:
            with ThreadPoolExecutor(min(AUTOTUNE_WORKERS, len(loaded))) as pool:
                futures = [pool.submit(walk, i, s, b) for i, (s, b) in enumerate(loaded)]
                del loaded
                for f in as_completed(futures):
                    r = f.result()
                    yield {"type": "error", **r} if "error" in r else {"type": "report", "report": r}
        yield {"type": "done", "batch": batch}

    return StreamingResponse((json.dumps(e) + "\n" for e in events()), media_type="application/x-ndjson")


@router.get("/api/engine/autotune")
def engine_autotune_list():
    root = _root(required=False)
    if not root:
        return []
    return sorted((_autotune_row(p) for p in _autotune_dir(root).glob("*/*/*.json")), key=lambda r: r["created"], reverse=True)


@router.get("/api/engine/autotune/{report_id}")
def engine_autotune_detail(report_id: str):
    return json.loads(_autotune_path(report_id).read_text())


@router.delete("/api/engine/autotune/batches/{batch}")
def engine_autotune_delete_batch(batch: str):
    """Every stock's report from one multi-stock run. Matches this route's own `wf-<batch>-<n>`
    files only."""
    if not SAFE_ID.match(batch):
        raise HTTPException(404, "No such batch")
    paths = list(_autotune_dir(_root()).glob(f"*/*/wf-{batch}-*.json"))
    for p in paths:
        p.unlink()
        _rows.pop(p, None)
    return {"deleted": len(paths)}


@router.delete("/api/engine/autotune/{report_id}")
def engine_autotune_delete(report_id: str):
    path = _autotune_path(report_id)
    path.unlink()
    _rows.pop(path, None)
    return {"ok": True}


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
