# Trade Log Simulation & Stress Testing

[← Back to index](README.md)

`/simulation` — Monte Carlo run over **the trades you actually took**, not
over asset returns. Every other simulator on the market samples SPY/AAPL
history and tells you what a portfolio might do. This one treats your own
realised P&L as the distribution, shuffles it, charges you for hesitating, and
shows you how often that ends badly.

The question it answers is not "is my strategy profitable" — the Backtesting
Statistics tab already answers that from what happened. It's **"was I lucky,
and what happens when I'm not?"** The order your trades arrived in was one
draw from a very large hat. This re-draws it a few thousand times.

The page has two tabs, sharing one configuration:

- **Single** — one account, in depth.
- **Multiple** — n accounts, each simulated separately under identical settings,
  with a Comparison tab and one tab per account. See
  [Comparing accounts](#comparing-accounts-the-multiple-tab).

## Using it (Single)

**1. Pick one account**

The dropdown top-right lists every backtest log *and* every paper account
(`Backtest log · Swing v2`, `Paper account · Momentum`). It lives in the URL
(`?account=3`), so a run is shareable and survives a reload.

There is deliberately **no "all accounts" option**. Two strategies with
different risk profiles have different P&L distributions; a simulation over
their union describes a trader who doesn't exist. To hold several against each
other, use the **Multiple** tab — which still runs each one separately.

**2. Read the Active data profile before you run anything**

Trades · win rate · profit factor · avg win · avg loss · largest loss — the
pool every run is drawn from. Closed trades only; anything still open has no
P&L to resample.

Look at **Trades** first. Below roughly 30 the simulation is honest but the
answer is mostly "we don't know" — resampling 12 trades produces 12 trades'
worth of confidence, dressed up as 1,000 runs. Below 100, treat the
percentile spread as a shape, not a forecast.

**3. Configure**

| Control | What it does |
|---|---|
| **Starting balance** | Prefilled from the account's opening balance when it has one. |
| **Simulations** | 100–10,000 runs. 1,000 is plenty for the shape; 10,000 steadies the last decimal. |
| **Length** | Trades to project forward. **Match log** sets it to your trade count — the honest "what else could my own history have looked like". |
| **Trade range** | Which slice of the log to draw from — see below. Blank ends mean the whole log. |
| **Resampling model** | See below. |
| **Slippage** | See below — this is the one that matters. |
| **Position sizing** | See below. |
| **Liquidation threshold** | Balance at which the account is dead and the curve flatlines. ₹0 by default; set it to your broker's actual minimum if you have one. |

**4. Run simulation.** It's synchronous and takes single-digit milliseconds —
there is no progress bar because there is nothing to wait for.

## Trade range — simulating the trader you are now

A log is not one strategy. Trades taken while a rule was still being learned
belong to a trader who no longer exists, and the pool doesn't know that:
bootstrap draws those early mistakes exactly as often as the current process,
so the projection is of an *average of two different traders*. That average is
nobody, and it is usually pessimistic in a way that hides whether the fix
worked.

The **From** and **To** fields cut the log to the part worth projecting — "50
to 95" after fixing a sizing rule at trade 50. Both are 1-based and inclusive,
blank means "from the first" / "to the last", and **All** clears them.

Positions count from your **oldest logged trade**, not the oldest market date.
That distinction only shows up for [Bar Replay](bar-replay.md) trades: one
taken on 2013 bars but journaled last week sits at the *end* of the range, not
the start, because the range is about your own timeline — the same axis the
trades table sorts on. Only closed trades are numbered, so position 50 is the
50th trade the simulation could actually draw.

Validation is on the field: From below 1, To below From, or a From past the end
of the log blocks the run and says why. Ends past the end of the log are
**clamped**, not rejected — that is what lets one range apply across accounts of
different lengths in the Multiple tab, where a shorter account contributes
whatever part of the range it has. There, the range is applied to each
account's own log ("the last 50 trades of each"), never to a pooled one.

A narrowed range is written into the CSV and Markdown exports, so a report of
trades 50–95 can't be mistaken later for a report of the whole log.

## The two resampling models

**Bootstrap (with replacement)** — each of the N simulated trades is drawn at
random from the whole pool, and the same trade can be drawn twice. Your worst
loss can strike three times in one run; your one enormous winner might never
show up. This is the harsher and more useful model: it asks what your
*distribution* can produce, not just what your *history* did.

**Sequence shuffle (without replacement)** — the exact same trades, in a new
order. Every run uses each trade exactly once, so if the length matches your
log, **every run ends at the identical balance** — that's not a bug, it's the
whole point. It isolates *sequence risk*: same trades, same profit, wildly
different drawdowns and wildly different odds of quitting halfway through.
Use it to answer "would I have survived my own results in a different order?"

If Length exceeds the pool size, the deck is reshuffled and dealt again.

## Slippage — the part to actually spend time on

An automated strategy doesn't hesitate. You do. You wait for one more candle,
you chase the entry by two ticks, you widen the stop because it *feels* like
it's coming back, you fumble the exit on your phone. None of that appears in a
hand-logged backtest, because you logged the fill you meant to get.

The slider charges a flat ₹ amount against **every simulated trade, winners
included** — it shrinks wins and deepens losses alike, because friction
doesn't care which way the trade went. As you drag it, the panel shows the
arithmetic cost live:

> Over 100 trades that is ₹15,000 of drag — 3.2 of your average winning
> trades, gone before the edge is counted.

**This is the eye-opener for anyone moving from paper to funded money**, and
it's why the panel is the loudest thing on the page. A strategy with a 1.4
profit factor on paper and ₹150 of real per-trade friction is frequently a
losing strategy. Work out your genuine number — spread + brokerage + the ticks
you actually give away, not the ones you meant to — and put *that* in the box.
Run it at ₹0 first, then at your real number, and compare the survival rate.

**Erase the top 5% of winners** (the checkbox below the slider) drops your
fattest wins from the pool before sampling. If the edge collapses without
them, the edge was three lucky trades and a lot of noise. A strategy that
survives this is a strategy you can size up.

## Position sizing

- **As logged** — replay the ₹ amounts exactly as they happened. The default,
  and the only mode that involves no assumptions.
- **Fixed ₹ risk per trade** — every trade is rescaled to a common risk.
- **Fixed % of equity** — risk X% of the *current* balance, so wins compound
  and losses shrink the next bet. This is the mode that shows why 5% risk and
  2% risk are different strategies, not the same one at different speeds.

Both rescaling modes need a risk unit to divide by. That unit is your
**average losing trade** — not your average trade, which the winners drag to
the wrong scale. A log with no losing trades has no such unit, so re-sizing
silently falls back to *as logged* and says so in the panel.

## Reading the output

**Survival rate / Probability of ruin** — three cards, deliberately blunt.
Survival is the share of runs that finished above the liquidation threshold.
Ruin (50% DD) is the share that hit a 50% drawdown *at any point*, even if
they recovered — a 50% drawdown needs a 100% gain to undo, and most people
stop trading long before it's undone. Ruin (total) is the share that died.

**Equity curves** — up to 80 faint runs spanning the full outcome range, plus
three bold ones:

| | |
|---|---|
| Dark red | the run that finished at the **10th percentile** |
| Grey | the **median** run |
| Green | the run that finished at the **90th percentile** |

These are **real runs**, not a band stitched from the 10th-percentile balance
at each step. The stitched version — what most tools draw — is a curve nobody
can actually trade. This one is a sequence that could genuinely happen to you.

**Drawdown over time** — peak-to-trough depth of those same three runs, so you
can see *when* the pain arrives, not just how deep it got.

Both charts toggle **Linear / Log**. Log helps when the 90th percentile run is
an order of magnitude above the 10th and the linear view squashes the
interesting half flat. Log can't render ₹0, so blown accounts clamp to ₹1
rather than vanishing.

**Statistics table** — ending balance, max drawdown %, max consecutive losses,
ROI %, profit factor, and per-trade Sharpe, each at the 10th/25th/50th/75th/
90th percentile. Read the **10th column first**. The median is the story you
tell yourself; the 10th percentile is the one you have to survive to get there.

**Consecutive losses** — how deep a losing streak each run ran into. This is a
psychological readout more than a statistical one: if 30% of runs hit seven
losses in a row, you will hit seven losses in a row, and the only question is
whether you'll still be following the plan on the eighth.

## Comparing accounts (the Multiple tab)

The reason this exists: **you backtest a strategy by hand, then run the same
strategy on a paper account, and the only question that matters is whether the
second one is still the first one.** Manual execution drifts — you skip the
setups that feel scary, you take the ones that aren't in the plan, you exit
early on the winners. The Single tab can't see that drift. This one can.

**Selecting** — click account chips to toggle them on and off; two or more
enables the run. The selection lives in the URL (`?accounts=1,4,7`), so a
comparison is shareable.

**One configuration, applied to all of them.** There is no per-account setup,
deliberately: a comparison is only a comparison if every account got the same
starting balance, the same slippage and the same sizing rule. Each account is
still simulated **separately** — their trades are never pooled into one log.

**Comparison tab**

- **Where each account ends up** — median ending balance and ROI per account,
  side by side, with the pool size that produced it.
- **Median equity curves** — every account's 50th-percentile run on one set of
  axes. Diverging lines mean the accounts are not the same strategy, whatever
  the labels say.
- **Worst-case (10th percentile) curves** — the same overlay for the runs that
  finished at the 10th percentile. This is the comparison that should decide
  which strategy gets real money.
- **Daily P&L correlation** — see below.
- **Risk & survival** — survival rate, both ruin probabilities, and the pool's
  own win rate and profit factor, one row per account.
- **Every metric, one table each** — ending balance, max drawdown, max
  consecutive losses, ROI, profit factor and Sharpe, each at the 10th / 25th /
  50th / 75th / 90th percentile, with accounts as rows. So any percentile of
  any metric can be read across accounts without switching tabs.

**Account tabs** — one per selected account, showing exactly what the Single
tab shows: the data profile, risk cards, equity and drawdown charts, the
percentile table, and the consecutive-loss histogram. Identical presentation on
purpose — an account's own numbers shouldn't change shape just because it's
being held up against another one.

### How the correlation is computed, and why that way

It is **Pearson correlation of realised daily P&L, over the days each pair both
traded** — computed on your actual trade history, not on the simulated curves.

Correlating two equity curves would report ~0.99 for any two profitable
strategies on earth, because both drift upward. That number measures *time
passing*, not agreement, and it would look like a strong finding while saying
nothing. Daily P&L is stationary and answers the question you actually asked.

Details that matter for reading it:

- **Several trades closed on one day collapse into one observation.** Two
  accounts that both traded Tuesday agree or disagree once, not six times.
- **Days only one account traded are dropped, not zero-filled.** A zero would
  assert "this account was flat that day" when the truth is it wasn't trading,
  and padding those manufactures correlation out of nothing but calendar
  overlap.
- **Each cell shows the shared-day count under the coefficient.** Below 10
  shared days the cell is greyed out — the number is noise wearing a number's
  clothes.

Reading the value:

| | |
|---|---|
| **≈ +1** | The two accounts win and lose on the same days. For a backtest/paper pair this is the *good* result: your live execution is reproducing the tested strategy. |
| **≈ 0** | Genuinely independent bets. Good for diversification, bad news if the two are supposed to be the same strategy. |
| **≈ −1** | They offset each other. |

**The trap worth naming**: a backtest and its paper account can correlate at
+0.9 and still have completely different profit factors. Correlation says the
*direction* matched; it says nothing about *size*. Read it next to the pool win
rate and average win in the Risk & survival table — same direction, smaller
wins, is the signature of manual execution leaking value, and that is exactly
what the slippage slider is there to quantify.

## Exports

- **Preset** — saves the current configuration to `localStorage`; it loads
  automatically next time you open the page. One slot, not a library.
- **CSV** — in Single, two sections in one file: the percentile summary, then
  every individual run (ending balance, max DD, worst streak, Sharpe, profit
  factor). In Multiple, every metric at every percentile for every account,
  plus the correlation matrix and its shared-day counts. One file either way.
- **Markdown** — **Copy MD** puts the whole report on the clipboard, **Markdown**
  downloads it as a file: the configuration it was run with, the percentile
  table, risk & survival, the losing-streak distribution, and (in Multiple)
  every metric per account plus the correlation matrix with its shared-day
  counts. The per-run dump is deliberately left out — a thousand rows of
  markdown is a wall, and that's what the CSV is for.
- **PDF** — the browser's own print-to-PDF. The nav rail and the config panel
  drop out; the profile, charts, table and risk cards print as rendered.

## How it works

`frontend/src/lib/tradeSimulation.js` is the whole engine — pure functions, no
React, no network. The page fetches nothing of its own: trades come from the
same `getManualTrades()` the Backtesting page uses, and accounts from
`getTradeAccounts('journal')` + `getTradeAccounts('paper')`. **There is no
backend endpoint for this feature**; paper exits are already written into
`manual_trades` (see [Paper Trading](paper-trading.md)), so both kinds of log
are one client-side filter apart.

Randomness comes from the seeded `mulberry32` in
[`tradeMath.js`](../frontend/src/lib/tradeMath.js), reused rather than
reimplemented. A fixed seed means **re-running the same configuration draws
the same picture** — curves that reshuffle on every render read as the numbers
being unstable rather than as a sample.

Every path is retained (runs × (length+1) floats, ~8 MB at the 10,000 × 100
maximum) so the percentile curves can be real runs. 1M iterations is a few
milliseconds, so it runs synchronously on the main thread; a worker would add
lifecycle and message-passing code to hide latency that isn't there. The
charts are `<canvas>` rather than SVG — 80 polylines of 100+ points is 10,000
DOM nodes for React to diff, on a chart with no per-point interaction to
justify them.

Self-check, no framework:

```bash
cd frontend && node src/lib/tradeSimulation.selfcheck.mjs
```

## Where it isn't

This is not [Backtesting → Manual](backtesting-manual.md), which reduces
trades you already took, nor the risk/expectancy models on that page's
Overview tab, which project from three scalars (win rate, payoff, risk %) and
describe a hypothetical trader. This page sits between them: real trades,
projected forward.

## Limits worth knowing

- **Resampling assumes trades are independent.** They aren't, quite — you
  trade differently after three losses, and correlated positions lose
  together. Both effects make real life worse than the simulation, not better,
  so the numbers here are the optimistic case.
- **A small log gives small answers.** 1,000 runs over 15 trades is 1,000
  rearrangements of 15 trades, not 15,000 trades' worth of evidence.
- **Slippage is flat, not proportional.** It doesn't scale with position size.
  For a log with wildly varying position sizes, set it to what you'd pay on a
  typical trade and treat the result as indicative.
- **Per-trade Sharpe, not annualised.** Mean over standard deviation of
  per-trade returns. Comparable between two runs on this page; not comparable
  to a fund's published Sharpe.
- **Correlation needs a real overlap.** Two accounts run in different months
  share no trading days and produce no coefficient at all — that's a blank, not
  a zero. It also can't see intraday timing: two accounts that both made money
  on Tuesday correlate positively even if one entered at the open and the other
  at the close.
- **The percentile columns stop at the 10th and 90th.** Both tabs use the same
  five, so any row can be read across accounts. If you need the true tail, the
  CSV has every individual run.
