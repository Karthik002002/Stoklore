/**
 * THE file a fork edits to restyle Stoklore.
 *
 * Every design-system component reads only CSS variables, and every variable comes from a preset
 * below (plus whatever the user overrode in the theme customizer). Add a preset here and it shows
 * up in the theme selector and the Storybook toolbar automatically.
 *
 * Colors are hex so the customizer's native color picker can edit them. Any CSS color works
 * (oklch(), rgb()...) - the picker just can't show a swatch for non-hex values.
 */

/** Tokens a user can change. Others (ring, destructive, success...) derive from these in tokens.css. */
export const COLOR_TOKENS = [
  { group: 'Surfaces', token: 'background', label: 'Page gutter', hint: 'Behind the panels' },
  { group: 'Surfaces', token: 'card', label: 'Panel', hint: 'Panels, cards, tables' },
  { group: 'Surfaces', token: 'panel-head', label: 'Panel header', hint: 'Header strips, inputs, menus' },
  { group: 'Surfaces', token: 'popover', label: 'Overlay', hint: 'Dialogs, popovers, menus' },
  { group: 'Surfaces', token: 'muted', label: 'Subtle fill', hint: 'Hover rows, secondary buttons' },
  { group: 'Text', token: 'foreground', label: 'Text', hint: 'Body text' },
  { group: 'Text', token: 'muted-foreground', label: 'Muted text', hint: 'Labels, captions, headers' },
  { group: 'Lines', token: 'border', label: 'Hairline', hint: 'Panel and row dividers' },
  { group: 'Lines', token: 'input', label: 'Control border', hint: 'Inputs, outline buttons' },
  { group: 'Brand', token: 'primary', label: 'Primary', hint: 'Primary buttons' },
  { group: 'Brand', token: 'primary-foreground', label: 'On primary', hint: 'Text on primary' },
  { group: 'Brand', token: 'accent', label: 'Accent', hint: 'Focus, selection, active tab, links' },
  { group: 'Brand', token: 'accent-foreground', label: 'On accent', hint: 'Text on accent' },
  { group: 'Market', token: 'up', label: 'Up / buy', hint: 'Gains, buy button' },
  { group: 'Market', token: 'up-foreground', label: 'On up', hint: 'Text on buy button' },
  { group: 'Market', token: 'down', label: 'Down / sell', hint: 'Losses, sell button, destructive' },
  { group: 'Market', token: 'down-foreground', label: 'On down', hint: 'Text on sell button' },
  { group: 'Market', token: 'warning', label: 'Warning', hint: 'Limits, surveillance, pending' },
  { group: 'Charts', token: 'chart-1', label: 'Series 1', hint: '' },
  { group: 'Charts', token: 'chart-2', label: 'Series 2', hint: '' },
  { group: 'Charts', token: 'chart-3', label: 'Series 3', hint: '' },
  { group: 'Charts', token: 'chart-4', label: 'Series 4', hint: '' },
  { group: 'Charts', token: 'chart-5', label: 'Series 5', hint: '' },
] as const

export type ColorToken = (typeof COLOR_TOKENS)[number]['token']
export type ThemeColors = Record<ColorToken, string>
export type Density = 'compact' | 'comfortable'

export interface ThemePreset {
  id: string
  label: string
  mode: 'dark' | 'light'
  /** The preset the light/dark switch jumps to. */
  pair?: string
  colors: ThemeColors
  /** Base corner radius in px; every rounded-* derives from it. */
  radius: number
  density: Density
  /** CSS font-family stacks. */
  fontSans: string
  fontMono: string
}

const GEIST = "'Geist Variable', ui-sans-serif, system-ui, sans-serif"
const GEIST_MONO = "'Geist Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace"

export const THEMES: ThemePreset[] = [
  {
    id: 'terminal-dark',
    label: 'Terminal Dark',
    mode: 'dark',
    pair: 'terminal-light',
    radius: 3,
    density: 'compact',
    fontSans: GEIST,
    fontMono: GEIST_MONO,
    colors: {
      background: '#0a0c0f',
      card: '#15181c',
      'panel-head': '#101316',
      popover: '#101316',
      muted: '#1c1f24',
      foreground: '#d5d9de',
      'muted-foreground': '#7d848d',
      border: '#23272c',
      input: '#30353b',
      primary: '#dfe2e6',
      'primary-foreground': '#121417',
      accent: '#5b9cf5',
      'accent-foreground': '#ffffff',
      up: '#2ebd85',
      'up-foreground': '#04140d',
      down: '#ef5350',
      'down-foreground': '#ffffff',
      warning: '#e9b44c',
      'chart-1': '#6ea8f7',
      'chart-2': '#e9b44c',
      'chart-3': '#3fcf9b',
      'chart-4': '#6b7280',
      'chart-5': '#b38cf5',
    },
  },
  {
    id: 'terminal-light',
    label: 'Terminal Light',
    mode: 'light',
    pair: 'terminal-dark',
    radius: 3,
    density: 'compact',
    fontSans: GEIST,
    fontMono: GEIST_MONO,
    colors: {
      background: '#e9ebee',
      card: '#ffffff',
      'panel-head': '#f7f8f9',
      popover: '#ffffff',
      muted: '#f0f1f3',
      foreground: '#262a30',
      'muted-foreground': '#6b727c',
      border: '#dcdfe3',
      input: '#cdd1d6',
      primary: '#262a30',
      'primary-foreground': '#fafafa',
      accent: '#2f6fd6',
      'accent-foreground': '#ffffff',
      up: '#0f9d6e',
      'up-foreground': '#ffffff',
      down: '#d8343f',
      'down-foreground': '#ffffff',
      warning: '#c98a12',
      'chart-1': '#2f6fd6',
      'chart-2': '#c98a12',
      'chart-3': '#0f9d6e',
      'chart-4': '#8a919b',
      'chart-5': '#8b5cf6',
    },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    mode: 'dark',
    radius: 4,
    density: 'compact',
    fontSans: GEIST,
    fontMono: GEIST_MONO,
    colors: {
      background: '#060a12',
      card: '#0d1422',
      'panel-head': '#0a101b',
      popover: '#0a101b',
      muted: '#131c2d',
      foreground: '#d6deeb',
      'muted-foreground': '#7b8ba5',
      border: '#1c2638',
      input: '#2a3650',
      primary: '#d6deeb',
      'primary-foreground': '#0a101b',
      accent: '#7c8cff',
      'accent-foreground': '#ffffff',
      up: '#3ddc97',
      'up-foreground': '#03170e',
      down: '#ff5c7a',
      'down-foreground': '#ffffff',
      warning: '#ffc857',
      'chart-1': '#7c8cff',
      'chart-2': '#ffc857',
      'chart-3': '#3ddc97',
      'chart-4': '#5a6a85',
      'chart-5': '#e07cff',
    },
  },
  {
    id: 'amber',
    label: 'Amber Terminal',
    mode: 'dark',
    radius: 0,
    density: 'compact',
    fontSans: GEIST_MONO,
    fontMono: GEIST_MONO,
    colors: {
      background: '#000000',
      card: '#0b0a08',
      'panel-head': '#060504',
      popover: '#060504',
      muted: '#16130d',
      foreground: '#e8e2d0',
      'muted-foreground': '#8a8068',
      border: '#262116',
      input: '#3a3222',
      primary: '#ffb000',
      'primary-foreground': '#000000',
      accent: '#ffb000',
      'accent-foreground': '#000000',
      up: '#4ade80',
      'up-foreground': '#000000',
      down: '#f87171',
      'down-foreground': '#000000',
      warning: '#ffb000',
      'chart-1': '#ffb000',
      'chart-2': '#4ade80',
      'chart-3': '#60a5fa',
      'chart-4': '#8a8068',
      'chart-5': '#f472b6',
    },
  },
]

export const DEFAULT_THEME_ID = 'terminal-dark'
