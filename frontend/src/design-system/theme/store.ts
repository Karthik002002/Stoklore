import { useSyncExternalStore } from 'react'
import { DEFAULT_STATE, findPreset, resolveTheme, sanitizeState, themeVars } from './resolve'
import type { ResolvedTheme, ThemeState } from './resolve'

const KEY = 'ds.theme'

function load(): ThemeState {
  try {
    return sanitizeState(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return { ...DEFAULT_STATE }
  }
}

let state: ThemeState = typeof window === 'undefined' ? { ...DEFAULT_STATE } : load()
let resolved: ResolvedTheme = resolveTheme(state)
const listeners = new Set<() => void>()

/** Writes the theme onto <html>: CSS variables, the `dark` class and data-theme. */
export function applyTheme(root: HTMLElement = document.documentElement) {
  for (const [k, v] of Object.entries(themeVars(resolved))) root.style.setProperty(k, v)
  root.classList.toggle('dark', resolved.preset.mode === 'dark')
  root.dataset.theme = resolved.preset.id
  root.style.colorScheme = resolved.preset.mode
}

function commit(next: ThemeState) {
  state = sanitizeState(next)
  resolved = resolveTheme(state)
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // private mode / blocked storage: theme still applies for this session
  }
  applyTheme()
  for (const l of listeners) l()
}

export const themeStore = {
  get: () => state,
  resolved: () => resolved,
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  /** Switching preset keeps the user's overrides only if they ask for it - by default a new preset starts clean. */
  setPreset: (presetId: string, keepOverrides = false) =>
    commit({ ...state, presetId, overrides: keepOverrides ? state.overrides : {}, radius: keepOverrides ? state.radius : undefined, density: keepOverrides ? state.density : undefined }),
  /** Flip to the preset's light/dark pair, carrying overrides along. */
  toggleMode: () => {
    const pair = findPreset(state.presetId).pair
    if (pair) commit({ ...state, presetId: pair })
  },
  update: (patch: Partial<ThemeState>) => commit({ ...state, ...patch }),
  setColor: (token: string, value: string | undefined) => {
    const overrides = { ...state.overrides } as Record<string, string>
    if (value === undefined) delete overrides[token]
    else overrides[token] = value
    commit({ ...state, overrides })
  },
  reset: () => commit({ presetId: state.presetId, overrides: {} }),
  /** Replace everything from an untrusted source (an imported JSON file). */
  import: (raw: unknown) => commit(sanitizeState(raw)),
}

export function useTheme() {
  const s = useSyncExternalStore(themeStore.subscribe, themeStore.get, themeStore.get)
  const { get: _get, resolved, subscribe: _sub, ...actions } = themeStore
  return { state: s, resolved: resolved(), ...actions }
}
