import type { UTCTimestamp } from 'lightweight-charts'

// Colours and time conversion for the app's line charts - a file of its own so the chart component
// file exports only a component, and fast refresh keeps working.

// Ten hand-picked hues that stay apart on both themes, then golden-angle steps for anything past
// them - a 25-symbol watchlist still gets 25 distinguishable lines.
export const PALETTE = [
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#a855f7',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#14b8a6',
]
const hslHex = (h: number, s: number, l: number) => {
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}
export const seriesColor = (i: number) => PALETTE[i] ?? hslHex((i * 137.508) % 360, 0.65, 0.55)
export type Dataset = { key: string; color: string; points: { time: UTCTimestamp; value: number }[] }

/** An ISO timestamp as this chart wants it: seconds, shifted by the local offset, because the axis
 *  labels in UTC - the same shift PriceChart applies for IST bars. */
export const chartTime = (iso: string) => {
  const ms = new Date(iso).getTime()
  return (Math.floor(ms / 1000) - new Date(ms).getTimezoneOffset() * 60) as UTCTimestamp
}
