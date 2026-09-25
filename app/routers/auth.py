"""Login, unlock, recovery and one-time setup. Everything else in the app is gated by the
middleware in main.py; these endpoints are the only ones it lets through unauthenticated.

The shape of it:

    setup     once, from the machine itself      -> account + recovery code + session + trust
    login     password + PIN                     -> session + 48h device trust
    unlock    PIN alone, trusted browser only    -> session
    recover   one-time code + new credentials    -> works from anywhere, revokes everything else

There is deliberately NO reset endpoint. An HTTP reset that needs no credentials is reachable by
any page your browser happens to open - `fetch('http://localhost:8010/...', {mode: 'no-cors'})`
sends the request whatever CORS says about reading the reply, and needs no cookie to do it. So the
only way to wipe a forgotten login is the script on the machine: `python -m app.reset_login`.
"""
from fastapi import APIRouter, HTTPException, Request, Response

from app.core import auth
from app.schemas import LoginRequest, RecoverRequest, SetupRequest, UnlockRequest

router = APIRouter(tags=["auth"])


def client_of(request: Request) -> str:
    """Who to count failed attempts against. Behind the Cloudflare tunnel every request arrives
    from 127.0.0.1, so the forwarded address is used when present - and when it isn't, one shared
    bucket is still correct: this app has exactly one user."""
    forwarded = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for")
    return (forwarded or "").split(",")[0].strip() or (request.client.host if request.client else "local")


def proxied(request: Request) -> bool:
    """True when the request came through a tunnel or reverse proxy rather than from this machine.
    Setup refuses it, so an instance can only be claimed by someone at the keyboard."""
    return any(h in request.headers for h in ("x-forwarded-for", "cf-connecting-ip", "x-forwarded-host"))


def _cookie(request: Request, response: Response, name: str, token: str, max_age: int) -> None:
    response.set_cookie(
        name,
        token,
        max_age=max_age,
        httponly=True,  # unreachable from JavaScript, so an XSS bug can't read it
        samesite="strict",  # no cross-site request carries it, which is the CSRF defence
        # Secure only over https: it would otherwise be dropped on plain http://localhost, and a
        # tunnel is always https - so this is strict exactly where it can be.
        secure=request.url.scheme == "https" or proxied(request),
        path="/",
    )


def _sign_in(request: Request, response: Response, *, trust_device: bool):
    """Issue the session, and (after a FULL login only) the 48-hour device trust."""
    token, expires = auth.start_session(request.headers.get("user-agent"))
    _cookie(request, response, auth.COOKIE_NAME, token, int(auth.SESSION_MAX_AGE.total_seconds()))
    if trust_device:
        device, device_expires = auth.trust_device(request.headers.get("user-agent"))
        _cookie(request, response, auth.DEVICE_COOKIE, device, int(auth.DEVICE_TRUST.total_seconds()))
    else:
        device_expires = auth.device_expires_at(request.cookies.get(auth.DEVICE_COOKIE))
    return {
        "ok": True,
        "username": auth.username(),
        "expires_at": expires.isoformat(),
        "trusted_until": device_expires.isoformat() if device_expires else None,
    }


@router.get("/api/auth/status")
def auth_status(request: Request):
    """Everything the login screen needs to decide what to show: is there an account, am I in, and
    may this browser offer just the PIN?"""
    return {
        "configured": auth.configured(),
        "authenticated": auth.session_valid(request.cookies.get(auth.COOKIE_NAME)),
        "device_trusted": auth.device_trusted(request.cookies.get(auth.DEVICE_COOKIE)),
        "username": auth.username() if auth.configured() else None,
        "pin_length": auth.MIN_PIN,
        "has_recovery_code": auth.has_recovery_code(),
    }


@router.post("/api/auth/setup")
def auth_setup(req: SetupRequest, request: Request, response: Response):
    """Creates the one account. Allowed exactly once, and never through a proxy: otherwise whoever
    found the tunnel URL first could claim an instance that isn't theirs.

    The recovery code is returned here and never again - it exists only in this response."""
    if auth.configured():
        raise HTTPException(status_code=409, detail="an account already exists - sign in instead")
    if proxied(request):
        raise HTTPException(
            status_code=403,
            detail="set the account up from the machine running the app, not through a tunnel",
        )
    problem = auth.validate_new_credentials(req.username, req.password, req.pin)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    auth.set_credentials(req.username, req.password, req.pin)
    code = auth.issue_recovery_code()
    return {**_sign_in(request, response, trust_device=True), "recovery_code": code}


@router.post("/api/auth/login")
def auth_login(req: LoginRequest, request: Request, response: Response):
    """The full login: password + PIN. Trusts this browser for 48 hours."""
    if not auth.configured():
        raise HTTPException(status_code=409, detail="no account yet - set one up first")
    client = client_of(request)
    wait = auth.locked_for(client)
    if wait:
        raise HTTPException(status_code=429, detail=f"too many attempts - try again in {wait}s")
    if not auth.check_credentials(req.password, req.pin):
        auth.record_failure(client)
        # One message for both fields: which one was wrong is a hint.
        raise HTTPException(status_code=401, detail="wrong password or PIN")
    auth.clear_failures(client)
    return _sign_in(request, response, trust_device=True)


@router.post("/api/auth/unlock")
def auth_unlock(req: UnlockRequest, request: Request, response: Response):
    """The PIN alone, on a browser that already passed a full login inside the trust window.

    A wrong PIN counts against that device and revokes its trust after a few, so this is not a
    guessing surface even for someone holding a stolen device cookie."""
    device = request.cookies.get(auth.DEVICE_COOKIE)
    if not auth.device_trusted(device):
        raise HTTPException(status_code=403, detail="this browser isn't trusted - sign in with your password")
    client = client_of(request)
    wait = auth.locked_for(client)
    if wait:
        raise HTTPException(status_code=429, detail=f"too many attempts - try again in {wait}s")
    if not auth.unlock_with_pin(device, req.pin):
        auth.record_failure(client)
        if not auth.device_trusted(device):
            response.delete_cookie(auth.DEVICE_COOKIE, path="/")
            raise HTTPException(status_code=403, detail="too many wrong PINs - sign in with your password")
        raise HTTPException(status_code=401, detail="wrong PIN")
    auth.clear_failures(client)
    return _sign_in(request, response, trust_device=False)


@router.post("/api/auth/logout")
def auth_logout(request: Request, response: Response, forget_device: bool = False):
    """Ends the session. `forget_device=true` also drops this browser's trust, so the next visit
    needs the password - what you'd use on a machine you're handing back."""
    auth.end_session(request.cookies.get(auth.COOKIE_NAME))
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    if forget_device:
        auth.revoke_device(request.cookies.get(auth.DEVICE_COOKIE))
        response.delete_cookie(auth.DEVICE_COOKIE, path="/")
    return {"ok": True}


@router.post("/api/auth/change")
def auth_change(req: SetupRequest, request: Request, response: Response):
    """Change the credentials. Authenticated (the middleware already checked) AND re-proves the
    current password + PIN, so a borrowed open laptop can't silently lock the owner out.

    Every other session and every trusted device is dropped - if the reason for changing is that
    something leaked, leaving them alive would defeat the change."""
    if not auth.check_credentials(req.current_password or "", req.current_pin or ""):
        raise HTTPException(status_code=401, detail="current password or PIN is wrong")
    problem = auth.validate_new_credentials(req.username, req.password, req.pin)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    auth.set_credentials(req.username, req.password, req.pin)
    auth.end_all_sessions()
    return _sign_in(request, response, trust_device=True)


@router.post("/api/auth/recover")
def auth_recover(req: RecoverRequest, request: Request, response: Response):
    """The one-time code: sets a new password and PIN from anywhere, including over a tunnel.

    Rate-limited like a login, single-use (a fresh code is issued and returned once), and it throws
    away every session and every trusted device - the point of using it is that something went
    wrong."""
    if not auth.configured():
        raise HTTPException(status_code=409, detail="no account yet - set one up first")
    client = client_of(request)
    wait = auth.locked_for(client)
    if wait:
        raise HTTPException(status_code=429, detail=f"too many attempts - try again in {wait}s")
    if not auth.check_recovery_code(req.code):
        auth.record_failure(client)
        raise HTTPException(status_code=401, detail="that recovery code isn't valid")
    problem = auth.validate_new_credentials(None, req.password, req.pin)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    auth.clear_failures(client)
    auth.set_credentials(auth.username() or "", req.password, req.pin)
    auth.end_all_sessions()
    code = auth.issue_recovery_code()  # the used one is now spent
    return {**_sign_in(request, response, trust_device=True), "recovery_code": code}


@router.post("/api/auth/recovery-code")
def auth_new_recovery_code(req: LoginRequest):
    """A fresh recovery code, shown once. Re-proves the password and PIN first - otherwise an open
    laptop would hand out a permanent key to the app."""
    if not auth.check_credentials(req.password, req.pin):
        raise HTTPException(status_code=401, detail="wrong password or PIN")
    return {"recovery_code": auth.issue_recovery_code()}
