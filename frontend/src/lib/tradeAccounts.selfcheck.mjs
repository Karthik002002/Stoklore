// Self-check for the trade-account helpers: wallet balance, position caps, account-return%.
// Plain node, no test framework:
//   node src/lib/tradeAccounts.selfcheck.mjs
import assert from 'node:assert/strict'
import {
  accountBalance,
  accountReturnPct,
  capWarnings,
  isPaperTrade,
  journalTrades,
  positionSizeCap,
  tradesForAccount,
} from './tradeAccounts.js'

const account = {
  id: 1,
  name: 'Swing',
  opening_balance: 100000,
  max_position_size: 20000,
  max_position_size_type: 'currency',
  max_position_count: 2,
}

const trade = (over) => ({
  id: 1,
  account_id: 1,
  direction: 'long',
  quantity: 10,
  entry_price: 100,
  exit_price: 110,
  is_open: false,
  account_balance_at_trade: 100000,
  ...over,
})

// --- scoping ------------------------------------------------------------------------------------
const trades = [trade({ id: 1 }), trade({ id: 2, account_id: 2 }), trade({ id: 3, account_id: null })]
assert.deepEqual(
  tradesForAccount(trades, 1).map((t) => t.id),
  [1],
)
assert.equal(tradesForAccount(trades, undefined).length, 3, 'no account selected = every trade')
assert.equal(tradesForAccount(null, 1).length, 0, 'no trades loaded yet, no crash')

// --- balance ------------------------------------------------------------------------------------
// opening 100000 + one +100 winner, then a 5000 deposit and a 2000 withdrawal.
assert.equal(accountBalance(account, [trade({})], []), 100100)
assert.equal(
  accountBalance(
    account,
    [trade({})],
    [
      { type: 'add', amount: 5000 },
      { type: 'subtract', amount: 2000 },
    ],
  ),
  103100,
)
assert.equal(accountBalance(account, [trade({ exit_price: null })], []), 100000, 'open trade adds no P&L')
assert.equal(accountBalance(null, [], []), null)

// --- position size cap --------------------------------------------------------------------------
assert.equal(positionSizeCap(account, 100000), 20000, 'currency cap ignores the balance')
assert.equal(
  positionSizeCap({ ...account, max_position_size_type: 'percentage', max_position_size: 5 }, 100000),
  5000,
)
assert.equal(
  positionSizeCap({ ...account, max_position_size_type: 'percentage' }, null),
  null,
  'a % cap needs a balance to be a percentage of',
)
assert.equal(positionSizeCap({ ...account, max_position_size: null }, 100000), null, 'no cap set')

// --- warnings -----------------------------------------------------------------------------------
assert.deepEqual(
  capWarnings(null, { positionValue: 999999, openCount: 99, balance: 1 }),
  [],
  'no account, no rules',
)
assert.equal(
  capWarnings(account, { positionValue: 15000, openCount: 1, balance: 100000 }).length,
  0,
  'inside both caps',
)
assert.equal(
  capWarnings(account, { positionValue: 25000, openCount: 0, balance: 100000 }).length,
  1,
  'over size',
)
// At the count limit, not past it - taking one more would breach it, so it warns.
assert.equal(capWarnings(account, { positionValue: 100, openCount: 2, balance: 100000 }).length, 1)
assert.equal(capWarnings(account, { positionValue: 25000, openCount: 5, balance: 100000 }).length, 2, 'both')

// --- account return % ---------------------------------------------------------------------------
// +100 P&L on a 100000 wallet = 0.1%.
assert.equal(accountReturnPct(trade({})), 0.1)
assert.equal(accountReturnPct(trade({ direction: 'short' })), -0.1, 'shorts flip the sign')
assert.equal(accountReturnPct(trade({ exit_price: null })), null, 'still open')
assert.equal(accountReturnPct(trade({ account_balance_at_trade: null })), null, 'logged without an account')

// --- the journal's "All accounts" set ------------------------------------------------------------
// Paper trading writes its closes into manual_trades too, so "no account selected" on the journal
// page must NOT mean "every row in the table" - that pooled the paper book into the journal's P&L,
// win rate and equity curve, with no way to deselect it (the picker only lists journal accounts).
const journalAccounts = [{ id: 2 }, { id: 6 }]
const book = [
  { id: 1, account_id: 2, tags: [] }, // journal account
  { id: 2, account_id: 6, tags: ['replay'] }, // replay trades ARE journal trades
  { id: 3, account_id: null, tags: [] }, // unassigned - still the journal's
  { id: 4, account_id: 3, tags: ['paper'] }, // paper account
  { id: 5, account_id: null, tags: ['paper'] }, // paper account since deleted (FK set null)
]
assert.deepEqual(
  journalTrades(book, journalAccounts).map((t) => t.id),
  [1, 2, 3],
  'journal + unassigned only',
)
assert.equal(isPaperTrade(book[3]), true)
assert.equal(isPaperTrade(book[0]), false)
assert.equal(isPaperTrade({}), false, 'a trade with no tags array is not a paper trade')
// A paper trade filed under a paper account is excluded by id even if the tag is missing.
assert.deepEqual(journalTrades([{ id: 9, account_id: 3, tags: [] }], journalAccounts), [])
// No accounts loaded yet (first render): only unassigned rows pass, never someone else's book.
assert.deepEqual(
  journalTrades(book, []).map((t) => t.id),
  [3],
)
assert.deepEqual(journalTrades(null, journalAccounts), [])

console.log('all checks passed')
