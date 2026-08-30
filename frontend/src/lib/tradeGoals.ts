// Trading goals: targets ("greater than") and limits ("less than") scored per period against the
// manual-trade journal.
//
// A goal is {id, metric, operator: 'gt'|'lt', target, period: 'daily'|'weekly'|'monthly',
// mode: 'continuous'|'binary'}. Nothing about achievement is persisted - every score here is
// recomputed from the trades, so editing a goal or a trade can never leave a stale score behind.
//
// Pure + dependency-free (relative imports, no '@/' alias) so tradeGoals.selfcheck.mjs runs it
// under plain `node`.
import { actualRiskAmount, lossExceededStop, tradePnl, underwaterSeries } from './manualTrades.ts'
import { METRICS } from './tradeStats.ts'
import type { Metric } from './tradeStats.ts'
import type { Trade } from './types.ts'

/** A goal as stored: a metric, a direction, a target, and how strictly it is scored. */
export type Goal = {
  id: number
  metric: string
  operator: 'gt' | 'lt'
  target: number
  period: 'daily' | 'weekly' | 'monthly'
  mode: 'continuous' | 'binary'
  label?: string | null
}

// Nulls sum as zero, exactly as this reduce already did.
const sum = (values: (number | null)[]) => values.reduce((s: number, v) => s + (v ?? 0), 0)
const round = (v: number | null, dp = 2) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp)
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

// Every metric a goal can track: the Statistics tab's aggregates (so a goal can never disagree
// with the chart of the same name) plus the count-and-limit style ones goals specifically need.
export const GOAL_METRICS: Record<string, Metric> = {
  ...METRICS,
  wins: { label: 'Winning trades', format: 'num', of: (g) => g.filter((t) => (tradePnl(t) ?? 0) > 0).length },
  losses: { label: 'Losing trades', format: 'num', of: (g) => g.filter((t) => (tradePnl(t) ?? 0) < 0).length },
  grossLoss: {
    label: 'Gross loss',
    format: 'inr',
    of: (g) => round(Math.abs(sum(g.map(tradePnl).filter((p) => (p ?? 0) < 0)))),
  },
  maxDrawdown: {
    label: 'Max drawdown',
    format: 'inr',
    of: (g) => {
      let running = 0
      return underwaterSeries(g.map((t) => (running += tradePnl(t) ?? 0))).maxDrawdown
    },
  },
  // TradesViz scores its risk goals off MAE, which needs intra-trade prices this journal doesn't
  // store - planned risk (entry to stop) is the equivalent it can compute honestly.
  maxRisk: {
    label: 'Largest risk taken',
    format: 'inr',
    of: (g) => {
      const risks = g.map(actualRiskAmount).filter((r) => r != null)
      return risks.length ? Math.max(...risks) : null
    },
  },
  stopViolations: {
    label: 'Stop violations',
    format: 'num',
    of: (g) => g.filter((t) => lossExceededStop(t)).length,
  },
}

export const PERIODS = {
  daily: { label: 'Daily' },
  weekly: { label: 'Weekly' },
  monthly: { label: 'Monthly' },
}

export const OPERATORS = {
  gt: { label: 'at least', symbol: '≥' },
  lt: { label: 'at most', symbol: '≤' },
}

export const MODES = {
  continuous: { label: 'Partial credit' },
  binary: { label: 'All or nothing' },
}

// Monday-start week, matching how the rest of the app orders weekdays.
function weekStart(date: Date | string) {
  const d = new Date(date)
  const offset = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - offset)
  return d
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function periodKey(tradedAt: string | Date, period: string) {
  const d = new Date(tradedAt)
  if (period === 'daily') return iso(d)
  if (period === 'weekly') return iso(weekStart(d))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function periodLabel(key: string, period: string) {
  if (period === 'weekly') return `Week of ${key}`
  if (period === 'monthly') {
    const [y, m] = key.split('-').map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }
  return key
}

export const currentPeriodKey = (period: string) => periodKey(new Date(), period)

/** Which day a trade counts toward for goal-tracking: when it was JOURNALED, not the market date
 *  it was taken on. A goal ("close 5 trades this week", "keep the week green") measures the work
 *  you actually did that week, and a Bar Replay session practised on 2013 bars is work done today
 *  - scoring it by traded_at would file today's practice under 2013 and leave this week empty.
 *  Falls back to traded_at for rows written before created_at was read here. */
export const goalDate = (t: Pick<Trade, 'created_at' | 'traded_at'>) => t.created_at ?? t.traded_at

// Achievement as a 0-100% score.
//   binary      - the condition is met or it isn't.
//   gt (target) - how much of the target you reached, capped at 100.
//   lt (limit)  - 100% while at or under the limit, then decaying by how far past it you went.
// Never returns a negative or >100 value, so the row average below stays a readable percentage.
export function achievement(goal: Goal, actual: number | null) {
  if (actual == null) return null
  const met = goal.operator === 'gt' ? actual >= goal.target : actual <= goal.target
  if (goal.mode === 'binary') return met ? 100 : 0
  if (goal.operator === 'gt') {
    // A non-positive target has no meaningful ratio ("make at least ₹0") - score it pass/fail.
    if (goal.target <= 0) return met ? 100 : 0
    return round(clamp((actual / goal.target) * 100, 0, 100), 1)
  }
  if (met) return 100
  // Past a limit of zero there's no ratio to decay - any breach is a total miss.
  if (goal.target <= 0) return 0
  return round(clamp((goal.target / actual) * 100, 0, 100), 1)
}

export function goalLabel(goal: Goal) {
  const metric = GOAL_METRICS[goal.metric]
  return goal.label || `${metric?.label ?? goal.metric} ${OPERATORS[goal.operator].symbol} ${goal.target}`
}

function scoreCell(goal: Goal, trades: Trade[]) {
  const metric = GOAL_METRICS[goal.metric]
  // A goal pointing at a metric this build doesn't know (an older saved goal, say) scores as
  // unrated rather than throwing the whole table away.
  if (!metric || trades.length === 0) return { goalId: goal.id, actual: null, pct: null, met: null }
  const actual = metric.of(trades)
  const pct = achievement(goal, actual)
  return {
    goalId: goal.id,
    actual,
    pct,
    met: actual == null ? null : goal.operator === 'gt' ? actual >= goal.target : actual <= goal.target,
  }
}

// One row per period that has trades, newest first, plus a `total` per row (the average of that
// row's goal percentages - TradesViz's pinned right-hand column).
export function evaluateGoals(trades: Trade[] | null | undefined, goals: Goal[], period: string) {
  const active = goals.filter((g) => g.period === period)
  const closed = (trades ?? []).filter((t) => t.exit_price != null)
  const buckets = new Map<string, Trade[]>()
  closed.forEach((t) => {
    const key = periodKey(goalDate(t), period)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)?.push(t)
  })

  const rows = [...buckets.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, group]) => {
      const cells = active.map((goal) => scoreCell(goal, group))
      const scored = cells.map((c) => c.pct).filter((p) => p != null)
      return {
        key,
        label: periodLabel(key, period),
        trades: group.length,
        cells,
        total: scored.length ? round(sum(scored) / scored.length, 1) : null,
      }
    })

  return { goals: active, rows }
}

// The current day/week/month only - what the Overview strip shows. Periods with no trades yet
// still come back with the goals listed and a null score, so an untouched day reads as "not
// started" rather than silently disappearing.
export function currentPeriodProgress(trades: Trade[] | null | undefined, goals: Goal[], period: string) {
  const key = currentPeriodKey(period)
  const active = goals.filter((g) => g.period === period)
  const group = (trades ?? []).filter((t) => t.exit_price != null && periodKey(goalDate(t), period) === key)
  const cells = active.map((goal) => ({ goal, ...scoreCell(goal, group) }))
  const scored = cells.map((c) => c.pct).filter((p) => p != null)
  return {
    key,
    label: periodLabel(key, period),
    trades: group.length,
    cells,
    total: scored.length ? round(sum(scored) / scored.length, 1) : null,
  }
}
