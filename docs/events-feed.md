# Events Feed

[← Back to index](README.md)

## Using it

- `/events` — pick a watchlist (or "all"), pick a date range (presets: last
  week/month/3mo/6mo), click **Scan**.
- Finds news, price moves, volume spikes, and corporate actions — no LLM
  calls, so it's fast and safe to re-run (won't duplicate what it already
  found).
- Each event with a link has a "···" menu: **Open** or **Tag in chat**.

## How it works

`POST /api/events/scan` spawns a background thread running
`events.scan(list_name)` (`events.py:47`), which iterates every symbol in
the chosen watchlist and calls `scan_symbol` on each, isolating exceptions
per-symbol so one bad fetch doesn't kill the whole scan. Progress is polled
via `GET /api/events/status`.

Inside `scan_symbol` (`events.py:13`), four independent checks run per
stock:

| Type | Source | Threshold | Dedup key |
|---|---|---|---|
| News | `scraper.get_news(symbol)` | every article | article URL |
| Price move | live quote's `changePercent` | `abs(change) >= 5.0%` (`skills/movement.py`) | symbol + today's date |
| Volume spike | live quote's volume vs. average | `volume >= 2× average` (`skills/volume.py`) | symbol + today's date |
| Corporate action | yfinance `.actions`/`.calendar` (last 30 days) | any dividend/split/earnings date | `action_type:date` |

**Dedup** is enforced at the DB level, not just in application logic: the
insert (`db.insert_event`) is `INSERT ... ON CONFLICT (symbol, event_type,
dedup_key) DO NOTHING`, against a real unique constraint on
`stock_events(symbol, event_type, dedup_key)`. That's what makes re-running
a scan safe — a story or a same-day price move that already exists just
silently no-ops instead of creating a duplicate row.

**Sentiment badges** are computed only for news events, via the same local
FinRoBERTa classifier used by `/sentiment` (see
[Sentiment](sentiment.md#how-it-works)) — scored once at scan time and
stored alongside the event, not recomputed on every page view.
