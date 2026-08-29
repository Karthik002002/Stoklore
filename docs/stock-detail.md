# Stock Detail

[← Back to index](README.md)

## Using it

- Click any stock (dashboard, search, or `@` tag) to open `/stock/:symbol`.
- Toggle candlestick/line, add EMA overlays with the period inputs.
- The default chart shows 1 year of history. Click **Collect max history**
  to pull the full listed history once — needed before Bar Replay or an
  Auto-backtest detail run can use it.
- The EMA Crossover panel takes two periods (or a preset like 20/50) and
  reports a golden/death cross, or the current %-spread if there's no
  crossover.
- The Screener.in panel's **Shareholding Pattern** tab prints the
  quarter-on-quarter change under each cell — percentage points of shares
  outstanding for the holder rows, shareholders for the count row. The
  other statement tabs don't: their rows mix ₹ Cr, % and per-share units
  within one table, so a column of deltas would be several different
  quantities stacked in one place.

## How it works

**Chart** — a shared `PriceChart` component renders both the default 1y
view and the full-history view off the same code path (candlestick/line
toggle, a volume pane, EMA overlays computed client-side from the fetched
bars via `computeEma` in `lib/indicators.js`, hover tooltip). The 1y view
reads `price_history`; the full-history view only renders once
`price_history_max` actually has data for that symbol (see
[Dashboard](dashboard.md#how-it-works) for how each table gets populated).

**EMA Crossover panel** — `GET /api/prices/{symbol}/ema-crossover?short=..&long=..`
→ `prices.ema_crossover(symbol, short, long)` (`app/core/prices.py:84`). It pulls
`long + 250` closes from `price_history`, computes both EMAs with pandas'
`.ewm(span=n, adjust=False).mean()`, and looks at `shortEma - longEma`:
- crossed from `<=0` to `>0` on the latest bar → **bullish** (golden cross)
- crossed from `>=0` to `<0` on the latest bar → **bearish** (death cross)
- otherwise `crossover: null`, and the frontend shows the current %-spread
  between the two EMAs instead

It also walks backward through the diff series to find `lastCrossoverDate`
— the most recent date, anywhere in the fetched window, either kind of
crossover happened — independent of whether one happened *today*. If there
isn't at least `long + 2` bars of history yet, the endpoint returns nothing
and the panel just says there isn't enough data (sync the symbol's price
history first).

**Backtest summary card** reads the same `backtests` table Backtesting →
Auto/Manual write to — nothing computed specially for this page, it's just
surfaced here too so past results aren't buried on a separate tab.

**Shareholding deltas** — the screener's cells are display strings ("74.90%",
"1,02,345", "—"), so the change is read back out of them by
`cellChange` in [`lib/screenerTable.js`](../frontend/src/lib/screenerTable.js).
An absent quarter is written `—` and must read as *missing*, not as zero — a
zero there would print a 75-point collapse under a holding that simply wasn't
filed. Pinned by `node frontend/src/lib/screenerTable.selfcheck.mjs`.

For the promoter-move screener that reads NSE's own filings (share counts, not
percentages, so a promoter *buying* is told apart from a promoter being *given*
shares), see [Shareholding](shareholding.md).

**Tables** — the Financials and Screener.in statement tables render through
one shared [`DataTable`](../frontend/src/components/DataTable.jsx): TanStack
Table for the row model, TanStack Virtual for windowing, drawn with the same
`ui/table` primitives as every hand-written table in the app, so adopting it
changed no styling. A caller passes column definitions; `meta.className` /
`meta.headClassName` carry per-column alignment, the sticky first column, and
the highlighted TTM column.

Rows are windowed only past 60 of them — below that the measuring pass and the
spacer rows buy nothing, so neither table on this page virtualizes today. The
windowing uses spacer rows rather than absolutely positioned ones: a `<tr>`
taken out of flow stops sharing the table's column widths, which the sticky
first column depends on. Sorting is off unless a caller asks for it, and only
columns with an accessor can sort.

Both tables here are pivoted — a row per line item, a column per period — so
the period index lives on the column definition, which is what makes "vs the
previous quarter" a column-local question.
