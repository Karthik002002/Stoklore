# Leaders

`/leaders` - the strongest stocks in the strongest sectors, across the NSE main board.

## Using it

- **Scan** - set the filters and press **Scan N** to flip through the matches in the chart slideshow
  (mark A/B/C as usual):
  - **RS ≥** (default 70) - the RS rating, below.
  - **Template ≥** (default 7 of 8) - Minervini's trend template: price above the 150- and 200-day
    averages, 150 above 200, the 200 rising for a month, 50 above 150 and 200, price above the 50,
    at least 30% above the 52-week low, within 25% of the 52-week high, RS 70+. Hover the score for
    which checks pass.
  - **Within % of 52wH** (default 15).
  - **₹Cr/day ≥** - average traded value over 20 days, to skip illiquid names.
  - **VCP only** - see below.
  - **Leading / improving sectors only** (on by default) - only stocks whose ET sector is in the
    Leading or Improving quadrant of the weekly rotation.
- **Sector rotation** - the RRG. Across: RS-Ratio (above 100 = beating NIFTY relative to its own
  trend); up: RS-Momentum (above 100 = that lead is growing). Sectors rotate clockwise: improving →
  leading → weakening → lagging. Weekly for positional work, daily for swing.
  - **Graph** is calm by default: one dot per sector, no tails or names. Hover a sector (on the graph
    or in the list) for its recent path and name; click to pin it so it stays lit. The scale follows
    the middle 90% of sectors so one runaway doesn't squash the rest - a sector past it sits on the
    edge with a ring.
  - **Timeline** shows the same thing as rows: one per sector, one cell per week (or day) coloured
    by the quadrant it was in, deeper the further from 100 - the rotation reads left to right.
  - The 20 largest sectors by market cap by default; tick **All sectors** for every one.
  - **Stocks ↗** beside each sector (timeline rows and the side list) opens the home page with that
    sector expanded in the Sector Performance panel - its member stocks, scrolled into view (the
    panel is un-hidden if you'd hidden it on the home layout).
- **RS ranking** - every rated stock, sortable, with a symbol search.

The open tab, Weekly/Daily and Graph/Timeline are kept in the URL (`?tab=rotation&tf=daily&view=timeline`; defaults are left out), so going back, reloading or sharing the link returns to the same view.

RS also appears as a column on the home watchlist and the Chart page sidebar, and in the sector panel's
hover card (with the template score and distance from the 52-week high).

## How it works

**Data: NSE's bhavcopy** (`app/core/bhavcopy.py`). One file per trading day carries the OHLC, volume
and traded value of every NSE security, so a year of history for the whole market is ~280 requests,
not one per stock - per-stock downloads hit rate limits. The first request to `/api/strength/*` starts
a background backfill (one file every ~2.5s, ~15-20 minutes, once, **newest day first**); after that each evening's file
(published after 18:30 IST) is pulled by a background tick every 15 minutes, whether or not the page is open. Files are cached as gzipped CSV in
`local_data/bhavcopy/` - gitignored, never the database. A holiday leaves an empty marker so it is
not asked for again; a day already on disk is never fetched twice. Only EQ and BE series rows are
kept, and only symbols in the NSE stocks master are rated - the bhavcopy files ETFs under EQ too.

**While the first backfill runs** the page doesn't wait: from 20 days collected it shows results rated
on the history so far, under a progress bar, re-rated every 10 more days. Because the newest days come
first, those partial ratings are current; what needs the full year (the 12-month return, the 200-day
average and the template checks built on it) fills in as it completes.

**Splits and bonuses.** Bhavcopy prices are as traded. NSE's corporate-actions list (one request a
day, cached as `local_data/bhavcopy/corp_actions.json`) gives each split and bonus with its ex-date;
prices before it are divided by the factor (bonus a:b → (a+b)/b, split Rs X → Rs Y → X/Y) and volume
multiplied, so those stocks are rated on their real moves - 1:3 and 1:4 bonuses included. As a
backstop, a stock whose adjusted year still contains an overnight **fall** matching a split ratio
(1.5×, 2×, 3×, 4×, 5×, 10×, ±4%) is left out rather than shown with a fake crash - the page says how many.

**VCP alerts.** When a new day lands (full year only, not partial ratings), every stock that passes
the VCP read today but didn't on the previous day checked - and trades at least ₹1 Cr a day - gets an
entry in the Alerts feed (kind `scan`): symbol, RS, pivot and distance to it. The first run only
records the current set, so switching it on doesn't flood the feed. Seen set:
`local_data/bhavcopy/vcp_seen.json`.

**RS rating** (`app/core/strength.py`): `0.4·r3m + 0.2·r6m + 0.2·r9m + 0.2·r12m` per stock, then the
percentile across every rated stock, 1-99. Stocks with under 200 bars are not rated. "6M vs Nifty" is
the 6-month return minus NIFTY 50's (NIFTY from Yahoo, one cached request - the bhavcopy has stocks
only).

**VCP read**: a 3% zigzag over the last 120 bars finds each pullback (high to next low). The latest run
of successively shallower pullbacks counts if it has 2+ of them and the last is ≤ 12%; volume is
"drying up" when the 10-day average is ≤ 75% of the 50-day; "near pivot" is within 5% under the last
pullback's high or up to 3% through it. All three = VCP. These are readings, not signals.

**Sector rotation**: Yahoo has full history for only four NSE sector indices, so each ET sector
(the 67 in the home Sector panel) is rebuilt from its members: each day, the market-cap-weighted
average of the members' daily returns, compounded. Members with a split gap are left out; sectors with
fewer than 3 clean members are skipped. The RRG maths is an open approximation of JdK's proprietary
RS-Ratio/RS-Momentum: `RS = sector / NIFTY`, `RS-Ratio = 100 · RS / mean(RS, 10 bars)`,
`RS-Momentum = 100 · RS-Ratio / RS-Ratio 5 bars ago`; the last 8 points are drawn as the tail.

Endpoints: `GET /api/strength/status`, `POST /api/strength/sync`, `GET /api/strength/stocks`,
`GET /api/strength/rrg?tf=weekly|daily`. Results are computed once per cached day and held in memory.

Self-check: `.venv/bin/python tests/strength.selfcheck.py`.
