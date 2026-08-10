# Indicators

Every indicator available in Bar Replay, what it measures, and **exactly how this codebase
computes it** — including the places where the implementation deliberately differs from the
textbook version.

All the math lives in one file, [`frontend/src/lib/indicators.js`](../frontend/src/lib/indicators.js).
It is pure: no React, no chart library, no network. That's what makes it testable in isolation:

```bash
node frontend/src/lib/indicators.selfcheck.mjs
```

---

## How the registry works

`INDICATOR_TYPES` is a plain object. One entry per indicator, and adding a new one is only ever an
entry here — [`ReplayChart.jsx`](../frontend/src/features/bar-replay/ReplayChart.jsx) iterates it
generically.

| Field | Meaning |
|---|---|
| `label` | Shown in the picker and on the chip |
| `compute(bars, period)` | The math. Receives **full bars** (see below) |
| `pane: 'separate'` | Oscillator — gets its own pane under the candles. Omit for a price overlay |
| `range: [min, max]` | Fixes that pane's scale. **Omit for unbounded readings** |
| `levels: [...]` | Horizontal reference lines drawn across the pane |
| `periodless: true` | No configurable lookback, so the period box is hidden |
| `lines: [...]` | Multi-line indicators. `compute` then returns an object keyed by line |
| `lineStyle` | lightweight-charts line style; `2` = dashed |

### The bar shape

`compute` receives the complete bar objects, not a `{time, close}` projection:

```js
{ time, date, open, high, low, close, volume }
```

- `time` — what the chart plots. A `YYYY-MM-DD` string on daily timeframes, IST-shifted unix
  seconds on intraday ones.
- `date` — the IST **calendar day**, present on both paths. This is the session boundary that
  VWAP, the previous-day levels, session volume and the gap metric all key off.

### One pane per oscillator *type*

Oscillators do not share a pane. RSI runs 0–100 while CLV runs −1…+1; on a shared price scale the
small-range one collapses to a flat line at the bottom. Each distinct type therefore gets its own
pane, and its `range` pins that pane's scale. Two RSIs of different periods *do* share a pane —
that's why the grouping is by type rather than by indicator instance.

Types with **no** `range` (MACD, ATR, relative volume, z-score, and the microstructure family) are
left to autoscale. They read in price units or are otherwise unbounded, so no fixed band could fit
both a ₹40 stock and a ₹5000 one.

### Warm-up and the null convention

Internally each indicator builds arrays **the same length as `bars`**, using `null` for the
warm-up window, so index `i` always means bar `i` no matter how many layers deep the calculation
goes (MACD's signal line is an EMA of a difference of EMAs). `points()` drops the nulls exactly
once, at the end, when values are paired with their bar's time.

It also drops any non-finite value. One `NaN` reaching the chart poisons its whole pane's
autoscale, so every division below guards its denominator.

---

## Moving averages

### SMA — `computeSma(bars, period)`

Rolling arithmetic mean of the closes, kept as a running sum (add the entering bar, subtract the
leaving one) rather than re-summing the window each bar.

### EMA — `computeEma(bars, period)`

Seeded with the SMA of the first `period` closes, then

```
EMA[i] = close[i]·k + EMA[i-1]·(1-k)      k = 2/(period+1)
```

### HMA — `computeHma(bars, period)`

Hull moving average, built from three weighted MAs:

```
raw = 2·WMA(close, period/2) − WMA(close, period)
HMA = WMA(raw, √period)
```

The doubled half-length WMA overshoots forward far enough to cancel most of the lag; the `√period`
pass cleans up the noise that overshoot introduces. On a linear ramp rising 1/bar the residual lag
is ≈0.67 versus ≈7.5 for an EMA of the same period — asserted in the self-check.

`wmaArr` weights the newest bar `period` and the oldest `1`, dividing by `period(period+1)/2`.

### KAMA — `computeKama(bars, period)`

Kaufman's adaptive MA. The **efficiency ratio** is the net move over the window divided by the
total distance travelled to get there:

```
ER = |close[i] − close[i-period]| / Σ|close[j] − close[j-1]|
```

≈1 for a clean directional run, ≈0 for chop. That scales the smoothing constant between a fast
EMA (2) and a slow one (30):

```
SC   = (ER·(2/3 − 2/31) + 2/31)²
KAMA = KAMA[i-1] + SC·(close[i] − KAMA[i-1])
```

So it tracks price closely in a trend and goes nearly flat in a range — exactly where a fixed-period
MA whipsaws. Seeded at `close[period-1]`.

---

## Trend

### MACD — `computeMacd(bars)` · 3 lines · own pane

Fixed **12/26/9** — `periodless`, because one period box can't express three.

```
MACD      = EMA(close,12) − EMA(close,26)
Signal    = EMA(MACD, 9)
Histogram = MACD − Signal
```

The signal line necessarily warms up later than the MACD line, being an EMA *of* it.

### ADX — `computeAdx(bars, period)` · 3 lines · own pane · 0–100

Trend **strength**, direction-blind. Directional movement first:

```
up   = high[i] − high[i-1]
down = low[i-1] − low[i]
+DM  = (up > down && up > 0)   ? up   : 0
−DM  = (down > up && down > 0) ? down : 0
```

Only the larger side counts, and only if positive — an inside bar contributes nothing to either.
Each of `+DM`, `−DM` and True Range is then **Wilder-smoothed**:

```
+DI = 100·smoothed(+DM)/smoothed(TR)
−DI = 100·smoothed(−DM)/smoothed(TR)
DX  = 100·|+DI − −DI| / (+DI + −DI)
ADX = Wilder(DX, period)
```

Above ~25 is conventionally trending, below ~20 chop — hence the two reference lines. `+DI`/`−DI`
are plotted alongside because ADX alone cannot tell you which side is winning.

> **Wilder ≠ EMA.** Wilder's smoothing constant is `1/n`, not `2/(n+1)`, so a 14-period Wilder
> average reacts like a 27-period EMA. Conflating the two is the usual reason a hand-rolled ADX
> doesn't match TradingView. `wilderArr` and `emaArr` are separate functions here for that reason.

---

## Momentum

### RSI — `computeRsi(bars, period)` · own pane · 0–100

Standard Wilder RSI: an `n`-bar average of gains and losses to seed, then an exponential roll.
Reference lines come from **Settings** (`store.js`'s `rsiLevels`), not the registry — RSI is the
one indicator whose bands are user-configurable.

### Stochastic — `computeStochastic(bars, period)` · 2 lines · own pane · 0–100

Where the close sits in the whole lookback window's range (not one candle — that's CLV):

```
raw %K = 100·(close − LL) / (HH − LL)
%K     = SMA(raw %K, 3)
%D     = SMA(%K, 3)
```

`HH`/`LL` are the highest high and lowest low of the last `period` bars. A window with no range
(`HH == LL`) returns 50 rather than dividing by zero. Bands at 20/80.

### Williams %R — `computeWilliamsR(bars, period)` · own pane · −100…0

The same reading as stochastic `%K`, inverted and shifted:

```
%R = −100·(HH − close) / (HH − LL)
```

0 = closing at the top of the range, −100 at the bottom. Kept as its own indicator because the
−80/−20 bands are what it's actually read against.

### CMO — `computeCmo(bars, period)` · own pane · −100…+100

Chande momentum oscillator. Same up/down sums as RSI, but **differenced over their total** rather
than ratioed, and with **no** smoothing:

```
CMO = 100·(ΣUp − ΣDown) / (ΣUp + ΣDown)
```

That makes it react a bar or two sooner than RSI at the cost of a noisier line. Note the neutral
point is **0**, not 50. An unbroken uptrend pins it at +100.

---

## Volatility

### ATR — `computeAtr(bars, period)` · own pane · autoscaled

Wilder average of True Range, where

```
TR = max(high−low, |high−prevClose|, |low−prevClose|)
```

Bar 0 has no previous close, so it falls back to its own range. Deliberately **not**
range-bounded: ATR is in price units, and what a stop distance should be sized against.

### Bollinger — `computeBollinger(bars, period, mult=2)` · 3 lines · price pane

```
middle = SMA(close, period)
σ      = population stdev of close over the window
upper  = middle + mult·σ
lower  = middle − mult·σ
```

Population σ (divide by `n`, not `n−1`): the window *is* the thing being described, not a sample
drawn from something larger, and it matches what charting packages plot.

### Keltner — `computeKeltner(bars, period, mult=2)` · 3 lines · price pane

Same idea, driven by true range instead of standard deviation:

```
middle = EMA(close, period)
upper  = middle + mult·ATR(period)
lower  = middle − mult·ATR(period)
```

Because ATR includes gaps and Bollinger's close-only σ does not, Keltner widens on gap days where
Bollinger doesn't notice.

### Donchian — `computeDonchian(bars, period)` · 3 lines · price pane

No averaging at all — the literal extremes of the last `period` bars:

```
upper  = highest high
lower  = lowest low
middle = (upper + lower)/2
```

Which is what makes it the honest one to trade against: the upper band *is* the breakout level.

### Rolling volatility — `computeRollingVolatility(bars, period)` · own pane

Standard deviation of bar-to-bar fractional returns, as a percentage. Variance is simply this
squared; σ is plotted rather than σ² because σ is in the same units as the returns themselves,
which makes it directly comparable to a stop distance.

---

## Volume

### VWAP — `computeVwap(bars)` · price pane · `periodless`

Volume-weighted average price, **re-anchored at each session open** (grouped by `bar.date`):

```
VWAP = Σ(typical·volume) / Σ(volume)      typical = (high+low+close)/3
```

A rolling VWAP would be meaningless — the whole point is "the average price paid *today*", which
is why institutional fills get measured against it. Bars with zero cumulative volume emit no
point rather than dividing by zero.

> On a **daily** timeframe every bar is its own session, so this degenerates to the bar's typical
> price. Correct, but not useful: VWAP is an intraday tool.

### MFI — `computeMfi(bars, period)` · own pane · 0–100

Volume-weighted RSI. Raw money flow is `typical · volume`, classified by whether the typical price
rose or fell versus the previous bar (unchanged contributes to neither):

```
MFI = 100 − 100/(1 + ΣpositiveFlow/ΣnegativeFlow)
```

Same 0–100 scale and 20/80 convention as RSI. A push higher on thin volume scores lower than the
same push on heavy volume.

### Relative volume — `computeRelativeVolume(bars, period)` · own pane

```
relVolume = volume / SMA(volume, period)
```

1 is a normal bar, 3 traded three times its usual size. Raw volume can't be compared across
symbols or across months of the same symbol; a multiple can — which is what makes a spike a spike.

### Session volume — `computeSessionVolume(bars)` · own pane · `periodless`

Volume accumulated so far within the current session, reset at each new `date`. Read across days
it shows whether today is running hot or thin versus the same point yesterday.

> **Not** the Asia/London/New York split this idea usually comes with. NSE trades one 09:15–15:30
> session, so those three windows would be one bucket and two empty ones. Grouping by trading day
> is the version of "which session controls the volume" that means anything on this instrument.

---

## Market microstructure (approximations)

Real order flow needs tick data carrying the aggressor side on every print. **None of that
survives into an OHLCV bar.** Everything in this section *infers* pressure from the candle's
shape. Treat it as a proxy — a bar that closed up on heavy volume probably saw more buying, but
"probably" is doing real work in that sentence.

### Volume delta (pseudo) — `computeVolumeDelta(bars)` · own pane · `periodless`

```
delta = sign(close − open) · volume
```

The bar's whole volume counted as buying if it closed above its open, selling if below, zero if
unchanged. The crudest possible split — a real delta allocates each trade to bid or ask — but it
does separate heavy up-bars from heavy down-bars, which raw volume cannot.

### Velocity / acceleration — `computeVelocity(bars, period)` · 2 lines · own pane

```
velocity     = close[i] − close[i−period]
acceleration = velocity[i] − velocity[i−period]
```

A move that is still *accelerating* is being pushed by someone who wants filled now — the "speed
strike" signature. On a perfectly linear ramp velocity is constant and acceleration is exactly
zero, which is what the self-check asserts.

### Volume-weighted spread — `computeVolumeWeightedSpread(bars)` · own pane · `periodless`

```
vwSpread = (high − low) / volume
```

Range per unit of volume: how far price had to travel to absorb each share. Spikes mark thin,
slippery conditions (big range on little volume); troughs mark heavy two-way trade going nowhere.
The scale is symbol-specific — read it against its own history, not an absolute number.

### Volume climax — `computeVolumeClimax(bars, period)` · own pane

Z-score of volume against its own rolling mean:

```
climax = (volume − mean(volume, period)) / σ(volume, period)
```

2+ is a genuine climax; sustained 3+ usually marks exhaustion rather than the start of something.
A z-score rather than a fixed multiple, so it adapts to how noisy that symbol's volume normally is.

---

## Statistical

### Rolling correlation — `computeRollingCorrelation(bars, period)` · own pane · −1…+1

Pearson correlation of **close against volume** over the window. Positive means moves come with
participation (a trend being funded); near zero or negative means price is drifting on nothing,
which is where reversals live. A constant window (zero variance) returns 0 rather than `NaN`.

### Z-score of close — `computeZScore(bars, period)` · own pane

```
z = (close − mean(close, period)) / σ(close, period)
```

The mean-reversion workhorse. ±2 is the classic stretched reading — and is *exactly* where a
Bollinger band sits, since both are built from the same rolling σ.

### Autocorrelation — `computeAutocorrelation(bars, period)` · own pane · −1…+1

Lag-1 autocorrelation of returns: Pearson of the window's returns against the same window shifted
back one bar. Does an up bar tend to be followed by another up bar?

- **Positive** — momentum regime; trend-following should work.
- **Negative** — mean-reverting regime; fade the move.
- **Near zero** — a random walk, where neither edge exists.

This is a **regime filter, not a signal**. Needs `period` return *pairs*, and returns themselves
start at index 1, so it warms up two bars later than a same-period indicator on raw price.

---

## Price action & structure

### Market structure — `computeMarketStructure(bars, period)` · own pane · −1…+1

Structure as a **state**, not an event:

- `+1` once a close exceeds the highest high of the prior `period` bars (break up)
- `−1` once a close falls below the lowest low (break down)
- and it **holds** that reading until the opposite break happens

The hold is the point — structure is "where we are", and a bar that breaks nothing leaves the
regime unchanged rather than resetting it to neutral.

The window ends at bar `i−1`, so the break is measured against bars that had **already closed** —
never against this bar's own high, which would make every new extreme trivially "a break".

> **Why not literal HH/HL/LH/LL swing labelling?** Confirming a swing pivot requires looking
> *forward* past it, which repaints. That's unusable in a replay, where the entire discipline is
> only seeing what you would have seen at the time.

### Previous-day levels — `computePrevDayLevel(bars, field)` · price pane · `periodless`

Four separate entries: `Prev day high / low / open / close`. Each carries the completed previous
session's level forward as a flat dashed line across every bar of the current day.

Grouped by `bar.date`, **not** by "the bar before this one" — on a 15m chart the previous day is
~25 bars back, on a daily chart exactly one, and grouping handles both with no special case. The
first day has nothing before it, so it emits no points rather than a fabricated line.

### Gap % — `computeGapPercent(bars)` · own pane · `periodless`

```
gap = 100·(sessionOpen − previousSessionClose) / previousSessionClose
```

Held flat across the day, so on an intraday chart every bar shows the gap the day started with.

### Inside / outside bars — `computeInsideOutside(bars)` · own pane · −1…+1 · `periodless`

- `+1` **outside** — `high > prevHigh && low < prevLow`. Expansion; both sides taken out.
- `−1` **inside** — `high ≤ prevHigh && low ≥ prevLow`. Compression; often coiling before a move.
- `0` neither.

---

## Candle shape

Three single-bar readings — no lookback, no period. Each is normalised by that bar's **own** range
and lands in a fixed band. A four-price doji (`high == low`) has no range to divide by; all three
return **0 rather than NaN**, because a NaN would break the pane's autoscale.

### CLV — `computeClv(bars)` · own pane · −1…+1

```
CLV = ((close − low) − (high − close)) / (high − low)
```

+1 closed on the high (buyers held it there), −1 on the low, 0 dead centre.

### Body / range — `computeBodyRatio(bars)` · own pane · 0…1

```
ratio = |close − open| / (high − low)
```

Near 1 is a decisive candle that opened one end and closed the other; near 0 is a long-wicked
candle that went somewhere and got rejected. **Unsigned** — a red bar reads the same as a green
one of the same shape.

### Wick asymmetry — `computeWickAsymmetry(bars)` · own pane · −1…+1

```
upper = high − max(open, close)
lower = min(open, close) − low
asym  = (upper − lower) / (high − low)
```

+1 is all upper wick (supply rejecting price from above), −1 all lower wick (demand absorbing it
from below). Body + both wicks always sum to the range, so this can never leave [−1, 1] — an
invariant the self-check asserts directly.

---

## What the self-check covers

[`indicators.selfcheck.mjs`](../frontend/src/lib/indicators.selfcheck.mjs) is plain asserts, no
framework. It targets the things that are easy to get subtly wrong rather than restating each
formula:

- **Degenerate bars** — the four-price doji, zero-volume bars, constant windows. Every one must
  produce a finite number or no point at all.
- **Sign conventions** — closing on the high is `+1`, an all-upper-wick bar is `+1`, a short's
  reading mirrors a long's.
- **Identities** — MACD's histogram equals line − signal on *every* bar; band ordering
  (`upper ≥ basis ≥ lower`) holds for all three families on every bar; ATR converges to exactly 4
  on a series of 4-wide gapless bars; Donchian's bands are the literal window extremes.
- **Regime behaviour** — `+DI`/`−DI` swap leadership when a synthetic series reverses; alternating
  returns autocorrelate negatively; HMA lags less than an EMA of the same period.
- **Session boundaries** — VWAP and session volume reset per day; gap is measured close-to-open
  and held; previous-day levels stay flat within a day.
- **Registry contracts** — every multi-line type returns exactly the keys it advertises (otherwise
  the chart creates series that silently never receive data), every declared range is ordered, and
  no indicator emits a non-finite value.
