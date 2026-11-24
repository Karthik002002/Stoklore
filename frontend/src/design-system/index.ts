// Public surface of the design system. App code imports from '@/design-system' only.
export { Button, buttonVariants } from './components/button'
export type { ButtonProps } from './components/button'
export { Popover, PopoverContent, PopoverTrigger } from './components/popover'

export { ThemeSelector, ThemeModeToggle } from './theme/ThemeSelector'
export { ThemeCustomizer } from './theme/ThemeCustomizer'
export { useTheme, themeStore, applyTheme } from './theme/store'
export { THEMES, COLOR_TOKENS, DEFAULT_THEME_ID } from './tokens/themes'
export type { ThemePreset, ThemeColors, ColorToken, Density } from './tokens/themes'
