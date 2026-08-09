"""One-dump-per-day pg_dump backups of the live database, kept current in the background.

Motivation: this DB holds a hand-typed trade journal that cannot be retyped, Postgres here runs
with archive_mode=off (so there is no point-in-time recovery), and a single bad DELETE already
destroyed the whole `manual_trades` table once. This is the safety net for that.

Design - "parallel" means a background thread, not dual writes:
  - Any mutating HTTP request marks the DB dirty (one middleware in api.py, so new endpoints are
    covered automatically - nothing to remember to wire up).
  - A daemon thread dumps at most once per BACKUP_MIN_INTERVAL, and only when dirty. Bursts of
    writes therefore cost one dump, and an idle app costs nothing at all.
  - The file is named for today's date (crawler-YYYY-MM-DD.dump) and OVERWRITTEN on every dump
    that day - a sync never creates a second file for the same day, it just brings today's file
    up to date. Only the last KEEP_DAYS calendar days are kept; older ones are deleted after
    every dump, so retention self-heals even across a period the app wasn't running.
  - Dumps are pg_dump's custom format (-Fc), which allows restoring ONE table without touching the
    rest - the exact shape of the accident this exists to undo:
        pg_restore -d crawler --data-only -t manual_trades backups/<file>.dump
    Whole database:
        pg_restore -d crawler --clean backups/<file>.dump
"""
import os
import re
import subprocess
import threading
import time
from datetime import date, datetime, timedelta, timezone

BACKUP_DIR = os.environ.get("BACKUP_DIR", "backups")
# Ceiling on dump frequency, not a schedule: a dump only happens if something actually changed.
MIN_INTERVAL_SECONDS = int(os.environ.get("BACKUP_MIN_INTERVAL", "300"))
KEEP_DAYS = int(os.environ.get("BACKUP_KEEP_DAYS", "5"))
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql:///crawler")

_FILENAME_RE = re.compile(r"^crawler-(\d{4}-\d{2}-\d{2})\.dump$")

_dirty = threading.Event()
_lock = threading.Lock()  # ponytail: one dump at a time is plenty for a single-user app
_status = {"last_ok": None, "last_error": None, "last_path": None, "count": 0}


def mark_dirty():
    """Called after every successful mutating request. Cheap and thread-safe - the actual dump is
    deferred to the background loop, so a write never waits on pg_dump."""
    _dirty.set()


def _dated_dumps():
    """{date: filename} for every dump on disk - one entry per day, since the filename IS the
    day (no timestamp component to disambiguate multiple dumps on the same date)."""
    try:
        names = os.listdir(BACKUP_DIR)
    except FileNotFoundError:
        return {}
    found = {}
    for name in names:
        m = _FILENAME_RE.match(name)
        if m:
            found[date.fromisoformat(m.group(1))] = name
    return found


def _prune():
    """Delete every dump older than KEEP_DAYS calendar days. Age is measured from today, not from
    the newest dump on disk, so a gap in the app running (the machine was off for a week) doesn't
    resurrect week-old files as if they were still "the last 5 kept"."""
    if KEEP_DAYS <= 0:
        return
    cutoff = datetime.now(timezone.utc).date() - timedelta(days=KEEP_DAYS - 1)
    for day, name in _dated_dumps().items():
        if day < cutoff:
            try:
                os.remove(os.path.join(BACKUP_DIR, name))
            except OSError:
                pass


def run_dump():
    """Dump now, regardless of the dirty flag. Overwrites today's file if one already exists.
    Returns the path written, or raises."""
    with _lock:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        today = datetime.now(timezone.utc).date().isoformat()
        # Write to .part first and rename on success: a dump killed halfway (app restart, disk
        # full) must never leave a truncated file looking like a usable backup - the previous
        # day's good dump for today stays in place until the new one fully lands.
        final = os.path.join(BACKUP_DIR, f"crawler-{today}.dump")
        partial = f"{final}.part"
        try:
            result = subprocess.run(
                ["pg_dump", "--format=custom", "--file", partial, DATABASE_URL],
                capture_output=True, text=True, timeout=600,
            )
            if result.returncode != 0:
                raise RuntimeError(result.stderr.strip() or "pg_dump failed")
            os.replace(partial, final)  # atomic - overwrites an existing same-day dump in place
        except Exception as e:
            if os.path.exists(partial):
                os.remove(partial)
            _status["last_error"] = f"{datetime.now(timezone.utc).isoformat()}: {e}"
            raise
        _prune()
        _status.update(
            last_ok=datetime.now(timezone.utc).isoformat(),
            last_error=None,
            last_path=final,
            count=_status["count"] + 1,
        )
        return final


def status():
    dumps = _dated_dumps()
    newest_day = max(dumps) if dumps else None
    newest = os.path.join(BACKUP_DIR, dumps[newest_day]) if newest_day else None
    return {
        **_status,
        "dir": os.path.abspath(BACKUP_DIR),
        "retained": len(dumps),
        "retained_days": sorted(d.isoformat() for d in dumps),
        "keep_days": KEEP_DAYS,
        "min_interval_seconds": MIN_INTERVAL_SECONDS,
        "pending_changes": _dirty.is_set(),
        "newest_bytes": os.path.getsize(newest) if newest and os.path.exists(newest) else None,
    }


def _loop():
    # One dump at startup gives a restore point that predates whatever this run is about to do.
    try:
        run_dump()
    except Exception:
        pass
    while True:
        _dirty.wait()
        # Sleep first, then clear: writes arriving during the wait are covered by the dump we are
        # about to take, and clearing after the sleep collapses a burst into a single dump.
        time.sleep(MIN_INTERVAL_SECONDS)
        _dirty.clear()
        try:
            run_dump()
        except Exception:
            # Swallowed deliberately - a failing backup must never take the API down with it. The
            # reason is kept in status() and surfaced at GET /api/backup/status.
            pass


def start():
    threading.Thread(target=_loop, daemon=True).start()
