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

export type SymbolEntry = { symbol: string; index: 'NSE' | 'BSE' }

/** A pasted symbol list, `[{"symbol": "INFY", "index": "NSE"}, ...]`: the entries, or every problem
 *  found (by 1-based position), so a bad paste is fixed in one go. Case-insensitive; other keys are
 *  ignored. Symbols follow the backend's SAFE_ID. */
export function parseSymbolJson(text: string): { entries: SymbolEntry[]; errors: string[] } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { entries: [], errors: [`Not valid JSON - ${(e as Error).message}`] }
  }
  if (!Array.isArray(data) || !data.length)
    return { entries: [], errors: ['Expected a non-empty array like [{"symbol": "INFY", "index": "NSE"}]'] }
  const entries: SymbolEntry[] = []
  const errors: string[] = []
  data.forEach((item, i) => {
    const at = `#${i + 1}`
    if (typeof item !== 'object' || item === null || Array.isArray(item))
      return errors.push(`${at}: not an object`)
    const { symbol, index } = item as Record<string, unknown>
    const sym = typeof symbol === 'string' ? symbol.trim().toUpperCase() : ''
    const idx = typeof index === 'string' ? index.trim().toUpperCase() : ''
    const bad = errors.length
    if (!/^[A-Z0-9_&-][A-Z0-9_.&-]*$/.test(sym)) errors.push(`${at}: "symbol" must be a ticker like "INFY"`)
    else if (entries.some((e) => e.symbol === sym)) errors.push(`${at}: ${sym} is listed twice`)
    if (idx !== 'NSE' && idx !== 'BSE') errors.push(`${at}${sym ? ` ${sym}` : ''}: "index" must be "NSE" or "BSE"`)
    if (errors.length === bad) entries.push({ symbol: sym, index: idx as SymbolEntry['index'] })
  })
  return { entries, errors }
}

/** Whether a stocks-master row trades on `index`: NSE rows are NSE-listed, and a BSE scrip code
 *  (an NSE row's `bse_code`, or a BSE-only row) means BSE-listed too. */
export const listedOn = (row: { exchange: string | null; bse_code: string | null }, index: SymbolEntry['index']) =>
  index === 'NSE' ? (row.exchange ?? 'NSE') === 'NSE' : row.exchange === 'BSE' || !!row.bse_code

export const comboCount =(lists: number[][]) => lists.reduce((n, l) => n * Math.max(l.length, 1), 1)

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

/** Bar interval ("1m", "5m", "15m", "1H", "4H", "1D") in seconds. */
export const intervalSeconds = (interval: string) =>
  parseInt(interval, 10) * (interval.endsWith('D') ? 86400 : interval.endsWith('H') ? 3600 : 60)

/** Minutes held, in the unit that reads: 45m, 3.5h, 12.4d. Intraday holds are minutes; daily bars
 *  hold for weeks, and "40,108m" says nothing. Calendar time, nights and weekends included. */
export const holdText = (min: number) =>
  min < 60
    ? `${Math.round(min)}m`
    : min < 1440
      ? `${+(min / 60).toFixed(1)}h`
      : `${+(min / 1440).toFixed(1)}d`

/** Time window to zoom the executions chart on one clicked trade: entry to exit, padded with a few
 *  bars either side so the candles it broke out of / into stay visible - the trade's own two points
 *  alone, with no padding, is two arrows on a blank chart. */
export function focusRange(entry: number, exit: number, interval: string, pad = 10) {
  const margin = Math.max(intervalSeconds(interval) * pad, Math.round((exit - entry) * 0.5))
  return { from: entry - margin, to: exit + margin }
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

type AutotuneLike = {
  id: string
  strategy: string
  symbol: string
  interval: string
  sessions: [string, string]
  train: number
  test: number
  min_trades: number
  margin: number
  cost_bps: number
  axes: Record<string, number[]>
  defaults: Record<string, number>
  stats: Record<string, number | boolean | null>
  oos: { summary: Summary; trades?: RunTrade[] }
  baseline: { summary: Summary }
  cells?: {
    params: Record<string, number>
    net: number
    trades: number
    win_rate: number
    profit_factor: number
    expectancy: number
    windows: number
    positive_windows: number
    picked: number
    is_net: number
  }[]
  windows: {
    train: [string, string]
    test: [string, string]
    chosen: Record<string, number> | null
    switched: boolean
    cells: number
    eligible: number
    is: Summary | null
    oos: Summary | null
    baseline: Summary
    start?: number
    end?: number
    rank?: number | null
    of?: number
    best?: { params: Record<string, number>; net: number } | null
  }[]
}

/** A walk-forward report as a workbook: settings + verdict numbers, tuned vs fixed side by side,
 *  one row per window, and - on reports that kept them - every cell's out-of-sample result and every
 *  executed trade. The windows sheet is what the CSV export writes. */
export function autotuneSheets(r: AutotuneLike): Sheet[] {
  const swept = Object.keys(r.axes)
  const stat = (k: string) => {
    const v = r.stats[k]
    return typeof v === 'boolean' ? (v ? 'yes' : 'no') : (v ?? null)
  }
  return [
    {
      sheet: 'Walk-forward',
      headers: ['Field', 'Value'],
      rows: [
        ['Report', r.id],
        ['Strategy', r.strategy],
        ['Symbol', r.symbol],
        ['Bars', r.interval],
        ['Sessions', `${r.sessions[0]} to ${r.sessions[1]}`],
        ['Train sessions', r.train],
        ['Test sessions', r.test],
        ['Min trades', r.min_trades],
        ['Switch margin', r.margin],
        ['Cost (bps/side)', r.cost_bps],
        ...swept.map((k): Cell[] => [`tuned: ${k}`, r.axes[k].join(', ')]),
        ...Object.entries(r.defaults).map(([k, v]): Cell[] => [`fixed defaults: ${k}`, v]),
        ['Windows', stat('windows')],
        ['Windows traded', stat('traded_windows')],
        ['Windows sat out', stat('sat_out')],
        ['Switches', stat('switches')],
        ['Walk-forward efficiency', stat('wfe')],
        ['Param stability', stat('stability')],
        ['Deflated Sharpe (probability)', stat('dsr')],
        ['Trials per window', stat('trials')],
        ['Beats fixed defaults', stat('beats_baseline')],
      ],
    },
    {
      sheet: 'Tuned vs fixed',
      headers: ['Metric', 'Tuned (out-of-sample)', 'Fixed defaults (out-of-sample)'],
      rows: SUMMARY_COLUMNS.filter(([k]) => k in r.oos.summary).map(([k, label]) => [
        label,
        r.oos.summary[k] ?? null,
        r.baseline.summary[k] ?? null,
      ]),
    },
    {
      sheet: 'Windows',
      headers: [
        'Train from',
        'Train to',
        'Test from',
        'Test to',
        ...swept,
        'Switched',
        'Eligible cells',
        'Cells',
        'In-sample net',
        'Out-of-sample net',
        'Out-of-sample trades',
        'Fixed defaults net',
        'Pick rank',
        'Cells',
        'Best cell (hindsight)',
        'Best cell net',
      ],
      rows: r.windows.map((w) => [
        ...w.train,
        ...w.test,
        ...swept.map((k) => w.chosen?.[k] ?? null),
        w.chosen ? (w.switched ? 'yes' : 'no') : 'sat out',
        w.eligible,
        w.cells,
        w.is?.net ?? null,
        w.oos?.net ?? null,
        w.oos?.trades ?? null,
        w.baseline.net ?? null,
        w.rank ?? null,
        w.of ?? null,
        w.best ? paramsLabel(w.best.params, swept) : null,
        w.best?.net ?? null,
      ]),
    },
    ...(r.cells?.length
      ? [
          {
            sheet: 'Combinations',
            headers: [
              ...swept,
              'Net (every window)',
              'Trades',
              'Win rate %',
              'Profit factor',
              'Expectancy',
              'Windows positive',
              'Windows',
              'Times picked',
              'Mean in-sample net',
            ],
            rows: r.cells.map((c) => [
              ...swept.map((k) => c.params[k]),
              c.net,
              c.trades,
              c.win_rate,
              c.profit_factor,
              c.expectancy,
              c.positive_windows,
              c.windows,
              c.picked,
              c.is_net,
            ]),
          },
        ]
      : []),
    ...(r.oos.trades?.length
      ? [
          {
            sheet: 'Trades',
            headers: [
              'Window',
              'Params',
              'Side',
              'Qty',
              'Entry (IST)',
              'Entry px',
              'Exit (IST)',
              'Exit px',
              'Gross P&L',
            ],
            rows: r.oos.trades.map((t) => {
              const i = windowOfTrade(t, r.windows)
              const w = r.windows[i]
              return [
                w ? `${w.test[0]} → ${w.test[1]}` : null,
                w?.chosen ? paramsLabel(w.chosen, swept) : null,
                t[3] > 0 ? 'Long' : 'Short',
                Math.abs(t[3]),
                istTime(t[1]),
                t[4],
                istTime(t[2]),
                t[5],
                t[6],
              ]
            }),
          },
        ]
      : []),
  ]
}

// --- multi-stock walk-forward: one batch, each stock tuned on its own ----------------------------

type TuneRowLike = {
  symbol: string
  stats: { traded_windows: number; windows: number; beats_baseline: boolean } & Record<string, unknown>
  oos: Summary
  baseline: Summary
}

/** What one stock's walk-forward showed. `held`: made money out-of-sample AND beat the fixed
 *  defaults. `idle`: no cell ever made money in-sample, so it never traded. `failed`: anything else -
 *  including "beat the defaults" by losing less. */
export function tuneVerdict(r: TuneRowLike): 'held' | 'failed' | 'idle' {
  if (!r.stats.traded_windows) return 'idle'
  return (r.oos.net ?? 0) > 0 && r.stats.beats_baseline ? 'held' : 'failed'
}

/** Several stocks' daily out-of-sample P&L summed by day, cumulated: the batch traded as one book.
 *  A day only one stock traded counts that stock alone; it isn't averaged against idle ones. */
export function portfolioCurve(dailies: [number, number][][]): [number, number][] {
  const byDay = new Map<number, number>()
  for (const daily of dailies) for (const [t, v] of daily) byDay.set(t, (byDay.get(t) ?? 0) + v)
  let cum = 0
  return [...byDay.entries()].sort(([a], [b]) => a - b).map(([t, v]) => [t, (cum += v)])
}

/** A batch as one sheet: a row per stock, tuned beside fixed, with the verdict. */
export function autotuneBatchSheet(rows: TuneRowLike[]): Sheet {
  const num = (v: unknown) => (typeof v === 'number' ? v : null)
  return {
    sheet: 'Stocks',
    headers: [
      'Symbol',
      'Verdict',
      'Windows traded',
      'Windows',
      'Tuned net',
      'Fixed defaults net',
      'Tuned trades',
      'Tuned profit factor',
      'Fixed profit factor',
      'Tuned max drawdown',
      'Walk-forward efficiency',
      'Deflated Sharpe',
      'Param stability',
    ],
    rows: rows.map((r) => [
      r.symbol,
      tuneVerdict(r),
      r.stats.traded_windows,
      r.stats.windows,
      r.oos.net ?? null,
      r.baseline.net ?? null,
      r.oos.trades ?? null,
      r.oos.profit_factor ?? null,
      r.baseline.profit_factor ?? null,
      r.oos.max_dd ?? null,
      num(r.stats.wfe),
      num(r.stats.dsr),
      num(r.stats.stability),
    ]),
  }
}

// --- history ranges: what a run was given, and what each stock actually had ----------------------

type HistoryLike = { mode: string; years?: number | null; start?: string | null; end?: string | null }
type CoverageLike = Record<
  string,
  {
    from: string
    to: string
    sessions: number
    missing?: { sessions: number; from: string; to: string }
    adjusted?: { date: string; ratio: number }[]
    jumps?: { date: string; move: number }[]
  }
>

const dayGap = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000
/** Holidays and weekends at a range's edge aren't worth mentioning; a stock missing more is. */
const EDGE_SLACK_DAYS = 7

/** A run's history in words. Runs from before ranges used the newest 30k bars; walk-forwards
 *  from before them kept a session count. */
export function historyText(h?: HistoryLike | number | null): string {
  if (h == null) return 'Newest 30,000 bars'
  if (typeof h === 'number') return `Last ${h} sessions`
  if (h.mode === 'years') {
    const n = h.years ?? 0
    return `Last ${n} year${n === 1 ? '' : 's'}${h.start ? ` (from ${h.start})` : ''}`
  }
  if (h.mode === 'dates') {
    if (h.start && h.end) return `${h.start} → ${h.end}`
    return h.start ? `From ${h.start}` : `Up to ${h.end}`
  }
  return 'All available'
}

/** Stocks whose own history didn't fill the range: listed after it starts, or data ending before
 *  it does. On "all available", the ones starting well after the earliest - their share of the
 *  result is shorter than it looks. Then each stock's data notes: sessions its bars lack, splits and
 *  bonuses that were back-adjusted, and big jumps left alone for a human to check. */
export function coverageNotes(h: HistoryLike | null | undefined, coverage?: CoverageLike): string[] {
  if (!coverage) return []
  const entries = Object.entries(coverage)
  const from = h?.start ?? entries.map(([, c]) => c.from).sort()[0]
  const notes: string[] = []
  for (const [sym, c] of entries) {
    if (from && dayGap(from, c.from) > EDGE_SLACK_DAYS) notes.push(`${sym} only from ${c.from}`)
    if (h?.end && dayGap(c.to, h.end) > EDGE_SLACK_DAYS) notes.push(`${sym} only up to ${c.to}`)
    if (c.missing)
      notes.push(`${sym} missing ${c.missing.sessions} sessions (${c.missing.from} → ${c.missing.to})`)
    for (const a of c.adjusted ?? [])
      notes.push(`${sym} split/bonus on ${a.date} - earlier prices ×${+a.ratio.toFixed(4)}`)
    for (const j of c.jumps ?? [])
      notes.push(
        `${sym} moved ${Math.round((j.move - 1) * 100)}% overnight on ${j.date} - not a known split ratio, check it`,
      )
  }
  return notes
}

/** The range that reproduces a finished run's bars exactly: its resolved start, and an end pinned
 *  to the last bar it had - "all available" or "last n years" would take in days added since. */
export function pinnedRange(h?: HistoryLike | null, coverage?: CoverageLike) {
  const last = coverage
    ? Object.values(coverage)
        .map((c) => c.to)
        .sort()
        .at(-1)
    : undefined
  const start = h?.start ?? null
  const end = h?.end ?? last ?? null
  return start || end ? { mode: 'dates' as const, start, end } : { mode: 'all' as const }
}

/** Why a history choice can't be sent, or null. `today` as "YYYY-MM-DD". */
export function historyError(r: HistoryLike, today: string): string | null {
  if (r.mode === 'years') {
    if (!(Number(r.years) > 0)) return 'Say how many years'
    if (Number(r.years) > 30) return 'At most 30 years'
  }
  if (r.mode === 'dates') {
    if (!r.start && !r.end) return 'Pick a start or an end date'
    if (r.start && r.end && r.start > r.end) return 'The range starts after it ends'
    if (r.start && r.start > today) return 'The range starts after today'
  }
  return null
}

// --- walk-forward detail: which parameter sets did what, and the trades behind the average -------

/** "fast=11 slow=30": a param set in the order of the swept axes. */
export const paramsLabel = (params: Record<string, number>, axes: string[]) =>
  axes.map((k) => `${k}=${params[k]}`).join(' ')

type WindowLike = {
  chosen: Record<string, number> | null
  test: [string, string]
  start?: number
  end?: number
  oos: Summary | null
}

/** The tuner's picks, grouped: each distinct param set it traded, over how many windows, and what
 *  those windows made out-of-sample. Best first. */
export function pickedSets(windows: WindowLike[], axes: string[]) {
  const by = new Map<
    string,
    { params: Record<string, number>; windows: number; positive: number; net: number; trades: number }
  >()
  for (const w of windows) {
    if (!w.chosen) continue
    const key = paramsLabel(w.chosen, axes)
    const g = by.get(key) ?? {
      params: Object.fromEntries(axes.map((k) => [k, w.chosen![k]])),
      windows: 0,
      positive: 0,
      net: 0,
      trades: 0,
    }
    g.windows += 1
    g.net += w.oos?.net ?? 0
    g.trades += w.oos?.trades ?? 0
    g.positive += (w.oos?.net ?? 0) > 0 ? 1 : 0
    by.set(key, g)
  }
  return [...by.values()].sort((a, b) => b.net - a.net)
}

/** Which test window a trade was taken in: by bar time where the report has window times, else by
 *  the entry's IST date. -1 when none contains it. */
export function windowOfTrade(trade: RunTrade, windows: WindowLike[]) {
  const entry = trade[1]
  const day = istTime(entry).slice(0, 10)
  return windows.findIndex((w) =>
    w.start != null && w.end != null
      ? entry >= w.start && entry <= w.end
      : day >= w.test[0] && day <= w.test[1],
  )
}

// --- run detail page (EngineRunPage.tsx): everything derived from one run's own report -----------

/** A trade's cost the way the engine charged it: `cost_bps` a side on each fill's notional. */
export const tradeCost = (t: RunTrade, costBps: number) => (Math.abs(t[3]) * (t[4] + t[5]) * costBps) / 1e4

export type RunDrawdown = {
  start: number // the peak it fell from
  trough: number
  end: number | null // back at the peak; null = still under water at the run's end
  depth: number // ₹ below the peak
  pct: number // % of the account at the peak
  days: number // peak to recovery (or to the end), calendar days
  recovery: number | null // trough to recovery, calendar days
}

export type RunBucket = { key: number; label: string; trades: number; net: number; winRate: number }

export type RunSymbol = {
  symbol: string
  trades: number
  net: number
  winRate: number
  profitFactor: number | null
  share: number // % of the run's total net
  avgHoldMin: number
  curve: [number, number][] // cumulative net by exit time
}

const DAY = 86400
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const sd = (xs: number[]) => {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

function buckets(trades: RunTrade[], nets: number[], keyOf: (t: RunTrade) => number, label: (k: number) => string) {
  const by = new Map<number, { n: number; net: number; wins: number }>()
  trades.forEach((t, i) => {
    const b = by.get(keyOf(t)) ?? { n: 0, net: 0, wins: 0 }
    b.n++
    b.net += nets[i]
    if (nets[i] > 0) b.wins++
    by.set(keyOf(t), b)
  })
  return [...by.entries()]
    .sort(([a], [b]) => a - b)
    .map(([key, b]): RunBucket => ({ key, label: label(key), trades: b.n, net: b.net, winRate: (100 * b.wins) / b.n }))
}

/** The biggest peak-to-recovery drawdowns of a daily P&L series on an account of `capital`. */
export function drawdownPeriods(daily: [number, number][], capital: number, top = 5): RunDrawdown[] {
  const out: RunDrawdown[] = []
  let cum = 0
  let peak = 0
  let peakT = daily[0]?.[0] ?? 0
  let cur: RunDrawdown | null = null
  for (const [t, pnl] of daily) {
    cum += pnl
    if (cum >= peak) {
      if (cur) {
        cur.end = t
        cur.days = Math.round((t - cur.start) / DAY)
        cur.recovery = Math.round((t - cur.trough) / DAY)
        out.push(cur)
        cur = null
      }
      peak = cum
      peakT = t
      continue
    }
    const depth = peak - cum
    if (!cur) cur = { start: peakT, trough: t, end: null, depth: 0, pct: 0, days: 0, recovery: null }
    if (depth > cur.depth) {
      cur.depth = depth
      cur.trough = t
      cur.pct = capital + peak > 0 ? (100 * depth) / (capital + peak) : 0
    }
  }
  if (cur) {
    cur.days = Math.round(((daily.at(-1)?.[0] ?? cur.start) - cur.start) / DAY)
    out.push(cur)
  }
  return out.sort((a, b) => b.depth - a.depth).slice(0, top)
}

/** Each trade's worst (MAE) and best (MFE) open P&L in ₹ while it was held, from the run's own bars:
 *  every bar from entry up to (not including) the exit bar, plus the exit fill. Sign follows qty, so
 *  a long's MAE comes from lows and a short's from highs. null where no bar covers the trade. */
export function excursions(
  trades: RunTrade[],
  bars: { time: number; high: number; low: number }[],
): ({ mae: number; mfe: number } | null)[] {
  const times = bars.map((b) => b.time)
  return trades.map(([, tin, tout, qty, pin, pout]) => {
    let lo = pout
    let hi = pout
    let seen = false
    // first bar at/after entry, by binary search - a run can hold thousands of trades on 1m bars
    let i = 0
    let j = times.length
    while (i < j) {
      const m = (i + j) >> 1
      if (times[m] < tin) i = m + 1
      else j = m
    }
    for (; i < bars.length && bars[i].time < tout; i++) {
      lo = Math.min(lo, bars[i].low)
      hi = Math.max(hi, bars[i].high)
      seen = true
    }
    if (!seen) return null
    const worst = qty > 0 ? lo : hi
    const best = qty > 0 ? hi : lo
    return { mae: Math.min(0, (worst - pin) * qty), mfe: Math.max(0, (best - pin) * qty) }
  })
}

/** Everything the run page shows beyond the engine's own summary. Trade stats are net of the cost
 *  the engine charged (cost_bps a side), so they add up to the run's net. `capital` is the Compound
 *  capital when the run was sized, else the most notional the run ever had open at once - the money
 *  a fixed-qty run actually needed - so % figures always have a base. */
export function runAnalytics(run: {
  summary: { net: number; gross: number; costs: number; max_dd: number; from: number; to: number }
  daily: [number, number][]
  trades: RunTrade[]
  params: Record<string, number>
  sizing?: { mode: string; capital: number } | null
}) {
  const costBps = run.params.cost_bps ?? 3
  const trades = [...run.trades].sort((a, b) => a[2] - b[2]) // by exit: the order P&L was realised in
  const nets = trades.map((t) => t[6] - tradeCost(t, costBps))
  const sized = !!run.sizing && run.sizing.mode !== 'fixed'

  // peak concurrent notional: +at entry, -at exit, exits first on a tie
  const moves = trades.flatMap((t) => [
    [t[1], Math.abs(t[3] * t[4])],
    [t[2], -Math.abs(t[3] * t[4])],
  ]) as [number, number][]
  moves.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let open = 0
  let peakNotional = 0
  for (const [, d] of moves) peakNotional = Math.max(peakNotional, (open += d))
  const capital = sized ? run.sizing!.capital : peakNotional

  const { net, gross, costs, from, to } = run.summary
  const years = (to - from) / (365.25 * DAY)
  const growth = capital > 0 ? 1 + net / capital : 0
  const cagr = capital > 0 && years >= 0.1 && growth > 0 ? (growth ** (1 / years) - 1) * 100 : null

  const rets = capital > 0 ? run.daily.map(([, p]) => p / capital) : []
  const downside = Math.sqrt(mean(rets.map((r) => Math.min(r, 0) ** 2)))
  const sortino = downside > 0 ? (mean(rets) / downside) * Math.sqrt(252) : 0

  let cum = 0
  let peak = 0
  const underwater: [number, number][] = run.daily.map(([t, p]) => {
    cum += p
    peak = Math.max(peak, cum)
    return [t, capital + peak > 0 ? (-100 * (peak - cum)) / (capital + peak) : 0]
  })
  const maxDdPct = -underwater.reduce((a, [, v]) => Math.min(a, v), 0)
  const ulcer = Math.sqrt(mean(underwater.map(([, v]) => v * v)))
  const calmar = cagr !== null && maxDdPct > 0 ? cagr / maxDdPct : null

  const WINDOW = 63 // a quarter of sessions
  const rollingSharpe: [number, number][] = []
  for (let i = WINDOW; i <= run.daily.length; i++) {
    const w = run.daily.slice(i - WINDOW, i).map(([, p]) => p)
    const s = sd(w)
    rollingSharpe.push([run.daily[i - 1][0], s > 0 ? (mean(w) / s) * Math.sqrt(252) : 0])
  }

  const wins = nets.filter((x) => x > 0)
  const losses = nets.filter((x) => x <= 0)
  const avgWin = mean(wins)
  const avgLoss = mean(losses)
  const payoff = wins.length && losses.length && avgLoss < 0 ? avgWin / -avgLoss : null
  const winP = nets.length ? wins.length / nets.length : 0
  const kelly = payoff ? (winP - (1 - winP) / payoff) * 100 : null
  const sqn = nets.length > 1 && sd(nets) > 0 ? (Math.sqrt(Math.min(nets.length, 100)) * mean(nets)) / sd(nets) : null

  let streak = 0
  let winStreak = 0
  let lossStreak = 0
  for (const x of nets) {
    streak = x > 0 ? Math.max(streak, 0) + 1 : Math.min(streak, 0) - 1
    winStreak = Math.max(winStreak, streak)
    lossStreak = Math.max(lossStreak, -streak)
  }

  // time in the market: the union of every trade's [entry, exit), over the run's span
  const spans = trades.map((t) => [t[1], t[2]]).sort((a, b) => a[0] - b[0])
  let covered = 0
  let end = -Infinity
  for (const [a, b] of spans) {
    if (b <= end) continue
    covered += b - Math.max(a, end)
    end = b
  }
  const holds = trades.map((t) => (t[2] - t[1]) / 60).sort((a, b) => a - b)

  const monthly = new Map<string, number>()
  const yearly = new Map<number, number>()
  for (const [t, p] of run.daily) {
    const d = new Date(t * 1000)
    const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`
    monthly.set(k, (monthly.get(k) ?? 0) + p)
    yearly.set(d.getUTCFullYear(), (yearly.get(d.getUTCFullYear()) ?? 0) + p)
  }

  const symbols = [...new Set(trades.map((t) => t[0]))]
  const bySymbol: RunSymbol[] = symbols
    .map((symbol) => {
      const idx = trades.flatMap((t, i) => (t[0] === symbol ? [i] : []))
      const n = idx.map((i) => nets[i])
      const w = n.filter((x) => x > 0).reduce((a, b) => a + b, 0)
      const l = -n.filter((x) => x < 0).reduce((a, b) => a + b, 0)
      const total = n.reduce((a, b) => a + b, 0)
      let c = 0
      return {
        symbol,
        trades: n.length,
        net: total,
        winRate: (100 * n.filter((x) => x > 0).length) / n.length,
        profitFactor: l > 0 ? w / l : null,
        share: net ? (100 * total) / net : 0,
        avgHoldMin: mean(idx.map((i) => (trades[i][2] - trades[i][1]) / 60)),
        curve: idx.map((i): [number, number] => [trades[i][2], (c += nets[i])]),
      }
    })
    .sort((a, b) => b.net - a.net)

  const hourOf = (t: RunTrade) => new Date(t[1] * 1000).getUTCHours()
  return {
    capital,
    capitalBasis: sized ? ('compound' as const) : ('peak exposure' as const),
    returnPct: capital > 0 ? (100 * net) / capital : null,
    cagr,
    sortino,
    calmar,
    ulcer,
    maxDdPct,
    payoff,
    sqn,
    kelly,
    largestWin: nets.reduce((a, b) => Math.max(a, b), 0),
    largestLoss: nets.reduce((a, b) => Math.min(a, b), 0),
    avgWin,
    avgLoss,
    winStreak,
    lossStreak,
    exposurePct: to > from ? Math.min(100, (100 * covered) / (to - from)) : 0,
    tradesPerMonth: to > from ? trades.length / ((to - from) / (30.44 * DAY)) : 0,
    medianHoldMin: holds.length ? holds[Math.floor(holds.length / 2)] : 0,
    costDragPct: gross > 0 ? (100 * costs) / gross : null,
    drawdowns: drawdownPeriods(run.daily, capital),
    underwater,
    rollingSharpe,
    monthly: [...monthly.entries()].map(([k, pnl]) => {
      const [y, m] = k.split('-').map(Number)
      return { year: y, month: m, pnl, pct: capital > 0 ? (100 * pnl) / capital : null }
    }),
    yearly: [...yearly.entries()].map(([year, pnl]) => ({ year, pnl, pct: capital > 0 ? (100 * pnl) / capital : null })),
    bySymbol,
    byHour: buckets(trades, nets, hourOf, (h) => `${String(h).padStart(2, '0')}:00`),
    byWeekday: buckets(trades, nets, (t) => new Date(t[1] * 1000).getUTCDay(), (d) => WEEKDAYS[d]),
    byMonth: buckets(trades, nets, (t) => new Date(t[1] * 1000).getUTCMonth(), (m) => MONTHS[m]),
    sizes: trades.map((t): [number, number] => [t[1], Math.abs(t[3])]),
    trades,
    nets,
  }
}
export type RunAnalytics = ReturnType<typeof runAnalytics>

/** A session date's first bar (09:15), on the same IST-read-as-UTC clock as every engine time. */
export const sessionTime = (date: string) => Date.parse(`${date}T09:15:00Z`) / 1000

type RunReportLike = AutotuneLike & {
  oos: { summary: Summary; trades?: RunTrade[]; daily?: [number, number][]; equity?: [number, number][] }
  baseline: { summary: Summary; trades?: RunTrade[]; daily?: [number, number][]; equity?: [number, number][] }
  sizing?: string[] | null
}

/** A whole auto-tune run as one workbook, for the run page's complete export: the per-stock summary,
 *  then every per-report sheet (walk settings, tuned vs fixed, windows, combinations, trades) merged
 *  into one sheet each with a Symbol column, plus what the run page derives - every metric per stock
 *  and side, both trade logs, daily P&L, the run as one book, monthly returns and drawdowns. Long
 *  format throughout, so a pivot table or filter slices it by stock. */
export function autotuneRunSheets(rows: TuneRowLike[], reports: RunReportLike[]): Sheet[] {
  const out: Sheet[] = [autotuneBatchSheet(rows)]
  const bySide = [
    ['Tuned', 'oos'],
    ['Fixed defaults', 'baseline'],
  ] as const
  const ymd = (t: number) => istTime(t).slice(0, 10)

  // every report's own sheets, one merged sheet per kind (same name and same columns)
  const merged = new Map<string, Sheet>()
  for (const r of reports)
    for (const sh of autotuneSheets(r)) {
      const key = `${sh.sheet}|${sh.headers.join('|')}`
      const m = merged.get(key) ?? { sheet: sh.sheet, headers: ['Symbol', ...sh.headers], rows: [] }
      m.rows.push(...sh.rows.map((row) => [r.symbol, ...row]))
      merged.set(key, m)
    }
  for (const m of merged.values()) out.push(m.sheet === 'Trades' ? { ...m, sheet: 'Tuned trades' } : m)

  const metricRows: Cell[][] = []
  const fixedTrades: Cell[][] = []
  const monthly: Cell[][] = []
  const dds: Cell[][] = []
  const daily: Cell[][] = []
  for (const r of reports) {
    const kv = Object.fromEntries((r.sizing ?? []).map((a) => a.split('=')))
    const sizing = kv.sizing ? { mode: kv.sizing === '2' ? 'all_in' : 'scale', capital: Number(kv.capital) } : null
    for (const [label, key] of bySide) {
      const s = r[key]
      const a = runAnalytics({
        summary: {
          net: s.summary.net ?? 0,
          gross: s.summary.gross ?? 0,
          costs: s.summary.costs ?? 0,
          max_dd: s.summary.max_dd ?? 0,
          from: s.equity?.[0]?.[0] ?? 0,
          to: s.equity?.at(-1)?.[0] ?? 0,
        },
        daily: s.daily ?? [],
        trades: s.trades ?? [],
        params: { cost_bps: r.cost_bps },
        sizing,
      })
      metricRows.push([
        r.symbol,
        label,
        s.summary.net ?? null,
        a.returnPct,
        a.cagr,
        s.summary.max_dd ?? null,
        a.maxDdPct,
        s.summary.sharpe ?? null,
        a.sortino,
        a.calmar,
        a.ulcer,
        s.summary.profit_factor ?? null,
        s.summary.win_rate ?? null,
        s.summary.expectancy ?? null,
        a.payoff,
        a.sqn,
        a.kelly,
        s.summary.trades ?? null,
        a.tradesPerMonth,
        a.exposurePct,
        a.medianHoldMin,
        a.avgWin,
        a.avgLoss,
        a.largestWin,
        a.largestLoss,
        a.winStreak,
        a.lossStreak,
        s.summary.costs ?? null,
        a.costDragPct,
        a.capital,
        a.capitalBasis,
      ])
      for (const m of a.monthly) monthly.push([r.symbol, label, m.year, m.month + 1, m.pnl, m.pct])
      for (const d of a.drawdowns)
        dds.push([r.symbol, label, ymd(d.start), ymd(d.trough), d.end ? ymd(d.end) : null, -d.depth, d.pct, d.days, d.recovery])
      if (key === 'baseline')
        a.trades.forEach((t, i) =>
          fixedTrades.push([r.symbol, t[3] > 0 ? 'Long' : 'Short', Math.abs(t[3]), istTime(t[1]), t[4], istTime(t[2]), t[5], t[6], a.nets[i]]),
        )
    }
    const fixedByDay = new Map(r.baseline.daily ?? [])
    const days = new Set([...(r.oos.daily ?? []).map(([t]) => t), ...fixedByDay.keys()])
    const tunedByDay = new Map(r.oos.daily ?? [])
    for (const t of [...days].sort((x, y) => x - y)) daily.push([r.symbol, ymd(t), tunedByDay.get(t) ?? 0, fixedByDay.get(t) ?? 0])
  }
  // the run as one book, both sides on the union of their days (a day only one side traded still counts)
  const sumBy = (key: 'oos' | 'baseline') => {
    const m = new Map<number, number>()
    for (const r of reports) for (const [t, v] of r[key].daily ?? []) m.set(t, (m.get(t) ?? 0) + v)
    return m
  }
  const tunedDay = sumBy('oos')
  const fixedDay = sumBy('baseline')
  let tunedCum = 0
  let fixedCum = 0
  const book: Cell[][] = [...new Set([...tunedDay.keys(), ...fixedDay.keys()])]
    .sort((a, b) => a - b)
    .map((t) => [ymd(t), (tunedCum += tunedDay.get(t) ?? 0), (fixedCum += fixedDay.get(t) ?? 0)])
  out.push(
    {
      sheet: 'Metrics',
      headers: [
        'Symbol', 'Side', 'Net', 'Return %', 'CAGR %', 'Max drawdown', 'Max drawdown %', 'Sharpe', 'Sortino',
        'Calmar', 'Ulcer index', 'Profit factor', 'Win rate %', 'Expectancy (gross)', 'Payoff ratio', 'SQN',
        'Kelly %', 'Trades', 'Trades / month', 'Exposure %', 'Median hold (min)', 'Avg win (net)',
        'Avg loss (net)', 'Largest win', 'Largest loss', 'Longest win streak', 'Longest loss streak', 'Costs',
        'Cost drag %', 'Capital for %', 'Capital basis',
      ],
      rows: metricRows,
    },
    {
      sheet: 'Fixed trades',
      headers: ['Symbol', 'Side', 'Qty', 'Entry (IST)', 'Entry px', 'Exit (IST)', 'Exit px', 'Gross P&L', 'Net P&L'],
      rows: fixedTrades,
    },
    { sheet: 'Daily', headers: ['Symbol', 'Day', 'Tuned P&L', 'Fixed defaults P&L'], rows: daily },
    {
      sheet: 'Book',
      headers: ['Day', 'Tuned cumulative', 'Fixed defaults cumulative'],
      rows: book,
    },
    { sheet: 'Monthly', headers: ['Symbol', 'Side', 'Year', 'Month', 'P&L', '% of capital'], rows: monthly },
    {
      sheet: 'Drawdowns',
      headers: ['Symbol', 'Side', 'Peak', 'Trough', 'Recovered', 'Depth', 'Depth %', 'Length (days)', 'Recovery (days)'],
      rows: dds,
    },
  )
  return out
}
