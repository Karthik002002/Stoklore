import { useSyncExternalStore } from 'react'
import { THEMES, themeStore, useTheme as useDesignTheme } from '@/design-system'
// The theme now lives in the design system (presets + user color overrides, see
// src/design-system/theme/store.ts). This file keeps the app's older two-value API so existing
// callers (command palette, charts, workflow canvas) don't change.

const watchRootClass = (onChange: () => void) => {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

/** The mode actually applied to the page, for components that need it as a value (a canvas or a
 *  third-party widget with its own light/dark mode). Reads the root `dark` class. */
export function useAppliedTheme(): 'light' | 'dark' {
  return useSyncExternalStore(watchRootClass, () =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )
}

/** Light/dark as a toggle. Jumps to the current preset's pair; a preset without one switches to
 *  the first preset of the other mode. */
export function useTheme() {
  const { resolved } = useDesignTheme()
  const theme = resolved.preset.mode
  const toggle = () => {
    if (resolved.preset.pair) return themeStore.toggleMode()
    const other = THEMES.find((t) => t.mode !== theme)
    if (other) themeStore.setPreset(other.id)
  }
  return { theme, toggle }
}
