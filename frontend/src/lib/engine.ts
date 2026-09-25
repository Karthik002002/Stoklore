// Pure helpers for the /engine page: sweep input parsing, the sweep grid, drawdown. No React.

/** One param field of the run form: "9", "5,9,13", or "5:20:5" (from:to:step, inclusive), mixed
 *  freely. Deduped, in the order given. null when any piece isn't a number, [] when empty. */
export function parseValues(text: string): number[] | null {
  const out: number[] = []
  for (const piece of text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const parts = piece.split(':').map(Number)
    if (parts.some((n) => !Number.isFinite(n))) return null
    if (parts.length === 1) out.push(parts[0])
    else if (parts.length === 3 && parts[2] > 0 && parts[1] >= parts[0]) {
      // stepping by index, not by repeated addition, so 0.1-steps don't drift past `to`
      for (let i = 0; parts[0] + i * parts[2] <= parts[1] + 1e-9; i++)
        out.push(+(parts[0] + i * parts[2]).toFixed(10))
    } else return null
  }
  return [...new Set(out)]
}

export const comboCount = (lists: number[][]) => lists.reduce((n, l) => n * Math.max(l.length, 1), 1)

/** Runs of a sweep bucketed by two param values (col is optional for a one-param sweep).
 *  With more than two varied params a cell holds several runs; the page shows the best. */
export function sweepGrid<R extends { params: Record<string, number> }>(
  runs: R[],
  rowKey: string,
  colKey?: string,
) {
  const values = (k?: string) => (k ? [...new Set(runs.map((r) => r.params[k]))].sort((a, b) => a - b) : [0])
  const cells = new Map<string, R[]>()
  for (const r of runs) {
    const key = `${r.params[rowKey]}|${colKey ? r.params[colKey] : 0}`
    cells.set(key, [...(cells.get(key) ?? []), r])
  }
  return {
    rows: values(rowKey),
    cols: values(colKey),
    cell: (row: number, col: number) => cells.get(`${row}|${col}`) ?? [],
  }
}

/** Drawdown from the running peak at each point (<= 0), from an equity curve. */
export function drawdown(equity: [number, number][]): [number, number][] {
  let peak = 0
  return equity.map(([t, e]) => ((peak = Math.max(peak, e)), [t, e - peak]))
}

/** Engine times are IST-shifted epoch seconds, so the UTC reading of them is the IST wall clock. */
export const istTime = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ')

// --- executions on the candle chart ---------------------------------------------------------------
// A run's trades, as lightweight-charts markers. Kept here (pure) rather than inside the chart
// effect so the arithmetic that decides where an arrow lands is checkable without a DOM.

/** [symbol, entry time, exit time, signed qty, entry px, exit px, gross pnl] - api.ts EngineTrade. */
export type RunTrade = [string, number, number, number, number, number, number]

export type TradeMarker = {
  time: number
  position: 'aboveBar' | 'belowBar'
  shape: 'arrowUp' | 'arrowDown'
  color: string
  text: string
}

/** A long entry points up from under the bar, a short entry down from above it; each exit is the
 *  mirror of its entry and takes the trade's colour - green if that trade made money, red if not.
 *  So an arrow's direction says what was done, and an exit's colour says how it went. */
export function tradeMarkers(
  trades: RunTrade[],
  symbol: string,
  colors: { up: string; down: string },
  limit = 300,
): TradeMarker[] {
  // The most recent `limit` trades: markers are drawn for every bar in the series, and thousands of
  // them cost more than they inform. The caller says how many were left out.
  const mine = trades.filter((t) => t[0] === symbol).slice(-limit)
  const markers: TradeMarker[] = []
  for (const [, entry, exit, qty, , , pnl] of mine) {
    const long = qty > 0
    const won = pnl >= 0
    markers.push({
      time: entry,
      position: long ? 'belowBar' : 'aboveBar',
      shape: long ? 'arrowUp' : 'arrowDown',
      color: long ? colors.up : colors.down,
      text: `${long ? 'B' : 'S'} ${Math.abs(qty)}`,
    })
    markers.push({
      time: exit,
      position: long ? 'aboveBar' : 'belowBar',
      shape: long ? 'arrowDown' : 'arrowUp',
      color: won ? colors.up : colors.down,
      text: `${pnl >= 0 ? '+' : ''}${Math.round(pnl)}`,
    })
  }
  // Same bar can hold an exit and the next entry; the chart wants them in time order.
  return markers.sort((a, b) => a.time - b.time)
}

/** Where to look when the chart opens: the marked trades, plus a margin so the arrows aren't on the
 *  edge. Null when there is nothing to frame, which means "leave the chart where it is". */
export function markerRange(markers: TradeMarker[], marginRatio = 0.05) {
  if (!markers.length) return null
  const from = markers[0].time
  const to = markers[markers.length - 1].time
  const margin = Math.max(Math.round((to - from) * marginRatio), 60)
  return { from: from - margin, to: to + margin }
}
