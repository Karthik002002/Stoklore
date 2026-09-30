"""Works the algo engine's background queue (db.engine_jobs).

"Run in background" on the /engine forms queues the same request "Run now" sends; a worker here
claims it and runs it through the very same code (routers/engine.py run_backtest / run_sweep /
autotune_events). The queue lives in Postgres, so queued jobs survive a restart; a job that was
running when the process died is marked interrupted at startup and can be retried.

MAX_WORKERS threads start once; worker i only takes a job while i < the configured count (Settings
key `engine_workers`, set from the Jobs tab), so the count changes live, without a restart.
"""
import threading
import time
import traceback

from fastapi import HTTPException

from app.core import db

MAX_WORKERS = 8
IDLE_SLEEP = 2  # seconds between queue polls when there's nothing to do


def workers():
    try:
        return max(1, min(MAX_WORKERS, int(db._get_setting("engine_workers", "1"))))
    except ValueError:
        return 1


def _run(job):
    """Runs one job to its end state. Cancellation is checked between stocks of an auto-tune walk;
    a backtest or sweep is one engine call and simply finishes."""
    from app.routers import engine  # the router owns the run code; imported late to keep startup light

    kind, req, jid = job["kind"], engine.JOB_REQUESTS[job["kind"]](**job["request"]), job["id"]
    if kind == "backtest":
        res = engine.run_backtest(req, job=jid)
        return "done", {"batch": res["batch"], "ids": [r["id"] for r in res["runs"]], "skipped": res["skipped"]}
    if kind == "sweep":
        res = engine.run_sweep(req, job=jid)
        return "done", {"sweep": res["id"], "skipped": res.get("skipped") or []}

    ids, errors, batch, finished, total = [], [], None, 0, len(req.symbols)
    events = engine.autotune_events(req, job=jid)
    try:
        for e in events:
            if e["type"] == "start":
                batch, total = e["batch"], e["symbols"]
            elif e["type"] == "report":
                ids.append(e["report"]["id"])
            elif e["type"] == "error":
                errors.append({"symbol": e["symbol"], "error": e["error"]})
            if e["type"] in ("report", "error"):
                finished += 1
                db.update_engine_job(jid, progress={"done": finished, "total": total})
                if db.engine_job_cancelled(jid):
                    return "cancelled", {"batch": batch, "ids": ids, "errors": errors}
    finally:
        events.close()  # stops loading further stocks; walks already running finish
    if not ids and errors:
        return "failed", {"batch": batch, "ids": [], "errors": errors}
    return "done", {"batch": batch, "ids": ids, "errors": errors}


def _worker(index):
    while True:
        job = None
        try:
            if index >= workers():
                time.sleep(IDLE_SLEEP * 3)
                continue
            job = db.claim_engine_job()
            if not job:
                time.sleep(IDLE_SLEEP)
                continue
            status, result = _run(job)
            error = None
            if status == "failed":
                error = "; ".join(dict.fromkeys(e["error"] for e in result["errors"]))
            db.update_engine_job(job["id"], status=status, result=result, error=error)
        except HTTPException as e:
            if job:
                db.update_engine_job(job["id"], status="failed", error=str(e.detail))
        except Exception as e:  # noqa: BLE001 - one bad job must not kill the worker
            traceback.print_exc()
            if job:
                try:
                    db.update_engine_job(job["id"], status="failed", error=f"{type(e).__name__}: {e}")
                except Exception:  # noqa: BLE001 - the DB itself is down; the next poll retries
                    pass
            time.sleep(IDLE_SLEEP)


def start():
    n = db.interrupt_engine_jobs()
    if n:
        print(f"engine jobs: {n} interrupted by the restart")
    for i in range(MAX_WORKERS):
        threading.Thread(target=_worker, args=(i,), daemon=True, name=f"engine-job-{i}").start()
