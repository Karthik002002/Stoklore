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
