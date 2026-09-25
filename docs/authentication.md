# Login

[← Back to index](README.md)

One account in front of the whole app. **Password + PIN** to sign in on a browser; for the next
**48 hours** that browser unlocks with the **PIN alone**. The app is local-first but can be put on
a Cloudflare tunnel, so this is built for the exposed case: **the API refuses every request that
doesn't carry a valid session**, and the UI's login screen is only the polite part of that.

## Using it

**First run** — *Create your login*: a display name, a password (8+ characters) and a PIN (6–12
digits). This can only be done **from the machine running the app**; a request arriving through a
proxy or tunnel is refused, so nobody who finds the URL first can claim the instance. You're then
shown a **recovery code, once**.

**Day to day** — the PIN. A full password sign-in trusts that browser for 48 hours, and the PIN
unlocks it for as long as that lasts. After 48 hours, or on any other browser, it's the password
and PIN again.

**There is no username at sign-in.** There's one account; a name that is displayed in the UI isn't
a secret, and asking for it would only be typing.

**Signing out** — the icon at the bottom of the sidebar. The browser stays trusted, so coming back
needs only the PIN. **Shift-click** to forget the device as well — what you'd use on a machine
you're handing to someone else.

**Settings › Account** changes the password/PIN (re-proving the current ones) and issues a fresh
recovery code. Changing credentials signs every other browser out *and* untrusts them.

## If you forget the password or PIN

| Where you are | What to do |
|---|---|
| Away, or anywhere, with the recovery code | *Forgot it?* → **Use a recovery code**. Sets a new password and PIN, issues a fresh code, and throws out every session and trusted device |
| At the machine, without the code | `.venv/bin/python -m app.reset_login` (add `--yes` to skip the prompt). Clears the login so you can set it up again; trades and settings are untouched |
| Away, without the code | Nothing. That is the design |

**There is no reset endpoint, on purpose.** A reset that needs no credentials is reachable by any
page your browser happens to open: a cross-origin `fetch(..., {mode: 'no-cors'})` is still *sent*
whatever CORS says about reading the reply, and with no cookie required there is nothing to stop
it. Checking for proxy headers doesn't help — a request straight to `localhost` from a tab you
opened has none. So the fallback is a script, which needs a shell on the machine: the same access
that could read the database directly, and unreachable from the network.

The other unauthenticated write, **setup**, survives that test for a different reason: it needs a
JSON body, and `Content-Type: application/json` forces a CORS preflight this app refuses. The
shapes a page *can* send cross-origin (`text/plain`, form-encoded, multipart) are rejected with 422.
Both facts are pinned in the self-check.

## What protects what

| | |
|---|---|
| **Stored secrets** | scrypt (`n=32768, r=8`), a fresh 16-byte salt each, ~70 ms per verification — password, PIN and recovery code alike. Stdlib `hashlib`, no new dependency |
| **The session** | A 256-bit random token in an **HttpOnly** cookie; only its SHA-256 is stored. **SameSite=Strict**, `Secure` whenever the request is https or proxied. 8-hour idle, 48-hour absolute |
| **The device** | A second long-lived cookie, same storage rule, 48 hours. It is what makes PIN-only possible: without it the PIN is not accepted at all |
| **PIN guessing** | A stranger has no device cookie, so there's no PIN entry point. On a trusted browser, **5 wrong PINs revokes the trust** and forces the password back. Plus the shared per-client lockout below |
| **CSRF** | SameSite=Strict, and CORS doesn't allow credentials. There is no token to forge |
| **XSS blast radius** | Both cookies are HttpOnly; nothing about the login is in `localStorage` |
| **Password guessing** | 5 free attempts per client, then 30s doubling to a 15-minute cap; a correct login clears it |
| **Enumeration** | Wrong password and wrong PIN return the same 401 and the same sentence, and both are always evaluated so the timing doesn't leak either |
| **Recovery code** | ~98 bits, from an alphabet with no I/O/0/1 so it survives being written down. Single use: using it issues a new one. Rate-limited like a login |
| **Scope** | Every `/api` route, `/uploads` (trade screenshots), `/docs` and `/openapi.json`. The only open paths are `/api/auth/*`. An `/api` path that matches no endpoint answers 404, rather than the SPA's HTML with a 200 |

## How it works

- **`app/core/auth.py`** is the vocabulary: hashing, credential checks, the lockout, sessions,
  device trust, recovery codes. **`app/routers/auth.py`** is the endpoints. **`app/main.py`** holds
  the gate. **`app/reset_login.py`** is the CLI escape hatch — and the only reset there is.
- **The gate is middleware, not a per-route dependency.** A new endpoint is protected because it
  exists, not because someone remembered to guard it.
- **Before setup, everything is refused** rather than waved through. An instance with no account is
  a locked instance, not an open one.
- **Sessions and trust are server-side.** Logging out, changing credentials, expiry, or too many
  wrong PINs each delete the row — a copied cookie stops working at that moment, which a stateless
  token could not offer.
- **The frontend gate (`LoginGate.tsx`) is a convenience.** Deleting it in devtools reveals an empty
  shell; the data lives behind the API. Any unexpected 401 anywhere re-raises the login screen, so a
  tab left open overnight doesn't sit there looking signed in.

### Known limits

- **One account, no roles.** This is a personal journal.
- **48 hours of PIN-only is a real trade.** Someone with your unlocked laptop needs only the PIN in
  that window. Shift-click sign-out, or change the window in `auth.DEVICE_TRUST`.
- **The PIN is a second secret, not a second factor** — same device, same form. No TOTP.
- **The lockout is in-process.** Restarting the API forgives the counter, and a second worker keeps
  its own. Fine for one user on one uvicorn process; it needs a table before multi-worker (there's
  a `ponytail:` note on it). Device PIN failures *are* stored, so those survive a restart.
- **Rate limiting keys on the forwarded IP** when there is one, so an attacker who can vary that
  header gets a fresh bucket. Behind cloudflared, `cf-connecting-ip` is set by the tunnel itself.
- **Nothing encrypts the database.** Anyone with the machine and the disk has the journal; the login
  protects the network surface, not the filesystem.

## Checks

```bash
.venv/bin/python tests/auth.selfcheck.py     # hashing, credential rules, lockout, code format

createdb crawler_scratch
DATABASE_URL=postgresql:///crawler_scratch .venv/bin/python tests/auth.selfcheck.py
dropdb crawler_scratch
```

The second form drives the real API: unauthenticated requests (including `/uploads` and
`/openapi.json`) refused, forged session and device cookies refused, the PIN rejected outright
without device trust, wrong PINs revoking that trust, identical failure messages, the lockout
tripping, logout invalidating server-side, idle and trust expiry, recovery by code (including that
a spent code stops working), that no reset endpoint exists, that a drive-by page can't claim an
unconfigured instance, and that the script does clear the login. It runs only against a database
named *scratch* or *test*.
