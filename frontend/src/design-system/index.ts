// Public surface of the design system. App code imports from '@/design-system' only.
export { Button, buttonVariants } from './components/button'
export type { ButtonProps } from './components/button'
export { Popover, PopoverContent, PopoverTrigger } from './components/popover'
export { Input, Textarea } from './components/input'
export type { InputProps } from './components/input'
export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
} from './components/input-group'
export { Field, FieldLabel, FieldDescription, FieldError, Label } from './components/field'
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './components/select'
export { Checkbox, Switch, RadioGroup, Radio } from './components/choice'
export { Tabs, TabsList, TabsTab, TabsIndicator, TabsPanel, TabsCount } from './components/tabs'
export {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
  buttonGroupVariants,
  ToggleGroup,
  Toggle,
} from './components/button-group'
export { Badge, badgeVariants, Kbd, KbdGroup } from './components/badge'
export type { BadgeProps } from './components/badge'
export {
  Separator,
  Spinner,
  Skeleton,
  Progress,
  Avatar,
  AvatarImage,
  AvatarFallback,
} from './components/display'
export type { ProgressProps } from './components/display'

export { ThemeSelector, ThemeModeToggle } from './theme/ThemeSelector'
export { ThemeCustomizer } from './theme/ThemeCustomizer'
export { useTheme, themeStore, applyTheme } from './theme/store'
export { THEMES, COLOR_TOKENS, DEFAULT_THEME_ID } from './tokens/themes'
export type { ThemePreset, ThemeColors, ColorToken, Density } from './tokens/themes'
