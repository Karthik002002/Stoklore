// Plain assert-based check, no framework - run with `node manualTrades.test.js`.
import assert from 'node:assert'
import {
  byLoggedOrder,
  lossStreaks,
  recoveryFactor,
  sortinoRatio,
  systemQualityNumber,
  underwaterSeries,
  winStreaks,
} from './manualTrades.js'

function trade(pnl) {
  // direction long, quantity 1 - exit_price - entry_price === pnl
  return { direction: 'long', quantity: 1, entry_price: 100, exit_price: 100 + pnl }
}

// win, loss, loss, loss, win, loss - longest loss streak 3, current streak (trailing) 1
{
  const trades = [1, -1, -2, -3, 5, -1].map(trade)
  assert.deepEqual(lossStreaks(trades), { longest: 3, current: 1 })
  assert.deepEqual(winStreaks(trades), { longest: 1, current: 0 })
}

// SQN: mean/stdev computed by hand for [1, -1, 2, -1, 3]
{
  const r = [1, -1, 2, -1, 3]
  const mean = r.reduce((s, x) => s + x, 0) / r.length // 0.8
  const variance = r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1)
  const expected = Math.round(((Math.sqrt(r.length) * mean) / Math.sqrt(variance)) * 100) / 100
  assert.equal(systemQualityNumber(r), expected)
  assert.equal(systemQualityNumber([1]), null) // needs at least 2
}

// Sortino: only the two negative values feed the downside deviation
{
  const r = [2, -1, 3, -2]
  const mean = 0.5
  const downsideVariance = (1 + 4) / 4
  const expected = Math.round((mean / Math.sqrt(downsideVariance)) * 100) / 100
  assert.equal(sortinoRatio(r), expected)
  assert.equal(sortinoRatio([1, 2, 3]), null) // no losers -> no downside deviation -> null
}

assert.equal(recoveryFactor(500, 0), null)
assert.equal(recoveryFactor(500, 250), 2)

// Peaks at 10, dips to -5 (drawdown -15), recovers to 8 (still -2 off peak)
{
  const { series, maxDrawdown } = underwaterSeries([0, 10, 5, -5, 8])
  assert.deepEqual(series, [0, 0, -5, -15, -2])
  assert.equal(maxDrawdown, 15)
}

// --- byLoggedOrder + the losing run it feeds ---------------------------------------------------
// The Bar Replay case: three trades taken in one session, but on 2013, 2024 and 2019 bars because
// the replay jumped around. Market-date order says the run ended on a win; logged order - the order
// they were actually taken in - says it is two losses deep and still going.
{
  const at = (created, traded, pnl) => ({ ...trade(pnl), created_at: created, traded_at: traded })
  const session = [
    at('2026-08-23T10:00:00Z', '2013-04-02', 5),
    at('2026-08-23T10:05:00Z', '2024-01-09', -2),
    at('2026-08-23T10:09:00Z', '2019-07-15', -3),
  ]
  const logged = byLoggedOrder(session)
  assert.deepEqual(
    logged.map((t) => t.created_at),
    ['2026-08-23T10:00:00Z', '2026-08-23T10:05:00Z', '2026-08-23T10:09:00Z'],
  )
  assert.equal(lossStreaks(logged).current, 2, 'two losses in a row, in the order they were taken')

  // Shuffled input, same answer - the sort is what decides, not the array it arrived in.
  assert.equal(lossStreaks(byLoggedOrder([session[2], session[0], session[1]])).current, 2)

  // A row written before created_at existed falls back to its trade date instead of sorting as
  // Invalid Date (which compares false against everything and scrambles the run).
  const legacy = [{ ...trade(-1), traded_at: '2020-01-01' }, ...session]
  assert.equal(byLoggedOrder(legacy)[0].traded_at, '2020-01-01')

  // The input is not mutated - callers hold this array from a query cache.
  const before = session.map((t) => t.created_at)
  byLoggedOrder(session)
  assert.deepEqual(
    session.map((t) => t.created_at),
    before,
  )
}

console.log('ok')
