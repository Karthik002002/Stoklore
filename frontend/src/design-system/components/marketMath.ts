// Pure helpers behind the trading components. No React: `node src/design-system/components/marketMath.selfcheck.ts`.

export type Side = 'buy' | 'sell'

export type TicketReading = {
  /** Rupees lost per share if the stop is hit; null when the stop is missing or on the wrong side. */
  riskPerShare: number | null
  /** Shares that risk exactly `riskAmount` (floored); null without a valid stop. */
  qtyForRisk: number | null
  /** Reward ÷ risk; null without both a valid stop and a valid target. */
  rr: number | null
  /** Human-readable problems, worst first. */
  errors: string[]
}

/** Reads a bracket: entry, stop, target, side and how much the trader is willing to lose. */
export function readTicket(
  side: Side,
  entry: number | null,
  stop: number | null,
  target: number | null,
  riskAmount: number | null,
): TicketReading {
  const errors: string[] = []
  const long = side === 'buy'
  if (entry == null || !(entry > 0))
    return { riskPerShare: null, qtyForRisk: null, rr: null, errors: ['Enter a price'] }

  let riskPerShare: number | null = null
  if (stop != null) {
    const r = long ? entry - stop : stop - entry
    if (r > 0) riskPerShare = r
    else errors.push(long ? 'Stop must be below entry for a long' : 'Stop must be above entry for a short')
  }

  let reward: number | null = null
  if (target != null) {
    const w = long ? target - entry : entry - target
    if (w > 0) reward = w
    else
      errors.push(long ? 'Target must be above entry for a long' : 'Target must be below entry for a short')
  }

  const qtyForRisk =
    riskPerShare && riskAmount && riskAmount > 0 ? Math.floor(riskAmount / riskPerShare) : null
  if (qtyForRisk === 0) errors.push('Risk is smaller than one share’s stop distance')
  const rr = riskPerShare && reward ? reward / riskPerShare : null
  return { riskPerShare, qtyForRisk, rr, errors }
}

export type CalendarCell = { date: string; day: number; inMonth: boolean; value: number | null }
export type CalendarWeek = { cells: CalendarCell[]; total: number; traded: number }

const pad = (n: number) => String(n).padStart(2, '0')

/** Monday-first weeks covering `month` ("YYYY-MM"), with each week's total of the values that fall
 *  inside the month. Days outside the month are present (to fill the grid) but never counted. */
export function monthGrid(month: string, values: Record<string, number>): CalendarWeek[] {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const start = new Date(y, m - 1, 1 - ((first.getDay() + 6) % 7))
  const last = new Date(y, m, 0)
  const weeks: CalendarWeek[] = []
  // whole weeks until the last day of the month is in
  for (const d = new Date(start); d <= last || weeks.at(-1)!.cells.length < 7; d.setDate(d.getDate() + 1)) {
    if (!weeks.length || weeks.at(-1)!.cells.length === 7) weeks.push({ cells: [], total: 0, traded: 0 })
    const w = weeks.at(-1)!
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const inMonth = d.getMonth() === m - 1
    const value = inMonth ? (values[date] ?? null) : null
    w.cells.push({ date, day: d.getDate(), inMonth, value })
    if (value != null) {
      w.total += value
      w.traded += 1
    }
  }
  return weeks
}

/** 0-1 intensity for a heat cell: |value| against the largest |value| in the set, square-rooted so
 *  small days still show. */
export function heat(value: number, maxAbs: number): number {
  if (!maxAbs || !value) return 0
  return Math.min(1, Math.sqrt(Math.abs(value) / maxAbs))
}
