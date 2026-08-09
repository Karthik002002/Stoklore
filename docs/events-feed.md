# Events Feed

[← Back to index](README.md)

## Using it

- `/events` — pick a watchlist (or "all"), pick a date range (presets: last
  week/month/3mo/6mo), click **Scan**.
- Finds news, price moves, volume spikes, and corporate actions — no LLM
  calls, so it's fast and safe to re-run (won't duplicate what it already
  found).
- Each event with a link has a "···" menu: **Open** or **Tag in chat**.
- **Unusual attention** — a row of chips above the event list, showing which
  watchlisted stocks are getting more event coverage than their own normal
  pace right now (`NEW` for a symbol with no prior baseline at all, or
  `2.4×` etc. for how far above its usual rate it is). Independent of the
  date-range filter below it — it's always "vs. right now", not scoped to
  whatever historical range you're browsing.

## How it works

`POST /api/events/scan` spawns a background thread running
`events.scan(list_name)` (`app/core/events.py:47`), which iterates every symbol in
the chosen watchlist and calls `scan_symbol` on each, isolating exceptions
per-symbol so one bad fetch doesn't kill the whole scan. Progress is polled
via `GET /api/events/status`.

Inside `scan_symbol` (`app/core/events.py:13`), four independent checks run per
stock:

| Type | Source | Threshold | Dedup key |
|---|---|---|---|
| News | `scraper.get_news(symbol)` | every article | article URL |
| Price move | live quote's `changePercent` | `abs(change) >= 5.0%` (`app/skills/movement.py`) | symbol + today's date |
| Volume spike | live quote's volume vs. average | `volume >= 2× average` (`app/skills/volume.py`) | symbol + today's date |
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

### Unusual attention: coverage volume vs. a symbol's own baseline

`GET /api/events/attention` → `db.attention_scores()` (`app/core/db.py`) answers "is
this stock getting more coverage than usual", not "what does the latest
headline say" — the distinction the whole Events feed above is otherwise
blind to (a single alarming headline looks the same whether it's an
isolated story or the start of a building narrative).

For each symbol with any `stock_events` rows in the lookback window, it
counts events in two buckets - `recent_count` (last `recent_days`, default
3) and `baseline_count` (the `baseline_days` before that, default 30,
**excluding** the recent window so a live spike never dilutes its own
comparison point) - then derives:

- `baseline_avg` = `baseline_count / (baseline_days - recent_days)`, an
  average events/day over the symbol's normal recent history.
- `ratio` = `(recent_count / recent_days) / baseline_avg` - how many times
  above its own normal pace the symbol is right now. `null` when
  `baseline_avg` is 0 (no prior events at all to compare against) - flagged
  instead as `is_new_attention`, since "brand new coverage" isn't
  expressible as "N times normal."

The frontend (`AttentionPanel` in `EventsFeed.jsx`) applies its own display
threshold on top of the raw scores (`ATTENTION_THRESHOLD = 1.3`, capped to
the top `MAX_ATTENTION_CHIPS = 8`) - the API itself returns every symbol's
score unfiltered, sorted `is_new_attention` first, then by `ratio`
descending, so a stricter or looser cutoff is a one-line frontend change,
not an API one.
