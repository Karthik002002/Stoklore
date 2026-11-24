import { useTheme, themeStore } from './store'
import type { ResolvedTheme } from './resolve'

// Canvas chart libraries (lightweight-charts) parse only hex / rgb() / hsl() and never see CSS
// variables, so they need the theme as concrete colors - and need to be told again when it
// changes. useChartColors() gives both: plain rgb strings, recomputed on every theme change.

let ctx: CanvasRenderingContext2D | null = null
const cache = new Map<string, [number, number, number]>()

/** Any CSS color (hex, oklch(), color-mix()...) -> its sRGB channels, by painting one pixel. */
export function toRgb(color: string): [number, number, number] {
  const hit = cache.get(color)
  if (hit) return hit
  ctx ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!ctx) return [128, 128, 128]
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = '#000'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  const rgb: [number, number, number] = [r, g, b]
  cache.set(color, rgb)
  return rgb
}

/** `color` at `alpha` as an rgba() string a canvas library accepts. */
export const withAlpha = (color: string, alpha: number) => {
  const [r, g, b] = toRgb(color)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const rgb = (color: string) => {
  const [r, g, b] = toRgb(color)
  return `rgb(${r}, ${g}, ${b})`
}

export type ChartColors = {
  mode: 'light' | 'dark'
  up: string
  down: string
  warning: string
  accent: string
  text: string
  mutedText: string
  grid: string
  border: string
  background: string
  /** chart-1 … chart-5, for series. */
  series: string[]
  /** Same color at an alpha - for volume bars, area fills. */
  alpha: (color: string, a: number) => string
}

function build(resolved: ResolvedTheme): ChartColors {
  const c = resolved.colors
  return {
    mode: resolved.preset.mode,
    up: rgb(c.up),
    down: rgb(c.down),
    warning: rgb(c.warning),
    accent: rgb(c.accent),
    text: rgb(c.foreground),
    mutedText: rgb(c['muted-foreground']),
    grid: withAlpha(c['muted-foreground'], 0.15),
    border: rgb(c.border),
    background: rgb(c.card),
    series: [c['chart-1'], c['chart-2'], c['chart-3'], c['chart-4'], c['chart-5']].map(rgb),
    alpha: withAlpha,
  }
}

let last: { resolved: ResolvedTheme; colors: ChartColors } | null = null

/** The current theme's chart colors, outside React (module-level helpers, imperative chart code).
 *  Not reactive by itself - pair it with useChartColors() in an effect's deps to restyle. */
export function currentChartColors(): ChartColors {
  const resolved = themeStore.resolved()
  if (last?.resolved !== resolved) last = { resolved, colors: build(resolved) }
  return last.colors
}

/** The current theme as canvas-safe colors. Put it in a chart effect's deps (or call
 *  chart.applyOptions when it changes) so charts restyle with the theme. */
export function useChartColors(): ChartColors {
  useTheme() // subscribe; the value itself comes from the shared cache
  return currentChartColors()
}
