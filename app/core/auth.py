"""Single-user login: a password + PIN to trust a browser, then the PIN alone for 48 hours.

The app is local-first but reachable through a Cloudflare tunnel (see the CORS block in main.py),
so this is written for the exposed case, not the localhost one.

What that means concretely:

- **Nothing reversible is stored.** Password and PIN are hashed with scrypt (stdlib `hashlib`, no
  new dependency - memory-hard, so a stolen database is expensive to attack offline), each with its
  own 16-byte salt.
- **There is no default account.** Until someone completes setup the app has no credentials at all,
  and setup is refused for a proxied request, so the tunnel can't be used to claim an instance
  before its owner does.
- **The PIN alone only works on a browser that already passed the full login**, and only for
  DEVICE_TRUST. A stranger has no device cookie, so the PIN is not a guessable entry point at all:
  where an exposed PIN-only login would allow hundreds of tries a day, this allows
  DEVICE_PIN_ATTEMPTS from an already-trusted browser before that browser is demoted.
- **The session token never touches the database in usable form.** The cookie holds a 256-bit
  random token; only its SHA-256 is stored, so a database dump doesn't hand over live sessions.
- **Every comparison is constant-time** (`hmac.compare_digest`) - a timing oracle on the username
  or the PIN would be a free hint.
- **Guessing is rate-limited** with an exponential lockout per client, and the failure reply never
  says which of the three fields was wrong.

Enforcement lives in main.py's middleware, not here: this module is the vocabulary, and the
self-check (tests/auth.selfcheck.py) exercises it without a database.
"""
import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta, timezone

from app.core import db

# scrypt, sized so one guess costs ~100ms and ~32MB here. Stored with the hash, so raising these
# later doesn't invalidate existing credentials - an old hash keeps verifying with its own values.
SCRYPT_N = 2**15
SCRYPT_R = 8
SCRYPT_P = 1
SALT_BYTES = 16


def _maxmem(n: int, r: int) -> int:
    """scrypt needs 128*n*r bytes, and OpenSSL refuses anything over 32MB unless told otherwise -
    which these parameters are, deliberately. Derived from the stored n/r rather than a constant,
    so raising the cost later doesn't start failing verification of old hashes."""
    return 128 * n * r * 2

#: How long a browser stays trusted after a full login - the window in which the PIN alone unlocks.
#: After it, the password is required again, wherever you are.
DEVICE_TRUST = timedelta(hours=48)
#: Wrong PINs allowed on a trusted browser before that browser is demoted to a full login. Small on
#: purpose: it is what keeps a 6-digit PIN out of reach even if someone steals the device cookie.
DEVICE_PIN_ATTEMPTS = 5

#: A session dies this long after it was created, however active it has been. Never longer than the
#: device trust behind it, so 48 hours is the outer bound on everything.
SESSION_MAX_AGE = DEVICE_TRUST
#: ...and this long after its last request, so an unattended browser doesn't stay open for a week.
SESSION_IDLE = timedelta(hours=8)

MIN_PASSWORD = 8
#: 6 digits = a million combinations. The device gate is what really bounds guessing, but a PIN is
#: also typed in public, so the extra two digits are cheap.
MIN_PIN = 6
MAX_PIN = 12

#: Wrong tries allowed before the lockout starts, then it doubles: 30s, 60s, 120s... capped.
FREE_ATTEMPTS = 5
LOCKOUT_BASE = 30
LOCKOUT_MAX = 15 * 60

USERNAME_KEY = "auth_username"  # a label, not a credential - see check_credentials
PASSWORD_KEY = "auth_password_hash"
PIN_KEY = "auth_pin_hash"
RECOVERY_KEY = "auth_recovery_hash"


# --- hashing -------------------------------------------------------------------------------------


def hash_secret(secret: str) -> str:
    """'scrypt$n$r$p$salt$hash', everything needed to verify it later."""
    salt = secrets.token_bytes(SALT_BYTES)
    derived = hashlib.scrypt(
        secret.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32,
        maxmem=_maxmem(SCRYPT_N, SCRYPT_R),
    )
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${derived.hex()}"


def verify_secret(secret: str, stored: str | None) -> bool:
    """Constant-time check. A missing or unparseable hash is False, never an exception."""
    if not stored:
        return False
    try:
        scheme, n, r, p, salt_hex, want_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        derived = hashlib.scrypt(
            secret.encode(), salt=bytes.fromhex(salt_hex), n=int(n), r=int(r), p=int(p), dklen=32,
            maxmem=_maxmem(int(n), int(r)),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(derived.hex(), want_hex)


# --- credentials ---------------------------------------------------------------------------------


def configured() -> bool:
    """True once someone has set up the one account. The whole app is open until this is True,
    which is why main.py refuses every request while it is False."""
    return bool(db.get_setting_value(USERNAME_KEY) and db.get_setting_value(PASSWORD_KEY))


def username() -> str | None:
    return db.get_setting_value(USERNAME_KEY)


def validate_new_credentials(user: str, password: str, pin: str) -> str | None:
    """The reason these credentials are unacceptable, or None. Length only: a rule that forces a
    digit and a symbol mostly produces Password1! - the lockout is what actually stops guessing."""
    if user is not None and not user.strip():
        return "a name is required"
    if len(password) < MIN_PASSWORD:
        return f"password must be at least {MIN_PASSWORD} characters"
    if not (MIN_PIN <= len(pin) <= MAX_PIN) or not pin.isdigit():
        return f"PIN must be {MIN_PIN}-{MAX_PIN} digits"
    if pin in password:
        return "the PIN must not be part of the password"
    return None


def set_credentials(user: str, password: str, pin: str) -> None:
    db.set_setting_value(USERNAME_KEY, user.strip())
    db.set_setting_value(PASSWORD_KEY, hash_secret(password))
    db.set_setting_value(PIN_KEY, hash_secret(pin))


def check_credentials(password: str, pin: str) -> bool:
    """The full login. No username: there is one account, and a name that is shown in the UI is not
    a secret - asking for it only adds typing.

    Both halves are always evaluated (`&`, not `and`): returning early on a wrong password would
    answer faster than a wrong PIN and say which one was right."""
    ok_password = verify_secret(password, db.get_setting_value(PASSWORD_KEY))
    ok_pin = verify_secret(pin, db.get_setting_value(PIN_KEY))
    return ok_password & ok_pin


def check_pin(pin: str) -> bool:
    """The PIN alone - only ever called for a browser that already holds a valid device token."""
    return verify_secret(pin, db.get_setting_value(PIN_KEY))


# --- lockout -------------------------------------------------------------------------------------
# ponytail: in-process, so a restart forgives the counter and a second worker keeps its own. Good
# enough for one user on one uvicorn process; move to a table if this ever runs multi-worker.
_failures: dict[str, tuple[int, float]] = {}


def locked_for(client: str, now: float | None = None) -> int:
    """Seconds this client must wait before another attempt counts. 0 when it may try."""
    count, last = _failures.get(client, (0, 0.0))
    if count <= FREE_ATTEMPTS:
        return 0
    wait = min(LOCKOUT_BASE * 2 ** (count - FREE_ATTEMPTS - 1), LOCKOUT_MAX)
    remaining = wait - ((now or time.time()) - last)
    return max(0, int(remaining) + 1) if remaining > 0 else 0


def record_failure(client: str, now: float | None = None) -> None:
    count, _ = _failures.get(client, (0, 0.0))
    _failures[client] = (count + 1, now or time.time())


def clear_failures(client: str) -> None:
    _failures.pop(client, None)


# --- sessions ------------------------------------------------------------------------------------

COOKIE_NAME = "stoklore_session"


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def start_session(user_agent: str | None = None) -> tuple[str, datetime]:
    """A new session. Returns (token for the cookie, when it expires) - the token itself is never
    stored, so it exists only in that one response and the browser that receives it."""
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + SESSION_MAX_AGE
    db.create_auth_session(_digest(token), expires, (user_agent or "")[:200])
    return token, expires


def session_valid(token: str | None) -> bool:
    """True when the token names a live session - and touches it, so idle timeout measures real
    inactivity. Expired or unknown tokens are simply false; the middleware turns that into a 401."""
    if not token:
        return False
    row = db.get_auth_session(_digest(token))
    if not row:
        return False
    now = datetime.now(timezone.utc)
    if row["expires_at"] <= now or row["last_seen"] + SESSION_IDLE <= now:
        db.delete_auth_session(_digest(token))
        return False
    db.touch_auth_session(_digest(token), now)
    return True


def end_session(token: str | None) -> None:
    if token:
        db.delete_auth_session(_digest(token))


def end_all_sessions() -> None:
    """Every browser signed out AND untrusted - what a credential change does, and the Settings
    panic button. Dropping the devices too is the point: a changed password must not leave some
    other browser able to walk back in with the old PIN."""
    db.delete_all_auth_sessions()
    db.delete_all_auth_devices()


# --- trusted devices ------------------------------------------------------------------------------
# A browser that has completed one full login may unlock with the PIN alone until the trust expires.
# The cookie is a second, longer-lived token, stored hashed like the session one.

DEVICE_COOKIE = "stoklore_device"


def trust_device(user_agent: str | None = None) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + DEVICE_TRUST
    db.create_auth_device(_digest(token), expires, (user_agent or "")[:200])
    return token, expires


def device_trusted(token: str | None) -> bool:
    """True when this browser may offer the PIN alone. Expired trust is deleted as it's noticed."""
    if not token:
        return False
    row = db.get_auth_device(_digest(token))
    if not row:
        return False
    if row["expires_at"] <= datetime.now(timezone.utc):
        db.delete_auth_device(_digest(token))
        return False
    return True


def device_expires_at(token: str | None) -> datetime | None:
    row = db.get_auth_device(_digest(token)) if token else None
    return row["expires_at"] if row else None


def unlock_with_pin(token: str, pin: str) -> bool:
    """PIN check for a trusted browser. A wrong PIN counts against the device, and at
    DEVICE_PIN_ATTEMPTS the trust is revoked outright - that browser is back to the full login,
    which is what makes a stolen device cookie plus PIN guessing a dead end."""
    if not device_trusted(token):
        return False
    if check_pin(pin):
        db.clear_auth_device_failures(_digest(token))
        db.touch_auth_device(_digest(token), datetime.now(timezone.utc))
        return True
    if db.bump_auth_device_failures(_digest(token)) >= DEVICE_PIN_ATTEMPTS:
        db.delete_auth_device(_digest(token))
    return False


def revoke_device(token: str | None) -> None:
    if token:
        db.delete_auth_device(_digest(token))


# --- recovery -------------------------------------------------------------------------------------
# Two ways back in, both deliberate:
#   1. From the machine itself (see the router's `proxied` check, and `python -m app.reset_login`).
#      Whoever is at the keyboard can already read the database, so this grants nothing new.
#   2. A one-time recovery code, shown once at setup. This one DOES work over a tunnel, which is the
#      point - it is for being locked out while away from the machine.

RECOVERY_GROUPS = 4
RECOVERY_GROUP_LEN = 5
#: No I/O/0/1 - this gets written down and read back by a human.
_RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def new_recovery_code() -> str:
    """A fresh code (~98 bits), generated and nothing more - `issue_recovery_code` is what stores
    one. Split so the generator stays pure and testable without a database."""
    return "-".join(
        "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(RECOVERY_GROUP_LEN))
        for _ in range(RECOVERY_GROUPS)
    )


def issue_recovery_code() -> str:
    """A new code, stored as a hash and returned once. It cannot be shown again, and issuing one
    invalidates whatever code came before it."""
    code = new_recovery_code()
    db.set_setting_value(RECOVERY_KEY, hash_secret(_normalise_code(code)))
    return code


def _normalise_code(code: str) -> str:
    """Case and dashes don't matter when typing it back in; the entropy is in the letters."""
    return "".join(ch for ch in code.upper() if ch.isalnum())


def check_recovery_code(code: str) -> bool:
    return verify_secret(_normalise_code(code), db.get_setting_value(RECOVERY_KEY))


def has_recovery_code() -> bool:
    return bool(db.get_setting_value(RECOVERY_KEY))


def clear_credentials() -> None:
    """Back to an unconfigured app: no account, no sessions, no trusted devices, no recovery code.
    The next visitor from the machine itself sets it up again."""
    for key in (USERNAME_KEY, PASSWORD_KEY, PIN_KEY, RECOVERY_KEY):
        db.set_setting_value(key, "")
    end_all_sessions()
