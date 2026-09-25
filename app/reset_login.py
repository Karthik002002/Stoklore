"""Clear the login so the app asks you to set it up again:

    .venv/bin/python -m app.reset_login          # asks first
    .venv/bin/python -m app.reset_login --yes    # no prompt

For when the password and PIN are both gone and you don't have the recovery code either. Trades,
watchlists, settings - everything else is untouched; only the credentials, sessions, trusted
devices and the recovery code go.

**This is deliberately not an HTTP endpoint.** A reset that needs no credentials would be reachable
by any web page your browser opens: a cross-origin POST is still *sent* whatever CORS says about
reading the reply, and with no cookie required there would be nothing to stop it. A script needs a
shell on the machine, which is the same access that could read the database directly - so it grants
nothing new, and it cannot be triggered from the network at all.
"""
import argparse
import sys

from app.core import auth, db


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="python -m app.reset_login",
        description="Clear the app's login (password, PIN, recovery code, sessions). Trades are kept.",
    )
    parser.add_argument("--yes", action="store_true", help="skip the confirmation prompt")
    args = parser.parse_args(argv)

    try:
        db.init_schema()
    except Exception as e:  # noqa: BLE001 - the usual cause is "Postgres isn't running"
        print(f"couldn't reach the database: {e}", file=sys.stderr)
        return 1

    if not auth.configured():
        print("No account is configured - open the app and set one up.")
        return 0

    name = auth.username() or "(unnamed)"
    if not args.yes:
        answer = input(f"Clear the login for '{name}'? Trades and settings are kept. [y/N] ")
        if answer.strip().lower() not in ("y", "yes"):
            print("Left alone.")
            return 0

    auth.clear_credentials()
    print("Login cleared. Open the app on this machine to create a new one.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
