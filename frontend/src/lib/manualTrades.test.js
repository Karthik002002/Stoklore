// Plain assert-based check, no framework - run with `node manualTrades.test.js`.
import assert from 'node:assert'
import {
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

console.log('ok')
