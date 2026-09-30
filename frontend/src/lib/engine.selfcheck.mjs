// node src/lib/engine.selfcheck.mjs
import assert from 'node:assert/strict'
import {
  autotuneBatchSheet,
  autotuneRunSheets,
  autotuneSheets,
  fanPaths,
  histogram,
  noTrades,
  oatSeries,
  portfolioCurve,
  runSheets,
  runsSheet,
  sweepSheets,
  SUMMARY_COLUMNS,
  spread,
  sweepCount,
  comboCount,
  coverageNotes,
  drawdown,
  focusRange,
  historyError,
  historyText,
  holdText,
  intervalSeconds,
  markerRange,
  paramsLabel,
  parseValues,
  listedOn,
  parseSymbolJson,
  drawdownPeriods,
  excursions,
  runAnalytics,
  tradeCost,
  pickedSets,
  pinnedRange,
  sweepGrid,
  tradeMarkers,
  tuneVerdict,
  windowOfTrade,
} from './engine.ts'

assert.deepEqual(parseValues('9'), [9])
assert.deepEqual(parseValues(' 5, 9 ,13,9 '), [5, 9, 13])
assert.deepEqual(parseValues('5:20:5'), [5, 10, 15, 20])
assert.deepEqual(parseValues('0.1:0.3:0.1'), [0.1, 0.2, 0.3])
assert.deepEqual(parseValues('3, 10:12:1'), [3, 10, 11, 12])
assert.deepEqual(parseValues(''), [])
assert.equal(parseValues('a'), null)
assert.equal(parseValues('5:1:1'), null)
assert.equal(parseValues('1:5:0'), null)
assert.equal(comboCount([[1, 2, 3], [4, 5], []]), 6)

// --- pasted symbol JSON ---
{
  const ok = parseSymbolJson('[{"symbol":" coforge ","index":"nse"},{"symbol":"RAIN","index":"BSE","note":"x"}]')
  assert.deepEqual(ok, { entries: [{ symbol: 'COFORGE', index: 'NSE' }, { symbol: 'RAIN', index: 'BSE' }], errors: [] })
  assert.match(parseSymbolJson('[{symbol:1}]').errors[0], /^Not valid JSON/)
  assert.equal(parseSymbolJson('[]').errors.length, 1, 'empty array refused')
  assert.equal(parseSymbolJson('{"symbol":"INFY"}').errors.length, 1, "an object, not an array")
  const bad = parseSymbolJson('[{"symbol":"INFY","index":"NSE"},"x",{"symbol":"infy","index":"NSE"},{"symbol":"A B","index":"NYSE"}]')
  assert.deepEqual(bad.errors, [
    '#2: not an object',
    '#3: INFY is listed twice',
    '#4: "symbol" must be a ticker like "INFY"',
    '#4 A B: "index" must be "NSE" or "BSE"',
  ])
  assert.deepEqual(bad.entries.map((e) => e.symbol), ['INFY'], 'only clean rows are kept')
  const dual = { exchange: 'NSE', bse_code: '532541' }
  assert.ok(listedOn(dual, 'NSE') && listedOn(dual, 'BSE'), 'dual-listed')
  assert.ok(!listedOn({ exchange: 'NSE', bse_code: null }, 'BSE'), 'NSE-only is not on BSE')
  assert.ok(listedOn({ exchange: 'BSE', bse_code: '500001' }, 'BSE') && !listedOn({ exchange: 'BSE', bse_code: '500001' }, 'NSE'))
}

const runs = [
  { id: 'a', params: { fast: 5, slow: 21 } },
  { id: 'b', params: { fast: 9, slow: 21 } },
  { id: 'c', params: { fast: 5, slow: 34 } },
]
const g = sweepGrid(runs, 'fast', 'slow')
assert.deepEqual(g.rows, [5, 9])
assert.deepEqual(g.cols, [21, 34])
assert.equal(g.cell(5, 34)[0].id, 'c')
assert.deepEqual(g.cell(9, 34), [])
assert.deepEqual(sweepGrid(runs, 'fast').cols, [0])

assert.deepEqual(
  drawdown([
    [1, 0],
    [2, 100],
    [3, 40],
    [4, 120],
    [5, -10],
  ]).map((p) => p[1]),
  [0, 0, -60, 0, -130],
)
// --- trade markers ---------------------------------------------------------------------------
const C = { up: 'green', down: 'red' }
// [symbol, entry, exit, signed qty, entry px, exit px, pnl]
const long = ['INFY', 100, 200, 5, 10, 12, 10]
const short = ['INFY', 300, 400, -5, 12, 13, -5]
const other = ['RELIANCE', 150, 250, 1, 9, 9, 0]

const m = tradeMarkers([long, short, other], 'INFY', C)
assert.equal(m.length, 4, 'two markers per trade, and only this symbol')
assert.deepEqual(
  m.map((x) => [x.time, x.shape, x.position, x.color, x.text]),
  [
    [100, 'arrowUp', 'belowBar', 'green', 'B 5'], // long entry: up, from under the bar
    [200, 'arrowDown', 'aboveBar', 'green', '+10'], // its exit: mirrored, green because it won
    [300, 'arrowDown', 'aboveBar', 'red', 'S 5'], // short entry: down, from above
    [400, 'arrowUp', 'belowBar', 'red', '-5'], // its exit: red because it lost
  ],
)
// A losing long still shows a green entry (that is what was done) and a red exit (how it went).
assert.deepEqual(
  tradeMarkers([['INFY', 1, 2, 1, 10, 9, -1]], 'INFY', C).map((x) => x.color),
  ['green', 'red'],
)
// A flat trade counts as won rather than lost - it did not cost anything.
assert.equal(tradeMarkers([['INFY', 1, 2, 1, 10, 10, 0]], 'INFY', C)[1].color, 'green')
// Only the most recent `limit` trades are marked, and markers come back in time order.
const many = Array.from({ length: 10 }, (_, i) => ['INFY', i * 10, i * 10 + 5, 1, 1, 1, 1])
const capped = tradeMarkers(many, 'INFY', C, 3)
assert.equal(capped.length, 6)
assert.equal(capped[0].time, 70, 'the last three trades, not the first')
assert.deepEqual(
  [...capped].sort((a, b) => a.time - b.time),
  capped,
)
assert.deepEqual(tradeMarkers([other], 'INFY', C), [], 'no trades for this symbol')

// The opening window covers the marks with a margin, and is null when there is nothing to frame.
assert.equal(markerRange([]), null)
const r = markerRange(m)
assert.ok(r.from < 100 && r.to > 400, JSON.stringify(r))
// Margin never collapses to zero on a single-instant range, which would be an unusable window.
const tiny = markerRange(tradeMarkers([['INFY', 5, 5, 1, 1, 1, 1]], 'INFY', C))
assert.ok(tiny.to - tiny.from >= 120, JSON.stringify(tiny))

// --- clicking a trade: the window the chart zooms to -----------------------------------------
assert.equal(intervalSeconds('5m'), 300)
assert.equal(intervalSeconds('1H'), 3600)
assert.equal(intervalSeconds('4H'), 14400)
assert.equal(intervalSeconds('1D'), 86400, 'a day, not a minute')
assert.equal(intervalSeconds('15m'), 900)
assert.deepEqual([holdText(45.4), holdText(210), holdText(40107.5)], ['45m', '3.5h', '27.9d'])
// A short scalp still gets bar-padding on both sides, not just its own two points.
const scalp = focusRange(1000, 1300, '5m', 10)
assert.deepEqual(scalp, { from: 1000 - 3000, to: 1300 + 3000 })
// A trade held a long time pads proportionally to its own length instead, once that's the bigger term.
const held = focusRange(0, 100_000, '5m', 10)
assert.deepEqual(held, { from: -50_000, to: 150_000 })

assert.equal(
  sweepCount('oat', [
    { values: [5, 9, 13], base: 9 },
    { values: [21, 34], base: 21 },
    { values: [1], base: 1 },
  ]),
  4,
)
assert.equal(sweepCount('oat', [{ values: [5, 13], base: 9 }]), 3)
assert.equal(
  sweepCount('grid', [
    { values: [5, 9, 13], base: 9 },
    { values: [21, 34], base: 21 },
  ]),
  6,
)
assert.equal(sweepCount('grid', [{ values: [1], base: 1 }]), 0)
const oat = [
  { params: { fast: 9, slow: 21 }, axis: '' },
  { params: { fast: 5, slow: 21 }, axis: 'fast' },
  { params: { fast: 13, slow: 21 }, axis: 'fast' },
  { params: { fast: 9, slow: 34 }, axis: 'slow' },
]
const series = oatSeries(oat, ['fast', 'slow'])
assert.deepEqual(
  series[0].points.map((p) => [p.value, p.isBase]),
  [
    [5, false],
    [9, true],
    [13, false],
  ],
)
assert.deepEqual(
  series[1].points.map((p) => p.value),
  [21, 34],
)
assert.equal(spread([3, -2, 7]), 9)
assert.equal(spread([]), 0)
// exports
const sum = {
  net: 50,
  gross: 60,
  costs: 10,
  trades: 2,
  sharpe: 1.5,
  max_dd: 20,
  from: 1718104500,
  to: 1718190900,
}
const run = {
  id: 'bt-1',
  source: 'backtest',
  strategy: 'ema_cross',
  label: null,
  symbols: ['TCS'],
  interval: '5m',
  params: { fast: 9 },
  summary: sum,
  created: '2026-09-25',
  trades: [['TCS', 1718104500, 1718106300, -3, 100, 90, 30]],
  daily: [
    [1718064000, 30],
    [1718150400, 20],
  ],
  by_symbol: { TCS: { pnl: 30, trades: 1 } },
  equity: [
    [1718104500, 0],
    [1718106300, 30],
    [1718190900, 10],
  ],
}
const rs = runSheets(run)
assert.deepEqual(
  rs.map((x) => x.sheet),
  ['Summary', 'Trades', 'Daily', 'By symbol', 'Equity'],
)
assert.deepEqual(rs[1].rows[0], ['TCS', 'Short', 3, '2024-06-11 11:15', 100, '2024-06-11 11:45', 90, 30, 30])
assert.deepEqual(
  rs[2].rows.map((r) => r[2]),
  [30, 50],
)
assert.deepEqual(
  rs[4].rows.map((r) => r[2]),
  [0, 0, -20],
)
assert.ok(rs[0].rows.some((r) => r[0] === 'param: fast' && r[1] === 9))
const list = runsSheet([run])
assert.equal(list.headers.length, list.rows[0].length)
assert.equal(list.rows[0][list.headers.indexOf('Net P&L')], 50)
assert.equal(list.rows[0][list.headers.indexOf('Profit factor')], null, 'older runs lack new metrics')
const sw = {
  id: 'sw-1',
  mode: 'oat',
  strategy: 'ema_cross',
  label: null,
  symbols: ['TCS'],
  interval: '5m',
  cost_bps: 3,
  base: { fast: 9, qty: 1 },
  axes: { fast: [5, 13] },
  created: '2026-09-25',
  runs: [
    { params: { fast: 9, qty: 1 }, axis: '', summary: { net: 10 } },
    { params: { fast: 5, qty: 1 }, axis: 'fast', summary: { net: -5 } },
    { params: { fast: 13, qty: 1 }, axis: 'fast', summary: { net: 40 } },
  ],
}
const ss = sweepSheets(sw)
assert.deepEqual(
  ss.map((x) => x.sheet),
  ['Sweep', 'Runs', 'Impact'],
)
assert.deepEqual(ss[1].headers.slice(0, 3), ['Varies', 'fast', 'qty'])
assert.deepEqual(
  ss[1].rows.map((r) => r[0]),
  ['base', 'fast', 'fast'],
)
assert.deepEqual(ss[2].rows[0].slice(0, 5), ['fast', 9, 3, 13, 45])
assert.deepEqual(
  sweepSheets({ ...sw, mode: 'grid' }).map((x) => x.sheet),
  ['Sweep', 'Runs'],
)
assert.equal(SUMMARY_COLUMNS.length, 15)

// --- multi-run views -------------------------------------------------------------------------
assert.equal(noTrades({ trades: 0 }), true, 'a run that took no trades is not a result')
assert.equal(noTrades({}), true, 'missing is dead too')
assert.equal(noTrades({ trades: 8 }), false)

const h = histogram([0, 1, 2, 3, 4, 10], 5)
assert.deepEqual([h.lo, h.hi, h.width], [0, 10, 2])
assert.deepEqual(h.counts, [2, 2, 1, 0, 1], 'the top value lands in the last bin, not past it')
assert.deepEqual(histogram([], 5).counts, [])
assert.deepEqual(histogram([7, 7, 7], 4).counts, [3, 0, 0, 0], 'a flat set does not divide by zero')

// two runs of different length still span the full width, on one shared scale (0 always included)
const fan = fanPaths(
  [
    [0, 10],
    [0, -5, 5],
  ],
  100,
  100,
)
assert.deepEqual([fan.lo, fan.hi, fan.zero], [-5, 10, 100 - (5 / 15) * 100])
assert.deepEqual(
  fan.paths[0].split(' ').map((p) => p.split(',')[0]),
  ['0', '100'],
)
assert.deepEqual(
  fan.paths[1].split(' ').map((p) => p.split(',')[0]),
  ['0', '50', '100'],
)
assert.equal(fanPaths([[1]]).paths[0], '', 'one point is not a curve')

// --- walk-forward export -----------------------------------------------------------------------
const wf = {
  id: 'wf-1',
  strategy: 'ema_cross',
  symbol: 'INFY',
  interval: '5m',
  sessions: ['2025-09-24', '2026-09-28'],
  train: 60,
  test: 5,
  min_trades: 30,
  margin: 0.15,
  cost_bps: 3,
  axes: { fast: [5, 9], slow: [21, 34] },
  defaults: { fast: 9, slow: 21, qty: 1, cost_bps: 3 },
  stats: { windows: 2, traded_windows: 1, sat_out: 1, wfe: null, beats_baseline: true, dsr: 0.4 },
  oos: { summary: { net: 10, trades: 4, profit_factor: 1.5 } },
  baseline: { summary: { net: -5, trades: 9, profit_factor: 0.8 } },
  windows: [
    {
      train: ['a', 'b'],
      test: ['c', 'd'],
      chosen: { fast: 9, slow: 34, qty: 1 },
      switched: false,
      cells: 4,
      eligible: 3,
      is: { net: 50 },
      oos: { net: 10, trades: 4 },
      baseline: { net: -2 },
    },
    {
      train: ['e', 'f'],
      test: ['g', 'h'],
      chosen: null,
      switched: false,
      cells: 4,
      eligible: 0,
      is: null,
      oos: null,
      baseline: { net: -3 },
    },
  ],
}
const ws = autotuneSheets(wf)
assert.deepEqual(
  ws.map((x) => x.sheet),
  ['Walk-forward', 'Tuned vs fixed', 'Windows'],
)
assert.deepEqual(
  ws[2].headers.slice(4, 6),
  ['fast', 'slow'],
  'one column per tuned param, not the fixed ones',
)
assert.deepEqual(ws[2].rows[0].slice(4, 7), [9, 34, 'no'])
assert.deepEqual(ws[2].rows[1].slice(4, 7), [null, null, 'sat out'], 'a sat-out window says so')
assert.equal(ws[2].headers.length, ws[2].rows[0].length)
assert.deepEqual(
  ws[1].rows.map((r) => r[0]),
  ['Net P&L', 'Trades', 'Profit factor'],
  'only metrics the report has',
)
assert.ok(
  ws[0].rows.some((r) => r[0] === 'Walk-forward efficiency' && r[1] === null),
  'null stays null, not 0',
)
assert.ok(ws[0].rows.some((r) => r[0] === 'Beats fixed defaults' && r[1] === 'yes'))
const full = autotuneSheets({
  ...wf,
  cells: [
    {
      params: { fast: 9, slow: 34 },
      net: 30,
      trades: 5,
      win_rate: 60,
      profit_factor: 2,
      expectancy: 6,
      windows: 2,
      positive_windows: 1,
      picked: 1,
      is_net: 25,
    },
  ],
  oos: { ...wf.oos, trades: [['INFY', Date.parse('2026-01-02T10:00:00Z') / 1000, 0, -3, 10, 9, 3]] },
  windows: [
    {
      ...wf.windows[0],
      test: ['2026-01-01', '2026-01-05'],
      rank: 2,
      of: 4,
      best: { params: { fast: 5, slow: 21 }, net: 12 },
    },
    wf.windows[1],
  ],
})
assert.deepEqual(
  full.map((x) => x.sheet),
  ['Walk-forward', 'Tuned vs fixed', 'Windows', 'Combinations', 'Trades'],
)
assert.deepEqual(
  full[2].rows[0].slice(-4),
  [2, 4, 'fast=5 slow=21', 12],
  'rank and the hindsight-best cell per window',
)
assert.deepEqual(full[3].rows[0].slice(0, 3), [9, 34, 30])
assert.deepEqual(
  full[4].rows[0].slice(0, 4),
  ['2026-01-01 → 2026-01-05', 'fast=9 slow=34', 'Short', 3],
  'each trade with its window and params',
)
assert.equal(ws.length, 3, 'reports from before cells/trades were kept export as before')

// --- multi-stock batches -----------------------------------------------------------------------
const row = (net, base, traded, beats) => ({
  symbol: 'X',
  stats: { traded_windows: traded, windows: 10, beats_baseline: beats, wfe: null, dsr: 0.5 },
  oos: { net, trades: 3 },
  baseline: { net: base },
})
assert.equal(tuneVerdict(row(10, -5, 4, true)), 'held')
assert.equal(tuneVerdict(row(-10, -50, 4, true)), 'failed', 'losing less than the defaults is not an edge')
assert.equal(tuneVerdict(row(10, 20, 4, false)), 'failed', 'profitable but worse than the defaults')
assert.equal(tuneVerdict(row(0, -5, 0, true)), 'idle', 'never traded')
assert.deepEqual(
  portfolioCurve([
    [
      [1, 5],
      [2, -1],
    ],
    [
      [2, 3],
      [3, 2],
    ],
  ]),
  [
    [1, 5],
    [2, 7],
    [3, 9],
  ],
  'summed by day, then cumulated, in day order',
)
assert.deepEqual(portfolioCurve([]), [])
const bs = autotuneBatchSheet([row(10, -5, 4, true)])
assert.equal(bs.headers.length, bs.rows[0].length)
assert.deepEqual(bs.rows[0].slice(0, 6), ['X', 'held', 4, 10, 10, -5])
assert.equal(bs.rows[0][10], null, 'a missing WFE stays empty, not 0')

// --- history ranges ------------------------------------------------------------------------------
assert.equal(historyText(undefined), 'Newest 30,000 bars', 'runs from before ranges')
assert.equal(historyText(250), 'Last 250 sessions', 'walk-forwards from before ranges')
assert.equal(historyText({ mode: 'all', start: null, end: null }), 'All available')
assert.equal(
  historyText({ mode: 'years', years: 3, start: '2023-09-29', end: null }),
  'Last 3 years (from 2023-09-29)',
)
assert.equal(historyText({ mode: 'years', years: 1, start: '2025-09-29' }), 'Last 1 year (from 2025-09-29)')
assert.equal(
  historyText({ mode: 'dates', start: '2024-01-01', end: '2024-12-31' }),
  '2024-01-01 → 2024-12-31',
)
assert.equal(historyText({ mode: 'dates', start: null, end: '2024-06-30' }), 'Up to 2024-06-30')

const cov = {
  INFY: { from: '2023-09-29', to: '2026-09-28', sessions: 743 },
  QPOWER: { from: '2025-02-24', to: '2026-09-28', sessions: 225 },
}
assert.deepEqual(coverageNotes({ mode: 'years', years: 3, start: '2023-09-29', end: null }, cov), [
  'QPOWER only from 2025-02-24',
])
assert.deepEqual(
  coverageNotes({ mode: 'all', start: null, end: null }, cov),
  ['QPOWER only from 2025-02-24'],
  'all: vs the earliest stock',
)
assert.deepEqual(
  coverageNotes({ mode: 'dates', start: '2023-09-25', end: '2026-10-01' }, { INFY: cov.INFY }),
  [],
  'a weekend or holiday at either edge is not worth a note',
)
assert.deepEqual(
  coverageNotes({ mode: 'dates', start: '2023-01-01', end: '2027-06-30' }, { INFY: cov.INFY }),
  ['INFY only from 2023-09-29', 'INFY only up to 2026-09-28'],
)
assert.deepEqual(coverageNotes(undefined, undefined), [])
assert.deepEqual(
  coverageNotes(
    { mode: 'all', start: null, end: null },
    {
      DHARIWAL: {
        from: '2024-08-08',
        to: '2026-09-28',
        sessions: 486,
        adjusted: [{ date: '2026-02-06', ratio: 0.2 }],
        jumps: [{ date: '2026-02-27', move: 0.526 }],
      },
      QPOWER: {
        from: '2024-08-09',
        to: '2026-09-28',
        sessions: 225,
        missing: { sessions: 168, from: '2026-01-22', to: '2026-09-25' },
      },
    },
  ),
  [
    'DHARIWAL split/bonus on 2026-02-06 - earlier prices ×0.2',
    'DHARIWAL moved -47% overnight on 2026-02-27 - not a known split ratio, check it',
    'QPOWER missing 168 sessions (2026-01-22 → 2026-09-25)',
  ],
)

assert.deepEqual(
  pinnedRange({ mode: 'all', start: null, end: null }, cov),
  { mode: 'dates', start: null, end: '2026-09-28' },
  'all: pinned to the last bar it had',
)
assert.deepEqual(pinnedRange({ mode: 'years', years: 3, start: '2023-09-29', end: null }, cov), {
  mode: 'dates',
  start: '2023-09-29',
  end: '2026-09-28',
})
assert.deepEqual(pinnedRange({ mode: 'dates', start: '2024-01-01', end: '2024-12-31' }, cov), {
  mode: 'dates',
  start: '2024-01-01',
  end: '2024-12-31',
})
assert.deepEqual(pinnedRange(undefined, undefined), { mode: 'all' }, 'an old run with nothing to pin to')

const today = '2026-09-29'
assert.equal(historyError({ mode: 'all' }, today), null)
assert.equal(historyError({ mode: 'years', years: 0 }, today), 'Say how many years')
assert.equal(historyError({ mode: 'years', years: 31 }, today), 'At most 30 years')
assert.equal(historyError({ mode: 'years', years: 0.5 }, today), null)
assert.equal(historyError({ mode: 'dates', start: '', end: '' }, today), 'Pick a start or an end date')
assert.equal(
  historyError({ mode: 'dates', start: '2025-01-02', end: '2025-01-01' }, today),
  'The range starts after it ends',
)
assert.equal(historyError({ mode: 'dates', start: '2027-01-01' }, today), 'The range starts after today')
assert.equal(historyError({ mode: 'dates', end: '2024-01-01' }, today), null, 'an open start is fine')

// --- walk-forward detail -------------------------------------------------------------------------
assert.equal(
  paramsLabel({ slow: 30, fast: 11, qty: 1 }, ['fast', 'slow']),
  'fast=11 slow=30',
  'axis order, swept only',
)
const wins = [
  {
    chosen: { fast: 5, qty: 1 },
    test: ['2026-01-01', '2026-01-05'],
    start: 100,
    end: 200,
    oos: { net: 10, trades: 2 },
  },
  { chosen: null, test: ['2026-01-06', '2026-01-10'], start: 300, end: 400, oos: null },
  {
    chosen: { fast: 5, qty: 1 },
    test: ['2026-01-11', '2026-01-15'],
    start: 500,
    end: 600,
    oos: { net: -4, trades: 1 },
  },
  {
    chosen: { fast: 9, qty: 1 },
    test: ['2026-01-16', '2026-01-20'],
    start: 700,
    end: 800,
    oos: { net: 20, trades: 3 },
  },
]
assert.deepEqual(
  pickedSets(wins, ['fast']),
  [
    { params: { fast: 9 }, windows: 1, positive: 1, net: 20, trades: 3 },
    { params: { fast: 5 }, windows: 2, positive: 1, net: 6, trades: 3 },
  ],
  'grouped by the swept params, sat-out windows skipped, best first',
)
assert.equal(windowOfTrade(['X', 550, 590, 1, 1, 1, 1], wins), 2)
assert.equal(windowOfTrade(['X', 650, 690, 1, 1, 1, 1], wins), -1, 'between windows')
const byDate = [{ chosen: null, test: ['2026-01-01', '2026-01-05'], oos: null }]
assert.equal(
  windowOfTrade(['X', Date.parse('2026-01-02T10:00:00Z') / 1000, 0, 1, 1, 1, 1], byDate),
  0,
  'older reports: by date',
)

// --- run detail page analytics ---
{
  const D = 86400
  // drawdowns: +100, -30, -20 (trough 50 below the peak), +60 (recovered), -10 (still under at the end)
  const daily = [[0, 100], [D, -30], [2 * D, -20], [3 * D, 60], [4 * D, -10]]
  const dd = drawdownPeriods(daily, 1000)
  assert.equal(dd.length, 2)
  assert.deepEqual([dd[0].start, dd[0].trough, dd[0].end, dd[0].depth, dd[0].days, dd[0].recovery], [0, 2 * D, 3 * D, 50, 3, 1])
  assert.equal(+dd[0].pct.toFixed(4), +((100 * 50) / 1100).toFixed(4), '% of the account at the peak')
  assert.deepEqual([dd[1].end, dd[1].depth, dd[1].recovery], [null, 10, null], 'still under water')

  // MAE/MFE: a long from 100 held over two bars, exit bar excluded; a short mirrors it
  const bars = [
    { time: 10, high: 104, low: 97 },
    { time: 20, high: 108, low: 99 },
    { time: 30, high: 200, low: 1 },
  ]
  const ex = excursions(
    [
      ['X', 10, 30, 2, 100, 105, 10],
      ['X', 10, 30, -1, 100, 105, -5],
      ['X', 40, 50, 1, 1, 1, 0],
    ],
    bars,
  )
  assert.deepEqual(ex[0], { mae: -6, mfe: 16 }, 'long: 2 x (97-100), 2 x (108-100)')
  assert.deepEqual(ex[1], { mae: -8, mfe: 3 }, 'short: -(108-100), -(97-100)')
  assert.equal(ex[2], null, 'no bar covers it')

  // the whole run: two symbols, costs 10 bps, fixed qty -> capital is the peak concurrent notional
  const trades = [
    ['A', 0 * D + 3600 * 10, 0 * D + 3600 * 11, 10, 100, 110, 100],
    ['B', 0 * D + 3600 * 10.5, 0 * D + 3600 * 12, -5, 200, 210, -50],
    ['A', 1 * D + 3600 * 10, 1 * D + 3600 * 13, 10, 110, 99, -110],
    ['A', 3 * D + 3600 * 14, 3 * D + 3600 * 15, 10, 100, 120, 200],
  ]
  assert.equal(tradeCost(trades[0], 10), (10 * 210 * 10) / 1e4)
  const a = runAnalytics({
    summary: { net: 0, gross: 140, costs: 0, max_dd: 0, from: 0, to: 4 * D },
    daily: [[0, 50], [D, -110], [3 * D, 200]],
    trades,
    params: { cost_bps: 10 },
  })
  assert.equal(a.capital, 2000, 'A (1000) and B (1000) were open at once')
  assert.equal(a.capitalBasis, 'peak exposure')
  assert.deepEqual(a.nets.map((x) => +x.toFixed(2)), [97.9, -52.05, -112.09, 197.8])
  assert.deepEqual([a.winStreak, a.lossStreak], [1, 2])
  assert.deepEqual(a.bySymbol.map((s) => [s.symbol, s.trades]), [['A', 3], ['B', 1]], 'best symbol first')
  assert.deepEqual(a.byHour.map((b) => [b.label, b.trades]), [['10:00', 3], ['14:00', 1]])
  assert.equal(+a.exposurePct.toFixed(4), +((100 * (2 * 3600 + 3 * 3600 + 3600)) / (4 * D)).toFixed(4), 'overlapping trades counted once')
  assert.equal(a.largestLoss < -112 && a.largestWin > 197, true)
  const sized = runAnalytics({
    summary: { net: 100000, gross: 1, costs: 0, max_dd: 0, from: 0, to: 365.25 * D },
    daily: [[0, 100000]],
    trades: [],
    params: {},
    sizing: { mode: 'all_in', capital: 100000 },
  })
  assert.equal(sized.capital, 100000)
  assert.equal(+sized.cagr.toFixed(6), 100, 'doubled in a year')
  assert.equal(sized.returnPct, 100)
}

// --- a whole auto-tune run as one workbook ---
{
  const D = 86400
  const rep = (symbol, tuned, fixed) => ({
    ...wf,
    id: `wf-x-${symbol}`,
    symbol,
    oos: { ...wf.oos, daily: tuned, equity: [[tuned[0][0], 0], [tuned.at(-1)[0], 1]], trades: [[symbol, D, 2 * D, 1, 10, 11, 1]] },
    baseline: { ...wf.baseline, daily: fixed, equity: [[fixed[0][0], 0], [fixed.at(-1)[0], 1]], trades: [[symbol, D, 2 * D, -1, 10, 11, -1]] },
  })
  const a = rep('AAA', [[D, 5], [2 * D, -1]], [[D, 1]])
  const b = rep('BBB', [[2 * D, 3]], [[3 * D, 2]])
  const rowOf = (r) => ({ ...r, oos: r.oos.summary, baseline: r.baseline.summary })
  const sheets = autotuneRunSheets([rowOf(a), rowOf(b)], [a, b])
  const names = sheets.map((s) => s.sheet)
  for (const n of ['Stocks', 'Walk-forward', 'Windows', 'Tuned trades', 'Metrics', 'Fixed trades', 'Daily', 'Book', 'Monthly', 'Drawdowns'])
    assert.ok(names.includes(n), `has ${n}`)
  const get = (n) => sheets.find((s) => s.sheet === n)
  assert.deepEqual(get('Windows').rows.map((r) => r[0]), ['AAA', 'AAA', 'BBB', 'BBB'], 'per-report sheets merged, Symbol first')
  assert.equal(get('Windows').headers[0], 'Symbol')
  assert.equal(get('Metrics').rows.length, 4, 'a row per stock and side')
  assert.deepEqual(get('Fixed trades').rows.map((r) => [r[0], r[1]]), [['AAA', 'Short'], ['BBB', 'Short']])
  assert.deepEqual(get('Book').rows.map((r) => r.slice(1)), [[5, 1], [7, 1], [7, 3]], 'union of days, both sides cumulative')
  assert.deepEqual(get('Daily').rows.filter((r) => r[0] === 'BBB').map((r) => r.slice(2)), [[3, 0], [0, 2]])
  for (const s of sheets) assert.ok(s.rows.every((r) => r.length === s.headers.length), `${s.sheet}: every row matches its headers`)
}

console.log('engine selfcheck passed')
