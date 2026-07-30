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
