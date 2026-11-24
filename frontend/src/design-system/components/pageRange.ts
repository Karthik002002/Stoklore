/** Page buttons to draw for `page` (1-based) of `count`: always the first and last page, `sibling`
 *  pages either side of the current one, and 'gap' where pages are skipped. A gap that would hide
 *  a single page shows that page instead (1 … 3 is worse than 1 2 3). */
export function pageRange(page: number, count: number, sibling = 1): (number | 'gap')[] {
  if (count <= 0) return []
  // short lists: every page fits in the space the gapped form would take anyway
  if (count <= 2 * sibling + 5) return Array.from({ length: count }, (_, i) => i + 1)
  const p = Math.min(Math.max(1, Math.round(page)), count)
  const lo = Math.max(2, p - sibling)
  const hi = Math.min(count - 1, p + sibling)
  const out: (number | 'gap')[] = [1]
  if (lo === 3) out.push(2)
  else if (lo > 3) out.push('gap')
  for (let i = lo; i <= hi; i++) out.push(i)
  if (hi === count - 2) out.push(count - 1)
  else if (hi < count - 2) out.push('gap')
  if (count > 1) out.push(count)
  return out
}

/** "1–25 of 1,842" for a page of `size` rows. */
export function rangeLabel(page: number, size: number, total: number): string {
  if (total <= 0) return '0 of 0'
  const from = (page - 1) * size + 1
  const to = Math.min(page * size, total)
  return `${from.toLocaleString('en-IN')}–${to.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')}`
}
