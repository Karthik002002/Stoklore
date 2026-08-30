// The spreadsheet shape of a trade: one fixed column set, shared by the journal's Trades tab and
// the paper trade history so both exports read the same way. Deliberately static - the on-screen
// table hides columns depending on the account, an export that did the same would produce two
// files with the same name and different columns. The screenshot is not exported: it is not data.
import { autoResult, tradePnl, tradeReturnPct, tradeRRDisplay } from '@/lib/manualTrades'
import { accountFor, accountsById, tradeCosts, tradeNetPnl } from '@/lib/tradeCosts'
import type { CellValue } from './exportFile.ts'
import type { Trade, TradeAccount } from './types.ts'

/** One column: the spreadsheet heading, the cell value, the JSON key, and - for the one or two
 *  fields where a cell and a JSON value should genuinely differ - a separate JSON value. */
type Column = [
  label: string,
  value: (t: Trade, account: TradeAccount | null) => CellValue,
  key: string,
  jsonValue?: (t: Trade, account: TradeAccount | null) => unknown,
]

// Local wall-clock, not the ISO string: these are Indian market timestamps and a UTC 'Z' in a
// spreadsheet turns every 09:15 entry into 03:45 the same day.
const localTime = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const hoursHeld = (t: Trade) => {
  if (!t.exited_at || !t.traded_at) return null
  const h = (new Date(t.exited_at).getTime() - new Date(t.traded_at).getTime()) / 3_600_000
  return Number.isFinite(h) ? Math.round(h * 100) / 100 : null
}

// [label, value, key, jsonValue?] - the label heads a spreadsheet column, the key names the field
// in the JSON copy, and the optional fourth entry is for the one or two fields a cell and a JSON
// value should genuinely differ on (tags read as "a, b" in a spreadsheet and belong as an array in
// JSON). Both outputs come off ONE list so an export and a copy can never describe the same trade
// differently; the keys are spelled out rather than slugged from the labels, because "R:R" and
// "Gross P&L" slug into things nobody wants to type.
const COLUMNS: Column[] = [
  ['Entry time', (t) => localTime(t.traded_at), 'entry_time'],
  ['Exit time', (t) => localTime(t.exited_at), 'exit_time'],
  ['Symbol', (t) => t.symbol, 'symbol'],
  ['Direction', (t) => t.direction, 'direction'],
  ['Status', (t) => (t.exit_price == null ? 'Open' : 'Closed'), 'status'],
  ['Setup', (t) => t.setup ?? '', 'setup'],
  ['Account', (t, acct) => acct?.name ?? '', 'account'],
  ['Quantity', (t) => t.quantity, 'quantity'],
  ['Entry price', (t) => t.entry_price, 'entry_price'],
  ['Exit price', (t) => t.exit_price, 'exit_price'],
  ['Stop loss', (t) => t.stop_loss, 'stop_loss'],
  ['Target', (t) => t.target, 'target'],
  ['Planned risk', (t) => t.ideal_risk_amount, 'planned_risk'],
  ['R:R', (t) => tradeRRDisplay(t)?.rr ?? null, 'rr'],
  [
    'R:R basis',
    (t) => (tradeRRDisplay(t) == null ? '' : tradeRRDisplay(t)?.planned ? 'planned' : 'realised'),
    'rr_basis',
  ],
  ['Gross P&L', (t) => tradePnl(t), 'gross_pnl'],
  ['Costs', (t, acct) => tradeCosts(t, acct)?.total ?? null, 'costs'],
  ['Net P&L', (t, acct) => tradeNetPnl(t, acct), 'net_pnl'],
  ['Return %', (t) => tradeReturnPct(t), 'return_pct'],
  ['Result', (t) => t.result ?? autoResult(t) ?? '', 'result'],
  ['Emotion', (t) => t.emotion ?? '', 'emotion'],
  ['Tags', (t) => (t.tags ?? []).join(', '), 'tags', (t) => t.tags ?? []],
  ['Hours held', (t) => hoursHeld(t), 'hours_held'],
  ['Notes', (t) => t.notes ?? '', 'notes'],
]

/** The selected trades as plain objects, for "Copy JSON" on the Trades tab - the same fields as the
 *  spreadsheet export, keyed for code rather than for a column heading.
 *
 *  Derived values (P&L, costs, R:R) are resolved here rather than left to the reader: they are what
 *  the app means by those words, and recomputing them elsewhere from entry/exit/quantity is how two
 *  answers to "what did this trade make" get into circulation. `id` is included so a pasted array
 *  can still be matched back to the journal; the screenshot is not - it isn't data. */
export function tradeJson(trades: Trade[], accounts: TradeAccount[] | null | undefined) {
  const byId = accountsById(accounts)
  return trades.map((t) => {
    const acct = accountFor(t, byId)
    return Object.fromEntries([
      ['id', t.id],
      ...COLUMNS.map(([, value, key, jsonValue]) => [key, (jsonValue ?? value)(t, acct)]),
    ])
  })
}

/** { headers, rows } for xlsxBlob. `trades` is whatever the page is currently showing - filters
 *  and the account picker have already been applied by the caller, so the file matches the screen. */
export function tradeSheet(trades: Trade[], accounts: TradeAccount[] | null | undefined) {
  const byId = accountsById(accounts)
  return {
    sheet: 'Trades',
    headers: COLUMNS.map(([label]) => label),
    rows: trades.map((t) => {
      const acct = accountFor(t, byId)
      return COLUMNS.map(([, value]) => value(t, acct))
    }),
  }
}
