// macOS-Dock magnification for a strip of segments laid out by flex-grow.
// Pure, no React: `node src/lib/dock.selfcheck.mjs`.

/** How far the swell reaches either side of the pointer, px. */
export const DOCK_SIGMA = 24
/** Width a segment gains at the pointer, px - fixed, so a crowded tail swells as much as a sparse one. */
export const DOCK_PEAK = 30

/**
 * Widths (px, summing to `width`) for segments of rest weight `weights` with the pointer at `x`, plus
 * each one's swell (0..1) and the index of the segment under the pointer.
 *
 * The swell is measured from each segment's centre IN THE MAGNIFIED LAYOUT, found by iterating: widen
 * by the swell, re-fit to the strip, re-measure. Measuring from the rest layout (the first version)
 * put the swell beside the pointer - re-fitting the strip shifts every segment, so on the crowded
 * tail the swollen group landed well left of the cursor and the stock under it stayed a sliver.
 */
export function dockLayout(weights: number[], x: number | null, width: number) {
  const n = weights.length
  const total = weights.reduce((a, b) => a + b, 0) || 1
  const rest = weights.map((w) => (w / total) * width)
  if (x == null || !width || !n) return { widths: weights, swell: weights.map(() => 0), focus: -1 }

  let widths = rest
  let swell: number[] = []
  for (let pass = 0; pass < 6; pass++) {
    let start = 0
    swell = widths.map((w) => {
      const d = (x - (start + w / 2)) / DOCK_SIGMA
      start += w
      return Math.exp(-d * d)
    })
    const extra = swell.map((g) => g * DOCK_PEAK)
    const grown = rest.map((r, i) => r + extra[i])
    const sum = grown.reduce((a, b) => a + b, 0)
    widths = grown.map((w) => (w / sum) * width)
  }

  // the segment actually under the pointer in the final layout
  let start = 0
  let focus = n - 1
  for (let i = 0; i < n; i++) {
    if (x < start + widths[i]) {
      focus = i
      break
    }
    start += widths[i]
  }
  return { widths, swell, focus }
}
