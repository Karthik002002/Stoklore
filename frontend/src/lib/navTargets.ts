import type { LinkProps } from '@tanstack/react-router'
import {
  BellIcon,
  BotIcon,
  CandlestickChartIcon,
  ChartNoAxesCombinedIcon,
  FlaskConicalIcon,
  LayoutDashboardIcon,
  LayoutGridIcon,
  NewspaperIcon,
  SettingsIcon,
  TrendingUpIcon,
  UsersIcon,
  WalletIcon,
  WorkflowIcon,
  ZapIcon,
} from 'lucide-react'

// Every top-level route in router.jsx that can be reached without a parameter. The ones that
// can't (/stock/:exchange/:symbol, /paper/:symbol, /paper/trade/:id, /live/:symbol,
// /backtest/auto/:scriptId) are reached
// from their own pages, or here by typing @SYMBOL.
export const PAGES: { icon: typeof LayoutDashboardIcon; label: string; to: LinkProps['to'] }[] = [
  { icon: LayoutDashboardIcon, label: 'Stocks', to: '/' },
  { icon: SettingsIcon, label: 'Settings', to: '/settings' },
  { icon: NewspaperIcon, label: 'Events', to: '/events' },
  { icon: TrendingUpIcon, label: 'Top news', to: '/top-news' },
  { icon: WalletIcon, label: 'Holdings', to: '/holdings' },
  { icon: UsersIcon, label: 'Shareholding', to: '/shareholding' },
  { icon: FlaskConicalIcon, label: 'Backtesting', to: '/backtesting' },
  { icon: CandlestickChartIcon, label: 'Paper Trading', to: '/paper' },
  { icon: ZapIcon, label: 'Live Trading', to: '/live' },
  { icon: ChartNoAxesCombinedIcon, label: 'Trade Simulation', to: '/simulation' },
  { icon: BellIcon, label: 'Alerts', to: '/alerts' },
  { icon: BotIcon, label: 'Agent', to: '/agent' },
  { icon: WorkflowIcon, label: 'Workflows', to: '/workflows' },
  { icon: LayoutGridIcon, label: 'Dashboards', to: '/dashboards' },
]

// Matches ManualBacktesting's real `view` tabs (router.jsx's backtestingRoute) - the old 'tab'
// param here pointed at the disabled Auto/Manual switcher and did nothing.
export const BACKTEST_TABS = [
  { label: 'Backtesting > Overview', view: 'overview' },
  { label: 'Backtesting > Trades', view: 'trades' },
  { label: 'Backtesting > Statistics', view: 'statistics' },
  { label: 'Backtesting > Goals', view: 'goals' },
  { label: 'Backtesting > Reviews', view: 'reviews' },
]

export const WORKFLOW_PAGES: { label: string; to: LinkProps['to'] }[] = [
  { label: 'Workflows > New workflow', to: '/workflows/new' },
]

export const HOME_TABS = [
  { label: 'Home > Stocks', tab: 'home' },
  { label: 'Home > My board', tab: 'board' },
]

export const PAPER_TABS = [
  { label: 'Paper Trading > Overview', view: 'overview' },
  { label: 'Paper Trading > Holdings', view: 'holdings' },
  { label: 'Paper Trading > Trades', view: 'trades' },
]

export const SIMULATION_MODES = [
  { label: 'Trade Simulation > Single account', mode: 'single' },
  { label: 'Trade Simulation > Multiple accounts', mode: 'multiple' },
]

// Mirrors Settings.jsx's TabsTab list exactly.
export const SETTINGS_TABS = [
  { label: 'Settings > Model', tab: 'model' },
  { label: 'Settings > LiteLLM', tab: 'litellm' },
  { label: 'Settings > OmniRoute', tab: 'omniroute' },
  { label: 'Settings > Cogencis', tab: 'cogencis' },
  { label: 'Settings > Telegram', tab: 'telegram' },
  { label: 'Settings > Screener', tab: 'screener' },
  { label: 'Settings > Classifier', tab: 'classifier' },
  { label: 'Settings > Broker', tab: 'broker' },
  { label: 'Settings > Watch rules', tab: 'rules' },
  { label: 'Settings > Collect data', tab: 'data' },
  { label: 'Settings > Manage stocks', tab: 'stocks' },
  { label: 'Settings > Activity', tab: 'activity' },
  { label: 'Settings > Shortcuts', tab: 'shortcuts' },
  { label: 'Settings > Backtesting', tab: 'backtesting' },
  { label: 'Settings > Trade accounts', tab: 'accounts' },
  { label: 'Settings > Paper accounts', tab: 'paper-accounts' },
]

// KEEP THIS FILE IN SYNC. It is the app's own index of itself: a new route, page tab or
// settings tab that isn't listed above simply cannot be found here, and the palette is where
// people look first. Adding or renaming one of those is not done until this file lists it.

// --- One flat list of everywhere you can go -----------------------------------------------------

/** A destination, as both the command palette and voice capture use it. */
export type NavTarget = { label: string; to: LinkProps['to']; search?: Record<string, unknown> }

/** Every table above, flattened. Voice matches a spoken phrase against these labels
 *  (lib/voiceCommands.ts); the palette renders them grouped, with icons. */
export const NAV_TARGETS: NavTarget[] = [
  ...PAGES.map((p) => ({ label: p.label, to: p.to })),
  { label: 'Bar Replay', to: '/backtest/replay' as LinkProps['to'] },
  ...BACKTEST_TABS.map((t) => ({
    label: t.label,
    to: '/backtesting' as LinkProps['to'],
    search: { view: t.view },
  })),
  ...WORKFLOW_PAGES.map((t) => ({ label: t.label, to: t.to })),
  ...HOME_TABS.map((t) => ({ label: t.label, to: '/' as LinkProps['to'], search: { tab: t.tab } })),
  ...PAPER_TABS.map((t) => ({ label: t.label, to: '/paper' as LinkProps['to'], search: { view: t.view } })),
  ...SIMULATION_MODES.map((m) => ({
    label: m.label,
    to: '/simulation' as LinkProps['to'],
    search: { mode: m.mode },
  })),
  ...SETTINGS_TABS.map((t) => ({
    label: t.label,
    to: '/settings' as LinkProps['to'],
    search: { tab: t.tab },
  })),
]
