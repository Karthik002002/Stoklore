// The arithmetic behind the home page's sector panel (components/SectorPerformancePanel.tsx).
// Pure, no React: `node src/lib/sectors.selfcheck.mjs`.

type SectorLike = {
  name: string
  mcap_cr: number | null
  mcap_change_cr: number | null
  change_pct: number | null
  advance: number | null
  decline: number | null
}

/** A day's % move as a fill: green up, red down, deeper the bigger the move, saturating at ±4%
 *  (a sector or a stock past that is "a big day" either way). Flat or unknown is a neutral grey. */
export function heatColor(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(pct) || pct === 0) return 'rgba(148, 163, 184, 0.25)'
  const a = (0.18 + 0.72 * Math.min(Math.abs(pct) / 4, 1)).toFixed(2)
  return pct > 0 ? `rgba(34, 197, 94, ${a})` : `rgba(239, 68, 68, ${a})`
}

/** Each bucket's share of the members, in %, summing to 100 (or all zeros for an empty sector). */
export function bucketShares(buckets: number[]): number[] {
  const total = buckets.reduce((s, n) => s + (n || 0), 0)
  return buckets.map((n) => (total ? ((n || 0) / total) * 100 : 0))
}

/** Advancers' share of the members that moved - 0.5 is an even split. Null when nothing moved. */
export function breadth(s: Pick<SectorLike, 'advance' | 'decline'>): number | null {
  const moved = (s.advance ?? 0) + (s.decline ?? 0)
  return moved ? (s.advance ?? 0) / moved : null
}

/** The whole market's day across sectors: how many rose and fell, the total market cap and its
 *  change (so the % is the cap-weighted move, not an average of sector %s), and the extremes. */
export function sectorSummary(sectors: SectorLike[]) {
  const up = sectors.filter((s) => (s.change_pct ?? 0) > 0).length
  const down = sectors.filter((s) => (s.change_pct ?? 0) < 0).length
  const mcap = sectors.reduce((t, s) => t + (s.mcap_cr ?? 0), 0)
  const change = sectors.reduce((t, s) => t + (s.mcap_change_cr ?? 0), 0)
  const prev = mcap - change
  const ranked = sectors.filter((s) => s.change_pct != null).sort((a, b) => b.change_pct! - a.change_pct!)
  return {
    up,
    down,
    flat: sectors.length - up - down,
    mcap,
    change,
    changePct: prev > 0 ? (change / prev) * 100 : null,
    best: ranked[0] ?? null,
    worst: ranked.at(-1) ?? null,
  }
}

/** Rupees crore, short: 5,86,347 Cr -> "5.86L Cr", 8,112 Cr -> "8,112 Cr". */
export function croreShort(v: number | null | undefined): string {
  if (v == null) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e5) return `${(v / 1e5).toFixed(2)}L Cr`
  return `${Math.round(v).toLocaleString('en-IN')} Cr`
}
