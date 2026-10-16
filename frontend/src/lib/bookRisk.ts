// The arithmetic behind the swing book risk page (RiskPage.tsx). Pure, no React:
// `node src/lib/bookRisk.selfcheck.mjs`.
import { pearson } from './tradeSimulation.ts'

/** One open position, from either book (paper or Dhan), reduced to what risk needs. */
export type BookPosition = {
  key: string
  symbol: string
  account: string
  direction: 'long' | 'short'
  quantity: number
  entry: number
  /** Last price; null when no quote came back. */
  price: number | null
  stops: { price: number; qty: number }[]
  sector?: string | null
}

export type PositionRisk = {
  /** What is given back if every stop fills, measured from the current price. Never below 0. */
  atRisk: number
  /** P&L against entry if every stop fills - negative is a loss, positive is profit already locked. */
  stoppedPnl: number
  /** Shares with no stop under them, and their market value. */
  uncoveredQty: number
  unprotectedValue: number
  value: number
}

export function positionRisk(p: BookPosition): PositionRisk {
  const sign = p.direction === 'long' ? 1 : -1
  const mark = p.price ?? p.entry
  let covered = 0
  let atRisk = 0
  let stoppedPnl = 0
  for (const s of p.stops) {
    const qty = Math.min(s.qty, p.quantity - covered)
    if (qty <= 0) break
    covered += qty
    atRisk += Math.max(0, (mark - s.price) * sign * qty)
    stoppedPnl += (s.price - p.entry) * sign * qty
  }
  const uncoveredQty = Math.max(0, p.quantity - covered)
  return { atRisk, stoppedPnl, uncoveredQty, unprotectedValue: uncoveredQty * mark, value: p.quantity * mark }
}

/** Totals per group (an account, a sector): value, risk to stops, what stopping out would book. */
export function groupRisk(positions: BookPosition[], by: (p: BookPosition) => string) {
  const out = new Map<
    string,
    { key: string; positions: number; value: number; atRisk: number; stoppedPnl: number; unprotected: number }
  >()
  for (const p of positions) {
    const r = positionRisk(p)
    const k = by(p)
    const g = out.get(k) ?? { key: k, positions: 0, value: 0, atRisk: 0, stoppedPnl: 0, unprotected: 0 }
    g.positions += 1
    g.value += r.value
    g.atRisk += r.atRisk
    g.stoppedPnl += r.stoppedPnl
    g.unprotected += r.uncoveredQty > 0 ? 1 : 0
    out.set(k, g)
  }
  return [...out.values()].sort((a, b) => b.atRisk - a.atRisk || b.value - a.value)
}

/** Daily % returns keyed by bar time, from ascending closes. */
const returnsByTime = (bars: { time: number | string; close: number }[]) => {
  const out = new Map<string, number>()
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close
    if (prev) out.set(String(bars[i].time), bars[i].close / prev - 1)
  }
  return out
}

/** Pairs of symbols whose daily returns moved together (|r| >= threshold) over the days both
 *  traded - two "different" positions that are really one bet. Fewer than `minDays` shared days
 *  is too little to say, and the pair is left out. Strongest first. */
export function correlatedPairs(
  barsBySymbol: Record<string, { time: number | string; close: number }[]>,
  threshold = 0.7,
  minDays = 20,
) {
  const series = Object.entries(barsBySymbol).map(([s, bars]) => [s, returnsByTime(bars)] as const)
  const pairs: { a: string; b: string; r: number; days: number }[] = []
  for (let i = 0; i < series.length; i++)
    for (let j = i + 1; j < series.length; j++) {
      const [a, ra] = series[i]
      const [b, rb] = series[j]
      const xs: number[] = []
      const ys: number[] = []
      for (const [t, v] of ra) {
        const w = rb.get(t)
        if (w != null) {
          xs.push(v)
          ys.push(w)
        }
      }
      if (xs.length < minDays) continue
      const r = pearson(xs, ys)
      if (r != null && Math.abs(r) >= threshold) pairs.push({ a, b, r, days: xs.length })
    }
  return pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r))
}

/** Whole days from `today` to an ISO date (0 = today, negative = past). */
export const daysUntil = (iso: string, today: Date = new Date()) => {
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - t) / 86_400_000)
}

/** The next results date for each symbol, from today on. */
export function nextResults(calendar: { symbol: string; date: string }[], today: Date = new Date()) {
  const out = new Map<string, string>()
  for (const r of calendar) {
    if (daysUntil(r.date, today) < 0) continue
    const was = out.get(r.symbol)
    if (!was || r.date < was) out.set(r.symbol, r.date)
  }
  return out
}
