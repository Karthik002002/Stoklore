import type { PanelShape } from '@/services/api'

// Does this data have the shape a panel type draws?
//
// Panels keep the previous data on screen while a new query runs (keepPreviousData), which is what
// makes editing a panel feel instant. Change a panel's TYPE, though, and the shape changes with it:
// a heatmap was handed the table's `{rows, columns, total}` and read `cells.length` off undefined,
// which threw and took the whole dashboard down with it. One check, before anything draws.
const SHAPED: Record<PanelShape, (data: Record<string, unknown>) => boolean> = {
  rows: (d) => Array.isArray(d.rows),
  timeseries: (d) => Array.isArray(d.series),
  // Both aggregate and treemap carry `items`, with different items inside - the second field is what
  // tells them apart, so bar → treemap doesn't draw one from the other's rows.
  aggregate: (d) => Array.isArray(d.items) && 'total' in d,
  stat: (d) => 'spark' in d,
  heatmap: (d) => Array.isArray(d.cells),
  treemap: (d) => Array.isArray(d.items) && 'color_max' in d,
}

export const matchesShape = (shape: PanelShape, data: unknown) =>
  !!data && typeof data === 'object' && SHAPED[shape](data as Record<string, unknown>)
