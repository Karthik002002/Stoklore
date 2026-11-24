// Public surface of the design system. App code imports from '@/design-system' only.
export { Button, buttonVariants } from './components/button'
export type { ButtonProps } from './components/button'
export { Popover, PopoverContent, PopoverTrigger, PopoverHeader, PopoverClose } from './components/popover'
export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from './components/dialog'
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './components/alert-dialog'
export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from './components/tooltip'
export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from './components/dropdown-menu'
export {
  Command,
  CommandDialog,
  CommandInput,
  CommandScopes,
  CommandChips,
  CommandList,
  CommandEmpty,
  CommandLoading,
  CommandGroup,
  CommandItem,
  CommandItemMedia,
  CommandItemText,
  CommandItemMeta,
  CommandShortcut,
  CommandSeparator,
  CommandFooter,
  CommandHint,
} from './components/command'
export { Toaster, toast } from './components/toast'
export {
  Panel,
  PanelHeader,
  PanelTitle,
  PanelBody,
  PanelSection,
  PanelFooter,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
  StatStrip,
  Stat,
  EmptyState,
} from './components/panel'
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  TableSortHead,
} from './components/table'
export { DataTable } from './components/data-table'
export type { DataTableColumns } from './components/data-table'
export { Pagination } from './components/pagination'
export type { PaginationProps } from './components/pagination'
export { Calendar, CalendarDayButton, DatePicker, DateRangePicker } from './components/calendar'
export {
  Change,
  TickPrice,
  Quote,
  RsPill,
  Delivery,
  ResultsBadge,
  SurveillanceBadge,
  Sparkline,
  RangeBar,
  IndexCard,
  TickerStrip,
  WatchlistRow,
  Meter,
} from './components/market'
export { OrderTicket, SideToggle, MarketDepth } from './components/order-ticket'
export type { TicketOrder } from './components/order-ticket'
export { PnlCalendar, Treemap, HeatLegend } from './components/heatmap'
export { readTicket, monthGrid, heat } from './components/marketMath'
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
export { useChartColors, currentChartColors, toRgb, withAlpha } from './theme/chartColors'
export type { ChartColors } from './theme/chartColors'
export { THEMES, COLOR_TOKENS, DEFAULT_THEME_ID } from './tokens/themes'
export type { ThemePreset, ThemeColors, ColorToken, Density } from './tokens/themes'
