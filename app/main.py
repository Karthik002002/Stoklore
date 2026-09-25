"""FastAPI application: middleware, startup hooks, static mounts, and the single
aggregated router. Every endpoint lives under app/routers/ - none are declared here."""
import os
import threading

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core import auth
from app.core import backup
from app.core import classifier
from app.core import db
from app.core import live
from app.core import llm
from app.core import paper

from app.core.config import UPLOAD_DIR
from app.routers import router
from app.services.jobs import (
    _auto_event_scan_loop,
    _auto_shareholding_loop,
    _workflow_schedule_loop,
)
from app.services.quotes import paper_price

app = FastAPI(title="Stoklore API")
db.init_schema()

os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

@app.on_event("startup")
def _startup():
    db.purge_old(days=14)
    db.purge_expired_auth_sessions()
    db.purge_expired_auth_devices()
    llm.configure_litellm(db.get_litellm_base_url(), db.get_litellm_api_key())
    llm.configure_omniroute(db.get_omniroute_base_url(), db.get_omniroute_api_key())
    # A no-op until the Laya classifier is switched on in Settings > Classifier.
    llm.TOOL_RESULT_GUARD = classifier.injection_flagged
    threading.Thread(target=_auto_event_scan_loop, daemon=True).start()
    # One NSE shareholding sweep per IST day: the newest 90-day window (one request covering every
    # listed company), then the XBRL detail for the handful of filings that actually moved. See
    # app/services/jobs.py.
    threading.Thread(target=_auto_shareholding_loop, daemon=True).start()
    # Saved workflows on a schedule. Minute tick (intervals can be that short), same
    # catch-up-after-downtime shape as the two loops above - see app/services/workflow_triggers.py.
    threading.Thread(target=_workflow_schedule_loop, daemon=True).start()
    backup.start()
    # Watches open paper positions against live prices and fires simulated exits. Idempotent, and
    # idles outside market hours - see paper.py.
    paper.start(paper_price)
    # Mirrors Dhan's order and position books while the market is open and sweeps price alerts.
    # Alerts run whether or not live trading is switched on; the mirror only runs when it is and
    # credentials exist - see app/core/live.py.
    live.start(paper_price)


# --- the login gate ------------------------------------------------------------------------------
# One middleware in front of everything, rather than a dependency on each route: a new endpoint is
# protected because it exists, not because someone remembered to protect it. That is the whole
# reason this isn't a per-router dependency.
#
# /uploads is in here too - those are trade screenshots, and serving them unauthenticated while
# gating the JSON around them would be a strange kind of privacy.
_OPEN_PATHS = {
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/unlock",
    "/api/auth/setup",
    "/api/auth/logout",
    "/api/auth/recover",
}


def _needs_auth(path: str) -> bool:
    if path in _OPEN_PATHS:
        return False
    return path.startswith(("/api", "/uploads", "/docs", "/redoc", "/openapi.json"))


@app.middleware("http")
async def _require_login(request: Request, call_next):
    path = request.url.path
    # CORS preflight carries no cookie by design; answering it is not answering for data.
    if request.method == "OPTIONS" or not _needs_auth(path):
        return await call_next(request)
    # Before setup there is no account to check against, so everything is refused rather than
    # waved through - an unconfigured instance on a tunnel must not be an open one.
    if not auth.configured():
        return JSONResponse({"detail": "no account configured yet"}, status_code=401)
    if not auth.session_valid(request.cookies.get(auth.COOKIE_NAME)):
        return JSONResponse({"detail": "not signed in"}, status_code=401)
    return await call_next(request)


# Every mutating request marks the database dirty; backup.py's background thread turns that into
# at most one pg_dump per interval. Middleware rather than per-endpoint calls so a new POST/PUT/
# DELETE is backed up without anyone remembering to opt it in.
@app.middleware("http")
async def _mark_backup_dirty(request: Request, call_next):
    response = await call_next(request)
    if request.method not in ("GET", "HEAD", "OPTIONS") and response.status_code < 400:
        backup.mark_dirty()
    return response


# Allows the app to be reached through a Cloudflare Quick Tunnel (random *.trycloudflare.com
# per run) in addition to local dev - matters if the frontend/API are ever hit cross-origin
# rather than through Vite's same-origin proxy.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://.*\.trycloudflare\.com",
    allow_methods=["*"],
    allow_headers=["*"],
)


# The one aggregated router - every endpoint in the app arrives through this.
app.include_router(router)


# Serving the built frontend from the API itself, so a deployed instance is ONE process to run and
# one port to expose - no Vite, no second web server, no reverse proxy to configure. Mounted last so
# every /api route above still wins; only paths nothing else claimed fall through to here.
#
# Absent in development: `npm run dev` serves the frontend and proxies /api here, so there is no
# dist/ to mount and this block is skipped entirely.
_DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist")
if os.path.isdir(_DIST):
    from fastapi.responses import FileResponse

    app.mount("/assets", StaticFiles(directory=os.path.join(_DIST, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def _spa(full_path: str):
        """Everything that isn't an API route is the single-page app: TanStack Router owns
        /paper/BTML and /backtest/replay client-side, so a hard refresh on one of those URLs has to
        return index.html rather than a 404. A real file under dist/ (favicon, manifest) is served
        as itself.

        An /api path that reached here matched no endpoint, and answering it with the HTML shell
        (status 200!) turns a typo'd or removed endpoint into "unexpected token < in JSON" wherever
        it was called from. Say 404 and mean it."""
        if full_path.startswith(("api/", "uploads/")):
            raise HTTPException(status_code=404, detail="no such endpoint")
        candidate = os.path.join(_DIST, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(_DIST, "index.html"))
