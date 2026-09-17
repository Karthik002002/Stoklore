# Dashboards

[← Back to index](README.md)

`/dashboards` — panels over market data and your workflows' data, arranged on a
grid the way you want: sectors and movers as heatmaps, your watchlist's day,
one stock's history, what workflows collected. Sources are a registry, so more
(the journal, alerts, holdings) plug in later without changing a panel.

## Using it

- **Start a dashboard** three ways from `/dashboards`:
  - **Build from a workflow** — a stat and a line for each number it collects, a
    top 10, a table, a pie, a heatmap, its run health and its notifications, with
    a dropdown for the field that names things (usually `symbol`). Also on each
    workflow's **Data** tab as **Build a dashboard**.
    - **Templates**, market first:
    - *Market pulse* — NIFTY 50 and NIFTY BANK today, NIFTY 500 breadth, every
      sector as a heatmap, sectors over 30 days and a year, every index.
    - *Market movers* — NSE's gainers and losers as a heatmap sized by turnover,
      the extremes, highest turnover, corporate actions behind the moves.
    - *Watchlist heatmap* — a *Watchlist* dropdown; today's move for each stock as
      a heatmap, advancing vs declining, volume against the 20-day average, 30
      days of daily moves as a heatmap.
    - *Stock deep-dive* — a *Symbol* dropdown; close and volume over time, the
      day's move, events by type, sentiment, every headline.
    - *Events radar* — events per stock per day, where the news is (coloured by
      sentiment), by type, the most-covered stocks, the latest headlines.
    - *Workflow health* and *Notifications overview* for the workflows
      themselves.
  - **New dashboard** — blank, opened in edit mode.
- **View mode** reads. Hover a panel for **View the data** and **Full screen**.
  **Click any mark** — a point on a line, a bar, a slice, a heatmap cell, a stat —
  and a drawer shows the exact rows behind it, each linking to its run, its stock
  or its notification. Click a table row to see that row in full.
- **Edit mode** (`Edit`) moves the grid: drag a panel by its header, resize from
  its bottom-right corner, and add, duplicate, edit or delete panels. Edits are a
  draft — **Save** keeps them, **Discard** drops them, and leaving with unsaved
  edits asks first.
- **Time range** (last hour … all time) and **auto-refresh** (off, 5s, 30s, 1m,
  5m) sit in the header. Picked in edit mode, they become the board's defaults.
- **Variables** are dropdowns in the header, e.g. *Symbol*. A panel filter whose
  value is `$symbol` follows it; set to **All**, that filter drops out, so the
  same board shows everything or narrows to one stock.
- ⌘K → **Dashboards**, or any dashboard by name; the grid icon in the sidebar.

## Every view is a URL

| Part of the view | In the URL |
|---|---|
| Time range | `?from=now-7d&to=now` |
| Auto-refresh | `?refresh=30` (seconds) |
| Variable values | `?vars={"symbol":"RAIN"}` |
| Edit mode, and the panel being edited | `?edit=true&panel=<id>` |
| Full-screen panel | `?view=<id>` |
| What was drilled into | `?drill={"panel":"<id>","group":"RAIN","bucket":"…"}` |

A reload, or a link sent to yourself, shows exactly that view.

## Panels

| Panel | Draws | Click opens |
|---|---|---|
| **Time series** | a value over time, a coloured line per group (the same chart as the Data tab) | the rows at that point, for that line |
| **Stat** | the latest value, how it moved against the one before, a sparkline | the rows in the latest bucket |
| **Table** | the rows themselves, newest first | that row |
| **Bar / top N** | one bar per group, largest first; negatives in red | that group's rows |
| **Pie** | each group's share | that slice's rows |
| **Heatmap** | a row per group, a column per day | that cell's rows |
| **Treemap** | a tile per group — area from one number (turnover, market cap, volume, or equal), green or red from another (the day's move) — a stock heatmap | that tile's rows |
| **Run health** | a bar per workflow run, red when it failed | the run's diagram |
| **Notifications** | what workflows filed, newest first | the notification in its inbox |

The panel editor (edit mode → pencil) is a drawer with a live preview. Every
change lands on the board as you make it.

- **Visualisation** — the eight types above. Run health and Notifications set
  their own source.
- **Data** — the source and its choices (a workflow, and a series for workflow
  data).
- **Query** — the value (a number field, or *Count rows*), the aggregate (`last
  first avg sum min max count`), group by, time bucket (per run / hour / day),
  order and limit. The fields offered come from the data itself, so a workflow's
  own columns appear with no setup.
- **Filters** — `field  = ≠ > ≥ < ≤ contains one-of has-a-value  value`. The
  value can be a `$variable`; *has a value* ignores it (e.g. only movers with a
  corporate action).
- **Display** — unit (`%`, `₹`, `s`), decimals; for a stat *a rise is bad*, so
  more failures show red; for a treemap the **colour scale** — the move that shows
  full green or red (blank uses the largest).

A treemap's tiles are laid out in the browser, squarified (Bruls et al.) against the
panel's measured size, so resizing the panel re-packs the tiles instead of
stretching them. The server sends one size and one colour value per tile.

## Sources

| Source | Rows | Time range |
|---|---|---|
| **NSE indices** | every NSE index: today's %, 30-day and 1-year %, advances/declines, P/E, P/B, yield; filter by category (Broad market, Sectoral, Thematic, Strategy…) | snapshot, refreshed every 5 min |
| **NSE movers** | the day's gainers and losers for one index cut (All securities, NIFTY 50, F&O…): %, last price, volume, turnover, corporate action | snapshot, NSE's once-a-day table |
| **Watchlist prices** | each watchlisted stock's latest close, previous close, % change, volume vs its 20-day average | snapshot, latest bar |
| **Price history** | daily bars — close, % change, open/high/low, volume — for one symbol or a watchlist | filtered by range |
| **Stock events** | events and headlines the scans found — type, sentiment, score | filtered by range |
| **Workflow data / runs / notifications** | what a workflow collected, every run, what it filed | filtered by range |

**A snapshot ignores the time range.** Today's movers or the latest close are what
they are; filtering them by "last hour" would only blank the panel.

- **NSE movers** read the snapshot the Movers page already keeps (fetched at most
  once a day), and NSE indices use the same 5-minute cache as the Indices page. A
  board refreshing every 5 seconds never asks NSE for more.
- **Watchlist prices and price history** take the previous close over the whole
  stored history, *before* the range is applied. So a range's first bar still has
  its change, and a stock's 20-day average is 20 real bars, not whatever the range
  cut off.

**A run is one point.** Grouping by run puts everything a single run collected —
eight symbols priced at 16:00 — at one moment on the x-axis, not eight moments a
few milliseconds apart.

## How it works

```
panel  →  query {source, params, filters, value, group_by, agg, bucket, …}
       →  POST /api/dashboards/query  →  source rows  →  dashboard_query.shape  →  what the panel draws
```

- **Sources** (`app/services/dashboards.py`, `SOURCES`) are the extension point.
  Each names its time field and its parameters, and returns flat dicts. Adding
  price history or the trade journal is one entry there; no panel changes.
- **Shaping** (`app/services/dashboard_query.py`) is pure — rows in, shapes out —
  and turns rows into `rows`, `timeseries`, `aggregate`, `stat` or `heatmap`.
  It also answers drill-downs.
- **Every panel asks separately**, so one slow or broken panel never blanks the
  rest of the board. A panel that fails says why in place.
- **Drill-down re-reads the rows with the panel's own filters, grouping and
  bucketing**, so the drawer shows exactly what made the mark. Buckets are formed
  over every row *before* narrowing to the clicked group. Doing it the other way
  round re-timed a run to that group's first row, and clicking a symbol that
  wasn't first in its run found nothing. That was caught against a real database
  and is pinned in the self-check.
- **Stored whole** in `dashboards` (name, panels, variables, settings) — the page
  reads and writes it in one piece, like a workflow's graph. Panels sit on a
  12-column grid laid out with `react-grid-layout`.
- **A bad time range** (`?from=yesterday-ish`) is refused with the forms that
  work, not a parse error.
- **The grid always fills the page.** The grid library measures its container
  once, when it mounts. The page used to show a loading spinner first, so on a
  fresh load there was no container to measure, and the grid stayed at the
  library's 1280px default — a gap on the right of any wider screen, only when
  the board wasn't already cached. The grid now mounts only after the board has
  loaded.

## What is checked

```bash
.venv/bin/python tests/dashboards.selfcheck.py
node frontend/src/components/charts/squarify.selfcheck.mjs
```

Pure, with no database or clock:
- variables and the *All* choice dropping a filter
- relative and absolute time ranges, and an unreadable one refused
- every filter operator, including a boolean matched by `true`
- rows, time series (a run is one point, a group is one line), aggregates, stats
  with their change, heatmaps
- drill-down for a group that isn't first in its run
- treemap tiles sized and coloured per group, equal tiles, zero sizes dropped
- the *has a value* filter
- every template and a workflow-built dashboard passing validation, and a panel
  past the 12th column refused

The treemap layout (`squarify.selfcheck.mjs`) checks that areas are proportional,
the tiles cover the panel exactly and never overlap, the tiles stay near-square,
and empty or unmeasured input produces no tiles.

The database side was verified against a throwaway database, never the live one:
- create, list, get and delete
- time-bounded run, notification and series reads
- every template and workflow-built panel running a real query — all 61 across
  the seven templates, with the NSE indices and movers fetched live
- the latest close, previous close and 20-day average volume against hand-computed
  numbers, and a range's first bar keeping its change
- every point on a chart drilling to exactly its own row

**Not covered:** the grid's drag and resize, which are the library's, and
rendering, which is checked by using the page.

| Piece | Job |
|---|---|
| `app/services/dashboard_query.py` | Filters, variables, time, and the five shapes; drill-down |
| `app/services/dashboards.py` | Sources, validation, templates, build-from-workflow |
| `app/routers/dashboards.py` | CRUD, query, drill, fields, values, templates |
| `frontend/src/dashboards/DashboardPage.tsx` | The grid, edit mode, header controls, save guard |
| `frontend/src/dashboards/panels.tsx` | The eight panel renderers |
| `frontend/src/dashboards/PanelEditor.tsx` | The live panel editor |
| `frontend/src/dashboards/DrillDrawer.tsx` | The rows behind a click |
| `frontend/src/dashboards/VariablesDialog.tsx` | Dashboard-wide dropdowns |
| `frontend/src/components/charts/SeriesChart.tsx` | The line chart shared with the Data tab |
| `frontend/src/components/charts/squarify.ts` | The treemap layout |
