import { Fragment, useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'
import { useCommandState } from 'cmdk'
import { toast } from 'sonner'
import {
  IconArrowUpRight,
  IconArrowsSort,
  IconBolt,
  IconBookmark,
  IconCalendarEvent,
  IconCornerDownLeft,
  IconEye,
  IconFilter,
  IconFlame,
  IconFolders,
  IconLayoutDashboard,
  IconLayoutGrid,
  IconMoon,
  IconPalette,
  IconRefresh,
  IconRobot,
  IconSelector,
  IconSettings,
  IconShieldExclamation,
  IconSitemap,
  IconSparkles,
  IconSun,
  IconTrendingDown,
  IconTrendingUp,
  IconUser,
  IconWallet,
} from '@tabler/icons-react'
import {
  Badge,
  Button,
  Command,
  CommandChips,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandHint,
  CommandInput,
  CommandItem,
  CommandItemMedia,
  CommandItemMeta,
  CommandItemText,
  CommandList,
  CommandLoading,
  CommandScopes,
  CommandSeparator,
  CommandShortcut,
  Kbd,
  KbdGroup,
  THEMES,
  themeStore,
  useTheme as useDesignTheme,
} from '@/design-system'
import type { ThemePreset } from '@/design-system'
import { daysUntil } from '@/lib/bookRisk'
import { useShortcut, useShortcutLabel } from '@/lib/shortcuts'
import { surveillanceLabel } from '@/lib/surveillance'
import { useStrength } from '@/lib/useStrength'
import { cn } from '@/lib/utils'
import {
  BACKTEST_TABS,
  ENGINE_TABS,
  FINANCE_TABS,
  HOLDINGS_TABS,
  HOME_TABS,
  PAGES,
  PAPER_TABS,
  SETTINGS_TABS,
  SIMULATION_MODES,
  WORKFLOW_PAGES,
} from '@/lib/navTargets'
import { askInChat } from './ChatWidget'
import { useNextResults } from './components/ResultsBadge'
import { openProfile } from './Profile'
import { openWatchlists } from './WatchlistManager'
import type { SettingsTab } from './router'
import {
  addStock,
  getDashboards,
  getPaperPositions,
  getStocks,
  getSurveillance,
  getWatchlist,
  getWorkflows,
  searchStocks,
} from '@/services/api'

// Global Cmd/Ctrl+K palette - the design system's palette (Storybook › Components › Command palette)
// on real data: source tabs (Tab cycles), stock filter chips, recents, tracked stocks with price and
// flags, every destination from lib/navTargets.ts (keep that file in sync - it is the app's index of
// itself), quick actions, themes, "Ask the agent", and a footer whose keys work: ⌘↵ opens the
// highlighted item in a new tab, ⌘L copies its link. "@SYMBOL" searches every tracked stock; an
// unknown symbol is verified on NSE before navigating.

type Icon = ComponentType<{ className?: string }>
type Scope = 'all' | 'stocks' | 'pages' | 'tabs' | 'actions' | 'settings' | 'theme'

type Entry = {
  /** cmdk value - unique, and what recents remember. */
  value: string
  scope: Exclude<Scope, 'all' | 'stocks'>
  group: string
  title: string
  path?: string[]
  subtitle?: string
  /** Second line - usually the route. */
  description?: string
  icon: Icon
  shortcut?: string
  theme?: ThemePreset
  /** In-app URL, for ⌘↵ (new tab) and ⌘L (copy link). */
  href?: string
  run: () => void
}

type StockFlags = {
  symbol: string
  price: number | null
  change: number | null
  lists: string[]
  held: number | null
  resultsIn: number | null
  surveillance: string | null
  reports: number
  /** NSE relative-strength rating 1-99, from the market-wide strength table; null until it's in. */
  rs: number | null
}

const SCOPES: { value: Scope; label: string; icon?: Icon }[] = [
  { value: 'all', label: 'All' },
  { value: 'stocks', label: 'Stocks', icon: IconTrendingUp },
  { value: 'pages', label: 'Pages', icon: IconLayoutDashboard },
  { value: 'tabs', label: 'Page tabs', icon: IconFolders },
  { value: 'actions', label: 'Actions', icon: IconBolt },
  { value: 'settings', label: 'Settings', icon: IconSettings },
  { value: 'theme', label: 'Theme', icon: IconPalette },
]

const CHIPS = [
  { value: 'watch', label: 'Watchlist', icon: IconEye },
  { value: 'held', label: 'Held', icon: IconWallet },
  { value: 'up', label: 'Gainers', icon: IconTrendingUp },
  { value: 'down', label: 'Losers', icon: IconTrendingDown },
  { value: 'rs', label: 'RS 80+', icon: IconFlame },
  { value: 'results', label: 'Results soon', icon: IconCalendarEvent },
  { value: 'asm', label: 'Surveillance', icon: IconShieldExclamation },
]

const CHIP_TEST: Record<string, (s: StockFlags) => boolean> = {
  watch: (s) => s.lists.length > 0,
  held: (s) => s.held != null,
  up: (s) => (s.change ?? 0) > 0,
  down: (s) => (s.change ?? 0) < 0,
  rs: (s) => (s.rs ?? 0) >= 80,
  results: (s) => s.resultsIn != null && s.resultsIn <= 14,
  asm: (s) => s.surveillance != null,
}

/** One line on what each page is for - the palette's subtitle. */
const PAGE_HINTS: Record<string, string> = {
  Stocks: 'Indices, watchlist, screener',
  Chart: 'Full chart with indicators',
  Leaders: 'Top relative strength',
  Microcaps: 'Microcap universe',
  Earnings: 'Results calendar',
  Settings: 'Accounts, models, brokers',
  Events: 'News, deals, filings',
  'Top news': 'Market-moving stories',
  Holdings: 'Broker holdings',
  Shareholding: 'Promoter / FII / DII',
  Backtesting: 'Trade journal',
  'Paper Trading': 'Simulated positions',
  'Live Trading': 'Dhan order ticket',
  'Book risk': 'Exposure and concentration',
  'Algo engine': 'C++ engine runs',
  'Trade Simulation': 'Monte Carlo on your log',
  'Net worth & goals': 'Snapshots and goals',
  Alerts: 'Price and indicator alerts',
  Scans: 'Saved screener scans',
  Agent: 'AI agent with tools',
  Workflows: 'Scheduled automations',
  Dashboards: 'Custom panel boards',
}

const RECENT_KEY = 'commandPalette.recent'
const readRecent = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 5) : []
  } catch {
    return []
  }
}
const pushRecent = (value: string) => {
  try {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([value, ...readRecent().filter((v) => v !== value)].slice(0, 5)),
    )
  } catch {
    // storage blocked: recents just don't persist
  }
}

/** "Backtesting > Trades" -> breadcrumb + title. */
const split = (label: string) => {
  const parts = label.split(' > ')
  return { title: parts.at(-1) ?? label, path: parts.slice(0, -1) }
}

const hrefOf = (to: string, search?: Record<string, unknown>) => {
  const q = search
    ? new URLSearchParams(Object.entries(search).map(([k, v]) => [k, String(v)])).toString()
    : ''
  return q ? `${to}?${q}` : to
}

const fmtPrice = (v: number) =>
  v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`

function ResultCount() {
  const n = useCommandState((s) => s.filtered.count)
  return <span className="tabular shrink-0">{n} results</span>
}

function ThemeTile({ theme }: { theme: ThemePreset }) {
  const c = theme.colors
  return (
    <CommandItemMedia className="overflow-hidden border border-border p-0" style={{ background: c.card }}>
      <span className="flex h-full w-full items-end gap-px p-1">
        {[c.accent, c.up, c.down].map((col, i) => (
          <span
            key={col}
            className="flex-1 rounded-[1px]"
            style={{ background: col, height: i === 0 ? '70%' : '45%' }}
          />
        ))}
      </span>
    </CommandItemMedia>
  )
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [chips, setChips] = useState<string[]>([])
  const [sortByChange, setSortByChange] = useState(false)
  const [highlighted, setHighlighted] = useState('')
  const [stockError, setStockError] = useState<string | null>(null)
  const [recent, setRecent] = useState(readRecent)
  const navigate = useNavigate()
  const { resolved } = useDesignTheme()
  const paletteKey = useShortcutLabel('global.commandPalette')
  const watchlistKey = useShortcutLabel('global.watchlists')

  useShortcut('global.commandPalette', () => {
    setOpen((o) => !o)
    setRecent(readRecent())
  })

  const close = () => {
    setOpen(false)
    setQuery('')
    setScope('all')
    setChips([])
    setStockError(null)
  }

  const stockMode = query.startsWith('@')
  const typed = (stockMode ? query.slice(1) : query).trim().toUpperCase()
  const effectiveScope: Scope = stockMode ? 'stocks' : scope
  const showStocks = effectiveScope === 'all' || effectiveScope === 'stocks'

  // Tracked stocks with their quotes, plus what makes one worth a flag - all cached queries the
  // rest of the app already runs, only fetched while the palette is open.
  const { data: tracked = [], isPending: trackedLoading } = useQuery({
    queryKey: ['stocks'],
    queryFn: getStocks,
    enabled: open,
  })
  const { data: watchlist = [] } = useQuery({ queryKey: ['watchlist'], queryFn: getWatchlist, enabled: open })
  const { data: paper = [] } = useQuery({
    queryKey: ['paperPositions', null],
    queryFn: () => getPaperPositions(null),
    enabled: open,
  })
  const { data: surveillance } = useQuery({
    queryKey: ['surveillance'],
    queryFn: getSurveillance,
    staleTime: 3_600_000,
    enabled: open,
  })
  const results = useNextResults()
  // RS for the stock rows and the RS 80+ chip - the same cached table Leaders uses
  const { bySymbol: strength } = useStrength(open)
  const { data: dashboards = [] } = useQuery({
    queryKey: ['dashboards'],
    queryFn: getDashboards,
    enabled: open,
  })
  const { data: workflows = [] } = useQuery({ queryKey: ['workflows'], queryFn: getWorkflows, enabled: open })

  // @SYMBOL searches every tracked symbol on the server (the list above is the dashboard's).
  const { data: searchMatches = [], isFetching: searching } = useQuery({
    queryKey: ['paletteStockSearch', typed],
    queryFn: () => searchStocks(typed),
    enabled: open && stockMode && typed.length > 0,
  })

  const stocks = useMemo<StockFlags[]>(() => {
    const lists = new Map<string, string[]>()
    for (const w of watchlist) lists.set(w.symbol, [...(lists.get(w.symbol) ?? []), w.list_name])
    const held = new Map<string, number>()
    for (const p of paper) if (p.status === 'open') held.set(p.symbol, (held.get(p.symbol) ?? 0) + p.quantity)
    const flags = (
      symbol: string,
      price: number | null,
      change: number | null,
      reports: number,
    ): StockFlags => {
      const date = results.get(symbol)
      const asm = surveillance?.stocks[symbol]
      return {
        symbol,
        price,
        change,
        reports,
        lists: lists.get(symbol) ?? [],
        held: held.get(symbol) ?? null,
        resultsIn: date ? daysUntil(date) : null,
        surveillance: asm?.length ? surveillanceLabel(asm) : null,
        rs: strength.get(symbol)?.rs ?? null,
      }
    }
    const base = stockMode
      ? (() => {
          const quote = new Map(tracked.map((t) => [t.symbol, t]))
          return searchMatches.map((m) => {
            const q = quote.get(m.symbol)
            return flags(m.symbol, q?.price ?? null, q?.changePercent ?? null, q?.report_count ?? 0)
          })
        })()
      : tracked.map((t) => flags(t.symbol, t.price, t.changePercent, t.report_count))
    const out = base.filter((s) => chips.every((c) => CHIP_TEST[c]?.(s) ?? true))
    if (sortByChange) out.sort((a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity))
    return out
  }, [
    tracked,
    watchlist,
    paper,
    surveillance,
    results,
    strength,
    searchMatches,
    stockMode,
    chips,
    sortByChange,
  ])

  const exactStockMatch = stocks.some((s) => s.symbol === typed)

  const goToStock = (symbol: string) => {
    pushRecent(`stock:${symbol}`)
    navigate({ to: '/stock/$exchange/$symbol', params: { exchange: 'NSE', symbol } })
    close()
  }

  // Matches from /api/stocks/search are already-tracked, real symbols - navigate straight away. An
  // unmatched, freshly-typed symbol is checked (the same live-scrape POST /api/stocks always does)
  // before navigating; on failure the error shows inline and the palette stays open.
  const verifyAndGo = useMutation({
    mutationFn: () => addStock(typed),
    onSuccess: ({ symbol }) => goToStock(symbol),
    onError: (e) => setStockError(e.message),
  })

  const reload = async () => {
    try {
      const res = await fetch('/api/cache/clear', { method: 'POST' })
      if (!res.ok) throw new Error('Failed to clear cache')
      window.location.reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear cache')
    }
  }

  const entries = useMemo<Entry[]>(() => {
    // Destinations come from the navTargets tables rather than being written at each call, so the
    // router cannot check `search` against the specific route being navigated to.
    const go = (to: LinkProps['to'], search?: Record<string, unknown>) => ({
      href: hrefOf(String(to), search),
      run: () => navigate(search ? ({ to, search } as never) : { to }),
    })
    const tab = (label: string, icon: Icon, to: LinkProps['to'], search?: Record<string, unknown>): Entry => {
      const target = go(to, search)
      return {
        value: label,
        scope: 'tabs',
        group: 'Page tabs',
        icon,
        description: target.href,
        ...target,
        ...split(label),
      }
    }
    const dark = resolved.preset.mode === 'dark'
    return [
      ...PAGES.map((p) => {
        const target = go(p.to)
        return {
          value: p.label,
          scope: 'pages' as const,
          group: 'Pages',
          title: p.label,
          subtitle: PAGE_HINTS[p.label],
          description: target.href,
          icon: p.icon as Icon,
          ...target,
        }
      }),
      {
        value: 'Bar Replay',
        scope: 'pages',
        group: 'Pages',
        title: 'Bar Replay',
        subtitle: 'Practise bar by bar',
        description: '/backtest/replay',
        icon: IconArrowUpRight,
        ...go('/backtest/replay'),
      },
      ...dashboards.map((d) => ({
        value: `Dashboard > ${d.name} ${d.id}`,
        scope: 'pages' as const,
        group: 'Dashboards',
        title: d.name,
        path: ['Dashboard'],
        description: `/dashboards/${d.id}`,
        href: `/dashboards/${d.id}`,
        icon: IconLayoutGrid,
        run: () => navigate({ to: '/dashboards/$dashboardId', params: { dashboardId: d.id } }),
      })),
      ...workflows.map((w) => ({
        value: `Workflow > ${w.name} ${w.id}`,
        scope: 'pages' as const,
        group: 'Workflows',
        title: w.name,
        path: ['Workflow'],
        description: `/workflows/${w.id}`,
        href: `/workflows/${w.id}`,
        icon: IconSitemap,
        run: () => navigate({ to: '/workflows/$workflowId', params: { workflowId: w.id } }),
      })),
      ...HOME_TABS.map((t) => tab(t.label, IconLayoutDashboard, '/', { tab: t.tab })),
      ...BACKTEST_TABS.map((t) => tab(t.label, IconFolders, '/backtesting', { view: t.view })),
      ...HOLDINGS_TABS.map((t) => tab(t.label, IconFolders, '/holdings', { broker: 'dhan', view: t.view })),
      ...PAPER_TABS.map((t) => tab(t.label, IconFolders, '/paper', { view: t.view })),
      ...ENGINE_TABS.map((t) => tab(t.label, IconFolders, '/engine', { tab: t.tab })),
      ...SIMULATION_MODES.map((m) => tab(m.label, IconFolders, '/simulation', { mode: m.mode })),
      ...FINANCE_TABS.map((t) => tab(t.label, IconFolders, '/finance', { view: t.view })),
      ...WORKFLOW_PAGES.map((t) => tab(t.label, IconSitemap, t.to)),
      {
        value: 'Watchlists',
        scope: 'actions',
        group: 'Quick actions',
        title: 'Watchlists',
        subtitle: 'Map stocks to lists',
        icon: IconBookmark,
        shortcut: watchlistKey,
        run: openWatchlists,
      },
      {
        value: 'Profile',
        scope: 'actions',
        group: 'Quick actions',
        title: 'Profile',
        icon: IconUser,
        run: openProfile,
      },
      {
        value: 'Reload',
        scope: 'actions',
        group: 'Quick actions',
        title: 'Reload data',
        subtitle: 'Clear the cache and reload',
        icon: IconRefresh,
        run: reload,
      },
      ...THEMES.map((t) => ({
        value: `Theme ${t.label}`,
        scope: 'theme' as const,
        group: 'Theme',
        title: t.label,
        subtitle: `${t.mode} · radius ${t.radius}px${t.id === resolved.preset.id ? ' · current' : ''}`,
        icon: IconPalette,
        theme: t,
        run: () => themeStore.setPreset(t.id),
      })),
      {
        value: 'Toggle theme',
        scope: 'theme',
        group: 'Theme',
        title: dark ? 'Switch to light' : 'Switch to dark',
        icon: dark ? IconSun : IconMoon,
        run: () =>
          resolved.preset.pair
            ? themeStore.toggleMode()
            : themeStore.setPreset(dark ? 'terminal-light' : 'terminal-dark'),
      },
      {
        value: 'Customize colors',
        scope: 'theme',
        group: 'Theme',
        title: 'Customize colors…',
        subtitle: 'Settings › Appearance',
        icon: IconPalette,
        ...go('/settings', { tab: 'appearance' }),
      },
      ...SETTINGS_TABS.map((s) => ({
        value: s.label,
        scope: 'settings' as const,
        group: 'Settings',
        icon: IconSettings,
        description: `/settings?tab=${s.tab}`,
        href: `/settings?tab=${s.tab}`,
        run: () => navigate({ to: '/settings', search: { tab: s.tab as SettingsTab } }),
        ...split(s.label),
      })),
    ]
    // reload is recreated each render but closes over nothing that changes
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  }, [dashboards, workflows, resolved.preset, watchlistKey, navigate])

  const byValue = useMemo(() => new Map(entries.map((e) => [e.value, e])), [entries])

  const select = (e: Entry) => {
    pushRecent(e.value)
    e.run()
    // picking a theme keeps the palette open so presets can be compared
    if (!e.theme) close()
  }

  const counts: Record<string, number> = { all: entries.length + tracked.length, stocks: tracked.length }
  for (const e of entries) counts[e.scope] = (counts[e.scope] ?? 0) + 1
  const shown = (s: Entry['scope']) => effectiveScope === 'all' || effectiveScope === s
  const groups = [...new Set(entries.filter((e) => shown(e.scope)).map((e) => e.group))]

  const recentEntries = recent
    .map((v) =>
      v.startsWith('stock:')
        ? (stocks.find((s) => s.symbol === v.slice(6)) ?? { symbol: v.slice(6) })
        : byValue.get(v),
    )
    .filter(Boolean) as (Entry | (Partial<StockFlags> & { symbol: string }))[]

  /** The highlighted row's in-app URL, for ⌘↵ / ⌘L. */
  const highlightedHref = () => {
    const v = highlighted.replace(/^recent /, '')
    if (v.startsWith('stock ')) return `/stock/NSE/${v.slice(6).split(' ')[0].toUpperCase()}`
    return [...byValue.values()].find((e) => e.value.toLowerCase() === v.toLowerCase())?.href
  }

  const row = (e: Entry, valuePrefix = '') => (
    <CommandItem
      key={valuePrefix + e.value}
      value={valuePrefix + e.value}
      keywords={[e.title, e.subtitle ?? '', ...(e.path ?? [])]}
      onSelect={() => select(e)}
    >
      {e.theme ? (
        <ThemeTile theme={e.theme} />
      ) : (
        <CommandItemMedia>
          <e.icon />
        </CommandItemMedia>
      )}
      <CommandItemText title={e.title} path={e.path} subtitle={e.subtitle} description={e.description} />
      {e.shortcut ? (
        <CommandShortcut>{e.shortcut}</CommandShortcut>
      ) : (
        <CommandItemMeta>
          <IconArrowUpRight className="size-3.5 opacity-0 group-data-[selected=true]/command-item:opacity-100" />
        </CommandItemMeta>
      )}
    </CommandItem>
  )

  const stockRow = (s: Partial<StockFlags> & { symbol: string }, valuePrefix = '') => {
    const change = s.change ?? null
    const details = [
      s.lists?.length ? s.lists.join(', ') : null,
      s.reports ? `${s.reports} report${s.reports === 1 ? '' : 's'}` : null,
    ].filter(Boolean)
    return (
      <CommandItem
        key={valuePrefix + s.symbol}
        value={`${valuePrefix}stock ${s.symbol}`}
        keywords={[s.symbol, ...(s.lists ?? [])]}
        onSelect={() => goToStock(s.symbol)}
      >
        <CommandItemMedia tone={change == null ? 'muted' : change >= 0 ? 'up' : 'down'}>
          {s.symbol.slice(0, 2)}
        </CommandItemMedia>
        <CommandItemText
          title={<span className="font-semibold">{s.symbol}</span>}
          subtitle={s.lists?.length ? 'watchlist' : 'tracked'}
          description={details.length ? details.join(' · ') : 'NSE'}
        />
        <CommandItemMeta>
          {s.held != null && <Badge variant="accent">held {s.held}</Badge>}
          {s.surveillance && <Badge variant="destructive">{s.surveillance}</Badge>}
          {s.resultsIn != null && s.resultsIn <= 14 && (
            <Badge variant={s.resultsIn <= 2 ? 'destructive' : s.resultsIn <= 7 ? 'warning' : 'secondary'}>
              Results {s.resultsIn === 0 ? 'today' : s.resultsIn === 1 ? 'tomorrow' : `in ${s.resultsIn}d`}
            </Badge>
          )}
          {s.price != null && (
            <span className="flex w-20 flex-col items-end">
              <span className="tabular text-xs text-foreground">{fmtPrice(s.price)}</span>
              {change != null && (
                <span className={cn('tabular', change >= 0 ? 'text-up' : 'text-down')}>{fmtPct(change)}</span>
              )}
            </span>
          )}
        </CommandItemMeta>
      </CommandItem>
    )
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => (o ? setOpen(true) : close())}
      title="Command palette"
      description="Jump to a page, a tab or a setting, run an action, or type @ to search stocks"
      className="top-[6%] flex h-[min(680px,calc(100dvh-3rem))] flex-col sm:max-w-2xl"
    >
      <Command
        shouldFilter={!stockMode}
        loop
        value={highlighted}
        onValueChange={setHighlighted}
        className="min-h-0 flex-1"
        onKeyDown={(e) => {
          const mod = e.metaKey || e.ctrlKey
          if (e.key === 'Tab' && !stockMode) {
            e.preventDefault()
            const i = SCOPES.findIndex((s) => s.value === scope)
            setScope(SCOPES[(i + (e.shiftKey ? -1 : 1) + SCOPES.length) % SCOPES.length].value)
          } else if (mod && e.key === 'Enter') {
            const href = highlightedHref()
            if (href) {
              e.preventDefault()
              window.open(href, '_blank', 'noopener')
            }
          } else if (mod && e.key.toLowerCase() === 'l') {
            const href = highlightedHref()
            if (href) {
              e.preventDefault()
              navigator.clipboard
                .writeText(new URL(href, window.location.origin).toString())
                .then(() => toast.success('Link copied'))
            }
          }
        }}
      >
        <CommandInput
          value={query}
          onValueChange={(v: string) => {
            setQuery(v)
            setStockError(null)
          }}
          placeholder="Start typing — pages, settings, actions, or @SYMBOL"
          scope={stockMode ? '@ Stocks' : undefined}
          loading={(stockMode && searching) || (showStocks && open && trackedLoading)}
          trailing={
            <>
              {paletteKey !== 'Off' && (
                <KbdGroup>
                  {paletteKey.split(' ').map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </KbdGroup>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-accent"
                aria-label="Ask the agent"
                title={query.trim() ? 'Ask the agent' : 'Type a question, then ask the agent'}
                disabled={!query.trim()}
                onClick={() => {
                  askInChat(query)
                  close()
                }}
              >
                <IconSparkles />
              </Button>
            </>
          }
        />
        <CommandScopes
          scopes={SCOPES.map((s) => ({ ...s, count: counts[s.value] }))}
          value={effectiveScope}
          onValueChange={(v) => {
            setScope(v as Scope)
            if (stockMode) setQuery('')
          }}
        />
        {showStocks && (
          <CommandChips
            chips={CHIPS}
            selected={chips}
            onToggle={(v) => setChips((c) => (c.includes(v) ? c.filter((x) => x !== v) : [...c, v]))}
            trailing={
              <>
                <Button
                  variant="outline"
                  size="icon-xs"
                  aria-label="Clear filters"
                  title="Clear filters"
                  className={cn('rounded-full', chips.length > 0 && 'border-accent text-accent')}
                  onClick={() => setChips([])}
                >
                  <IconFilter />
                </Button>
                <Button
                  variant="outline"
                  size="icon-xs"
                  aria-label="Sort stocks by change"
                  title={sortByChange ? 'Sorted by change' : 'Sort stocks by change'}
                  className={cn('rounded-full', sortByChange && 'border-accent text-accent')}
                  onClick={() => setSortByChange((v) => !v)}
                >
                  <IconArrowsSort />
                </Button>
              </>
            }
          />
        )}
        <CommandList className="max-h-none min-h-0 flex-1">
          {stockMode ? (
            <>
              {searching && stocks.length === 0 && <CommandLoading>Searching stocks…</CommandLoading>}
              {!searching && (
                <CommandEmpty>{typed ? 'No tracked stock matches.' : 'Type a symbol.'}</CommandEmpty>
              )}
              <CommandGroup heading="Stocks" count={stocks.length}>
                {stocks.map((s) => stockRow(s))}
                {typed && !exactStockMatch && (
                  <CommandItem
                    value={`__goto__${typed}`}
                    disabled={verifyAndGo.isPending}
                    onSelect={() => verifyAndGo.mutate()}
                  >
                    <CommandItemMedia>
                      <IconArrowUpRight />
                    </CommandItemMedia>
                    <CommandItemText
                      title={`Go to “${typed}”`}
                      description="Not tracked yet — checked on NSE before opening"
                    />
                  </CommandItem>
                )}
              </CommandGroup>
              {stockError && <p className="px-2 py-1.5 text-2xs text-down">{stockError}</p>}
            </>
          ) : (
            <>
              <CommandEmpty>
                <div className="flex flex-col items-center gap-1">
                  <span>No matches for “{query}”.</span>
                  <span className="text-2xs">Ask the agent (✦ above), or type @ to search stocks.</span>
                </div>
              </CommandEmpty>
              {!query && effectiveScope === 'all' && chips.length === 0 && recentEntries.length > 0 && (
                <>
                  <CommandGroup heading="Recent" count={recentEntries.length}>
                    {recentEntries.map((e) =>
                      'value' in e ? row(e as Entry, 'recent ') : stockRow(e, 'recent '),
                    )}
                  </CommandGroup>
                  <CommandSeparator />
                </>
              )}
              {showStocks && stocks.length > 0 && (
                <>
                  <CommandGroup heading={chips.length ? 'Stocks · filtered' : 'Stocks'} count={stocks.length}>
                    {stocks.map((s) => stockRow(s))}
                  </CommandGroup>
                  {groups.length > 0 && <CommandSeparator />}
                </>
              )}
              {showStocks && chips.length > 0 && stocks.length === 0 && (
                <p className="px-2 py-3 text-center text-2xs text-muted-foreground">
                  No tracked stock passes these filters.
                </p>
              )}
              {groups.map((g, i) => {
                const list = entries.filter((e) => e.group === g && shown(e.scope))
                return (
                  <Fragment key={g}>
                    <CommandGroup heading={g} count={list.length}>
                      {list.map((e) => row(e))}
                    </CommandGroup>
                    {i < groups.length - 1 && <CommandSeparator />}
                  </Fragment>
                )
              })}
              {query.trim() && (
                <CommandGroup heading="Agent" forceMount>
                  <CommandItem
                    value={`__ask__${query}`}
                    forceMount
                    onSelect={() => {
                      askInChat(query)
                      close()
                    }}
                  >
                    <CommandItemMedia tone="accent">
                      <IconRobot />
                    </CommandItemMedia>
                    <CommandItemText
                      title={`Ask the agent: “${query}”`}
                      description="Opens the chat and sends it, with your book as context"
                    />
                  </CommandItem>
                </CommandGroup>
              )}
            </>
          )}
        </CommandList>
        <CommandFooter>
          <CommandHint keys={<IconSelector />}>Select</CommandHint>
          <CommandHint keys={<IconCornerDownLeft />}>Open</CommandHint>
          <CommandHint keys="⌘↵">Open in new tab</CommandHint>
          <CommandHint keys="⌘L">Copy link</CommandHint>
          {!stockMode && <CommandHint keys="Tab">Scope</CommandHint>}
          <CommandHint keys="ESC">Close</CommandHint>
          <span className="flex-1" />
          <ResultCount />
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Palette shortcuts"
            title="Change shortcuts"
            onClick={() => {
              navigate({ to: '/settings', search: { tab: 'shortcuts' } })
              close()
            }}
          >
            <IconSettings />
          </Button>
        </CommandFooter>
      </Command>
    </CommandDialog>
  )
}
