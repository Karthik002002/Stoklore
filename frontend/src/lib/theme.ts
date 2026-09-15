import { useEffect, useState, useSyncExternalStore } from 'react'

const watchRootClass = (onChange: () => void) => {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

/** The theme actually applied to the page, for components that need it as a value (a canvas or a
 *  third-party widget with its own light/dark mode). Reads the root `dark` class rather than
 *  calling useTheme: that hook holds its own state, so a second copy would not see the toggle. */
export function useAppliedTheme(): 'light' | 'dark' {
  return useSyncExternalStore(watchRootClass, () =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )
}

const STORAGE_KEY = 'theme'

function getInitial() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState(getInitial)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return { theme, toggle }
}
