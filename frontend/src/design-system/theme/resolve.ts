/** Pure theme logic - no DOM, so the self-check runs under plain node. */
import { COLOR_TOKENS, DEFAULT_THEME_ID, THEMES } from '../tokens/themes.ts'
import type { ColorToken, Density, ThemeColors, ThemePreset } from '../tokens/themes.ts'

/** What gets saved: a preset plus the user's own tweaks on top of it. */
export interface ThemeState {
  presetId: string
  overrides: Partial<ThemeColors>
  radius?: number
  density?: Density
}

export const DEFAULT_STATE: ThemeState = { presetId: DEFAULT_THEME_ID, overrides: {} }

const TOKENS = new Set<string>(COLOR_TOKENS.map((t) => t.token))
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
// Functional colors only; no ; { } so a pasted value can't smuggle extra CSS.
const FN = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^;{}()]*\)$/i

export const isColor = (v: unknown): v is string =>
  typeof v === 'string' && (HEX.test(v.trim()) || FN.test(v.trim()))

export const findPreset = (id: string): ThemePreset => THEMES.find((t) => t.id === id) ?? THEMES[0]

/** Untrusted input (localStorage, an imported file) -> a valid state. Unknown keys and bad colors drop out. */
export function sanitizeState(raw: unknown): ThemeState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATE }
  const r = raw as Record<string, unknown>
  const presetId =
    typeof r.presetId === 'string' && THEMES.some((t) => t.id === r.presetId) ? r.presetId : DEFAULT_THEME_ID
  const overrides: Partial<ThemeColors> = {}
  if (r.overrides && typeof r.overrides === 'object') {
    for (const [k, v] of Object.entries(r.overrides))
      if (TOKENS.has(k) && isColor(v)) overrides[k as ColorToken] = v.trim()
  }
  const state: ThemeState = { presetId, overrides }
  if (typeof r.radius === 'number' && Number.isFinite(r.radius))
    state.radius = Math.min(16, Math.max(0, r.radius))
  if (r.density === 'compact' || r.density === 'comfortable') state.density = r.density
  return state
}

export interface ResolvedTheme {
  preset: ThemePreset
  colors: ThemeColors
  radius: number
  density: Density
}

export function resolveTheme(state: ThemeState): ResolvedTheme {
  const preset = findPreset(state.presetId)
  return {
    preset,
    colors: { ...preset.colors, ...state.overrides },
    radius: state.radius ?? preset.radius,
    density: state.density ?? preset.density,
  }
}

const DENSITY = { compact: { control: 26, row: 26 }, comfortable: { control: 32, row: 34 } }

/** Every CSS variable the theme sets on :root. */
export function themeVars(t: ResolvedTheme): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [k, v] of Object.entries(t.colors)) vars[`--${k}`] = v
  vars['--radius'] = `${t.radius}px`
  vars['--control-h'] = `${DENSITY[t.density].control}px`
  vars['--row-h'] = `${DENSITY[t.density].row}px`
  vars['--ds-font-sans'] = t.preset.fontSans
  vars['--ds-font-mono'] = t.preset.fontMono
  return vars
}

/** The current look as a preset object, ready to paste into THEMES in themes.ts. */
export function toPreset(t: ResolvedTheme, id = 'my-theme', label = 'My Theme'): ThemePreset {
  return { ...t.preset, id, label, pair: undefined, colors: t.colors, radius: t.radius, density: t.density }
}
