// The behaviour half of the journal: WHY a trade went the way it did, as opposed to what it made.
//
// Execution checklist + score, the strategy-vs-behaviour matrix, the pattern readings (profit
// concentration, streak effects), the per-setup scorecard and the before/after comparison the
// Reviews tab runs on a rule change. Everything is derived from stored review fields and raw
// trade numbers - nothing here is persisted.
//
// Pure + dependency-free (relative imports, no '@/' alias) so tradeReview.selfcheck.mjs can run it
// under plain `node`.
import { byLoggedOrder, expectedR, lossExceededStop, riskStatus, tradePnl } from './manualTrades.ts'
import type { ExecutionChecks, Trade } from './types.ts'

/** The execution checklist. `label` is asked after the trade ("did I?"), `pre` on the Bar Replay
 *  order ticket before it ("am I about to?") - same keys, so the two can be compared. */
export const CHECKS = [
  { key: 'entry_rules', label: 'Entry rules followed', pre: 'Entry rules are met' },
  { key: 'position_size', label: 'Position size per plan', pre: 'Size fits my risk plan' },
  { key: 'stop_honored', label: 'Stop honoured', pre: 'Stop is placed' },
  { key: 'exit_rules', label: 'Exit rules followed', pre: 'Exit plan is set' },
  { key: 'no_impulse', label: 'No impulsive decisions', pre: 'Not acting on impulse' },
  { key: 'followed_plan', label: 'Followed the trading plan', pre: 'It is in my trading plan' },
] as const

/** A score at or above this counts as good execution in the matrix. */
export const GOOD_EXECUTION = 7

/** The one mistake label that isn't a mistake - a loss that followed the plan. Excluded wherever
 *  "how often do I make mistakes" is counted. Matches the default in db.DEFAULT_MISTAKES. */
export const NORMAL_LOSS = 'Normal loss'

/** Below this many trades a setup's numbers are flagged as too thin to act on. */
export const MIN_SAMPLE = 20

type Pnl = Pick<Trade, 'direction' | 'quantity' | 'entry_price' | 'exit_price'>

const closed = <T extends Pick<Trade, 'exit_price'>>(trades: T[]) =>
  trades.filter((t) => t.exit_price != null)
const sum = (values: number[]) => values.reduce((s, v) => s + v, 0)
const mean = (values: number[]) => (values.length ? sum(values) / values.length : null)
const round = (v: number | null, dp = 2) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp)
const pnlOf = (t: Pnl) => tradePnl(t) ?? 0

/** 1-10 from the ticked checks: all six → 10, none → 1. Null when the trade was never scored. */
export function scoreFromChecks(checks: ExecutionChecks | null | undefined): number | null {
  if (!checks) return null
  const passed = CHECKS.filter((c) => checks[c.key]).length
  return Math.round(1 + (9 * passed) / CHECKS.length)
}

/** The stored score, falling back to one derived from the checks. */
export const executionScore = (t: Pick<Trade, 'execution_score' | 'execution_checks'>) =>
  t.execution_score ?? scoreFromChecks(t.execution_checks)

/** What the journal can already answer about two of the checks, so the form doesn't ask for them
 *  blind: sizing from the ideal-risk deviation, the stop from whether the loss overran it. Keys
 *  it has no evidence for are left out, not guessed. */
export function prefillChecks(
  t: Parameters<typeof riskStatus>[0] & Parameters<typeof lossExceededStop>[0],
  tolerancePct: number,
): ExecutionChecks {
  const out: ExecutionChecks = {}
  const risk = riskStatus(t, tolerancePct)
  if (risk != null) out.position_size = risk === 'good'
  const overran = lossExceededStop(t)
  if (overran != null) out.stop_honored = !overran
  return out
}

export function executionBucket(t: Pick<Trade, 'execution_score' | 'execution_checks'>) {
  const s = executionScore(t)
  if (s == null) return 'Not scored'
  if (s <= 3) return 'Poor (1–3)'
  if (s < GOOD_EXECUTION) return 'Mixed (4–6)'
  return 'Good (7–10)'
}
export const EXECUTION_ORDER = ['Good (7–10)', 'Mixed (4–6)', 'Poor (1–3)', 'Not scored']

/** A trade's mistake labels, with the two empty states told apart. */
export const mistakeLabels = (t: Pick<Trade, 'mistakes'>) =>
  t.mistakes == null ? ['Not reviewed'] : t.mistakes.length ? t.mistakes : ['No mistakes']

/** Where a trade came from. Replay and paper closes are tagged by the code that writes them. */
export const SOURCES = ['Replay', 'Paper', 'Journal'] as const
export type Source = (typeof SOURCES)[number]
export const sourceOf = (t: Pick<Trade, 'tags'>): Source =>
  t.tags?.includes('replay') ? 'Replay' : t.tags?.includes('paper') ? 'Paper' : 'Journal'

// --- Strategy vs behaviour -----------------------------------------------------------------------

export type Quadrant = 'keep' | 'fixBehavior' | 'reviewStrategy' | 'undiagnosed'

/** The cheat sheet's 2×2. Strategy is judged at SETUP level (its average P&L across every closed
 *  trade of that setup here) - one trade's outcome says almost nothing about a strategy. Execution
 *  is judged per trade, off its score. Trades with no setup or no score can't be placed and are
 *  counted rather than dropped silently. */
export function strategyBehaviorMatrix(trades: Trade[]) {
  const done = closed(trades)
  const bySetup = new Map<string, number[]>()
  done.forEach((t) => {
    if (!t.setup) return
    if (!bySetup.has(t.setup)) bySetup.set(t.setup, [])
    bySetup.get(t.setup)?.push(pnlOf(t))
  })
  const setupGood = new Map([...bySetup].map(([setup, pnls]) => [setup, (mean(pnls) ?? 0) > 0]))

  const cell = () => ({ count: 0, netPnl: 0, setups: new Set<string>() })
  const cells: Record<Quadrant, ReturnType<typeof cell>> = {
    keep: cell(),
    fixBehavior: cell(),
    reviewStrategy: cell(),
    undiagnosed: cell(),
  }
  let noSetup = 0
  let noScore = 0
  done.forEach((t) => {
    if (!t.setup) return void noSetup++
    const score = executionScore(t)
    if (score == null) return void noScore++
    const good = setupGood.get(t.setup)
    const key: Quadrant =
      good && score >= GOOD_EXECUTION
        ? 'keep'
        : good
          ? 'fixBehavior'
          : score >= GOOD_EXECUTION
            ? 'reviewStrategy'
            : 'undiagnosed'
    cells[key].count++
    cells[key].netPnl += pnlOf(t)
    cells[key].setups.add(t.setup)
  })
  return {
    cells: Object.fromEntries(
      Object.entries(cells).map(([k, c]) => [
        k,
        { count: c.count, netPnl: round(c.netPnl) ?? 0, setups: [...c.setups].sort() },
      ]),
    ) as Record<Quadrant, { count: number; netPnl: number; setups: string[] }>,
    noSetup,
    noScore,
  }
}

// --- Patterns ------------------------------------------------------------------------------------

/** How much of the result rests on a handful of trades. `netWithoutTop` is the telling number:
 *  an edge that goes negative without its best five trades is two lucky days, not an edge. */
export function profitConcentration(trades: Pnl[], top = 5) {
  const pnls = closed(trades).map(pnlOf)
  if (!pnls.length) return null
  const winners = pnls.filter((p) => p > 0).sort((a, b) => b - a)
  const topSum = sum(winners.slice(0, top))
  const grossProfit = sum(winners)
  const net = sum(pnls)
  return {
    top: Math.min(top, winners.length),
    topSum: round(topSum) ?? 0,
    grossProfit: round(grossProfit) ?? 0,
    shareOfGross: grossProfit ? round((topSum / grossProfit) * 100, 1) : null,
    net: round(net) ?? 0,
    netWithoutTop: round(net - topSum) ?? 0,
  }
}

/** How you trade right after a run. In LOGGED order (byLoggedOrder), not market order - a replay
 *  session on random dates has market dates in no meaningful sequence, and a run is about what
 *  you just lived through. A flat trade breaks a run in both directions. */
export function streakEffects(trades: (Pnl & Pick<Trade, 'traded_at' | 'created_at'>)[], run = 2) {
  const seq = byLoggedOrder(closed(trades))
  const groups: Record<'afterLosses' | 'afterWins' | 'all', number[]> = {
    afterLosses: [],
    afterWins: [],
    all: [],
  }
  let losses = 0
  let wins = 0
  seq.forEach((t) => {
    const p = pnlOf(t)
    if (losses >= run) groups.afterLosses.push(p)
    if (wins >= run) groups.afterWins.push(p)
    groups.all.push(p)
    losses = p < 0 ? losses + 1 : 0
    wins = p > 0 ? wins + 1 : 0
  })
  const read = (pnls: number[]) => ({
    count: pnls.length,
    winRate: pnls.length ? round((pnls.filter((p) => p > 0).length / pnls.length) * 100, 1) : null,
    avgPnl: round(mean(pnls)),
  })
  return {
    run,
    afterLosses: read(groups.afterLosses),
    afterWins: read(groups.afterWins),
    all: read(groups.all),
  }
}

// --- Setup scorecard -----------------------------------------------------------------------------

/** 95% Wilson interval for a win rate, in %. Unlike the naive p ± 1.96·SE it stays inside 0-100 and
 *  behaves on small samples - which is the whole point of showing it. */
export function wilson(wins: number, n: number, z = 1.96) {
  if (!n) return null
  const p = wins / n
  const denom = 1 + z ** 2 / n
  const centre = (p + z ** 2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z ** 2 / (4 * n ** 2))) / denom
  return {
    low: round(Math.max(0, centre - half) * 100, 1) ?? 0,
    high: round(Math.min(1, centre + half) * 100, 1) ?? 0,
  }
}

function cellStats(group: Trade[]) {
  if (!group.length) return null
  const pnls = group.map(pnlOf)
  const wins = pnls.filter((p) => p > 0).length
  const rs = group.map(expectedR).filter((r): r is number => r != null)
  return {
    count: group.length,
    winRate: round((wins / group.length) * 100, 1) ?? 0,
    ci: wilson(wins, group.length),
    avgPnl: round(mean(pnls)) ?? 0,
    avgR: round(mean(rs)),
    thin: group.length < MIN_SAMPLE,
  }
}

/** One row per setup: how it has done overall, with a confidence interval on the win rate, and the
 *  same split by where the trades came from (replay → paper → journal) - does a practised edge
 *  survive contact with live prices? Sorted by sample size, because the best-sampled setups are
 *  the ones whose numbers mean something. */
export function setupScorecard(trades: Trade[]) {
  const groups = new Map<string, Trade[]>()
  closed(trades).forEach((t) => {
    const key = t.setup || 'Untagged'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)?.push(t)
  })
  return [...groups]
    .map(([setup, group]) => ({
      setup,
      all: cellStats(group),
      bySource: Object.fromEntries(
        SOURCES.map((s) => [s, cellStats(group.filter((t) => sourceOf(t) === s))]),
      ) as Record<Source, ReturnType<typeof cellStats>>,
    }))
    .sort((a, b) => (b.all?.count ?? 0) - (a.all?.count ?? 0))
}

// --- Reviews: a period's numbers, and before/after a rule change --------------------------------

/** The local calendar day a timestamp falls on, as "YYYY-MM-DD" - the same day the Goals tab and
 *  the Logged column would file it under. */
export const localDay = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Days are compared on created_at - when the work was done - like Goals, so a replay session on
 *  2013 bars counts toward the week it was practised in. */
const loggedDay = (t: Pick<Trade, 'created_at' | 'traded_at'>) => localDay(t.created_at ?? t.traded_at)

export function summarize(trades: Trade[]) {
  const done = closed(trades)
  const pnls = done.map(pnlOf)
  const reviewed = done.filter((t) => t.mistakes != null)
  const scores = done.map(executionScore).filter((s): s is number => s != null)
  const rs = done.map(expectedR).filter((r): r is number => r != null)
  return {
    count: done.length,
    winRate: done.length ? round((pnls.filter((p) => p > 0).length / done.length) * 100, 1) : null,
    netPnl: round(sum(pnls)) ?? 0,
    avgPnl: round(mean(pnls)),
    avgR: round(mean(rs)),
    avgScore: round(mean(scores), 1),
    /** Share of REVIEWED trades carrying at least one real mistake ('Normal loss' isn't one). */
    mistakeRate: reviewed.length
      ? round(
          (reviewed.filter((t) => (t.mistakes ?? []).some((m) => m !== NORMAL_LOSS)).length /
            reviewed.length) *
            100,
          1,
        )
      : null,
    reviewed: reviewed.length,
  }
}

/** Trades logged within [start, end], both inclusive, "YYYY-MM-DD". */
export const tradesInPeriod = (trades: Trade[], start: string, end: string) =>
  trades.filter((t) => {
    const d = loggedDay(t)
    return d >= start && d <= end
  })

/** Trades logged before the change against trades from that day on. Bounded by the neighbouring
 *  changes when given: the "after" of one rule change stops where the next change starts, or the
 *  comparison would credit this change with whatever the next one did. */
export function beforeAfter(
  trades: Trade[],
  changeFrom: string,
  prevChange: string | null = null,
  nextChange: string | null = null,
) {
  const before = trades.filter((t) => {
    const d = loggedDay(t)
    return d < changeFrom && (prevChange == null || d >= prevChange)
  })
  const after = trades.filter((t) => {
    const d = loggedDay(t)
    return d >= changeFrom && (nextChange == null || d < nextChange)
  })
  return { before: summarize(before), after: summarize(after) }
}

/** The most frequent real mistakes in a set of trades, most common first - "repeating mistakes". */
export function topMistakes(trades: Trade[], limit = 3) {
  const counts = new Map<string, { count: number; netPnl: number }>()
  closed(trades).forEach((t) =>
    (t.mistakes ?? [])
      .filter((m) => m !== NORMAL_LOSS)
      .forEach((m) => {
        const c = counts.get(m) ?? { count: 0, netPnl: 0 }
        c.count++
        c.netPnl += pnlOf(t)
        counts.set(m, c)
      }),
  )
  return [...counts]
    .map(([mistake, c]) => ({ mistake, count: c.count, netPnl: round(c.netPnl) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.netPnl - b.netPnl)
    .slice(0, limit)
}
