// Forward-looking risk/expectancy modelling for the Overview tab's "Risk & expectancy" section.
//
// Everything else in this app (manualTrades.js, tradeStats.js) reduces trades you *already took*.
// This file is the other direction: pure math over a handful of scalars (win rate, payoff ratio,
// risk per trade), used to answer "given how I actually trade, what does that imply". No trade
// objects in here at all - the caller feeds in its own realised numbers, which is what makes
// these curves the user's rather than a textbook's.
//
// Self-check: node src/lib/tradeMath.selfcheck.mjs

/** A point on one of the curves below: trade number, and the balance as a percentage of start. */
type Point = { x: number; value: number }

// Deterministic PRNG (mulberry32). The simulations below must produce the same picture on every
// render - Math.random() would reshuffle the curves on any parent re-render, which reads as the
// numbers being unstable rather than as a sample.
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Expectancy in R: what one average trade returns, in units of the amount risked.
// Positive = the edge is real; 0 = breakeven; negative = the system loses money by design.
export function expectancyR(winRate: number, payoff: number) {
  return winRate * payoff - (1 - winRate)
}

// Win rate at which a given payoff ratio exactly breaks even - the boundary running through the
// expectancy grid below.
export function breakevenWinRate(payoff: number) {
  return 1 / (1 + payoff)
}

export const GRID_WIN_RATES = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
export const GRID_PAYOFFS = [1, 2, 3, 4, 5, 6, 8]

// `1` Expectancy grid: every (win rate x payoff) cell's expectancy in R. Rendered as a heatmap so
// the profitable region and its boundary are visible at a glance rather than as a formula.
export function expectancyGrid(winRates: number[] = GRID_WIN_RATES, payoffs: number[] = GRID_PAYOFFS) {
  return payoffs.map((payoff) => ({
    payoff,
    cells: winRates.map((winRate) => ({
      winRate,
      payoff,
      value: Math.round(expectancyR(winRate, payoff) * 100) / 100,
    })),
  }))
}

// `2` Losing-streak survival: the worst case, run forward. `streakLen` losses back to back, then
// trading on at your own expectancy. Answers "if my longest losing streak happened again right
// now, where would the account be, and how long until it's back above water".
// Fixed-fractional compounding (each trade risks `riskPct` of the *current* balance), so the
// losing phase decays rather than falling linearly.
export function streakSurvival({
  winRate,
  payoff,
  riskPct,
  streakLen,
  trades = 75,
}: {
  winRate: number
  payoff: number
  riskPct: number
  streakLen: number
  trades?: number
}) {
  const risk = riskPct / 100
  const perTrade = expectancyR(winRate, payoff) * risk
  let balance = 1
  const points = [{ x: 0, value: 100 }]
  for (let i = 1; i <= trades; i++) {
    balance *= 1 + (i <= streakLen ? -risk : perTrade)
    points.push({ x: i, value: Math.round(balance * 1000) / 10 })
  }
  const recoveredAt = points.find((p) => p.x > streakLen && p.value >= 100)?.x ?? null
  return {
    points,
    streakLen,
    trough: Math.min(...points.map((p) => p.value)),
    // null = this expectancy never climbs back to breakeven within `trades` (or is negative).
    recoveredAt,
  }
}

// `3` Same trade sequence, different position size. One shared win/loss sequence drawn from the
// seeded PRNG means the three curves differ *only* by risk per trade - which is the whole point,
// and why this isn't three independent samples.
export function riskPaths({
  winRate,
  payoff,
  riskPcts,
  trades = 100,
  seed = 7,
}: {
  winRate: number
  payoff: number
  riskPcts: number[]
  trades?: number
  seed?: number
}) {
  const next = rng(seed)
  const wins = Array.from({ length: trades }, () => next() < winRate)
  return riskPcts.map((riskPct) => {
    const risk = riskPct / 100
    let balance = 1
    const points = [{ x: 0, value: 100 }]
    wins.forEach((won, i) => {
      balance *= 1 + (won ? risk * payoff : -risk)
      points.push({ x: i + 1, value: Math.round(balance * 1000) / 10 })
    })
    return { riskPct, points }
  })
}

// `4` Achievable win rate by target size. Deliberately a lookup table, not a formula: it's an
// empirical rule of thumb (bigger targets are hit less often), and presenting a fitted curve
// would imply a precision that doesn't exist. The UI labels it as such.
export const ACHIEVABLE_WIN_RATE = [
  { payoff: 1, winRate: 70 },
  { payoff: 2, winRate: 60 },
  { payoff: 3, winRate: 50 },
  { payoff: 4, winRate: 42 },
  { payoff: 5, winRate: 35 },
  { payoff: 6, winRate: 28 },
  { payoff: 8, winRate: 15 },
  { payoff: 10, winRate: 10 },
]

// Where the typically-achievable win rate still clears the breakeven line comfortably - big
// enough targets to pay for the losers, small enough to actually get hit.
export const SWEET_SPOT = { from: 3, to: 6 }

// `5` Compounding asymmetry: the same percentage, won or lost repeatedly, does not cancel out.
// (1+g)^n grows without bound while (1-l)^n is floored at -100%, so the down curve flattens as
// the up curve accelerates - the visual argument for why a big drawdown is so expensive.
export function compoundingDivergence({
  gainPct,
  lossPct,
  trades = 100,
}: {
  gainPct: number
  lossPct: number
  trades?: number
}) {
  const g = gainPct / 100
  const l = lossPct / 100
  const gains: Point[] = []
  const losses: Point[] = []
  for (let i = 0; i <= trades; i++) {
    gains.push({ x: i, value: Math.round(((1 + g) ** i - 1) * 1000) / 10 })
    losses.push({ x: i, value: Math.round(((1 - l) ** i - 1) * 1000) / 10 })
  }
  return { gains, losses }
}

// `6` Probability of a `threshold` drawdown, by risk per trade - Monte Carlo, not a formula.
//
// The tempting closed form (probability of a long enough *losing streak*) is not just imprecise
// here, it's wrong by an order of magnitude: real drawdowns come from choppy mixed sequences, not
// from clean runs of losses, so streak math reports a fraction of a percent where the true risk
// is tens of percent. On a chart whose entire job is to show that 5% risk is dangerous, that
// error points the wrong way, so it's simulated instead.
//
// The horizon matters as much as the risk level and is not a detail to bury: a 50% drawdown that
// is unlikely over 200 trades becomes likely over 1,000. 500 is the default because it's roughly
// two years of active trading, and the UI states it on the card rather than leaving it implicit.
//
// ponytail: 2,000 paths, fixed seed - stable and ~10ms, but the last digit wobbles with the seed.
// Raise `paths` if the exact percentage ever matters more than the shape.
export function drawdownProbabilities({
  winRate,
  payoff,
  riskPcts,
  trades = 500,
  threshold = 0.5,
  paths = 2000,
  seed = 11,
}: {
  winRate: number
  payoff: number
  riskPcts: number[]
  trades?: number
  threshold?: number
  paths?: number
  seed?: number
}) {
  return riskPcts.map((riskPct) => {
    const risk = riskPct / 100
    const next = rng(seed)
    let hits = 0
    for (let p = 0; p < paths; p++) {
      let balance = 1
      let peak = 1
      for (let i = 0; i < trades; i++) {
        balance *= 1 + (next() < winRate ? risk * payoff : -risk)
        if (balance > peak) peak = balance
        if (1 - balance / peak >= threshold) {
          hits++
          break
        }
      }
    }
    return { riskPct, probability: Math.round((hits / paths) * 100) }
  })
}
