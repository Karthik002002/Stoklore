// Click-to-sort for the home page's tables. Pure, no React: `node src/lib/sortRows.selfcheck.mjs`.

export type SortDir = 'asc' | 'desc'
export type Sort = { key: string; dir: SortDir } | null
export type SortValue = number | string | null | undefined

/** Rows ordered by one column. Missing values (null / undefined / NaN / '') always go last, whichever
 *  way the column is sorted - a dash at the top of "highest first" reads as the highest. Strings
 *  compare case-insensitively and number-aware ("NIFTY 50" before "NIFTY 100"). Stable: equal
 *  values keep their original order. `sort` null = the rows as given. */
export function sortRows<T>(rows: T[], sort: Sort, get: Record<string, (row: T) => SortValue>): T[] {
  const pick = sort && get[sort.key]
  if (!sort || !pick) return rows
  const missing = (v: SortValue) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v))
  const sign = sort.dir === 'asc' ? 1 : -1
  return rows
    .map((row, i) => ({ row, i, v: pick(row) }))
    .sort((a, b) => {
      const ma = missing(a.v)
      const mb = missing(b.v)
      if (ma || mb) return ma === mb ? a.i - b.i : ma ? 1 : -1
      const c =
        typeof a.v === 'number' && typeof b.v === 'number'
          ? a.v - b.v
          : String(a.v).localeCompare(String(b.v), undefined, { numeric: true, sensitivity: 'base' })
      return c * sign || a.i - b.i
    })
    .map((x) => x.row)
}

/** The next state after clicking a column header: a new column starts at `first` (highest first for
 *  numbers, A-Z for names), a second click flips it, a third goes back to the table's own order. */
export function nextSort(current: Sort, key: string, first: SortDir): Sort {
  if (current?.key !== key) return { key, dir: first }
  if (current.dir === first) return { key, dir: first === 'asc' ? 'desc' : 'asc' }
  return null
}
