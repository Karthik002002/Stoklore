// P&L, return%, and R:R are deliberately never persisted (see db.py's manual_trades table
// comment) - always derived here from the raw entry/exit/stop/target/quantity fields so an edit
// never leaves a stale computed value lying around.

export function tradePnl(t) {
  if (t.exit_price == null) return null
  const diff = t.exit_price - t.entry_price
  return Math.round((t.direction === 'short' ? -diff : diff) * t.quantity * 100) / 100
}

export function tradeReturnPct(t) {
  if (t.exit_price == null || !t.entry_price) return null
  const pct = ((t.exit_price - t.entry_price) / t.entry_price) * 100
  return Math.round((t.direction === 'short' ? -pct : pct) * 100) / 100
}

export function tradeRR(t) {
  if (t.stop_loss == null || t.target == null) return null
  const risk = Math.abs(t.entry_price - t.stop_loss)
  const reward = Math.abs(t.target - t.entry_price)
  if (risk === 0) return null
  return Math.round((reward / risk) * 100) / 100
}

export function autoResult(t) {
  const pnl = tradePnl(t)
  if (pnl == null) return null
  if (pnl > 0) return 'profit'
  if (pnl < 0) return 'loss'
  return 'neutral'
}

export const RESULT_META = {
  profit: { label: 'Profit', badgeVariant: 'success' },
  loss: { label: 'Loss', badgeVariant: 'destructive' },
  neutral: { label: 'Neutral', badgeVariant: 'outline' },
}

export const EMOTIONS = ['Confident', 'Calm', 'Fear', 'Greed', 'FOMO', 'Revenge', 'Impatient', 'Bored']

// --- Risk discipline: planned (ideal_risk_amount, set at entry) vs actual (from stop/qty) ------
// See docs/manual-backtesting-improvement-plan.md - these are the "did I size the trade the way
// I meant to" metrics, distinct from tradeRR's plan-only target:stop ratio above.

export function actualRiskAmount(t) {
  if (t.stop_loss == null) return null
  return Math.round(Math.abs(t.entry_price - t.stop_loss) * t.quantity * 100) / 100
}

export function riskDeviationPct(t) {
  const actual = actualRiskAmount(t)
  if (actual == null || !t.ideal_risk_amount) return null
  return Math.round(((actual - t.ideal_risk_amount) / t.ideal_risk_amount) * 1000) / 10
}

// tolerancePct comes from manual-backtest settings (risk_deviation_tolerance_pct) - not baked in
// here since it's user-configurable, unlike the other pure-derivation functions in this file.
export function riskStatus(t, tolerancePct) {
  const dev = riskDeviationPct(t)
  if (dev == null) return null
  if (dev > tolerancePct) return 'over'
  if (dev < -tolerancePct) return 'under'
  return 'good'
}

export function expectedR(t) {
  const pnl = tradePnl(t)
  if (pnl == null || !t.ideal_risk_amount) return null
  return Math.round((pnl / t.ideal_risk_amount) * 100) / 100
}

// Bucketed for the R-multiple distribution histogram - mirrors the reference app's "3+"/"-3+"
// overflow buckets so a couple of outlier trades don't stretch the whole chart flat.
export function expectedRBucket(t) {
  const r = expectedR(t)
  if (r == null) return null
  const bucket = Math.floor(r)
  if (bucket >= 3) return '3+'
  if (bucket <= -3) return '-3+'
  return String(bucket)
}

// --- Day-of-week / session-of-day breakdown - both pure functions of traded_at, no new columns -

export function dayOfWeek(t) {
  return new Date(t.traded_at).toLocaleDateString('en-US', { weekday: 'long' })
}

// NSE cash-market hours (9:15-15:30 IST), not configurable like the reference app's forex
// sessions - the trading day's shape here is fixed by the exchange, not by broker/timezone.
export const NSE_SESSIONS = [
  { name: 'Opening', startMinutes: 9 * 60 + 15, endMinutes: 9 * 60 + 45 },
  { name: 'Mid-day', startMinutes: 9 * 60 + 45, endMinutes: 14 * 60 + 30 },
  { name: 'Closing', startMinutes: 14 * 60 + 30, endMinutes: 15 * 60 + 30 },
]

export function sessionFor(t) {
  const d = new Date(t.traded_at)
  const minutes = d.getHours() * 60 + d.getMinutes()
  const session = NSE_SESSIONS.find((s) => minutes >= s.startMinutes && minutes < s.endMinutes)
  return session?.name ?? 'After hours'
}

// --- Loss-focused analysis: streaks, stop discipline, revenge-trade heuristic -----------------
// Losing trades diagnose "why" far better than profit metrics, which just reward whatever's
// already working - these all read fields already captured per trade, no new columns needed.

// trades must be chronological (oldest first).
function streaksBy(trades, predicate) {
  let longest = 0
  let running = 0
  trades.forEach((t) => {
    if (predicate(t)) {
      running += 1
      longest = Math.max(longest, running)
    } else {
      running = 0
    }
  })
  let current = 0
  for (let i = trades.length - 1; i >= 0; i--) {
    if (predicate(trades[i])) current += 1
    else break
  }
  return { longest, current }
}

export function lossStreaks(trades) {
  return streaksBy(trades, (t) => tradePnl(t) < 0)
}

export function winStreaks(trades) {
  return streaksBy(trades, (t) => tradePnl(t) > 0)
}

// True if the realized loss ate through more than the stop-loss distance implied - the stop
// wasn't actually honored (slippage, a gap, or a manual override). Null when there's nothing to
// compare against (no stop set, or the trade wasn't a loss).
export function lossExceededStop(t) {
  const pnl = tradePnl(t)
  const risk = actualRiskAmount(t)
  if (pnl == null || pnl >= 0 || risk == null || risk === 0) return null
  return Math.abs(pnl) > risk
}

// Heuristic, not a stored fact: a trade counts as "likely revenge" if tagged with the Revenge
// emotion outright, or if it followed a same-day loss and was sized bigger than planned - the two
// symptoms trading-psychology research on revenge trading calls out (over-sized, off-plan entries
// right after a loss). trades must be chronological; prevTrade is trades[i - 1].
export function isLikelyRevenge(trade, prevTrade, tolerancePct) {
  if (trade.emotion === 'Revenge') return true
  if (!prevTrade) return false
  const prevPnl = tradePnl(prevTrade)
  if (prevPnl == null || prevPnl >= 0) return false
  if (trade.traded_at.slice(0, 10) !== prevTrade.traded_at.slice(0, 10)) return false
  return riskStatus(trade, tolerancePct) === 'over'
}

// --- Profit/edge metrics: is the edge real, or a couple of outliers carrying the average? ------
// See docs brainstorm on SQN/Sortino/profit concentration - all derived from per-trade R
// (expectedR, needs ideal_risk_amount set) or raw closed-trade P&L, no new columns needed.

// Van Tharp's System Quality Number: combines expectancy and consistency into one number -
// sqrt(N) * mean(R) / stdev(R), N capped at 100 so a huge sample doesn't inflate it further.
// rValues: array of per-trade expectedR() values (nulls already filtered out by the caller).
export function systemQualityNumber(rValues) {
  const n = rValues.length
  if (n < 2) return null
  const mean = rValues.reduce((s, r) => s + r, 0) / n
  const variance = rValues.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1)
  const stdev = Math.sqrt(variance)
  if (stdev === 0) return null
  return Math.round(((Math.sqrt(Math.min(n, 100)) * mean) / stdev) * 100) / 100
}

// Van Tharp's classic rating table.
export function sqnRating(sqn) {
  if (sqn == null) return null
  if (sqn < 1.6) return 'Poor'
  if (sqn < 2.0) return 'Below average'
  if (sqn < 2.5) return 'Average'
  if (sqn < 3.0) return 'Good'
  if (sqn < 5.0) return 'Excellent'
  if (sqn < 7.0) return 'Superb'
  return 'Holy grail'
}

// Sortino ratio, applied to per-trade R rather than a time series of % returns (this journal has
// no reliable per-day capital base to compute % returns against) - mean(R) over the standard
// deviation of only the downside (losing) R values, so winners of any size never get penalized.
export function sortinoRatio(rValues) {
  const n = rValues.length
  if (n < 2) return null
  const mean = rValues.reduce((s, r) => s + r, 0) / n
  const downsideVariance = rValues.reduce((s, r) => s + Math.min(r, 0) ** 2, 0) / n
  const downsideDeviation = Math.sqrt(downsideVariance)
  if (downsideDeviation === 0) return null
  return Math.round((mean / downsideDeviation) * 100) / 100
}

export function recoveryFactor(netProfit, maxDrawdown) {
  if (!maxDrawdown) return null
  return Math.round((netProfit / maxDrawdown) * 100) / 100
}

// Underwater curve: drawdown from the running peak at each point of a cumulative P&L series
// (ascending, oldest first) - values are <= 0. Popularized by Jack Schwager as a clearer read on
// "how did I get here" than a flat max-drawdown number (one sharp crash vs a slow bleed).
export function underwaterSeries(cumulativeValues) {
  let peak = 0
  let maxDrawdown = 0
  const series = cumulativeValues.map((v) => {
    peak = Math.max(peak, v)
    const dd = Math.round((v - peak) * 100) / 100
    if (-dd > maxDrawdown) maxDrawdown = -dd
    return dd
  })
  return { series, maxDrawdown: Math.round(maxDrawdown * 100) / 100 }
}
