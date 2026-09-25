// Pure helpers for the /engine page: sweep input parsing, the sweep grid, drawdown. No React.

/** One param field of the run form: "9", "5,9,13", or "5:20:5" (from:to:step, inclusive), mixed
 *  freely. Deduped, in the order given. null when any piece isn't a number, [] when empty. */
export function parseValues(text: string): number[] | null {
  const out: number[] = []
  for (const piece of text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const parts = piece.split(':').map(Number)
    if (parts.some((n) => !Number.isFinite(n))) return null
    if (parts.length === 1) out.push(parts[0])
    else if (parts.length === 3 && parts[2] > 0 && parts[1] >= parts[0]) {
      // stepping by index, not by repeated addition, so 0.1-steps don't drift past `to`
      for (let i = 0; parts[0] + i * parts[2] <= parts[1] + 1e-9; i++)
        out.push(+(parts[0] + i * parts[2]).toFixed(10))
    } else return null
  }
  return [...new Set(out)]
}

export const comboCount = (lists: number[][]) => lists.reduce((n, l) => n * Math.max(l.length, 1), 1)

/** Runs of a sweep bucketed by two param values (col is optional for a one-param sweep).
 *  With more than two varied params a cell holds several runs; the page shows the best. */
export function sweepGrid<R extends { params: Record<string, number> }>(
  runs: R[],
  rowKey: string,
  colKey?: string,
) {
  const values = (k?: string) => (k ? [...new Set(runs.map((r) => r.params[k]))].sort((a, b) => a - b) : [0])
  const cells = new Map<string, R[]>()
  for (const r of runs) {
    const key = `${r.params[rowKey]}|${colKey ? r.params[colKey] : 0}`
    cells.set(key, [...(cells.get(key) ?? []), r])
  }
  return {
    rows: values(rowKey),
    cols: values(colKey),
    cell: (row: number, col: number) => cells.get(`${row}|${col}`) ?? [],
  }
}

/** Drawdown from the running peak at each point (<= 0), from an equity curve. */
export function drawdown(equity: [number, number][]): [number, number][] {
  let peak = 0
  return equity.map(([t, e]) => ((peak = Math.max(peak, e)), [t, e - peak]))
}

/** Engine times are IST-shifted epoch seconds, so the UTC reading of them is the IST wall clock. */
export const istTime = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ')

// --- executions on the candle chart ---------------------------------------------------------------
// A run's trades, as lightweight-charts markers. Kept here (pure) rather than inside the chart
// effect so the arithmetic that decides where an arrow lands is checkable without a DOM.

/** [symbol, entry time, exit time, signed qty, entry px, exit px, gross pnl] - api.ts EngineTrade. */
export type RunTrade = [string, number, number, number, number, number, number]

export type TradeMarker = {
  time: number
  position: 'aboveBar' | 'belowBar'
  shape: 'arrowUp' | 'arrowDown'
  color: string
  text: string
}

/** A long entry points up from under the bar, a short entry down from above it; each exit is the
 *  mirror of its entry and takes the trade's colour - green if that trade made money, red if not.
 *  So an arrow's direction says what was done, and an exit's colour says how it went. */
export function tradeMarkers(
  trades: RunTrade[],
  symbol: string,
  colors: { up: string; down: string },
  limit = 300,
): TradeMarker[] {
  // The most recent `limit` trades: markers are drawn for every bar in the series, and thousands of
  // them cost more than they inform. The caller says how many were left out.
  const mine = trades.filter((t) => t[0] === symbol).slice(-limit)
  const markers: TradeMarker[] = []
  for (const [, entry, exit, qty, , , pnl] of mine) {
    const long = qty > 0
    const won = pnl >= 0
    markers.push({
      time: entry,
      position: long ? 'belowBar' : 'aboveBar',
      shape: long ? 'arrowUp' : 'arrowDown',
      color: long ? colors.up : colors.down,
      text: `${long ? 'B' : 'S'} ${Math.abs(qty)}`,
    })
    markers.push({
      time: exit,
      position: long ? 'aboveBar' : 'belowBar',
      shape: long ? 'arrowDown' : 'arrowUp',
      color: won ? colors.up : colors.down,
      text: `${pnl >= 0 ? '+' : ''}${Math.round(pnl)}`,
    })
  }
  // Same bar can hold an exit and the next entry; the chart wants them in time order.
  return markers.sort((a, b) => a.time - b.time)
}

/** Where to look when the chart opens: the marked trades, plus a margin so the arrows aren't on the
 *  edge. Null when there is nothing to frame, which means "leave the chart where it is". */
export function markerRange(markers: TradeMarker[], marginRatio = 0.05) {
  if (!markers.length) return null
  const from = markers[0].time
  const to = markers[markers.length - 1].time
  const margin = Math.max(Math.round((to - from) * marginRatio), 60)
  return { from: from - margin, to: to + margin }
}

// --- parameter sweeps (backtest --sweep) ---------------------------------------------------------

export type SweepRunLike = { params: Record<string, number>; axis: string }

/** How many runs a sweep makes. A param with one value is fixed. oat: the base run plus every
 *  swept value other than that param's base. grid: the product of the swept lists. */
export function sweepCount(mode: 'oat' | 'grid', lists: { values: number[]; base: number }[]) {
  const swept = lists.filter((l) => l.values.length > 1)
  if (!swept.length) return 0
  return mode === 'grid'
    ? swept.reduce((n, l) => n * l.values.length, 1)
    : 1 + swept.reduce((n, l) => n + l.values.filter((v) => v !== l.base).length, 0)
}

/** A one-at-a-time sweep as one series per swept param: its runs in value order, with the base run
 *  (axis "") slotted in at the param's base value, since that run is also that param's point. */
export function oatSeries<R extends SweepRunLike>(runs: R[], params: string[]) {
  const base = runs.find((r) => r.axis === '')
  return params.map((param) => ({
    param,
    points: [...runs.filter((r) => r.axis === param), ...(base ? [base] : [])]
      .map((run) => ({ value: run.params[param], run, isBase: run === base }))
      .sort((a, b) => a.value - b.value),
  }))
}

/** A run that took no trades. Its metrics are all exactly zero, which is not a result: leave it off
 *  the colour scale and out of "best", or a grid full of dead cells reads as a grid of bad ones. */
export const noTrades = (summary: { trades?: number }) => !summary.trades

/** Equal-width buckets of `values`, for a distribution bar chart. Empty in, empty out. */
export function histogram(values: number[], bins = 20) {
  if (!values.length) return { lo: 0, hi: 0, width: 0, counts: [] as number[] }
  // reduce, not spread: a grid sweep can be 20,000 runs, which is past a safe argument count
  const lo = values.reduce((a, v) => Math.min(a, v), Infinity)
  const hi = values.reduce((a, v) => Math.max(a, v), -Infinity)
  const width = (hi - lo) / bins || 1
  const counts = Array<number>(bins).fill(0)
  for (const v of values) counts[Math.min(Math.floor((v - lo) / width), bins - 1)]++
  return { lo, hi, width, counts }
}

/** Many runs' equity sparklines on one pair of axes: every curve spans the full width whatever its
 *  own length, and all share one value scale, so the fan shows how far apart the runs actually end
 *  up. Reduce rather than spread - a big grid sweep is far past the argument limit. */
export function fanPaths(sparks: number[][], w = 100, h = 100) {
  let lo = 0
  let hi = 0
  for (const s of sparks)
    for (const v of s) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  const y = (v: number) => (hi === lo ? h / 2 : h - ((v - lo) / (hi - lo)) * h)
  return {
    lo,
    hi,
    zero: y(0),
    paths: sparks.map((s) =>
      s.length < 2 ? '' : s.map((v, i) => `${(i / (s.length - 1)) * w},${y(v)}`).join(' '),
    ),
  }
}

/** How far a param moves a metric across its own range: the spread from worst to best. Ranks which
 *  params matter - a big spread means that param needs care, a flat one can be left alone. */
export function spread(values: number[]) {
  return values.length ? Math.max(...values) - Math.min(...values) : 0
}

// --- export: every engine view as spreadsheet sheets (lib/exportFile writes them) -----------------

type Cell = string | number | null | undefined
type Sheet = { sheet: string; headers: Cell[]; rows: Cell[][] }
type Summary = Record<string, number | undefined>

/** Every summary field a run or sweep reports, in reading order. Older runs lack the later ones. */
export const SUMMARY_COLUMNS: [string, string][] = [
  ['net', 'Net P&L'],
  ['gross', 'Gross P&L'],
  ['costs', 'Costs'],
  ['trades', 'Trades'],
  ['win_rate', 'Win rate %'],
  ['avg_win', 'Avg win'],
  ['avg_loss', 'Avg loss'],
  ['profit_factor', 'Profit factor'],
  ['expectancy', 'Expectancy / trade'],
  ['max_dd', 'Max drawdown'],
  ['ret_dd', 'Return / drawdown'],
  ['sharpe', 'Sharpe (daily)'],
  ['trades_per_day', 'Trades / day'],
  ['avg_hold_min', 'Avg hold (min)'],
  ['days', 'Days'],
]
const metrics = (s: Summary) => SUMMARY_COLUMNS.map(([k]) => s[k] ?? null)
const period = (s: Summary) => [s.from ? istTime(s.from) : null, s.to ? istTime(s.to) : null]
const paramsText = (p: Record<string, number>) =>
  Object.entries(p)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')

type RunLike = {
  id: string
  source: string
  strategy: string
  label?: string | null
  symbols: string[]
  interval: string
  params: Record<string, number>
  summary: Summary
  created: string
}

/** One run (backtest, paper or live) as a workbook: summary, trades, daily, per symbol, equity. */
export function runSheets(
  run: RunLike & {
    trades: RunTrade[]
    daily: [number, number][]
    by_symbol: Record<string, { pnl: number; trades: number }>
    equity: [number, number][]
  },
): Sheet[] {
  let cum = 0
  return [
    {
      sheet: 'Summary',
      headers: ['Field', 'Value'],
      rows: [
        ['Run', run.id],
        ['Source', run.source],
        ['Strategy', run.strategy],
        ['Label', run.label ?? null],
        ['Symbols', run.symbols.join(', ')],
        ['Bars', run.interval],
        ['From (IST)', period(run.summary)[0]],
        ['To (IST)', period(run.summary)[1]],
        ...Object.entries(run.params).map(([k, v]): Cell[] => [`param: ${k}`, v]),
        ...SUMMARY_COLUMNS.map(([k, label]): Cell[] => [label, run.summary[k] ?? null]),
      ],
    },
    {
      sheet: 'Trades',
      headers: [
        'Symbol',
        'Side',
        'Qty',
        'Entry (IST)',
        'Entry px',
        'Exit (IST)',
        'Exit px',
        'Gross P&L',
        'Held (min)',
      ],
      rows: run.trades.map(([sym, tin, tout, qty, pin, pout, pnl]) => [
        sym,
        qty > 0 ? 'Long' : 'Short',
        Math.abs(qty),
        istTime(tin),
        pin,
        istTime(tout),
        pout,
        pnl,
        Math.round((tout - tin) / 60),
      ]),
    },
    {
      sheet: 'Daily',
      headers: ['Date', 'P&L', 'Cumulative'],
      rows: run.daily.map(([t, v]) => [istTime(t).slice(0, 10), v, (cum += v)]),
    },
    {
      sheet: 'By symbol',
      headers: ['Symbol', 'Trades', 'Gross P&L'],
      rows: Object.entries(run.by_symbol).map(([s, v]) => [s, v.trades, v.pnl]),
    },
    {
      sheet: 'Equity',
      headers: ['Time (IST)', 'Equity', 'Drawdown'],
      rows: drawdown(run.equity).map(([t, dd], i) => [istTime(t), run.equity[i][1], dd]),
    },
  ]
}

/** The runs list: one row per run, every metric. */
export function runsSheet(runs: RunLike[]): Sheet {
  return {
    sheet: 'Runs',
    headers: [
      'Run',
      'Source',
      'Strategy',
      'Label',
      'Params',
      'Symbols',
      'Bars',
      'From (IST)',
      'To (IST)',
      ...SUMMARY_COLUMNS.map(([, l]) => l),
      'Created',
    ],
    rows: runs.map((r) => [
      r.id,
      r.source,
      r.strategy,
      r.label ?? null,
      paramsText(r.params),
      r.symbols.join(', '),
      r.interval,
      ...period(r.summary),
      ...metrics(r.summary),
      r.created,
    ]),
  }
}

type SweepLike = {
  id: string
  mode: 'oat' | 'grid'
  strategy: string
  label: string | null
  symbols: string[]
  interval: string
  cost_bps: number
  base: Record<string, number>
  axes: Record<string, number[]>
  created: string
  runs: (SweepRunLike & { summary: Summary })[]
}

/** A sweep as a workbook: settings, every run (one column per param), and for one-at-a-time sweeps
 *  the per-param impact. The runs sheet is also what the CSV export writes. */
export function sweepSheets(sweep: SweepLike): Sheet[] {
  const params = Object.keys(sweep.base)
  const swept = Object.keys(sweep.axes)
  const runs: Sheet = {
    sheet: 'Runs',
    headers: [...(sweep.mode === 'oat' ? ['Varies'] : []), ...params, ...SUMMARY_COLUMNS.map(([, l]) => l)],
    rows: sweep.runs.map((r) => [
      ...(sweep.mode === 'oat' ? [r.axis || 'base'] : []),
      ...params.map((k) => r.params[k]),
      ...metrics(r.summary),
    ]),
  }
  const sheets: Sheet[] = [
    {
      sheet: 'Sweep',
      headers: ['Field', 'Value'],
      rows: [
        ['Sweep', sweep.id],
        ['Mode', sweep.mode === 'oat' ? 'one at a time' : 'grid'],
        ['Strategy', sweep.strategy],
        ['Label', sweep.label],
        ['Symbols', sweep.symbols.join(', ')],
        ['Bars', sweep.interval],
        ['Cost (bps/side)', sweep.cost_bps],
        ['Runs', sweep.runs.length],
        ['Created', sweep.created],
        ...params.map((k): Cell[] => [
          `${sweep.mode === 'oat' ? 'base' : swept.includes(k) ? 'swept' : 'fixed'}: ${k}`,
          swept.includes(k)
            ? sweep.axes[k].join(', ') + (sweep.mode === 'oat' ? ` (base ${sweep.base[k]})` : '')
            : sweep.base[k],
        ]),
      ],
    },
    runs,
  ]
  if (sweep.mode === 'oat') {
    const keys: [string, string][] = [
      ['net', 'Net P&L'],
      ['sharpe', 'Sharpe'],
      ['ret_dd', 'Return / drawdown'],
      ['max_dd', 'Max drawdown'],
    ]
    sheets.push({
      sheet: 'Impact',
      headers: ['Param', 'Base', 'Values', 'Best value (net)', ...keys.map(([, l]) => `${l} spread`)],
      rows: oatSeries(sweep.runs, swept).map(({ param, points }) => {
        const best = [...points].sort((a, b) => (b.run.summary.net ?? 0) - (a.run.summary.net ?? 0))[0]
        return [
          param,
          sweep.base[param],
          points.length,
          best?.value,
          ...keys.map(([k]) => spread(points.map((p) => p.run.summary[k] ?? 0))),
        ]
      }),
    })
  }
  return sheets
}
