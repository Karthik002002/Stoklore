// Monte Carlo over YOUR OWN trade log, not over asset returns.
//
// The distinction matters. tradeMath.js models a hypothetical trader from three scalars (win rate,
// payoff, risk %); an asset-return simulator samples SPY/AAPL history. This file samples the
// realised P&L of trades you actually took, so every simulated curve is built from sequences that
// already happened to you - the log is the distribution. Nothing here is fitted or assumed.
//
// Self-check: node src/lib/tradeSimulation.selfcheck.mjs

import { mdTable } from './exportFile.ts'
import { rng } from './tradeMath.ts'

// --- pool preparation -------------------------------------------------------------------------

/** Which slice of a trade log to simulate, as 1-based inclusive positions counting from the OLDEST
 *  trade. Blank ends mean "from the start" / "to the end", so the default is the whole log.
 *
 *  This exists because a log is not one strategy. Trades taken while a rule was still being learned
 *  belong to a trader who no longer exists, and mixing them into the pool answers a question nobody
 *  asked: bootstrap draws the old mistakes as often as the current process, so the projection is of
 *  an average of two different traders. Cutting the log at the point the process changed is the
 *  only way to simulate the one being run now.
 *
 *  Returns 0-based slice bounds plus how many trades that actually selects, and an `error` string
 *  for a range the user still has to fix. Ends past the end of the log are CLAMPED rather than
 *  rejected - that is what lets one range apply across accounts of different lengths in the
 *  Multiple tab, where an account simply contributes whatever part of the range it has.
 */
/** How each simulated trade is sized. 'as-logged' replays the rupee amounts; the other two
 *  re-express every trade in R and re-size it. */
export type Sizing =
  | { mode: 'as-logged' }
  | { mode: 'fixed-amount'; amount: number }
  | { mode: 'fixed-pct'; pct: number }

export type SimulationConfig = {
  pnls: number[]
  startBalance?: number
  runs?: number
  length?: number
  model?: 'bootstrap' | 'shuffle'
  slip?: number
  removeTopWins?: boolean
  sizing?: Sizing
  liquidateAt?: number
  keepPaths?: number
  seed?: number
}

/** What `simulate` hands back. Typed structurally rather than restated field by field: the
 *  function is the definition, and duplicating its shape here is how the two drift apart. */
export type SimulationResult = NonNullable<ReturnType<typeof simulate>>

/** One cell of the correlation matrix: the coefficient, and how many shared days it rests on. */
export type CorrelationCell = { r: number | null; overlap: number }

/** One account in the Multiple tab's comparison export. */
export type ComparisonEntry = {
  name: string
  /** An abbreviated name for the correlation matrix's headers, where the full one won't fit. */
  short?: string
  result: SimulationResult
}

/** The UI's own settings object (TradeSimulation.jsx, also what the saved preset holds). Flatter
 *  than SimulationConfig - the page keeps the sizing mode and its two amounts as separate fields
 *  because they are separate inputs - and it is what the exported report describes. */
export type PresetConfig = {
  startBalance: number
  runs: number
  length: number
  model: 'bootstrap' | 'shuffle'
  slip: number
  sizingMode: 'as-logged' | 'fixed-amount' | 'fixed-pct'
  riskAmount?: number
  riskPct?: number
  liquidateAt: number
  removeTopWins?: boolean
  rangeFrom?: number | string | null
  rangeTo?: number | string | null
}

export function tradeRange(
  total: number,
  // Straight off a <input type="number">, so a blank one is '' and a cleared one is null.
  from: number | string | null = null,
  to: number | string | null = null,
) {
  const blank = (v: number | string | null) => v == null || v === ''
  const f = blank(from) ? 1 : Math.floor(Number(from))
  const t = blank(to) ? total : Math.floor(Number(to))
  const fail = (error: string) => ({ start: 0, end: total, count: total, error })

  if (!Number.isFinite(f) || !Number.isFinite(t)) return fail('Range must be whole numbers')
  if (f < 1) return fail('From must be at least 1')
  if (t < f) return fail('To must be greater than or equal to From')
  if (total > 0 && f > total) return fail(`Only ${total} trades in this log`)

  const start = f - 1
  const end = Math.min(t, total)
  return { start, end, count: Math.max(0, end - start), error: null }
}

/** The R denominator: what one "unit of risk" was worth in this log. Average losing trade, because
 *  that is what a manual trader's stop actually cost on average - a mean over all trades would be
 *  dragged around by the winners, which is the wrong scale for sizing. Null when there are no
 *  losses to measure (an all-winners log can't be re-sized, only replayed as logged). */
export function riskUnitOf(pnls: number[]) {
  const losses = pnls.filter((p: number) => p < 0)
  if (!losses.length) return null
  return losses.reduce((s: number, p: number) => s + Math.abs(p), 0) / losses.length
}

/** Descriptive stats of the pool the simulation will draw from - shown before running so the user
 *  can see what "the DNA" actually is. profitFactor is null (not Infinity) when nothing was lost. */
export function poolStats(pnls: number[]) {
  const wins = pnls.filter((p: number) => p > 0)
  const losses = pnls.filter((p: number) => p < 0)
  const gross = wins.reduce((s: number, p: number) => s + p, 0)
  const bled = Math.abs(losses.reduce((s: number, p: number) => s + p, 0))
  return {
    n: pnls.length,
    winRate: pnls.length ? (wins.length / pnls.length) * 100 : null,
    profitFactor: bled ? gross / bled : null,
    avgWin: wins.length ? gross / wins.length : null,
    avgLoss: losses.length ? -bled / losses.length : null,
    largestLoss: losses.length ? Math.min(...losses) : null,
    expectancy: pnls.length ? pnls.reduce((s: number, p: number) => s + p, 0) / pnls.length : null,
  }
}

/** "Black swan erasure": drop the fattest winners and see whether the edge was ever real, or was
 *  three lucky trades carrying two years of mediocrity. Removes the top `fraction` of the WINNING
 *  trades (not of all trades) - 5% of winners is the meaningful cut, 5% of a log that is 70%
 *  losers barely removes anything. */
export function eraseTopWins(pnls: number[], fraction = 0.05) {
  // Cut by position, not by value: two trades that both made exactly ₹5,000 are two trades, and a
  // value filter would delete both when only one belongs in the cut.
  const winners = pnls.map((p: number, i: number) => i).filter((i: number) => pnls[i] > 0)
  const drop = Math.ceil(winners.length * fraction)
  if (drop <= 0) return pnls.slice()
  const cut = new Set(winners.sort((a: number, b: number) => pnls[b] - pnls[a]).slice(0, drop))
  return pnls.filter((_, i: number) => !cut.has(i))
}

// --- percentiles ------------------------------------------------------------------------------

/** Linear-interpolated percentile over an already-sorted ascending array. */
export function percentile(sorted: ArrayLike<number>, p: number) {
  if (!sorted.length) return null
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

export const PERCENTILES = [0.1, 0.25, 0.5, 0.75, 0.9]

const spread = (values: ArrayLike<number>) => {
  const sorted = Float64Array.from(values).sort()
  return PERCENTILES.map((p) => percentile(sorted, p))
}

// --- account-to-account correlation -----------------------------------------------------------
//
// The reason this exists: you backtest a strategy by hand, then run the same strategy on a paper
// account, and the only question that matters is whether the second one is still the first one.
// Two simulations side by side show whether the OUTCOMES rhyme; correlation shows whether the
// TRADES do.
//
// It is computed on realised daily P&L, not on the simulated curves. Correlating two equity curves
// would report ~0.99 for any two profitable strategies on earth - both drift upward, so the
// correlation measures "time passed", not "these move together". Daily P&L is stationary and is
// the series that actually answers the question.

/** [{ date, pnl }] -> Map<isoDate, summed P&L>. Several trades closed on one day are one
 *  observation: two accounts that both traded Tuesday agree or disagree once, not six times. */
export function dailyTotals(entries: { date: string | null; pnl: number | null }[]) {
  const byDay = new Map<string, number>()
  for (const { date, pnl } of entries) {
    if (!date || pnl == null) continue
    const day = String(date).slice(0, 10)
    byDay.set(day, (byDay.get(day) ?? 0) + pnl)
  }
  return byDay
}

export function pearson(xs: number[], ys: number[]) {
  const n = xs.length
  if (n < 3) return null
  const mx = xs.reduce((s: number, v: number) => s + v, 0) / n
  const my = ys.reduce((s: number, v: number) => s + v, 0) / n
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx
    const b = ys[i] - my
    num += a * b
    dx += a * a
    dy += b * b
  }
  // A flat series has no variance to correlate against - undefined, not zero.
  if (dx === 0 || dy === 0) return null
  return num / Math.sqrt(dx * dy)
}

/** Correlation of two accounts over the days they BOTH traded. Days only one of them was active
 *  are dropped rather than filled with zeros: a zero would assert "this account was flat that day",
 *  when the truth is it wasn't trading, and padding with those manufactures correlation out of
 *  nothing but calendar overlap. `overlap` is returned so a 4-day intersection can be labelled as
 *  the non-answer it is. */
export function correlationPair(mapA: Map<string, number>, mapB: Map<string, number>) {
  const xs: number[] = []
  const ys: number[] = []
  for (const [day, v] of mapA) {
    if (mapB.has(day)) {
      xs.push(v)
      ys.push(mapB.get(day) as number)
    }
  }
  return { r: pearson(xs, ys), overlap: xs.length }
}

/** Full n x n matrix. Diagonal is 1 by definition; the rest is symmetric and computed once. */
export function correlationMatrix(maps: Map<string, number>[]) {
  const n = maps.length
  const out = Array.from({ length: n }, () => new Array(n).fill(null))
  for (let i = 0; i < n; i++) {
    out[i][i] = { r: 1, overlap: maps[i].size }
    for (let j = i + 1; j < n; j++) {
      const cell = correlationPair(maps[i], maps[j])
      out[i][j] = cell
      out[j][i] = cell
    }
  }
  return out
}

/** Below this many shared trading days the coefficient is noise wearing a number's clothes, and
 *  the UI greys it out rather than letting it be read as a finding. */
export const MIN_OVERLAP = 10

// --- the simulation ---------------------------------------------------------------------------

export const MODELS = {
  bootstrap: 'Bootstrap (with replacement)',
  shuffle: 'Sequence shuffle (without replacement)',
}

export const SIZING = {
  'as-logged': 'As logged (replay the ₹ amounts)',
  'fixed-amount': 'Fixed ₹ risk per trade',
  'fixed-pct': 'Fixed % of equity per trade',
}

/** Drawdown series (% below running peak, values >= 0) for one balance curve. */
export function drawdownCurve(curve: ArrayLike<number>) {
  let peak = curve[0]
  const out = new Float64Array(curve.length)
  for (let i = 0; i < curve.length; i++) {
    if (curve[i] > peak) peak = curve[i]
    out[i] = peak > 0 ? ((peak - curve[i]) / peak) * 100 : 0
  }
  return out
}

/**
 * Run the whole thing. Synchronous on purpose: 10,000 runs x 100 trades is ~1M iterations, single
 * digit milliseconds - a worker would add lifecycle and message-passing code to hide latency that
 * isn't there.
 *
 * ponytail: every path is retained (runs x (length+1) floats, ~8MB at the 10,000 x 100 maximum) so
 * the reported percentile curves are REAL runs rather than a cross-sectional band. A band stitched
 * from the 10th-percentile balance at each step is not a sequence anyone can trade; "here is the
 * run that finished at the 10th percentile" is. Stream the stats and drop the paths if the limits
 * ever grow past what a tab can hold.
 */
export function simulate({
  pnls,
  startBalance = 100000,
  runs = 1000,
  length = 100,
  model = 'bootstrap',
  slip = 0,
  removeTopWins = false,
  sizing = { mode: 'as-logged' },
  liquidateAt = 0,
  keepPaths = 80,
  seed = 12345,
}: SimulationConfig) {
  const pool = removeTopWins ? eraseTopWins(pnls) : pnls.slice()
  if (!pool.length || runs < 1 || length < 1) return null

  const riskUnit = riskUnitOf(pool)
  // Both re-sizing modes are expressed in R, so they need a risk unit to divide by. Without one
  // (a log with no losing trades) the only honest thing is to replay the amounts as they were.
  const mode = sizing.mode !== 'as-logged' && !riskUnit ? 'as-logged' : sizing.mode
  const rescaled = mode === 'as-logged' || !riskUnit ? null : pool.map((p: number) => p / riskUnit)

  const steps = length + 1
  const curves = new Float64Array(runs * steps)
  const endBalance = new Float64Array(runs)
  const maxDD = new Float64Array(runs)
  const maxLossStreak = new Float64Array(runs)
  const profitFactor = new Float64Array(runs)
  const sharpe = new Float64Array(runs)
  let survived = 0
  let ruin50 = 0
  let ruinFull = 0

  const next = rng(seed)
  // One deck reshuffled per run for the without-replacement model. Reused across runs rather than
  // reallocated - it is the same set of indices every time, only the order changes.
  const deck = Uint32Array.from(pool.keys())

  for (let r = 0; r < runs; r++) {
    const base = r * steps
    let balance = startBalance
    let peak = startBalance
    let dd = 0
    let streak = 0
    let worstStreak = 0
    let won = 0
    let lost = 0
    let retSum = 0
    let retSqSum = 0
    let n = 0
    let hit50 = false
    let blown = false
    let deckPos = deck.length // forces a shuffle on the first draw

    curves[base] = balance

    for (let i = 0; i < length; i++) {
      if (blown) {
        // Account is gone: the curve flatlines at the liquidation level rather than continuing to
        // trade money that no longer exists.
        curves[base + i + 1] = balance
        continue
      }

      let draw
      if (model === 'shuffle') {
        if (deckPos >= deck.length) {
          for (let k = deck.length - 1; k > 0; k--) {
            const j = Math.floor(next() * (k + 1))
            const tmp = deck[k]
            deck[k] = deck[j]
            deck[j] = tmp
          }
          deckPos = 0
        }
        draw = deck[deckPos++]
      } else {
        draw = Math.floor(next() * pool.length)
      }

      let pnl
      if (mode === 'fixed-amount' && rescaled) pnl = rescaled[draw] * (sizing as { amount: number }).amount
      else if (mode === 'fixed-pct' && rescaled)
        pnl = rescaled[draw] * balance * ((sizing as { pct: number }).pct / 100)
      else pnl = pool[draw]

      // Friction last, and unconditionally: a manual trader pays the spread and the hesitation on
      // winners and losers alike, so it shrinks wins and deepens losses rather than scaling with
      // position size.
      pnl -= slip

      const before = balance
      balance += pnl
      if (balance <= liquidateAt) {
        balance = liquidateAt
        blown = true
      }
      curves[base + i + 1] = balance

      if (pnl > 0) {
        won += pnl
        streak = 0
      } else {
        lost += -pnl
        streak += 1
        if (streak > worstStreak) worstStreak = streak
      }

      if (balance > peak) peak = balance
      const under = peak > 0 ? ((peak - balance) / peak) * 100 : 0
      if (under > dd) dd = under
      if (under >= 50) hit50 = true

      if (before > 0) {
        const ret = pnl / before
        retSum += ret
        retSqSum += ret * ret
        n += 1
      }
    }

    endBalance[r] = balance
    maxDD[r] = dd
    maxLossStreak[r] = worstStreak
    profitFactor[r] = lost > 0 ? won / lost : won > 0 ? Infinity : 0
    if (n > 1) {
      const mean = retSum / n
      const variance = Math.max(retSqSum / n - mean * mean, 0)
      sharpe[r] = variance > 0 ? mean / Math.sqrt(variance) : 0
    }
    if (!blown) survived += 1
    if (hit50) ruin50 += 1
    if (blown) ruinFull += 1
  }

  // Rank runs by where they ended, then hand back the actual run sitting at each percentile.
  const order = Array.from({ length: runs }, (_, i) => i).sort((a, b) => endBalance[a] - endBalance[b])
  const runAt = (p: number) => order[Math.min(Math.round((runs - 1) * p), runs - 1)]
  const curveOf = (r: number) => curves.subarray(r * steps, r * steps + steps)

  const bandRuns = { p10: runAt(0.1), p50: runAt(0.5), p90: runAt(0.9) }
  const bands = {
    p10: curveOf(bandRuns.p10),
    p50: curveOf(bandRuns.p50),
    p90: curveOf(bandRuns.p90),
  }

  // Evenly spaced through the ranked order so the faint background spans the full outcome range
  // instead of clustering wherever the RNG happened to land first.
  const sample = []
  // Which run each sampled curve is, and where it ranked - so hovering a line can report that run's
  // own statistics instead of the percentile aggregates.
  const sampleRuns = []
  const samplePct = []
  const stride = Math.max(1, Math.floor(runs / keepPaths))
  for (let i = 0; i < runs && sample.length < keepPaths; i += stride) {
    sample.push(curveOf(order[i]))
    sampleRuns.push(order[i])
    samplePct.push((i / (runs - 1 || 1)) * 100)
  }

  // Infinity is a real outcome (a run that never lost) but it is not a number you can take a
  // percentile of - those runs sort to the top and the reported figure is capped rather than NaN.
  const finitePF = Array.from(profitFactor, (v) => (Number.isFinite(v) ? v : 1e9))

  return {
    pool: poolStats(pool),
    riskUnit,
    sizingApplied: mode,
    steps,
    startBalance,
    bands,
    bandRuns,
    ddBands: {
      p10: drawdownCurve(bands.p10),
      p50: drawdownCurve(bands.p50),
      p90: drawdownCurve(bands.p90),
    },
    sample,
    sampleRuns,
    samplePct,
    table: {
      endBalance: spread(endBalance),
      maxDD: spread(maxDD),
      maxLossStreak: spread(maxLossStreak),
      roi: spread(Array.from(endBalance, (v) => ((v - startBalance) / startBalance) * 100)),
      profitFactor: spread(finitePF),
      sharpe: spread(sharpe),
    },
    survivalRate: (survived / runs) * 100,
    ruin50Pct: (ruin50 / runs) * 100,
    ruinFullPct: (ruinFull / runs) * 100,
    lossStreakHist: histogram(maxLossStreak, runs),
    runs,
    // Raw per-run rows, for the CSV export.
    perRun: { endBalance, maxDD, maxLossStreak, sharpe, profitFactor },
  }
}

/** Distribution of "the worst losing streak this run hit", as a % of runs. Tail streaks beyond the
 *  9th are pooled into a `10+` bucket so one freak run doesn't stretch the chart flat. */
function histogram(streaks: ArrayLike<number>, runs: number) {
  const counts = new Array(11).fill(0)
  for (let i = 0; i < streaks.length; i++) counts[Math.min(streaks[i], 10)] += 1
  return counts
    .map((c, streak) => ({ streak, label: streak === 10 ? '10+' : String(streak), pct: (c / runs) * 100 }))
    .filter((b) => b.streak > 0)
}

// --- exports ----------------------------------------------------------------------------------

const CSV_ROWS: [label: string, key: keyof SimulationResult['table']][] = [
  ['Ending balance', 'endBalance'],
  ['Max drawdown %', 'maxDD'],
  ['Max consecutive losses', 'maxLossStreak'],
  ['ROI %', 'roi'],
  ['Profit factor', 'profitFactor'],
  ['Sharpe (per trade)', 'sharpe'],
]

/** Two sections in one file: the percentile summary, then every run. One file rather than two
 *  downloads - a spreadsheet can split it, a second click can't be un-clicked. */
export function toCsv(result: SimulationResult) {
  const lines = [
    'Percentile summary',
    ['Metric', '10th', '25th', '50th', '75th', '90th'].join(','),
    ...CSV_ROWS.map(([label, key]) => [label, ...result.table[key].map((v) => round(v))].join(',')),
    '',
    'Per run',
    ['Run', 'Ending balance', 'Max drawdown %', 'Max consecutive losses', 'Sharpe', 'Profit factor'].join(
      ',',
    ),
  ]
  const { endBalance, maxDD, maxLossStreak, sharpe, profitFactor } = result.perRun
  for (let i = 0; i < endBalance.length; i++) {
    lines.push(
      [
        i + 1,
        round(endBalance[i]),
        round(maxDD[i]),
        maxLossStreak[i],
        round(sharpe[i]),
        round(profitFactor[i]),
      ].join(','),
    )
  }
  return lines.join('\n')
}

/** The multi-account view's export: every metric at every percentile for every account, plus the
 *  correlation matrix. One file, so the comparison stays a comparison outside the app too. */
export function toComparisonCsv(entries: ComparisonEntry[], matrix: CorrelationCell[][] | null) {
  const lines = [
    'Percentile comparison',
    ['Metric', 'Account', '10th', '25th', '50th', '75th', '90th'].join(','),
  ]
  for (const [label, key] of CSV_ROWS) {
    for (const e of entries) {
      lines.push([label, quote(e.name), ...e.result.table[key].map(round)].join(','))
    }
  }
  lines.push('', 'Risk', ['Account', 'Survival %', 'Ruin 50% DD %', 'Ruin total %'].join(','))
  for (const e of entries) {
    lines.push(
      [
        quote(e.name),
        round(e.result.survivalRate),
        round(e.result.ruin50Pct),
        round(e.result.ruinFullPct),
      ].join(','),
    )
  }
  if (matrix) {
    lines.push(
      '',
      'Daily P&L correlation (shared trading days)',
      ['', ...entries.map((e) => quote(e.name))].join(','),
    )
    matrix.forEach((row, i: number) => {
      lines.push([quote(entries[i].name), ...row.map((c) => (c?.r == null ? '' : round(c.r)))].join(','))
    })
    lines.push('', 'Shared trading days', ['', ...entries.map((e) => quote(e.name))].join(','))
    matrix.forEach((row, i: number) => {
      lines.push([quote(entries[i].name), ...row.map((c) => c?.overlap ?? '')].join(','))
    })
  }
  return lines.join('\n')
}

// --- markdown -----------------------------------------------------------------------------
// The same numbers as the CSV, in the shape you paste into a journal entry or a review note. The
// per-run dump is deliberately absent: 1,000 rows of markdown is a wall, and that is what the CSV
// export is for.

const PCT_COLS = ['10th', '25th', '50th', '75th', '90th']

const configLines = (config: PresetConfig) => [
  `- Starting balance: ${config.startBalance}`,
  `- Runs x length: ${config.runs} x ${config.length} trades`,
  `- Model: ${config.model === 'bootstrap' ? 'bootstrap (with replacement)' : 'shuffle (without replacement)'}`,
  `- Slippage per trade: ${config.slip}`,
  `- Sizing: ${
    config.sizingMode === 'fixed-amount'
      ? `fixed risk of ${config.riskAmount} per trade`
      : config.sizingMode === 'fixed-pct'
        ? `${config.riskPct}% of equity per trade`
        : 'as logged'
  }`,
  `- Liquidation threshold: ${config.liquidateAt}`,
  ...(config.removeTopWins ? ['- Top 5% of wins removed from the pool'] : []),
  // Only when narrowed - an exported report of the whole log shouldn't imply a slice was chosen,
  // but one of trades 50-95 is a different claim and has to say so.
  ...(config.rangeFrom || config.rangeTo
    ? [`- Trade range: ${config.rangeFrom || 'first'} to ${config.rangeTo || 'last'} (oldest logged = 1)`]
    : []),
]

export function toMd(result: SimulationResult, { title, config }: { title: string; config: PresetConfig }) {
  return [
    `# Trade log simulation — ${title}`,
    `Pool: ${result.pool.n} closed trades · win rate ${round(result.pool.winRate)}% · profit factor ${
      result.pool.profitFactor == null ? '∞' : round(result.pool.profitFactor)
    }`,
    '## Configuration',
    configLines(config).join('\n'),
    '## Percentile summary',
    mdTable(
      ['Metric', ...PCT_COLS],
      CSV_ROWS.map(([label, key]) => [label, ...result.table[key].map(round)]),
    ),
    '## Risk & survival',
    mdTable(
      ['Measure', 'Value'],
      [
        ['Survival rate', `${round(result.survivalRate)}%`],
        ['Ruin (50% drawdown)', `${round(result.ruin50Pct)}%`],
        ['Ruin (total)', `${round(result.ruinFullPct)}%`],
      ],
    ),
    '## Consecutive losses',
    mdTable(
      ['Streak', '% of runs'],
      result.lossStreakHist.map((b) => [b.label, round(b.pct)]),
    ),
  ].join('\n\n')
}

export function toComparisonMd(
  entries: ComparisonEntry[],
  matrix: CorrelationCell[][] | null,
  { config }: { config: PresetConfig },
) {
  const parts = [
    `# Trade log simulation — ${entries.length} accounts compared`,
    '## Configuration',
    configLines(config).join('\n'),
    '## Where each account ends up (median run)',
    mdTable(
      ['Account', 'Median end balance', 'Median ROI %', 'Pool trades', 'Pool win rate %'],
      entries.map((e) => [
        e.name,
        round(e.result.table.endBalance[2]),
        round(e.result.table.roi[2]),
        e.result.pool.n,
        round(e.result.pool.winRate),
      ]),
    ),
    '## Risk & survival',
    mdTable(
      ['Account', 'Survival %', 'Ruin (50% DD) %', 'Ruin (total) %'],
      entries.map((e) => [
        e.name,
        round(e.result.survivalRate),
        round(e.result.ruin50Pct),
        round(e.result.ruinFullPct),
      ]),
    ),
  ]

  for (const [label, key] of CSV_ROWS) {
    parts.push(
      `## ${label}`,
      mdTable(
        ['Account', ...PCT_COLS],
        entries.map((e) => [e.name, ...e.result.table[key].map(round)]),
      ),
    )
  }

  if (matrix) {
    parts.push(
      '## Daily P&L correlation',
      `Pearson correlation of realised daily P&L over the days each pair both traded; cells with fewer than ${MIN_OVERLAP} shared days are too thin to read as a finding. Shared days in brackets.`,
      mdTable(
        ['', ...entries.map((e) => e.short ?? e.name)],
        matrix.map((row, i: number) => [
          entries[i].short ?? entries[i].name,
          ...row.map((c) => (c?.r == null ? '—' : `${round(c.r)} (${c.overlap}d)`)),
        ]),
      ),
    )
  }

  return parts.join('\n\n')
}

// Account names are user-typed and routinely contain a comma ("Swing, v2").
const quote = (s: unknown) => `"${String(s).replace(/"/g, '""')}"`

const round = (v: number | null | undefined) => (Number.isFinite(v) ? Math.round((v as number) * 100) / 100 : '')
