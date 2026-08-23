# Database Backups

[← Back to index](README.md)

## Using it

- Nothing to turn on. The API dumps the database in the background while it
  runs, and once on startup.
- Dumps land in `backups/` as `crawler-<YYYY-MM-DD>.dump` — **one file per
  calendar day**. Every sync that lands on the same day overwrites that day's
  file in place; it never creates a second dump for the same date. The folder
  is gitignored — a dump contains your whole journal and is never committed.
- Only the **last 5 calendar days** are kept. After every dump, anything older
  than that is deleted automatically.
- `GET /api/backup/status` — when the last dump succeeded, which days are
  currently retained, whether changes are waiting, and the last error if one
  happened.
- `POST /api/backup` — force a dump right now. Worth hitting before anything
  risky (a bulk edit, a schema change, a script you're not sure about) rather
  than waiting out the interval.

## What's in a dump

**The entire database, not just the trade journal.** `pg_dump` runs with no
`--table` filter, so every table is included — schema and data:

`manual_trades`, `trade_accounts`, `balance_adjustments`, `watchlists`,
`watchlist`, `watch_rules`, `stock_events`, `settings`, `chat_sessions`,
`chat_messages`, `scraped_items`, `stock_news`, `top_news`, `stocks_master`,
`symbol_isin`, `stock_cache`, `price_history`, `price_history_max`,
`backtests`, `auto_backtest_scripts`, `daily_activity`.

Roughly 830 KB per dump on a typical database (price history is most of it),
so keeping 5 days of daily dumps is around 4 MB.

`daily_activity` holds the synced history, but **today's tally lives in the
browser** until it syncs (`localStorage`, key `activity.time` — see
`frontend/src/lib/activityTime.js`). Restoring a dump onto a different machine
therefore brings back the streak history and not the current day's partial
count, and clearing site data loses at most the unsynced remainder.

Trade **screenshots are not in the dump** — they're files on disk under
`uploads/`, backed up by whatever backs up that folder. A restored trade row
keeps its `image_filename`, so the link re-connects as long as `uploads/`
still has the file.

## Restoring

One table — the common case, when something went wrong in one place:

```bash
pg_restore -d crawler --data-only -t manual_trades backups/crawler-2026-08-01.dump
```

The whole database:

```bash
pg_restore -d crawler --clean backups/crawler-<stamp>.dump
```

Inspect what a dump holds before restoring anything:

```bash
pg_restore -l backups/crawler-<stamp>.dump
```

## How it works

**Custom format (`-Fc`), not plain SQL.** Both are the same amount of code, but
the custom format can restore a single table without touching the other twenty
— which is the exact shape of the accident this exists for. Plain SQL would
mean hand-extracting the right `COPY` block out of a text file.

**Writes are never blocked.** A mutating request only sets a flag
(`backup.mark_dirty()`); a daemon thread does the actual dumping. Nothing waits
on `pg_dump`.

**One middleware, not per-endpoint calls.** Any non-GET request that returns
under 400 marks the database dirty, so a newly added `POST`/`PUT`/`DELETE` is
covered without anyone remembering to opt it in. Failed requests and reads
don't mark anything.

**Dirty-flag debounce, not a fixed schedule.** The loop waits for a change,
sleeps out `BACKUP_MIN_INTERVAL`, then dumps — so a burst of twenty edits costs
one dump, and an idle app costs nothing at all. Writes arriving during that
sleep are covered by the dump about to be taken.

**Partial dumps can't masquerade as good ones.** Each dump is written to
`<name>.dump.part` and renamed only after `pg_dump` exits cleanly. A dump
interrupted by a restart or a full disk leaves nothing behind.

**A failing backup never takes the API down.** Exceptions in the loop are
swallowed on purpose; the reason is kept and surfaced at
`GET /api/backup/status`, which is the thing to check if you want to know the
backups are actually working.

**One file per calendar day, overwritten in place.** The filename encodes only
the date, not a time - a second sync on the same day dumps to `<file>.part`
and then atomically replaces that day's existing dump, so a day's backup is
always the most recent state from that day, not a growing pile of near-
duplicates.

**Retention is by calendar age, not file count.** After every dump, any file
whose date is older than `BACKUP_KEEP_DAYS` days ago is deleted. Age is
measured from today, not from the newest file on disk, so a gap in the app
running (the machine was off for a week) doesn't let stale dumps masquerade as
"the last 5 kept" - they're pruned on the next run regardless.

## Configuration

Environment variables, all optional:

| Variable | Default | Meaning |
|---|---|---|
| `BACKUP_DIR` | `backups` | Where dumps are written |
| `BACKUP_MIN_INTERVAL` | `300` | Minimum seconds between dumps (a ceiling on frequency, not a schedule) |
| `BACKUP_KEEP_DAYS` | `5` | How many most-recent calendar days of dumps to retain |

## What this does and doesn't protect

This is a rolling snapshot, so **you can lose up to `BACKUP_MIN_INTERVAL` of
work** — it is not point-in-time recovery. Postgres here runs with
`archive_mode=off` and `wal_level=replica`, so there's no WAL archive to replay
and no way to recover the moment before a mistake. Turning on WAL archiving
would give true PITR, at the cost of a Postgres config change and a restart.

It also doesn't protect against losing the disk — every dump sits on the same
machine as the database. Copying `backups/` somewhere else periodically is the
missing half.
