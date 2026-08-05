from fastapi import APIRouter
import os

from fastapi import HTTPException
from fastapi.responses import RedirectResponse

import db
import kite

router = APIRouter(tags=["kite-auth"])

@router.get("/api/kite/login-url")
def kite_login_url():
    creds = db.get_kite_credentials()
    if not creds:
        raise HTTPException(status_code=400,
                             detail="Kite isn't configured - add your API key and secret in Settings > Kite")
    return {"url": kite.login_url(creds["api_key"])}


# The frontend runs on its own dev-server origin (run.sh's fixed port 5180), separate from this
# API's - a relative RedirectResponse below would redirect within this API's own origin instead.
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5180")


@router.get("/api/kite/callback")
def kite_callback(request_token: str | None = None, status: str | None = None):
    """Where Kite's login redirect lands (register this exact URL - http://localhost:8010/api/kite/callback
    - as the app's Redirect URL at developers.kite.trade/apps). Exchanges request_token for a
    day-valid access_token server-side, then bounces the browser back into the app."""
    creds = db.get_kite_credentials()
    if not creds:
        raise HTTPException(status_code=400, detail="Kite isn't configured")
    if status != "success" or not request_token:
        return RedirectResponse(f"{FRONTEND_URL}/holdings?broker=kite&kite_login=failed")
    try:
        access_token = kite.generate_session(creds["api_key"], creds["api_secret"], request_token)
    except kite.KiteError:
        return RedirectResponse(f"{FRONTEND_URL}/holdings?broker=kite&kite_login=failed")
    db.set_kite_session(access_token)
    return RedirectResponse(f"{FRONTEND_URL}/holdings?broker=kite&kite_login=success")
