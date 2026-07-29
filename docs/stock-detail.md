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

## How it works

**Chart** — a shared `PriceChart` component renders both the default 1y
view and the full-history view off the same code path (candlestick/line
toggle, a volume pane, EMA overlays computed client-side from the fetched
bars via `computeEma` in `lib/indicators.js`, hover tooltip). The 1y view
reads `price_history`; the full-history view only renders once
`price_history_max` actually has data for that symbol (see
[Dashboard](dashboard.md#how-it-works) for how each table gets populated).

**EMA Crossover panel** — `GET /api/prices/{symbol}/ema-crossover?short=..&long=..`
→ `prices.ema_crossover(symbol, short, long)` (`prices.py:84`). It pulls
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
