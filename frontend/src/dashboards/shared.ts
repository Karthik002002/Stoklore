import {
  BellIcon,
  ChartBarIcon,
  ChartLineIcon,
  ChartPieIcon,
  GaugeIcon,
  Grid3x3Icon,
  HeartPulseIcon,
  TableIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type {
  DashboardPanel,
  PanelOptions,
  PanelQuery,
  PanelRequest,
  PanelShape,
  PanelType,
} from '@/services/api'

// What every dashboard file shares, kept out of the component files so fast refresh keeps working.

export const PANEL_META: Record<
  PanelType,
  { label: string; icon: LucideIcon; shape: PanelShape; hint: string }
> = {
  timeseries: {
    label: 'Time series',
    icon: ChartLineIcon,
    shape: 'timeseries',
    hint: 'A value over time, a line per group',
  },
  stat: {
    label: 'Stat',
    icon: GaugeIcon,
    shape: 'stat',
    hint: 'The latest number, how it moved, a sparkline',
  },
  table: { label: 'Table', icon: TableIcon, shape: 'rows', hint: 'The rows themselves' },
  bar: {
    label: 'Bar / top N',
    icon: ChartBarIcon,
    shape: 'aggregate',
    hint: 'A bar per group, largest first',
  },
  pie: { label: 'Pie', icon: ChartPieIcon, shape: 'aggregate', hint: "Each group's share" },
  heatmap: {
    label: 'Heatmap',
    icon: Grid3x3Icon,
    shape: 'heatmap',
    hint: 'A row per group, a column per day',
  },
  health: {
    label: 'Run health',
    icon: HeartPulseIcon,
    shape: 'rows',
    hint: 'A bar per workflow run, red when it failed',
  },
  notifications: {
    label: 'Notifications',
    icon: BellIcon,
    shape: 'rows',
    hint: 'What workflows filed, newest first',
  },
}

/** Panel types that only make sense over one source - picking the type picks the source too. */
export const TYPE_SOURCE: Partial<Record<PanelType, string>> = {
  health: 'workflow_runs',
  notifications: 'workflow_notifications',
}

export const ALL_TIME = 'all'

export const TIME_RANGES = [
  { value: 'now-1h', label: 'Last hour' },
  { value: 'now-6h', label: 'Last 6 hours' },
  { value: 'now-24h', label: 'Last 24 hours' },
  { value: 'now-7d', label: 'Last 7 days' },
  { value: 'now-30d', label: 'Last 30 days' },
  { value: 'now-90d', label: 'Last 90 days' },
  { value: ALL_TIME, label: 'All time' },
]

export const REFRESH_OPTIONS = [
  { value: 0, label: 'Refresh off' },
  { value: 5, label: 'Every 5s' },
  { value: 30, label: 'Every 30s' },
  { value: 60, label: 'Every 1m' },
  { value: 300, label: 'Every 5m' },
]

export const newPanelId = () => crypto.randomUUID().slice(0, 8)

/** Everything a panel needs to fetch: the board's variables, range and refresh. */
export type PanelContext = {
  dashboardId: string
  variables: Record<string, string>
  from: string | null
  to: string | null
  refresh: number
}

/** What a click on a mark means: the group it belongs to, and the time bucket it sits in. */
export type DrillPoint = { group?: string; bucket?: string }

export const withShape = (panel: DashboardPanel): PanelQuery => ({
  ...panel.query,
  shape: PANEL_META[panel.type].shape,
})

export const panelRequest = (panel: DashboardPanel, ctx: PanelContext): PanelRequest => ({
  query: withShape(panel),
  variables: ctx.variables,
  time_from: ctx.from,
  time_to: ctx.to,
})

export const formatValue = (value: number | null | undefined, options?: PanelOptions) => {
  if (value == null || !Number.isFinite(value)) return '—'
  const digits = options?.decimals ?? (Math.abs(value) >= 100 ? 0 : 2)
  const text = new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(value)
  const unit = options?.unit?.trim()
  if (!unit) return text
  if (unit === '₹') return `₹${text}`
  return unit === '%' ? `${text}%` : `${text} ${unit}`
}

/** A panel whose source is missing a required choice can't run yet - say which. */
export const missingParam = (panel: DashboardPanel) =>
  panel.query.source === 'workflow_series' && !panel.query.params?.workflow_id
    ? 'Pick a workflow for this panel'
    : null
