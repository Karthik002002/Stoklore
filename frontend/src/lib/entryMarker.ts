// Which bar a fill landed on, for the entry arrow on a position chart.
// Pure, no React: `node src/lib/entryMarker.selfcheck.mjs`.

const IST_SECONDS = 19800

/** Fill arrows: a buy is green, a sell red, whichever end of the trade it is. */
export const BUY_COLOR = '#22c55e'
export const SELL_COLOR = '#ef4444'

/** The fill time as the chart's clock reads it. The chart endpoint's bars are IST wall-clock
 *  encoded as UTC seconds (scraper pre-shifts them so the UTC-only axis shows market time), so an
 *  instant is shifted the same way before it is compared with them. */
export const chartClock = (iso: string) => Math.floor(new Date(iso).getTime() / 1000) + IST_SECONDS

/** The bar a fill at `iso` belongs to: the last one that STARTED at or before it - a daily bar opens
 *  the session the fill happened in, an intraday bar the minutes it happened in. That holds for both
 *  stamps daily bars come with (00:00 of the day on the chart clock, or IST midnight as a plain
 *  instant, a few hours earlier). Bars keyed by "YYYY-MM-DD" match on the calendar day.
 *  Null when the fill is before the first bar on screen. */
export function barOfFill<T extends { time: number | string }>(bars: T[], iso: string | null | undefined): T | null {
  if (!iso || !bars.length) return null
  if (typeof bars[0].time === 'string') {
    // the IST calendar day of the fill
    const day = new Date(chartClock(iso) * 1000).toISOString().slice(0, 10)
    let hit: T | null = null
    for (const b of bars) if (String(b.time).slice(0, 10) <= day) hit = b
    return hit
  }
  const at = chartClock(iso)
  let hit: T | null = null
  for (const b of bars) {
    if ((b.time as number) <= at) hit = b
    else break
  }
  return hit
}
