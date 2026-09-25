"""Self-check for the login gate:

    .venv/bin/python tests/auth.selfcheck.py                       # hashing + lockout only
    DATABASE_URL=postgresql:///crawler_scratch .venv/bin/python tests/auth.selfcheck.py   # + the API

The hashing and lockout half needs nothing. The HTTP half writes credentials and sessions, so it
runs only against a scratch database - never the real one.

What is pinned here is the security behaviour, not the happy path: an unauthenticated request is
refused, uploads are refused too, a wrong PIN with the right password is still a failure, the
lockout grows, the reply never says which field was wrong, and logout actually kills the session.
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core import auth  # noqa: E402

# --- hashing (no database) ------------------------------------------------------------------------

stored = auth.hash_secret("correct horse battery staple")
assert stored.startswith("scrypt$")
assert "correct horse" not in stored, "the secret itself must not be recoverable from the hash"
assert auth.verify_secret("correct horse battery staple", stored)
assert not auth.verify_secret("Correct horse battery staple", stored)
assert not auth.verify_secret("", stored)
# Two hashes of the same secret differ - per-credential salt, so one rainbow table can't do both.
assert auth.hash_secret("same") != auth.hash_secret("same")
# Anything unparseable is a failure, not a crash - a truncated column must not authenticate.
for junk in (None, "", "notahash", "scrypt$x$y$z$q$r", "md5$1$1$1$aa$bb"):
    assert not auth.verify_secret("same", junk), junk

# --- credential rules -----------------------------------------------------------------------------

assert auth.validate_new_credentials("k", "longenough", "123456") is None
assert auth.validate_new_credentials(None, "longenough", "123456") is None, "recovery sets no name"
assert auth.validate_new_credentials("", "longenough", "123456"), "a blank name is a typo, not a choice"
assert auth.validate_new_credentials("k", "short", "123456")
assert auth.validate_new_credentials("k", "longenough", "1234"), "4 digits is below the minimum now"
assert auth.validate_new_credentials("k", "longenough", "abcdef")
assert auth.validate_new_credentials("k", "pass123456word", "123456"), "PIN inside the password"

# Recovery codes: readable, and not repeated.
code = auth.new_recovery_code()
assert len(code.replace("-", "")) == auth.RECOVERY_GROUPS * auth.RECOVERY_GROUP_LEN
assert not set(code.replace("-", "")) & set("IO01"), "ambiguous characters would be misread"
assert auth.new_recovery_code() != code

# --- lockout ---------------------------------------------------------------------------------------

t = 1000.0
auth.clear_failures("ip")
for _ in range(auth.FREE_ATTEMPTS):
    auth.record_failure("ip", t)
assert auth.locked_for("ip", t) == 0, "the first few tries are free"
auth.record_failure("ip", t)
first = auth.locked_for("ip", t)
assert first > 0
auth.record_failure("ip", t)
assert auth.locked_for("ip", t) > first, "the wait doubles"
assert auth.locked_for("ip", t + 10_000) == 0, "and it expires"
for _ in range(40):
    auth.record_failure("ip", t)
assert auth.locked_for("ip", t) <= auth.LOCKOUT_MAX + 1, "capped, so it can't lock forever"
auth.clear_failures("ip")
assert auth.locked_for("ip", t) == 0, "a correct login forgives the counter"

# Guard, not a preference: this half writes credentials and sessions, and the default DATABASE_URL
# is the real journal. A database named *scratch* or *test* is opt-in by construction.
if not any(mark in (os.environ.get("DATABASE_URL") or "") for mark in ("scratch", "test")):
    print("ok - auth: hashing, credential rules, lockout (point DATABASE_URL at a scratch/test db for the API half)")
    raise SystemExit

# --- the API (scratch database only) ----------------------------------------------------------------

from fastapi.testclient import TestClient  # noqa: E402

from app.core import db  # noqa: E402
from app.main import app  # noqa: E402

PASSWORD = "longenough1"
PIN = "654321"


def reset_account():
    db.init_schema()
    auth.clear_credentials()
    auth.clear_failures("testclient")


reset_account()

# TestClient is used WITHOUT its context manager on purpose: entering it runs the startup event,
# which would launch the scrapers, the paper poller and pg_dump backups against this scratch db.
c = TestClient(app)

# Before setup: nothing is readable, not even with no account to check against.
status = c.get("/api/auth/status").json()
assert status["configured"] is False and status["authenticated"] is False
assert status["pin_length"] == auth.MIN_PIN
assert c.get("/api/manual-trades").status_code == 401
assert c.post("/api/auth/login", json={"password": "y", "pin": PIN}).status_code == 409

# Setup through a proxy is refused - the tunnel must not be able to claim the instance.
proxied = c.post(
    "/api/auth/setup",
    json={"username": "karthik", "password": PASSWORD, "pin": PIN},
    headers={"x-forwarded-for": "203.0.113.9"},
)
assert proxied.status_code == 403, proxied.status_code
assert c.post("/api/auth/setup", json={"username": "karthik", "password": "short", "pin": PIN}).status_code == 422

setup = c.post("/api/auth/setup", json={"username": "karthik", "password": PASSWORD, "pin": PIN})
assert setup.status_code == 200, setup.text
recovery_code = setup.json()["recovery_code"]
assert recovery_code, "the code is returned exactly once, here"
assert auth.COOKIE_NAME in c.cookies and auth.DEVICE_COOKIE in c.cookies, "setup signs in and trusts"

# Nothing reversible was stored - not the password, not the PIN, not the recovery code.
for key in (auth.PASSWORD_KEY, auth.PIN_KEY, auth.RECOVERY_KEY):
    stored = db.get_setting_value(key)
    assert PASSWORD not in stored and PIN not in stored
    assert recovery_code.replace("-", "") not in stored

assert c.get("/api/manual-trades").status_code == 200
assert c.get("/api/auth/status").json()["device_trusted"] is True

# A stranger: no session, no device. Every surface closed, and the PIN is not an entry point.
stranger = TestClient(app)
for path in ("/api/manual-trades", "/api/stocks", "/uploads/anything.png", "/openapi.json", "/docs"):
    assert stranger.get(path).status_code == 401, path
assert stranger.post("/api/auth/unlock", json={"pin": PIN}).status_code == 403, "PIN without a trusted device"
stranger.cookies.set(auth.COOKIE_NAME, "not-a-real-token")
stranger.cookies.set(auth.DEVICE_COOKIE, "not-a-real-device")
assert stranger.get("/api/manual-trades").status_code == 401
assert stranger.post("/api/auth/unlock", json={"pin": PIN}).status_code == 403, "a forged device cookie"

# Both cookies are HttpOnly and SameSite=Strict.
cookies_set = setup.headers.get_list("set-cookie")
assert len(cookies_set) == 2, cookies_set
for raw in cookies_set:
    assert "httponly" in raw.lower() and "samesite=strict" in raw.lower(), raw

# The full login needs both halves, and says the same thing either way.
fresh = TestClient(app)
auth.clear_failures("testclient")
wrong_pin = fresh.post("/api/auth/login", json={"password": PASSWORD, "pin": "000000"})
wrong_pw = fresh.post("/api/auth/login", json={"password": "wrongwrong", "pin": PIN})
assert wrong_pin.status_code == wrong_pw.status_code == 401
assert wrong_pin.json()["detail"] == wrong_pw.json()["detail"]

for _ in range(auth.FREE_ATTEMPTS):
    fresh.post("/api/auth/login", json={"password": "nope-nope", "pin": "000000"})
assert fresh.post("/api/auth/login", json={"password": PASSWORD, "pin": PIN}).status_code == 429
auth.clear_failures("testclient")

ok = fresh.post("/api/auth/login", json={"password": PASSWORD, "pin": PIN})
assert ok.status_code == 200, ok.text
assert ok.json()["trusted_until"], "a full login trusts this browser"
assert fresh.get("/api/manual-trades").status_code == 200

# --- the whole point: PIN alone, on a browser that already did the full login ---------------------

# Session gone (idle/expired), device still trusted -> the PIN is enough.
fresh.post("/api/auth/logout")
assert fresh.get("/api/manual-trades").status_code == 401
assert fresh.get("/api/auth/status").json()["device_trusted"] is True
unlocked = fresh.post("/api/auth/unlock", json={"pin": PIN})
assert unlocked.status_code == 200, unlocked.text
assert fresh.get("/api/manual-trades").status_code == 200

# Wrong PINs on a trusted browser revoke the trust, which forces the password back.
fresh.post("/api/auth/logout")
auth.clear_failures("testclient")
for _ in range(auth.DEVICE_PIN_ATTEMPTS):
    fresh.post("/api/auth/unlock", json={"pin": "000000"})
    auth.clear_failures("testclient")  # isolate the DEVICE counter from the per-client one
assert fresh.get("/api/auth/status").json()["device_trusted"] is False, "the device should be demoted"
assert fresh.post("/api/auth/unlock", json={"pin": PIN}).status_code == 403, "even the right PIN now"

# Signing out with forget_device drops the trust deliberately.
handing_back = TestClient(app)
handing_back.post("/api/auth/login", json={"password": PASSWORD, "pin": PIN})
handing_back.post("/api/auth/logout", params={"forget_device": "true"})
assert handing_back.post("/api/auth/unlock", json={"pin": PIN}).status_code == 403

# Trust expires on its own after DEVICE_TRUST.
token, _ = auth.trust_device("test")
assert auth.device_trusted(token)
db.connect().execute(
    "UPDATE auth_devices SET expires_at = now() - interval '1 minute' WHERE token_hash = %s",
    (auth._digest(token),),
)
assert not auth.device_trusted(token), "expired trust"
assert db.get_auth_device(auth._digest(token)) is None, "and the row is cleaned up"

# An expired/idle SESSION is refused and cleaned up too.
token, _ = auth.start_session("test")
db.touch_auth_session(auth._digest(token), datetime.now(timezone.utc) - auth.SESSION_IDLE - timedelta(minutes=1))
assert not auth.session_valid(token)
assert db.get_auth_session(auth._digest(token)) is None

# --- recovery --------------------------------------------------------------------------------------

# The one-time code works from anywhere - including through a tunnel, which is its purpose.
away = TestClient(app)
auth.clear_failures("testclient")
assert away.post("/api/auth/recover", json={"code": "WRONG-CODE-HERE-XXXXX", "password": "newpassword1",
                                            "pin": "111222"}).status_code == 401
auth.clear_failures("testclient")
recovered = away.post(
    "/api/auth/recover",
    json={"code": recovery_code.lower().replace("-", " "), "password": "newpassword1", "pin": "111222"},
    headers={"x-forwarded-for": "203.0.113.9"},
)
assert recovered.status_code == 200, recovered.text  # case and dashes don't matter when typing it
new_code = recovered.json()["recovery_code"]
assert new_code and new_code != recovery_code, "a fresh code replaces the spent one"

# The old credentials are dead, the new ones work, and everyone else was thrown out.
assert c.get("/api/manual-trades").status_code == 401, "the setup session should be gone"
auth.clear_failures("testclient")
assert away.post("/api/auth/login", json={"password": PASSWORD, "pin": PIN}).status_code == 401
assert away.post("/api/auth/login", json={"password": "newpassword1", "pin": "111222"}).status_code == 200
# The spent code cannot be reused.
auth.clear_failures("testclient")
assert away.post("/api/auth/recover", json={"code": recovery_code, "password": "another1234",
                                            "pin": "333444"}).status_code == 401
auth.clear_failures("testclient")

# A new code needs the current password and PIN - an open laptop is not enough.
assert away.post("/api/auth/recovery-code", json={"password": "wrong", "pin": "111222"}).status_code == 401
assert away.post("/api/auth/recovery-code", json={"password": "newpassword1", "pin": "111222"}).status_code == 200

# Changing credentials re-proves the old ones and throws every other browser out.
other = TestClient(app)
other.post("/api/auth/login", json={"password": "newpassword1", "pin": "111222"})
assert away.post("/api/auth/change", json={"username": "karthik", "password": "thirdpassword1", "pin": "999888",
                                           "current_password": "wrong", "current_pin": "111222"}).status_code == 401
assert away.post("/api/auth/change", json={"username": "karthik", "password": "thirdpassword1", "pin": "999888",
                                           "current_password": "newpassword1",
                                           "current_pin": "111222"}).status_code == 200
assert other.get("/api/manual-trades").status_code == 401, "other sessions dropped"
assert other.post("/api/auth/unlock", json={"pin": "999888"}).status_code == 403, "and untrusted too"
assert away.get("/api/manual-trades").status_code == 200

# There is NO reset endpoint. One that needs no credentials would be reachable by any page the
# browser opens (a cross-origin POST is still sent, cookie or not), so wiping a forgotten login is
# `python -m app.reset_login` on the machine and nothing else.
gone = away.post("/api/auth/local-reset").status_code
assert gone in (404, 405), f"a credential-less reset must not exist (got {gone})"
assert TestClient(app).post("/api/auth/local-reset").status_code == 401, "and not to a stranger either"

# The remaining unauthenticated write, setup, can't be driven by a random page either: it needs a
# JSON body, and Content-Type: application/json forces a CORS preflight this app refuses. The only
# shapes a cross-origin page can send without one are these, and they are rejected.
reset_account()
drive_by = TestClient(app)
claim = '{"username":"evil","password":"longenough1","pin":"654321"}'
for content_type in ("text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data"):
    r = drive_by.post("/api/auth/setup", content=claim,
                      headers={"content-type": content_type, "origin": "https://evil.example"})
    assert r.status_code == 422, (content_type, r.status_code)
assert not auth.configured(), "a drive-by page must not be able to claim the instance"

# The script is the way back: same effect, but it needs a shell on the machine.
from app import reset_login  # noqa: E402

drive_by.post("/api/auth/setup", json={"username": "karthik", "password": PASSWORD, "pin": PIN})
assert auth.configured()
assert reset_login.main(["--yes"]) == 0
assert not auth.configured(), "the script should clear the account"
assert drive_by.get("/api/manual-trades").status_code == 401, "wiped means closed, not open"
assert drive_by.get("/api/auth/status").json() == {
    "configured": False, "authenticated": False, "device_trusted": False, "username": None,
    "pin_length": auth.MIN_PIN, "has_recovery_code": False,
}

reset_account()

print("ok - auth: hashing, rules, lockout, gate, device trust, PIN unlock, revocation, recovery code, "
      "no reset endpoint, drive-by setup refused, reset script")
