// The spreadsheet shape of a trade: one fixed column set, shared by the journal's Trades tab and
// the paper trade history so both exports read the same way. Deliberately static - the on-screen
// table hides columns depending on the account, an export that did the same would produce two
// files with the same name and different columns. The screenshot is not exported: it is not data.
import { autoResult, tradePnl, tradeReturnPct, tradeRRDisplay } from '@/lib/manualTrades'
import { accountFor, accountsById, tradeCosts, tradeNetPnl } from '@/lib/tradeCosts'

// Local wall-clock, not the ISO string: these are Indian market timestamps and a UTC 'Z' in a
// spreadsheet turns every 09:15 entry into 03:45 the same day.
const localTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const hoursHeld = (t) => {
  if (!t.exited_at || !t.traded_at) return null
  const h = (new Date(t.exited_at) - new Date(t.traded_at)) / 3_600_000
  return Number.isFinite(h) ? Math.round(h * 100) / 100 : null
}

const COLUMNS = [
  ['Entry time', (t) => localTime(t.traded_at)],
  ['Exit time', (t) => localTime(t.exited_at)],
  ['Symbol', (t) => t.symbol],
  ['Direction', (t) => t.direction],
  ['Status', (t) => (t.exit_price == null ? 'Open' : 'Closed')],
  ['Setup', (t) => t.setup ?? ''],
  ['Account', (t, acct) => acct?.name ?? ''],
  ['Quantity', (t) => t.quantity],
  ['Entry price', (t) => t.entry_price],
  ['Exit price', (t) => t.exit_price],
  ['Stop loss', (t) => t.stop_loss],
  ['Target', (t) => t.target],
  ['Planned risk', (t) => t.ideal_risk_amount],
  ['R:R', (t) => tradeRRDisplay(t)?.rr ?? null],
  ['R:R basis', (t) => (tradeRRDisplay(t) == null ? '' : tradeRRDisplay(t).planned ? 'planned' : 'realised')],
  ['Gross P&L', (t) => tradePnl(t)],
  ['Costs', (t, acct) => tradeCosts(t, acct)?.total ?? null],
  ['Net P&L', (t, acct) => tradeNetPnl(t, acct)],
  ['Return %', (t) => tradeReturnPct(t)],
  ['Result', (t) => t.result ?? autoResult(t) ?? ''],
  ['Emotion', (t) => t.emotion ?? ''],
  ['Tags', (t) => (t.tags ?? []).join(', ')],
  ['Hours held', (t) => hoursHeld(t)],
  ['Notes', (t) => t.notes ?? ''],
]

/** { headers, rows } for xlsxBlob. `trades` is whatever the page is currently showing - filters
 *  and the account picker have already been applied by the caller, so the file matches the screen. */
export function tradeSheet(trades, accounts) {
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
