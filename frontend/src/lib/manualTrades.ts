import type { RiskStatus, Trade, TradeResult } from './types.ts'

/** What every derivation here actually needs. Looser than `Trade` on purpose: Bar Replay and the
 *  paper engine call these with a position they are still building, which has the prices but not
 *  yet an id or a created_at. */
export type TradeLike = Pick<Trade, 'direction' | 'quantity' | 'entry_price'> &
  Partial<Pick<Trade, 'exit_price' | 'stop_loss' | 'target' | 'ideal_risk_amount' | 'emotion'>>

// P&L, return%, and R:R are deliberately never persisted (see db.py's manual_trades table
// comment) - always derived here from the raw entry/exit/stop/target/quantity fields so an edit
// never leaves a stale computed value lying around.

export function tradePnl(t: TradeLike): number | null {
  if (t.exit_price == null) return null
  const diff = t.exit_price - t.entry_price
  return Math.round((t.direction === 'short' ? -diff : diff) * t.quantity * 100) / 100
}

// Narrower than TradeLike: a return percentage is entry, exit and direction - no quantity, which
// is what lets the chart's level labels reuse it for a price that isn't a trade yet.
export function tradeReturnPct(
  t: Pick<Trade, 'direction' | 'entry_price'> & Partial<Pick<Trade, 'exit_price'>>,
): number | null {
  if (t.exit_price == null || !t.entry_price) return null
  const pct = ((t.exit_price - t.entry_price) / t.entry_price) * 100
  return Math.round((t.direction === 'short' ? -pct : pct) * 100) / 100
}

export function tradeRR(t: TradeLike): number | null {
  if (t.stop_loss == null || t.target == null) return null
  const risk = Math.abs(t.entry_price - t.stop_loss)
  const reward = Math.abs(t.target - t.entry_price)
  if (risk === 0) return null
  return Math.round((reward / risk) * 100) / 100
}

/** R:R for the trades table, with the exit standing in for a target that was never set.
 *
 * Most trades in this journal are managed out by hand rather than at a pre-set level, so tradeRR
 * above (plan only) is null for them and the column read as a column of dashes. Falling back to
 * the exit answers the question the column is actually asked: what did this trade return per unit
 * of risk?
 *
 * Two deliberate differences from the planned ratio:
 *  - the fallback is SIGNED against the trade's direction, so a stopped-out long reads -1, not +1.
 *    An absolute value would print a losing trade as a healthy reward.
 *  - `planned: false` comes back with it, so the caller can mark the number as realised. Mixing
 *    "what I aimed for" and "what I got" in one column without saying which is which would make
 *    the whole column unreadable.
 */
export function tradeRRDisplay(t: TradeLike): { rr: number; planned: boolean } | null {
  const planned = tradeRR(t)
  if (planned != null) return { rr: planned, planned: true }
  if (t.stop_loss == null || t.exit_price == null) return null
  const risk = Math.abs(t.entry_price - t.stop_loss)
  if (risk === 0) return null
  const move = t.exit_price - t.entry_price
  const reward = t.direction === 'short' ? -move : move
  return { rr: Math.round((reward / risk) * 100) / 100, planned: false }
}

// A trade that lands within this many rupees of flat is "neutral" rather than a token win/loss -
// scratching out at +₹12 is not a winning trade, and counting it as one flatters the win rate and
// every stat built on it. Exact-zero P&L (the old rule) essentially never happens, so before this
// band nothing was ever classified neutral.
export const NEUTRAL_PNL_BAND = 20

export function autoResult(t: TradeLike, band = NEUTRAL_PNL_BAND): TradeResult | null {
  // The band is in rupees, so the classification is only meaningful with a real quantity. Left
  // ungated, a missing one silently produces a flat trade rather than an unknown one: `undefined`
  // multiplies to NaN (which fails both comparisons below and fell through to 'neutral'), while
  // `null` and `''` both coerce to 0 and land dead-centre in the band. Unknown means unknown.
  if (!(Number(t.quantity) > 0)) return null
  const pnl = tradePnl(t)
  if (pnl == null || !Number.isFinite(pnl)) return null
  if (pnl > band) return 'profit'
  if (pnl < -band) return 'loss'
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

export function actualRiskAmount(t: TradeLike): number | null {
  if (t.stop_loss == null) return null
  return Math.round(Math.abs(t.entry_price - t.stop_loss) * t.quantity * 100) / 100
}

export function riskDeviationPct(t: TradeLike): number | null {
  const actual = actualRiskAmount(t)
  if (actual == null || !t.ideal_risk_amount) return null
  return Math.round(((actual - t.ideal_risk_amount) / t.ideal_risk_amount) * 1000) / 10
}

// tolerancePct comes from manual-backtest settings (risk_deviation_tolerance_pct) - not baked in
// here since it's user-configurable, unlike the other pure-derivation functions in this file.
export function riskStatus(t: TradeLike, tolerancePct: number): RiskStatus | null {
  const dev = riskDeviationPct(t)
  if (dev == null) return null
  if (dev > tolerancePct) return 'over'
  if (dev < -tolerancePct) return 'under'
  return 'good'
}

export function expectedR(t: TradeLike): number | null {
  const pnl = tradePnl(t)
  if (pnl == null || !t.ideal_risk_amount) return null
  return Math.round((pnl / t.ideal_risk_amount) * 100) / 100
}

// Bucketed for the R-multiple distribution histogram - mirrors the reference app's "3+"/"-3+"
// overflow buckets so a couple of outlier trades don't stretch the whole chart flat.
export function expectedRBucket(t: TradeLike): string | null {
  const r = expectedR(t)
  if (r == null) return null
  const bucket = Math.floor(r)
  if (bucket >= 3) return '3+'
  if (bucket <= -3) return '-3+'
  return String(bucket)
}

// --- Day-of-week / session-of-day breakdown - both pure functions of traded_at, no new columns -

export function dayOfWeek(t: Pick<Trade, 'traded_at'>) {
  return new Date(t.traded_at).toLocaleDateString('en-US', { weekday: 'long' })
}

// NSE cash-market hours (9:15-15:30 IST), not configurable like the reference app's forex
// sessions - the trading day's shape here is fixed by the exchange, not by broker/timezone.
export const NSE_SESSIONS = [
  { name: 'Opening', startMinutes: 9 * 60 + 15, endMinutes: 9 * 60 + 45 },
  { name: 'Mid-day', startMinutes: 9 * 60 + 45, endMinutes: 14 * 60 + 30 },
  { name: 'Closing', startMinutes: 14 * 60 + 30, endMinutes: 15 * 60 + 30 },
]

export function sessionFor(t: Pick<Trade, 'traded_at'>) {
  const d = new Date(t.traded_at)
  const minutes = d.getHours() * 60 + d.getMinutes()
  const session = NSE_SESSIONS.find((s) => minutes >= s.startMinutes && minutes < s.endMinutes)
  return session?.name ?? 'After hours'
}

// --- Loss-focused analysis: streaks, stop discipline, revenge-trade heuristic -----------------
// Losing trades diagnose "why" far better than profit metrics, which just reward whatever's
// already working - these all read fields already captured per trade, no new columns needed.

/** Oldest LOGGED first (created_at), which is NOT tradeStats' chronological() - that one orders by
 *  traded_at, the market date.
 *
 *  Both are right, for different questions. An equity curve belongs on market dates. Anything about
 *  *your own* sequence - "am I on a losing run right now", "the first 40 trades were while I was
 *  still learning" - belongs on the order you actually took them in, and the two diverge hard in
 *  Bar Replay: a session jumping to random bars produces trades whose market dates are shuffled
 *  relative to the order they were taken. created_at is the same axis the trades table sorts on.
 */
// created_at is optional here, not on Trade: the fallback to traded_at exists precisely because
// some callers (and the test) work with rows that predate it.
export const byLoggedOrder = <T extends Pick<Trade, 'traded_at'> & Partial<Pick<Trade, 'created_at'>>>(
  trades: T[],
): T[] =>
  [...trades].sort(
    (a, b) =>
      new Date(a.created_at ?? a.traded_at).getTime() - new Date(b.created_at ?? b.traded_at).getTime(),
  )

// trades must be chronological (oldest first).
function streaksBy<T>(trades: T[], predicate: (t: T) => boolean) {
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

export function lossStreaks(trades: TradeLike[]) {
  return streaksBy(trades, (t) => (tradePnl(t) ?? 0) < 0)
}

export function winStreaks(trades: TradeLike[]) {
  return streaksBy(trades, (t) => (tradePnl(t) ?? 0) > 0)
}

// True if the realized loss ate through more than the stop-loss distance implied - the stop
// wasn't actually honored (slippage, a gap, or a manual override). Null when there's nothing to
// compare against (no stop set, or the trade wasn't a loss).
export function lossExceededStop(t: TradeLike): boolean | null {
  const pnl = tradePnl(t)
  const risk = actualRiskAmount(t)
  if (pnl == null || pnl >= 0 || risk == null || risk === 0) return null
  return Math.abs(pnl) > risk
}

// Heuristic, not a stored fact: a trade counts as "likely revenge" if tagged with the Revenge
// emotion outright, or if it followed a same-day loss and was sized bigger than planned - the two
// symptoms trading-psychology research on revenge trading calls out (over-sized, off-plan entries
// right after a loss). trades must be chronological; prevTrade is trades[i - 1].
export function isLikelyRevenge(
  trade: TradeLike & Pick<Trade, 'traded_at'>,
  prevTrade: (TradeLike & Pick<Trade, 'traded_at'>) | null | undefined,
  tolerancePct: number,
) {
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
export function systemQualityNumber(rValues: number[]): number | null {
  const n = rValues.length
  if (n < 2) return null
  const mean = rValues.reduce((s, r) => s + r, 0) / n
  const variance = rValues.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1)
  const stdev = Math.sqrt(variance)
  if (stdev === 0) return null
  return Math.round(((Math.sqrt(Math.min(n, 100)) * mean) / stdev) * 100) / 100
}

// Van Tharp's classic rating table.
export function sqnRating(sqn: number | null): string | null {
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
export function sortinoRatio(rValues: number[]): number | null {
  const n = rValues.length
  if (n < 2) return null
  const mean = rValues.reduce((s, r) => s + r, 0) / n
  const downsideVariance = rValues.reduce((s, r) => s + Math.min(r, 0) ** 2, 0) / n
  const downsideDeviation = Math.sqrt(downsideVariance)
  if (downsideDeviation === 0) return null
  return Math.round((mean / downsideDeviation) * 100) / 100
}

export function recoveryFactor(netProfit: number, maxDrawdown: number): number | null {
  if (!maxDrawdown) return null
  return Math.round((netProfit / maxDrawdown) * 100) / 100
}

// Underwater curve: drawdown from the running peak at each point of a cumulative P&L series
// (ascending, oldest first) - values are <= 0. Popularized by Jack Schwager as a clearer read on
// "how did I get here" than a flat max-drawdown number (one sharp crash vs a slow bleed).
export function underwaterSeries(cumulativeValues: number[]) {
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
