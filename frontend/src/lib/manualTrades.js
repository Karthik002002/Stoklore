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
