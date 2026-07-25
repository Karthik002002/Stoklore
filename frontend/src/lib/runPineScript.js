import { PineTS } from 'pinets'
import { getPriceHistory } from '@/services/api'

function toCandles(rows) {
  return rows.map((r) => ({
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
    openTime: new Date(r.date).getTime(),
  }))
}

// Runs a Pine Script string against already-fetched OHLCV rows (client-side, via PineTS - no
// backend execution). Strategy scripts (strategy.entry/close) come back in the same
// {trades, summary} shape backtest.run_ema_crossover uses, so the existing TradesTable/
// ReturnBadge components work unmodified. Indicator-only scripts (just plot()) come back as
// {plots} instead - there's no strategy/trades to show.
export async function runPineScriptOnRows(script, rows) {
  if (rows.length === 0) {
    throw new Error('No price history available to run against.')
  }
  const candles = toCandles(rows)
  const lastCandle = candles[candles.length - 1]

  const pineTS = new PineTS(candles)
  const { strategy, plots } = await pineTS.run(script)

  if (!strategy) {
    return { plots: Object.fromEntries(Object.entries(plots ?? {}).map(([name, p]) => [name, p.data])) }
  }

  const trades = [...strategy.closedtrades, ...strategy.opentrades].map((t) => {
    const exitPrice = t.exit_price ?? lastCandle.close
    const pct = ((exitPrice - t.entry_price) / t.entry_price) * 100 * (t.size < 0 ? -1 : 1)
    return {
      entry_date: new Date(t.entry_time).toISOString().slice(0, 10),
      exit_date: new Date(t.exit_time ?? lastCandle.openTime).toISOString().slice(0, 10),
      entry_price: Math.round(t.entry_price * 100) / 100,
      exit_price: Math.round(exitPrice * 100) / 100,
      return_pct: Math.round(pct * 100) / 100,
      open: t.status === 'open',
    }
  })

  const wins = trades.filter((t) => t.return_pct > 0)
  return {
    trades,
    summary: {
      total_return_pct: Math.round((strategy.netprofit / strategy.initial_capital) * 10000) / 100,
      win_rate: trades.length ? Math.round((wins.length / trades.length) * 1000) / 10 : 0,
      num_trades: trades.length,
    },
  }
}

// Quick-preview variant (Add-script modal) - fetches the default 1y price_history window itself
// rather than requiring the caller to have collected full max history first.
export async function runPineScript(script, symbol, days = 365) {
  const rows = await getPriceHistory(symbol, days)
  if (rows.length === 0) {
    throw new Error(`No synced price history for '${symbol}' yet - run a price sync first`)
  }
  return runPineScriptOnRows(script, rows)
}

export const DEFAULT_PINE_SCRIPT = `//@version=5
strategy("EMA Cross", overlay=true)

fastLen = input.int(20, "Fast EMA")
slowLen = input.int(50, "Slow EMA")

fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)

if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)

if ta.crossunder(fast, slow)
    strategy.close("Long")

plot(fast, "Fast EMA", color.blue)
plot(slow, "Slow EMA", color.red)
`
