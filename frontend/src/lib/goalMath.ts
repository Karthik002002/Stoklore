// Net worth + money goals arithmetic for /finance. Pure functions, no React, no network.
// Dates are 'YYYY-MM-DD' strings throughout (what Postgres DATE serialises to), compared as
// strings - lexicographic order is date order for that format.
//
// The Focus list is plain arithmetic in a fixed order of priorities, not advice:
//   emergency fund -> high-interest debt -> goals behind schedule -> can the surplus pay for every
//   goal -> short goals held in equity -> allocation drift -> housekeeping.
// Self-check: node src/lib/goalMath.selfcheck.mjs

import { rng } from './tradeMath.ts'
import { percentile } from './tradeSimulation.ts'

export type FinKind =
  | 'bank'
  | 'fd'
  | 'mf'
  | 'stock'
  | 'epf'
  | 'ppf'
  | 'nps'
  | 'gold'
  | 'property'
  | 'cash'
  | 'other'
  | 'loan'
  | 'credit_card'
export type AssetClass = 'equity' | 'debt' | 'gold' | 'cash' | 'real_estate' | 'other'
export type FinItem = {
  id: number
  name: string
  kind: FinKind
  asset_class: AssetClass
  is_liquid: boolean
  interest_pct: number | null
  source: string
  external_key: string | null
  archived: boolean
}
export type FinSnapshot = { id?: number; item_id: number; as_of: string; value: number }
export type GoalCategory = 'emergency' | 'savings' | 'purchase' | 'lifestyle' | 'retirement' | 'other'
export type FinGoal = {
  id: number
  name: string
  category: GoalCategory
  target_amount: number
  target_date: string
  priority: number
  expected_return_pct: number
  monthly_contribution: number
  funding: { item_id: number; pct: number }[]
  notes?: string | null
}
export type FinCashflow = { month: string; income: number; expenses: number }
export type FinSettings = {
  emergency_months: number
  target_equity_pct: number
  target_debt_pct: number
  target_gold_pct: number
}

export const LIABILITY_KINDS: FinKind[] = ['loan', 'credit_card']
export const isLiability = (kind: FinKind) => LIABILITY_KINDS.includes(kind)

/** What a new item of this kind usually is - the form pre-fills these, the user can change them. */
export const KIND_DEFAULTS: Record<FinKind, { label: string; asset_class: AssetClass; is_liquid: boolean }> =
  {
    bank: { label: 'Bank account', asset_class: 'cash', is_liquid: true },
    cash: { label: 'Cash', asset_class: 'cash', is_liquid: true },
    fd: { label: 'Fixed deposit', asset_class: 'debt', is_liquid: true },
    mf: { label: 'Mutual fund', asset_class: 'equity', is_liquid: false },
    stock: { label: 'Stocks', asset_class: 'equity', is_liquid: false },
    epf: { label: 'EPF', asset_class: 'debt', is_liquid: false },
    ppf: { label: 'PPF', asset_class: 'debt', is_liquid: false },
    nps: { label: 'NPS', asset_class: 'equity', is_liquid: false },
    gold: { label: 'Gold / SGB', asset_class: 'gold', is_liquid: false },
    property: { label: 'Property', asset_class: 'real_estate', is_liquid: false },
    other: { label: 'Other asset', asset_class: 'other', is_liquid: false },
    loan: { label: 'Loan', asset_class: 'other', is_liquid: false },
    credit_card: { label: 'Credit card', asset_class: 'other', is_liquid: false },
  }

/** Each item's latest value on or before `asOf` (default: latest overall). Items with no snapshot
 *  yet are absent, not zero - "never recorded" and "worth nothing" read differently in the UI. */
export function latestValues(snapshots: FinSnapshot[], asOf?: string) {
  const best = new Map<number, FinSnapshot>()
  for (const s of snapshots) {
    if (asOf && s.as_of > asOf) continue
    const prev = best.get(s.item_id)
    if (!prev || s.as_of > prev.as_of) best.set(s.item_id, s)
  }
  return best
}

export type NetWorth = {
  assets: number
  liabilities: number
  net: number
  liquid: number
  byClass: Record<AssetClass, number>
}

export function netWorth(items: FinItem[], snapshots: FinSnapshot[], asOf?: string): NetWorth {
  const latest = latestValues(snapshots, asOf)
  const out: NetWorth = {
    assets: 0,
    liabilities: 0,
    net: 0,
    liquid: 0,
    byClass: { equity: 0, debt: 0, gold: 0, cash: 0, real_estate: 0, other: 0 },
  }
  for (const item of items) {
    const v = latest.get(item.id)?.value ?? 0
    if (isLiability(item.kind)) {
      out.liabilities += v
      continue
    }
    out.assets += v
    out.byClass[item.asset_class] += v
    if (item.is_liquid) out.liquid += v
  }
  out.net = out.assets - out.liabilities
  return out
}

/** Net worth on every date anything was recorded, each item carried forward from its last value. */
export function netWorthSeries(items: FinItem[], snapshots: FinSnapshot[]) {
  const dates = [...new Set(snapshots.map((s) => s.as_of))].sort()
  return dates.map((as_of) => ({ as_of, ...netWorth(items, snapshots, as_of) }))
}

/** Whole months from `from` to `to`, floored; negative when `to` is in the past. */
export function monthsBetween(from: string, to: string) {
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0)
}

// Monthly rate equivalent to an annual compounded return - 12% a year is 0.949% a month, not 1%.
const monthlyRate = (annualPct: number) => (1 + annualPct / 100) ** (1 / 12) - 1

/** What `pv` today plus `monthly` at each month-end grows to after `months`. */
export function futureValue(pv: number, monthly: number, annualPct: number, months: number) {
  const n = Math.max(0, months)
  const r = monthlyRate(annualPct)
  if (r === 0) return pv + monthly * n
  const g = (1 + r) ** n
  return pv * g + (monthly * (g - 1)) / r
}

/** The monthly amount that takes `pv` to `target` in `months`. With no months left, it is the whole
 *  gap - a lump sum, not a monthly figure, which goalProgress reports as 'overdue'. */
export function requiredMonthly(target: number, pv: number, annualPct: number, months: number) {
  if (months <= 0) return Math.max(0, target - pv)
  const r = monthlyRate(annualPct)
  const need = target - (r === 0 ? pv : pv * (1 + r) ** months)
  if (need <= 0) return 0
  return r === 0 ? need / months : (need * r) / ((1 + r) ** months - 1)
}

export type GoalStatus = 'done' | 'on-track' | 'at-risk' | 'off-track' | 'overdue'
export type GoalProgress = {
  goal: FinGoal
  funded: number
  pct: number
  months: number
  required: number
  projected: number
  status: GoalStatus
}

/** "At risk" = the current plan reaches at least this share of the target. */
export const AT_RISK_SHARE = 0.9

export function goalProgress(goal: FinGoal, latest: Map<number, FinSnapshot>, today: string): GoalProgress {
  const funded = goal.funding.reduce((sum, f) => sum + ((latest.get(f.item_id)?.value ?? 0) * f.pct) / 100, 0)
  const months = monthsBetween(today, goal.target_date)
  const required = requiredMonthly(goal.target_amount, funded, goal.expected_return_pct, months)
  const projected = futureValue(funded, goal.monthly_contribution, goal.expected_return_pct, months)
  const status: GoalStatus =
    funded >= goal.target_amount
      ? 'done'
      : months <= 0
        ? 'overdue'
        : projected >= goal.target_amount
          ? 'on-track'
          : projected >= goal.target_amount * AT_RISK_SHARE
            ? 'at-risk'
            : 'off-track'
  return { goal, funded, pct: Math.min(1, funded / goal.target_amount), months, required, projected, status }
}

/** Items whose earmarks across all goals add up to more than 100% - the same rupee counted twice. */
export function overAllocated(goals: FinGoal[]) {
  const total = new Map<number, number>()
  for (const g of goals) for (const f of g.funding) total.set(f.item_id, (total.get(f.item_id) ?? 0) + f.pct)
  return [...total].filter(([, pct]) => pct > 100.0001).map(([item_id, pct]) => ({ item_id, pct }))
}

/** Average income/expenses over the last `n` recorded months. */
export function avgCashflow(cashflow: FinCashflow[], n = 6) {
  const rows = [...cashflow].sort((a, b) => a.month.localeCompare(b.month)).slice(-n)
  if (!rows.length) return null
  const income = rows.reduce((s, r) => s + r.income, 0) / rows.length
  const expenses = rows.reduce((s, r) => s + r.expenses, 0) / rows.length
  return {
    months: rows.length,
    income,
    expenses,
    surplus: income - expenses,
    savingsRate: income ? (income - expenses) / income : null,
  }
}

export type Finding = { level: 'act' | 'watch' | 'ok'; title: string; detail: string }

/** Loans at or above this rate are worth prepaying before investing for anything but safety. */
export const HIGH_INTEREST_PCT = 10
/** Goals closer than this are short-horizon: equity can be down 30% the year you need the money. */
export const SHORT_HORIZON_MONTHS = 36
/** Allocation drift worth flagging, in percentage points. */
export const DRIFT_PP = 10
/** Balances older than this are stale enough to say so. */
export const STALE_DAYS = 45

const rs = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

export function focus(input: {
  items: FinItem[]
  snapshots: FinSnapshot[]
  goals: FinGoal[]
  cashflow: FinCashflow[]
  settings: FinSettings
  today: string
}): Finding[] {
  const { items, snapshots, goals, cashflow, settings, today } = input
  const out: Finding[] = []
  if (!snapshots.length) {
    return [
      {
        level: 'act',
        title: 'Record your balances',
        detail: 'Add your accounts and run the first monthly update.',
      },
    ]
  }
  const latest = latestValues(snapshots)
  const nw = netWorth(items, snapshots)
  const flow = avgCashflow(cashflow)
  const byId = new Map(items.map((i) => [i.id, i]))

  // 1. Emergency fund
  if (!flow || flow.expenses <= 0) {
    out.push({
      level: 'watch',
      title: 'Monthly expenses unknown',
      detail: 'Add income and expenses in the monthly update - the emergency fund and goal checks need them.',
    })
  } else {
    const need = flow.expenses * settings.emergency_months
    const months = nw.liquid / flow.expenses
    out.push(
      nw.liquid < need
        ? {
            level: 'act',
            title: 'Build the emergency fund first',
            detail: `Liquid assets cover ${months.toFixed(1)} of ${settings.emergency_months} months of expenses - ${rs(need - nw.liquid)} short.`,
          }
        : {
            level: 'ok',
            title: 'Emergency fund covered',
            detail: `Liquid assets cover ${months.toFixed(1)} months of expenses.`,
          },
    )
  }

  // 2. Expensive debt
  for (const item of items) {
    const v = latest.get(item.id)?.value ?? 0
    if (!isLiability(item.kind) || v <= 0) continue
    if (item.kind === 'credit_card' || (item.interest_pct ?? 0) >= HIGH_INTEREST_PCT) {
      out.push({
        level: 'act',
        title: `Pay down ${item.name}`,
        detail: `${rs(v)} outstanding${item.interest_pct ? ` at ${item.interest_pct}%` : ''} - few investments reliably beat that rate.`,
      })
    }
  }

  // 3. Goals behind schedule, most important first
  const progress = goals.map((g) => goalProgress(g, latest, today))
  const behind = progress
    .filter((p) => p.status === 'overdue' || p.status === 'off-track' || p.status === 'at-risk')
    .sort((a, b) => a.goal.priority - b.goal.priority || a.goal.target_date.localeCompare(b.goal.target_date))
  for (const p of behind) {
    out.push(
      p.status === 'overdue'
        ? {
            level: 'act',
            title: `${p.goal.name} is past its date`,
            detail: `${rs(p.goal.target_amount - p.funded)} still short. Move the date or the target.`,
          }
        : {
            level: p.status === 'off-track' ? 'act' : 'watch',
            title: `${p.goal.name} is ${p.status}`,
            detail: `Needs ${rs(p.required)}/month for ${p.months} months; you plan ${rs(p.goal.monthly_contribution)}. Projected ${rs(p.projected)} of ${rs(p.goal.target_amount)}.`,
          },
    )
  }

  // 4. Can the surplus fund every goal? If not, which lowest-priority goals to push back.
  const active = progress.filter((p) => p.status !== 'done' && p.status !== 'overdue')
  const totalRequired = active.reduce((s, p) => s + p.required, 0)
  if (flow && active.length) {
    if (totalRequired > flow.surplus) {
      let gap = totalRequired - flow.surplus
      const pushBack: string[] = []
      for (const p of [...active].sort(
        (a, b) => b.goal.priority - a.goal.priority || b.goal.target_date.localeCompare(a.goal.target_date),
      )) {
        if (gap <= 0) break
        pushBack.push(p.goal.name)
        gap -= p.required
      }
      out.push({
        level: 'act',
        title: 'Goals need more than you save',
        detail: `All goals need ${rs(totalRequired)}/month; your average surplus is ${rs(flow.surplus)}. Pushing back ${pushBack.join(', ')} would close the gap.`,
      })
    } else {
      out.push({
        level: 'ok',
        title: 'Surplus covers every goal',
        detail: `Goals need ${rs(totalRequired)}/month of your ${rs(flow.surplus)} surplus.`,
      })
    }
  }

  // 5. Short goals held in equity
  for (const p of active) {
    if (p.months >= SHORT_HORIZON_MONTHS) continue
    const equity = p.goal.funding.filter((f) => byId.get(f.item_id)?.asset_class === 'equity')
    if (equity.length) {
      out.push({
        level: 'watch',
        title: `${p.goal.name} is ${p.months} months away but funded from equity`,
        detail: `Consider moving it to FD/debt: ${equity.map((f) => byId.get(f.item_id)?.name).join(', ')}.`,
      })
    }
  }

  // 6. Allocation drift (equity / debt+cash / gold, of those three)
  const eq = nw.byClass.equity
  const debt = nw.byClass.debt + nw.byClass.cash
  const gold = nw.byClass.gold
  const base = eq + debt + gold
  if (base > 0) {
    const drifts = [
      ['Equity', (eq / base) * 100, settings.target_equity_pct],
      ['Debt & cash', (debt / base) * 100, settings.target_debt_pct],
      ['Gold', (gold / base) * 100, settings.target_gold_pct],
    ].filter(([, actual, target]) => Math.abs((actual as number) - (target as number)) >= DRIFT_PP)
    if (drifts.length) {
      out.push({
        level: 'watch',
        title: 'Allocation has drifted',
        detail: drifts
          .map(([name, a, t]) => `${name} ${(a as number).toFixed(0)}% vs ${t}% target`)
          .join(' · '),
      })
    }
  }

  // 7. Housekeeping
  for (const { item_id, pct } of overAllocated(goals)) {
    out.push({
      level: 'watch',
      title: `${byId.get(item_id)?.name ?? 'An item'} is earmarked ${pct.toFixed(0)}%`,
      detail: 'Its goal shares add up to more than 100% - the same money is counted twice.',
    })
  }
  const newest = [...latest.values()].reduce((m, s) => (s.as_of > m ? s.as_of : m), '')
  if (newest && daysBetween(newest, today) > STALE_DAYS) {
    out.push({
      level: 'watch',
      title: 'Balances are out of date',
      detail: `Last update ${newest}. Run the monthly update.`,
    })
  }
  const trading = items
    .filter((i) => i.source === 'trade_account')
    .reduce((s, i) => s + (latest.get(i.id)?.value ?? 0), 0)
  if (trading > 0 && nw.net > 0) {
    out.push({
      level: 'ok',
      title: 'Trading capital',
      detail: `${((trading / nw.net) * 100).toFixed(1)}% of net worth sits in trading accounts.`,
    })
  }
  if (flow?.savingsRate != null) {
    out.push({
      level: 'ok',
      title: 'Savings rate',
      detail: `${(flow.savingsRate * 100).toFixed(0)}% of income over the last ${flow.months} month(s).`,
    })
  }
  return out
}

// --- Savings projection ("if I save this much, what do I end up with") ---------------------------

export type SavingsPlan = {
  start: number
  monthly: number
  /** Raise the monthly amount by this % every 12 months (salary hikes). */
  stepUpPct: number
  /** Expected annual return, %. In the simulation it is the MEDIAN year, not the average. */
  returnPct: number
  years: number
  /** Shown as "in today's money" - the final value deflated at this rate. */
  inflationPct: number
}
export type ProjectionYear = { year: number; invested: number; value: number; real: number }

const deflate = (v: number, inflationPct: number, years: number) => v / (1 + inflationPct / 100) ** years

/** Month by month: grow the balance, then add that month's saving (month-end, like futureValue).
 *  Row 0 is today. */
export function projectSavings(plan: SavingsPlan): ProjectionYear[] {
  const r = monthlyRate(plan.returnPct)
  let value = plan.start
  let invested = plan.start
  let monthly = plan.monthly
  const rows: ProjectionYear[] = [{ year: 0, invested, value, real: value }]
  for (let m = 1; m <= Math.round(plan.years * 12); m++) {
    value = value * (1 + r) + monthly
    invested += monthly
    if (m % 12 === 0) {
      rows.push({ year: m / 12, invested, value, real: deflate(value, plan.inflationPct, m / 12) })
      monthly *= 1 + plan.stepUpPct / 100
    }
  }
  return rows
}

export type SimulationYear = { year: number; p10: number; p25: number; p50: number; p75: number; p90: number }
export type SavingsSimulation = {
  years: SimulationYear[]
  /** Share of runs that end at or above the target (null without a target). */
  successRate: number | null
  /** Share of runs that end below what was put in. */
  lossRate: number
  final: Float64Array
}

/** Monte Carlo: the same plan, but each month's return is random. Monthly log-returns are normal
 *  with the median set to the expected return and `volatilityPct` as the annual standard deviation
 *  (Nifty 50 has run at roughly 15-20%; FD/debt ~1-3%). Seeded, so the same inputs give the same
 *  answer. With 0 volatility every run is the plain projection.
 *  ponytail: independent normal months - no fat tails or crash clustering, so the p10 is kinder
 *  than reality. Upgrade: bootstrap from real Nifty monthly returns. */
export function simulateSavings(
  plan: SavingsPlan,
  {
    volatilityPct,
    runs = 2000,
    target = null,
    seed = 7,
  }: { volatilityPct: number; runs?: number; target?: number | null; seed?: number },
): SavingsSimulation {
  const months = Math.round(plan.years * 12)
  const yearsN = Math.floor(months / 12)
  const sigma = volatilityPct / 100 / Math.sqrt(12)
  const mu = Math.log(1 + plan.returnPct / 100) / 12
  const next = rng(seed)
  const gauss = () => {
    // Box-Muller; 1 - u keeps log away from 0
    const u = 1 - next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next())
  }
  const byYear = Array.from({ length: yearsN + 1 }, () => new Float64Array(runs))
  const final = new Float64Array(runs)
  let invested = plan.start
  for (let run = 0; run < runs; run++) {
    let value = plan.start
    let monthly = plan.monthly
    let put = plan.start
    byYear[0][run] = value
    for (let m = 1; m <= months; m++) {
      value = value * Math.exp(mu + sigma * gauss()) + monthly
      put += monthly
      if (m % 12 === 0) {
        byYear[m / 12][run] = value
        monthly *= 1 + plan.stepUpPct / 100
      }
    }
    final[run] = value
    invested = put
  }
  const years = byYear.map((vals, year) => {
    const sorted = vals.slice().sort()
    const at = (p: number) => percentile(sorted, p) ?? 0
    return { year, p10: at(0.1), p25: at(0.25), p50: at(0.5), p75: at(0.75), p90: at(0.9) }
  })
  let hit = 0
  let lost = 0
  for (const v of final) {
    if (target != null && v >= target) hit++
    if (v < invested) lost++
  }
  return {
    years,
    successRate: target != null && target > 0 ? hit / runs : null,
    lossRate: lost / runs,
    final,
  }
}
