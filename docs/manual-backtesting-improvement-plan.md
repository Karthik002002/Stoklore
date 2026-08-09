# Manual Backtesting — Improvement Plan

[← Back to index](README.md) · builds on [backtesting-manual.md](backtesting-manual.md) and [bar-replay.md](bar-replay.md)

Source analyzed: [coderkhalide/Trading-Journal](https://github.com/coderkhalide/Trading-Journal) (MIT) — a
client-only Next.js/localStorage trade journal for forex/crypto. Full codebase read (types, calc
utils, every analytics component, hooks, import/export, validation) — nothing skimmed.

## Where we already win — don't touch

- **Postgres-backed, not localStorage.** TJ's entire dataset lives in the browser and is one
  cache-clear from gone; `manual_trades` in our `app/core/db.py` already survives that.
- **Native Bar Replay** (bar-by-bar practice trading with an order engine that writes straight
  into `manual_trades`) — TJ has nothing like this; it's pure after-the-fact logging.
- **Vision-LLM bulk screenshot import** (`llm.analyze_trade_screenshot`) — TJ only has manual
  entry, CSV import (one broker: Exness), and a clipboard-paste parser for that same broker's
  copy format. No screenshot path at all.

## What's worth taking

Ranked by leverage. Everything here is *analysis tooling for a human*, not an AI verdict —
matches the existing design principle (`AGENT_SYSTEM` in `app/main.py` + `app/routers/` never recommends, only reports
against user-stated criteria).

### 1. Setup tagging + per-setup performance breakdown (highest leverage)

TJ's biggest idea: every trade carries a `system` (their term for "which strategy/setup") and all
analytics slice by it — this is the actual "does my backtested edge hold up" question, and we
don't have it at all. `tags TEXT[]` on `manual_trades` isn't a substitute — nothing forces one
canonical value per trade, so you can't cleanly group-by it.

- Add `setup TEXT` column to `manual_trades` (call it *Setup*, not TJ's "system" — matches how
  equity traders actually talk: "Breakout", "EMA Pullback", "Earnings Play").
- User-configurable setup list lives in the existing `settings` key-value table (same pattern
  already used for broker/model config) — no new table needed.
- New analytics view: win rate / avg P&L / avg R by setup, sorted best→worst. This is the single
  chart that answers "which of my setups should I actually keep trading."
- **Stretch, not in TJ, our own idea**: let `setup` optionally reference a `watch_rules.name` —
  then you can ask "trades I entered because they passed my \[X\] watch rule — did they actually
  perform?" Ties the objective-rule-checking feature you already built to real outcomes. Skip for
  v1, flag as a follow-up.

### 2. Risk-discipline framework: ideal risk vs actual risk, Expected-R

TJ separates *planned* risk from *actual* risk per trade:

```
riskAmount       = |entry - stop| × quantity            (actual, from what you logged)
idealRiskAmount  = what you told yourself you'd risk     (stored, chosen at entry)
riskDeviation%   = (actual - ideal) / ideal × 100
expectedR        = pnl / idealRiskAmount
isOverRisked     = riskDeviation > tolerance%  (tolerance configurable, default 10%)
```

We already compute `tradeRR` (target:stop ratio) in `lib/manualTrades.js`, but that's a *plan*
metric, not a *discipline* metric — it doesn't tell you whether you actually sized the trade the
way you meant to. This does.

- Add `ideal_risk_amount REAL` to `manual_trades` (nullable — old trades won't have it, degrade
  gracefully same as `stop_loss`/`target` already do).
- Everything else (`riskDeviation`, `expectedR`, `isOverRisked`/`isUnderRisked`) is derived at
  read time in `lib/manualTrades.js`, same convention the file's own header comment already
  commits to for P&L/RR/return%.
- Default ideal-risk-tolerance % goes in the same settings blob as setups.

### 3. Equity curve (Expected-R and account-balance versions)

We have a cumulative-P&L area chart already (`ManualOverview.jsx`'s `totalPnlData`). TJ adds two
things worth having:

- **Expected-R equity curve** — cumulative `expectedR` per trade, not ₹. Shows discipline over
  time independent of position-size drift (a ₹50k trade and a ₹5k trade both just count as their
  R).
- **Account-balance curve** — starts from a configured opening balance (new settings field) and
  walks forward by each trade's P&L. TJ also has a `BalanceAdjuster` for manual corrections
  (deposits/withdrawals/broker-fee true-ups) that feed into this curve without being trades
  themselves — small, worth porting as a `balance_adjustments` table mirroring their shape
  (amount, reason, type add/subtract, date).

### 4. R-multiple distribution histogram

Bucket closed trades by `floor(rMultiple)` into a bar chart (`-3+`, `-2`, `-1`, `0`, `1`, `2`,
`3+`). Cheap (`ManualOverview.jsx` already has `pnls`/`closed` computed) and it's the chart that
shows *shape* of your edge — e.g. "I win small a lot and lose big rarely" vs the reverse — which
win-rate/profit-factor alone can't show.

### 5. Day-of-week and session (time-of-day) breakdown

Both are pure functions of `traded_at`, zero new columns:

- Day-of-week: `new Date(traded_at).getDay()` → bucket win rate / avg R.
- Session: NSE-specific buckets instead of TJ's forex sessions — e.g. Opening (9:15–9:45),
  Mid-day (9:45–14:30), Closing (14:30–15:30) — configurable in settings same as TJ's
  `tradingSessions`, but our defaults should match NSE hours, not London/NY.
- Surfaces "best/worst day" and "best/worst session" cards, same pattern TJ uses.

### 6. Multi-field filter bar for the Trades tab

Currently the Trades tab (`ManualBacktesting.jsx`) is unfiltered — one flat table. TJ's
`AdvancedFilterDialog` filters by setup/timeframe/session/day/grade/tags/risk-deviation/R-range/
P&L-range simultaneously with a live "N of M trades" preview. Worth one filter bar (not a modal —
we don't have that many fields) above `TradesTable`, reusing the multi-select badge-toggle pattern
for setup/tags and plain min/max inputs for R and P&L range.

### 7. Bulk edit for existing trades

We have bulk *import* (`BulkTradesDialog.jsx`, screenshots) but no bulk *edit* — no way to
multi-select rows in `TradesTable` and apply "set setup = X" or "add tag Y" across all of them.
Useful once setup-tagging exists and you're backfilling old trades. TJ's `BulkUpdateDialog` is a
reasonable shape to copy: checkbox-per-field ("update this field: y/n") so you don't accidentally
blank out fields you didn't mean to touch.

### 8. CSV/JSON export

We have zero export path today (checked `services/api.js` and the API routes — nothing there).
TJ's `lib/export-import.ts` is worth the direct port of the *shape*, not the code: a JSON dump
(trades + settings + adjustments, versioned) for backup/restore, and a flat CSV for opening in
Excel/Sheets. Straightforward `GET /api/manual-trades/export` returning either format.

## Explicitly not taking

- **Sharpe ratio, max drawdown** — TJ's README advertises both under "Key Metrics Explained" but
  neither is actually implemented anywhere in the code (confirmed by grep across the repo — no
  `sharpe`/`drawdown` hits at all). Don't chase a feature that doesn't exist upstream. Max
  drawdown specifically *is* legitimately useful and cheap once the balance-equity curve (#3)
  exists — compute peak-to-trough on that series ourselves, correctly, rather than porting
  vaporware.
- **Trade grading (A++++ to F) with grade-adjusted position sizing** — clever idea (scale ideal
  risk by setup-quality grade) but it's a second axis on top of setup-tagging (#1) and
  risk-discipline (#2) that adds real form complexity for marginal extra insight. Revisit only if
  #1+#2 ship and feel like they need it.
- **Fee-impact analysis dashboard** — built for forex/crypto per-lot fee structures in USD.
  Indian equity delivery trades have brokerage+STT+other charges that don't map cleanly to
  "fee per lot per asset." Worth a much smaller version (flat brokerage/trade estimate subtracted
  from P&L) only if you start logging intraday/F&O trades where costs actually bite.
- **Broker CSV/clipboard-paste importers** — built against one specific forex broker's (Exness)
  export/copy format. Not portable. Our vision-LLM screenshot import already solves the "get a
  trade from somewhere else into the journal" problem more generally.
- **Rich markdown journal editor with templates/toolbar** — nice-to-have, but our single
  `notes` textarea + `emotion` dropdown + `tags` already covers the same ground with far less UI.
  Add markdown rendering only if notes actually get long enough that plain text becomes hard to
  scan — not speculative.
- **Everything under TJ's own "Roadmap"** (mobile app, cloud sync, ML predictions, social
  trading, tax reporting) — unimplemented wishlist in the source repo itself, not a real feature
  to compare against.

## Suggested order

1. `setup` column + settings-driven setup list + per-setup breakdown chart (#1) — this alone is
   the "manual backtesting" payoff: proof of which setups work.
2. `ideal_risk_amount` + derived risk-deviation/Expected-R (#2) — pairs naturally with #1 since
   ideal risk is usually set *per setup*.
3. R-distribution histogram + day/session breakdown (#4, #5) — cheap, pure derivations, no schema
   changes beyond #1/#2.
4. Equity curves + balance adjustments (#3) — once the above give something worth curving.
5. Filter bar, bulk edit, export (#6, #7, #8) — quality-of-life once trade volume makes them worth
   it.

Skipped for now: grading (needs #1+#2 first), fee analysis (wrong cost model for equities),
broker-specific importers (screenshot import already covers this), markdown editor (speculative).
