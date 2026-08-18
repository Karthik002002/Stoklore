"""FastAPI application: middleware, startup hooks, static mounts, and the single
aggregated router. Every endpoint lives under app/routers/ - none are declared here."""
import os
import threading

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core import backup
from app.core import db
from app.core import llm
from app.core import paper

from app.core.config import UPLOAD_DIR
from app.routers import router
from app.services.jobs import _auto_event_scan_loop
from app.services.quotes import paper_price

app = FastAPI(title="Stoklore API")
db.init_schema()

os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

@app.on_event("startup")
def _startup():
    db.purge_old(days=14)
    llm.configure_litellm(db.get_litellm_base_url(), db.get_litellm_api_key())
    threading.Thread(target=_auto_event_scan_loop, daemon=True).start()
    backup.start()
    # Watches open paper positions against live prices and fires simulated exits. Idempotent, and
    # idles outside market hours - see paper.py.
    paper.start(paper_price)


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
        as itself."""
        candidate = os.path.join(_DIST, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(_DIST, "index.html"))
