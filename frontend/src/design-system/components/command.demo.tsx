// Storybook-only: the full Stoklore command palette, built from the design-system parts and laid
// out after the reference (source tabs → filter chips → grouped results → key-hint footer).
// Pages, tabs and settings come from the app's real index (lib/navTargets.ts), so this stays in
// sync with what CommandPalette.tsx can reach. Stocks and recents are sample data.
import { Fragment, useEffect, useMemo, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { useCommandState } from 'cmdk'
import {
  IconAlertTriangle,
  IconArrowsSort,
  IconArrowUpRight,
  IconBell,
  IconBolt,
  IconChartCandle,
  IconDatabaseX,
  IconEye,
  IconFileImport,
  IconFilter,
  IconFlame,
  IconFolders,
  IconHistory,
  IconLayoutDashboard,
  IconLayoutSidebarLeftCollapse,
  IconListDetails,
  IconMicrophone,
  IconMoon,
  IconNotebook,
  IconPalette,
  IconPlayerTrackNext,
  IconRefresh,
  IconRobot,
  IconScan,
  IconSettings,
  IconShieldExclamation,
  IconSparkles,
  IconTrendingDown,
  IconTrendingUp,
  IconUser,
  IconWallet,
  IconCalendarEvent,
  IconCornerDownLeft,
  IconSelector,
} from '@tabler/icons-react'
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
import { cn } from '@/lib/utils'
import { THEMES } from '../tokens/themes'
import type { ThemePreset } from '../tokens/themes'
import { themeStore } from '../theme/store'
import { Badge, Kbd, KbdGroup } from './badge'
import { Button } from './button'
import {
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
} from './command'
import { toast } from './toast'

type Icon = ComponentType<{ className?: string }>
type ScopeId = 'all' | 'stocks' | 'pages' | 'tabs' | 'actions' | 'settings' | 'theme'
type Tone = 'success' | 'warning' | 'destructive' | 'secondary' | 'outline'

type Stock = {
  symbol: string
  name: string
  sector: string
  ltp: number
  chg: number
  rs: number
  deliv: number
  vol: string
  watch?: boolean
  held?: number
  results?: boolean
  surveillance?: boolean
  flag?: [string, Tone]
}

type Entry = {
  value: string
  scope: Exclude<ScopeId, 'all'>
  title: string
  subtitle?: string
  description?: string
  path?: string[]
  icon?: Icon
  shortcut?: string
  stock?: Stock
  theme?: ThemePreset
  route?: string
  run?: () => void
}

const STOCKS: Stock[] = [
  {
    symbol: 'TATAMOTORS',
    name: 'Tata Motors',
    sector: 'Auto',
    ltp: 986.25,
    chg: 3.4,
    rs: 88,
    deliv: 62,
    vol: '21.1M · 2.3×',
    watch: true,
    held: 52,
    flag: ['Breakout', 'outline'],
  },
  {
    symbol: 'KAYNES',
    name: 'Kaynes Technology',
    sector: 'Electronics',
    ltp: 5480.75,
    chg: 4.02,
    rs: 95,
    deliv: 48,
    vol: '1.2M · 3.1×',
    watch: true,
    held: 8,
    flag: ['Bulk deal', 'warning'],
  },
  {
    symbol: 'RELIANCE',
    name: 'Reliance Industries',
    sector: 'Oil & Gas',
    ltp: 2914.6,
    chg: 1.82,
    rs: 92,
    deliv: 54,
    vol: '8.4M · 1.4×',
    watch: true,
    flag: ['Results ✓', 'success'],
  },
  {
    symbol: 'HDFCBANK',
    name: 'HDFC Bank',
    sector: 'Banks',
    ltp: 1702.9,
    chg: 0.05,
    rs: 61,
    deliv: 49,
    vol: '12.6M · 0.9×',
    watch: true,
    results: true,
    flag: ['Results 28 Nov', 'secondary'],
  },
  {
    symbol: 'TATAPOWER',
    name: 'Tata Power',
    sector: 'Power',
    ltp: 432.15,
    chg: 1.12,
    rs: 71,
    deliv: 47,
    vol: '12.4M · 1.2×',
  },
  {
    symbol: 'TATASTEEL',
    name: 'Tata Steel',
    sector: 'Metal',
    ltp: 148.9,
    chg: -0.81,
    rs: 54,
    deliv: 41,
    vol: '38.2M · 0.9×',
  },
  {
    symbol: 'TATAELXSI',
    name: 'Tata Elxsi',
    sector: 'IT',
    ltp: 6140.0,
    chg: -1.95,
    rs: 32,
    deliv: 55,
    vol: '0.4M · 0.8×',
  },
  {
    symbol: 'TCS',
    name: 'Tata Consultancy Services',
    sector: 'IT',
    ltp: 4128.3,
    chg: 0.22,
    rs: 58,
    deliv: 61,
    vol: '2.1M · 0.7×',
    results: true,
    flag: ['Results 9 Jan', 'secondary'],
  },
  {
    symbol: 'DIXON',
    name: 'Dixon Technologies',
    sector: 'Electronics',
    ltp: 15210.5,
    chg: -1.38,
    rs: 71,
    deliv: 41,
    vol: '0.3M · 0.8×',
    watch: true,
  },
  {
    symbol: 'ZOMATO',
    name: 'Zomato',
    sector: 'Consumer Tech',
    ltp: 262.15,
    chg: -2.14,
    rs: 55,
    deliv: 32,
    vol: '44.8M · 1.1×',
    watch: true,
  },
  {
    symbol: 'SUZLON',
    name: 'Suzlon Energy',
    sector: 'Capital Goods',
    ltp: 64.8,
    chg: -4.95,
    rs: 23,
    deliv: 18,
    vol: '96.3M · 2.7×',
    held: 600,
    surveillance: true,
    flag: ['ASM Stage 1', 'destructive'],
  },
  {
    symbol: 'IRFC',
    name: 'Indian Railway Finance',
    sector: 'Finance',
    ltp: 148.35,
    chg: 0.92,
    rs: 47,
    deliv: 40,
    vol: '31.2M · 1.0×',
  },
]

const PAGE_DESC: Record<string, string> = {
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

const say = (msg: string) => () => toast(msg)

const tabEntry = (label: string, scope: 'tabs' | 'settings', route: string): Entry => {
  const parts = label.split(' > ')
  return {
    value: label,
    scope,
    title: parts.at(-1) ?? label,
    path: parts.slice(0, -1),
    description: route,
    route,
  }
}

function buildEntries(): Entry[] {
  return [
    ...STOCKS.map((s) => ({
      value: `${s.symbol} ${s.name}`,
      scope: 'stocks' as const,
      title: s.symbol,
      subtitle: s.name,
      description: `${s.sector} · RS ${s.rs} · Deliv ${s.deliv}% · Vol ${s.vol}`,
      stock: s,
      route: `/stock/NSE/${s.symbol}`,
    })),
    ...PAGES.map((p) => ({
      value: p.label,
      scope: 'pages' as const,
      title: p.label,
      subtitle: PAGE_DESC[p.label],
      description: String(p.to),
      icon: p.icon as Icon,
      route: String(p.to),
    })),
    {
      value: 'Bar Replay',
      scope: 'pages',
      title: 'Bar Replay',
      subtitle: 'Practise bar by bar',
      description: '/backtest/replay',
      icon: IconPlayerTrackNext,
      route: '/backtest/replay',
    },
    ...HOME_TABS.map((t) => tabEntry(t.label, 'tabs', `/?tab=${t.tab}`)),
    ...BACKTEST_TABS.map((t) => tabEntry(t.label, 'tabs', `/backtesting?view=${t.view}`)),
    ...HOLDINGS_TABS.map((t) => tabEntry(t.label, 'tabs', `/holdings?broker=dhan&view=${t.view}`)),
    ...PAPER_TABS.map((t) => tabEntry(t.label, 'tabs', `/paper?view=${t.view}`)),
    ...ENGINE_TABS.map((t) => tabEntry(t.label, 'tabs', `/engine?tab=${t.tab}`)),
    ...SIMULATION_MODES.map((t) => tabEntry(t.label, 'tabs', `/simulation?mode=${t.mode}`)),
    ...FINANCE_TABS.map((t) => tabEntry(t.label, 'tabs', `/finance?view=${t.view}`)),
    ...WORKFLOW_PAGES.map((t) => tabEntry(t.label, 'tabs', String(t.to))),
    ...SETTINGS_TABS.map((t) => tabEntry(t.label, 'settings', `/settings?tab=${t.tab}`)),
    {
      value: 'Buy',
      scope: 'actions',
      title: 'Buy…',
      subtitle: 'Order ticket',
      icon: IconChartCandle,
      shortcut: 'B',
      run: say('Order ticket: BUY'),
    },
    {
      value: 'Sell',
      scope: 'actions',
      title: 'Sell…',
      subtitle: 'Order ticket',
      icon: IconChartCandle,
      shortcut: 'S',
      run: say('Order ticket: SELL'),
    },
    {
      value: 'Create alert',
      scope: 'actions',
      title: 'Create alert',
      icon: IconBell,
      shortcut: '⌘⇧A',
      run: say('New alert'),
    },
    {
      value: 'Log a manual trade',
      scope: 'actions',
      title: 'Log a manual trade',
      icon: IconNotebook,
      shortcut: '⌘J',
      run: say('New journal trade'),
    },
    {
      value: 'Import tradebook',
      scope: 'actions',
      title: 'Import tradebook',
      subtitle: 'Zerodha / Dhan CSV',
      icon: IconFileImport,
      run: say('Import tradebook'),
    },
    {
      value: 'Exit all positions',
      scope: 'actions',
      title: 'Exit all positions',
      subtitle: 'Market orders',
      icon: IconAlertTriangle,
      run: say('Confirm: exit all'),
    },
    { value: 'Run a scan', scope: 'actions', title: 'Run a scan', icon: IconScan, run: say('Scans') },
    {
      value: 'New backtest',
      scope: 'actions',
      title: 'New backtest',
      icon: IconHistory,
      run: say('New backtest'),
    },
    {
      value: 'Open AI chat',
      scope: 'actions',
      title: 'Open AI chat',
      icon: IconSparkles,
      shortcut: '⌘/',
      run: say('Chat opened'),
    },
    {
      value: 'Watchlists',
      scope: 'actions',
      title: 'Watchlists',
      subtitle: 'Map stocks to lists',
      icon: IconListDetails,
      shortcut: '⌘B',
      run: say('Watchlists'),
    },
    {
      value: 'Toggle sidebar',
      scope: 'actions',
      title: 'Hide / show the sidebar',
      icon: IconLayoutSidebarLeftCollapse,
      shortcut: '⌘\\',
      run: say('Sidebar toggled'),
    },
    {
      value: 'Voice capture',
      scope: 'actions',
      title: 'Voice capture',
      subtitle: 'Hold to talk',
      icon: IconMicrophone,
      shortcut: '⌘⇧V',
      run: say('Listening…'),
    },
    { value: 'Profile', scope: 'actions', title: 'Profile', icon: IconUser, run: say('Profile') },
    { value: 'Reload', scope: 'actions', title: 'Reload data', icon: IconRefresh, run: say('Reloaded') },
    {
      value: 'Clear cache',
      scope: 'actions',
      title: 'Clear cache',
      icon: IconDatabaseX,
      run: say('Cache cleared'),
    },
    ...THEMES.map((t) => ({
      value: `Theme ${t.label}`,
      scope: 'theme' as const,
      title: t.label,
      subtitle: `${t.mode} · radius ${t.radius}px`,
      theme: t,
      run: () => themeStore.setPreset(t.id),
    })),
    {
      value: 'Switch light dark',
      scope: 'theme',
      title: 'Switch light / dark',
      icon: IconMoon,
      run: () => themeStore.toggleMode(),
    },
    {
      value: 'Customize colors',
      scope: 'theme',
      title: 'Customize colors…',
      subtitle: 'Settings › Appearance',
      icon: IconPalette,
      run: say('Settings › Appearance'),
    },
  ]
}

const RECENT = ['TATAMOTORS Tata Motors', 'Trade Simulation > Multiple accounts', 'Settings > Broker']

const SCOPES: { value: ScopeId; label: string; icon?: Icon }[] = [
  { value: 'all', label: 'All' },
  { value: 'stocks', label: 'Stocks', icon: IconTrendingUp },
  { value: 'pages', label: 'Pages', icon: IconLayoutDashboard },
  { value: 'tabs', label: 'Page tabs', icon: IconFolders },
  { value: 'actions', label: 'Actions', icon: IconBolt },
  { value: 'settings', label: 'Settings', icon: IconSettings },
  { value: 'theme', label: 'Theme', icon: IconPalette },
]

const GROUP_TITLE: Record<Entry['scope'], string> = {
  stocks: 'Stocks',
  pages: 'Pages',
  tabs: 'Page tabs',
  settings: 'Settings',
  actions: 'Quick actions',
  theme: 'Theme',
}

// Stock filters (the reference's People / Task / Pages… chips). "F&O" shows the disabled state.
const CHIPS = [
  { value: 'watch', label: 'Watchlist', icon: IconEye },
  { value: 'held', label: 'Held', icon: IconWallet },
  { value: 'up', label: 'Gainers', icon: IconTrendingUp },
  { value: 'down', label: 'Losers', icon: IconTrendingDown },
  { value: 'rs', label: 'RS 80+', icon: IconFlame },
  { value: 'results', label: 'Results soon', icon: IconCalendarEvent },
  { value: 'asm', label: 'Surveillance', icon: IconShieldExclamation },
  { value: 'fno', label: 'F&O', disabled: true },
]

const CHIP_TEST: Record<string, (s: Stock) => boolean> = {
  watch: (s) => !!s.watch,
  held: (s) => s.held != null,
  up: (s) => s.chg > 0,
  down: (s) => s.chg < 0,
  rs: (s) => s.rs >= 80,
  results: (s) => !!s.results,
  asm: (s) => !!s.surveillance,
}

const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`

function Row({ e, onRun }: { e: Entry; onRun: (e: Entry) => void }) {
  const s = e.stock
  const t = e.theme
  const Icon = e.icon ?? IconArrowUpRight
  return (
    <CommandItem
      value={e.value}
      keywords={[e.title, e.subtitle ?? '', ...(e.path ?? [])]}
      onSelect={() => onRun(e)}
    >
      {s ? (
        <CommandItemMedia tone={s.chg >= 0 ? 'up' : 'down'}>{s.symbol.slice(0, 2)}</CommandItemMedia>
      ) : t ? (
        <CommandItemMedia
          className="overflow-hidden border border-border p-0"
          style={{ background: t.colors.card }}
        >
          <span className="flex h-full w-full items-end gap-px p-1">
            {[t.colors.accent, t.colors.up, t.colors.down].map((c) => (
              <span
                key={c}
                className="flex-1 rounded-[1px]"
                style={{ background: c, height: c === t.colors.accent ? '70%' : '45%' }}
              />
            ))}
          </span>
        </CommandItemMedia>
      ) : (
        <CommandItemMedia>
          <Icon />
        </CommandItemMedia>
      )}
      <CommandItemText
        title={s ? <span className="font-semibold">{e.title}</span> : e.title}
        subtitle={e.subtitle}
        description={e.description}
        path={e.path}
      />
      {s ? (
        <CommandItemMeta>
          {s.held != null && <Badge variant="accent">held {s.held}</Badge>}
          {s.flag && <Badge variant={s.flag[1]}>{s.flag[0]}</Badge>}
          <span className="flex w-20 flex-col items-end">
            <span className="tabular text-xs text-foreground">{fmt(s.ltp)}</span>
            <span className={cn('tabular', s.chg >= 0 ? 'text-up' : 'text-down')}>{pct(s.chg)}</span>
          </span>
        </CommandItemMeta>
      ) : e.shortcut ? (
        <CommandShortcut>{e.shortcut}</CommandShortcut>
      ) : (
        <CommandItemMeta>
          <IconArrowUpRight className="size-3.5 opacity-0 group-data-[selected=true]/command-item:opacity-100" />
        </CommandItemMeta>
      )}
    </CommandItem>
  )
}

function ResultCount() {
  const n = useCommandState((s) => s.filtered.count)
  return <span className="tabular shrink-0">{n} results</span>
}

/** The full palette. `embedded` renders it inline instead of in a dialog. */
export function StoklorePalette({
  initialQuery = '',
  embedded = false,
  defaultOpen = true,
  renderTrigger,
}: {
  initialQuery?: string
  embedded?: boolean
  defaultOpen?: boolean
  /** Replaces the default "Search ⌘K" button (the app shell draws a search bar). */
  renderTrigger?: (open: () => void) => ReactNode
}) {
  const entries = useMemo(buildEntries, [])
  const byValue = useMemo(() => new Map(entries.map((e) => [e.value, e])), [entries])
  const [open, setOpen] = useState(defaultOpen)
  const [query, setQuery] = useState(initialQuery)
  const [scope, setScope] = useState<ScopeId>('all')
  const [chips, setChips] = useState<string[]>([])
  const [sortByChange, setSortByChange] = useState(false)
  const [loading, setLoading] = useState(false)

  const stockMode = query.startsWith('@')
  const stockQuery = stockMode ? query.slice(1).trim().toUpperCase() : ''
  const effectiveScope: ScopeId = stockMode ? 'stocks' : scope

  // stand-in for /api/stocks/search latency
  useEffect(() => {
    if (!stockMode) return
    setLoading(true)
    const id = setTimeout(() => setLoading(false), 280)
    return () => clearTimeout(id)
  }, [stockMode, stockQuery])

  useEffect(() => {
    if (embedded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [embedded])

  const run = (e: Entry) => {
    if (e.run) e.run()
    else toast(`Open ${e.path?.length ? `${e.path.join(' › ')} › ` : ''}${e.title}`, { description: e.route })
    if (!embedded && !e.theme) setOpen(false)
  }

  const stockPasses = (s: Stock) => chips.every((c) => CHIP_TEST[c]?.(s) ?? true)
  const stocks = entries
    .filter((e) => e.stock && stockPasses(e.stock))
    .filter((e) => !stockMode || !stockQuery || e.value.toUpperCase().includes(stockQuery))
    .sort((a, b) => (sortByChange ? b.stock!.chg - a.stock!.chg : 0))

  const counts: Record<string, number> = { all: entries.length }
  for (const e of entries) counts[e.scope] = (counts[e.scope] ?? 0) + 1

  const show = (s: Entry['scope']) => effectiveScope === 'all' || effectiveScope === s
  const groupsInOrder: Entry['scope'][] = ['pages', 'tabs', 'actions', 'theme', 'settings']

  const body = (
    <Command
      shouldFilter={!stockMode}
      loop
      className="min-h-0 flex-1"
      onKeyDown={(e) => {
        if (e.key === 'Tab' && !stockMode) {
          e.preventDefault()
          const i = SCOPES.findIndex((s) => s.value === scope)
          setScope(SCOPES[(i + (e.shiftKey ? -1 : 1) + SCOPES.length) % SCOPES.length].value)
        }
      }}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Start typing — pages, settings, actions, or @SYMBOL"
        scope={stockMode ? '@ Stocks' : undefined}
        loading={loading}
        trailing={
          <>
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Ask agent"
              title="Ask agent"
              className="text-accent"
              onClick={() => toast('Agent', { description: query || 'Ask anything about your book' })}
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
          setScope(v as ScopeId)
          if (stockMode) setQuery('')
        }}
      />
      {show('stocks') && (
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
                aria-label="Sort by change"
                title={sortByChange ? 'Sorted by change' : 'Sort by change'}
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
        {stockMode && loading ? (
          <CommandLoading>Searching NSE…</CommandLoading>
        ) : (
          <>
            <CommandEmpty>
              <div className="flex flex-col items-center gap-1">
                <span>No matches for “{query}”.</span>
                <span className="text-2xs">Ask the agent instead (✦ above), or type @ to search stocks.</span>
              </div>
            </CommandEmpty>

            {!query && effectiveScope === 'all' && chips.length === 0 && (
              <>
                <CommandGroup heading="Recent" count={RECENT.length}>
                  {RECENT.map((v) => {
                    const e = byValue.get(v)
                    return e ? <Row key={v} e={{ ...e, value: `recent ${e.value}` }} onRun={run} /> : null
                  })}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}

            {show('stocks') && stocks.length > 0 && (
              <>
                <CommandGroup heading={chips.length ? 'Stocks · filtered' : 'Stocks'} count={stocks.length}>
                  {stocks.map((e) => (
                    <Row key={e.value} e={e} onRun={run} />
                  ))}
                  {stockMode && stockQuery && !stocks.some((e) => e.title === stockQuery) && (
                    <CommandItem
                      value={`go ${stockQuery}`}
                      onSelect={() => toast(`Looking up ${stockQuery} on NSE…`)}
                    >
                      <CommandItemMedia>
                        <IconArrowUpRight />
                      </CommandItemMedia>
                      <CommandItemText
                        title={`Go to “${stockQuery}”`}
                        description="Not tracked yet — verify on NSE and open"
                      />
                    </CommandItem>
                  )}
                </CommandGroup>
                {!stockMode && <CommandSeparator />}
              </>
            )}

            {!stockMode &&
              groupsInOrder.filter(show).map((g, i, arr) => {
                const list = entries.filter((e) => e.scope === g)
                return (
                  <Fragment key={g}>
                    <CommandGroup heading={GROUP_TITLE[g]} count={list.length}>
                      {list.map((e) => (
                        <Row key={e.value} e={e} onRun={run} />
                      ))}
                    </CommandGroup>
                    {i < arr.length - 1 && <CommandSeparator />}
                  </Fragment>
                )
              })}

            {query && !stockMode && (
              <CommandGroup heading="Agent" forceMount>
                <CommandItem
                  value={`ask ${query}`}
                  forceMount
                  onSelect={() => toast('Agent', { description: query })}
                >
                  <CommandItemMedia tone="accent">
                    <IconRobot />
                  </CommandItemMedia>
                  <CommandItemText
                    title={`Ask agent: “${query}”`}
                    description="Runs with your positions, journal and watchlist as context"
                  />
                  <CommandShortcut>⌘↵</CommandShortcut>
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
          aria-label="Palette settings"
          onClick={say('Settings › Shortcuts')}
        >
          <IconSettings />
        </Button>
      </CommandFooter>
    </Command>
  )

  if (embedded)
    return (
      <div className="flex h-[640px] max-w-2xl flex-col overflow-hidden rounded-md border border-input">
        {body}
      </div>
    )

  return (
    <>
      {renderTrigger ? (
        renderTrigger(() => setOpen(true))
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Search
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Button>
      )}
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        className="top-[6%] flex h-[min(680px,calc(100dvh-3rem))] flex-col sm:max-w-2xl"
      >
        {body}
      </CommandDialog>
    </>
  )
}
