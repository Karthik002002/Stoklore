// Reading screener.in's table cells, which arrive as display strings rather than numbers ("74.90%",
// "1,02,345", "-2,145", "₹ 590", "—"): one screener table mixes ₹ Cr, % and per-share units across
// its rows, so the source formatting is what carries the meaning and nothing here reformats it.
//
// Pure, no React: `node frontend/src/lib/screenerTable.selfcheck.mjs`.

/** The number inside a screener cell, or null when the cell is a placeholder rather than a value.
 *  The em dash matters: stripping non-digits from "—" leaves "", which Number() happily calls 0 -
 *  and a missing quarter read as zero invents a 75-point collapse in the holding. */
export function cellNumber(value) {
  const digits = String(value ?? '').replace(/[^0-9.-]/g, '')
  const n = Number(digits)
  return /\d/.test(digits) && Number.isFinite(n) ? n : null
}

/** Change from the previous quarter's cell, in the unit the cell is already printed in - or null
 *  when either quarter is missing, or when the move is below what that unit can show. */
export function cellChange(current, previous) {
  const [now, before] = [cellNumber(current), cellNumber(previous)]
  if (now == null || before == null) return null
  const delta = now - before
  const isPct = String(current).includes('%')
  // Screener prints two decimals for percentages and whole numbers for shareholder counts; below
  // a rounding step there is nothing to report.
  if (Math.abs(delta) < (isPct ? 0.005 : 0.5)) return null
  const size = isPct ? `${Math.abs(delta).toFixed(2)}%` : Math.round(Math.abs(delta)).toLocaleString('en-IN')
  return { text: `${delta > 0 ? '+' : '−'}${size}`, up: delta > 0 }
}
