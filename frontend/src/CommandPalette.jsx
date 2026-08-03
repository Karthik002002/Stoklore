import { useState } from 'react'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  ArrowRightIcon,
  ClapperboardIcon,
  FlaskConicalIcon,
  LayoutDashboardIcon,
  MoonIcon,
  NewspaperIcon,
  RefreshCwIcon,
  SettingsIcon,
  SunIcon,
  TrendingUpIcon,
  UserRoundIcon,
  WalletIcon,
} from 'lucide-react'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Spinner } from '@/components/ui/spinner'
import { useTheme } from '@/lib/theme'
import { openProfile } from './Profile'
import { addStock, searchStocks } from '@/services/api'

const PAGES = [
  { icon: LayoutDashboardIcon, label: 'Stocks', to: '/' },
  { icon: NewspaperIcon, label: 'Events', to: '/events' },
  { icon: TrendingUpIcon, label: 'Top news', to: '/top-news' },
  { icon: WalletIcon, label: 'Holdings', to: '/holdings' },
  { icon: FlaskConicalIcon, label: 'Backtesting', to: '/backtesting' },
]

// Matches ManualBacktesting's real `view` tabs (router.jsx's backtestingRoute) - the old 'tab'
// param here pointed at the disabled Auto/Manual switcher and did nothing.
const BACKTEST_TABS = [
  { label: 'Backtesting > Overview', view: 'overview' },
  { label: 'Backtesting > Trades', view: 'trades' },
  { label: 'Backtesting > Statistics', view: 'statistics' },
  { label: 'Backtesting > Goals', view: 'goals' },
]

// Mirrors Settings.jsx's TabsTab list exactly.
const SETTINGS_TABS = [
  { label: 'Settings > Model', tab: 'model' },
  { label: 'Settings > LiteLLM', tab: 'litellm' },
  { label: 'Settings > Cogencis', tab: 'cogencis' },
  { label: 'Settings > Broker', tab: 'broker' },
  { label: 'Settings > Watch rules', tab: 'rules' },
  { label: 'Settings > Collect data', tab: 'data' },
  { label: 'Settings > Manage stocks', tab: 'stocks' },
  { label: 'Settings > Activity', tab: 'activity' },
  { label: 'Settings > Backtesting', tab: 'backtesting' },
  { label: 'Settings > Trade accounts', tab: 'accounts' },
]

// Global Cmd/Ctrl+K palette: pages + Backtesting/Settings tabs by default, or "@SYMBOL" to
// search stocks (same "@" convention ChatInput's tag menu already uses) and jump to its detail
// page - searched via the existing /api/stocks/search, same as any other tracked-stock lookup.
export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [stockError, setStockError] = useState(null)
  const navigate = useNavigate()
  const { theme, toggle: toggleTheme } = useTheme()

  useHotkey('Mod+K', () => setOpen((o) => !o))

  const close = () => {
    setOpen(false)
    setQuery('')
    setStockError(null)
  }

  const setQueryValue = (next) => {
    setQuery(next)
    setStockError(null)
  }

  const isStockSearch = query.startsWith('@')
  const stockQuery = query.slice(1).trim().toUpperCase()

  const { data: stockMatches = [] } = useQuery({
    queryKey: ['paletteStockSearch', stockQuery],
    queryFn: () => searchStocks(stockQuery),
    enabled: isStockSearch,
  })
  const exactStockMatch = stockMatches.some((s) => s.symbol === stockQuery)

  const goTo = (to, search) => {
    navigate(search ? { to, search } : { to })
    close()
  }

  const goToStock = (symbol) => {
    navigate({ to: '/stock/$symbol', params: { symbol } })
    close()
  }

  // Matches from /api/stocks/search are already-tracked, real symbols - navigate straight away.
  // An unmatched, freshly-typed symbol isn't confirmed to exist yet, so it's checked (the same
  // live-scrape POST /api/stocks always does) before navigating; on failure the error is shown
  // inline and the palette stays open instead of routing to an empty detail page.
  const verifyAndGo = useMutation({
    mutationFn: () => addStock(stockQuery),
    onSuccess: ({ symbol }) => goToStock(symbol),
    onError: (e) => setStockError(e.message),
  })

  const openSettings = (tab) => {
    navigate({ search: (prev) => ({ ...prev, settings: tab }) })
    close()
  }

  const openProfileModal = () => {
    openProfile()
    close()
  }

  const toggleThemeAndClose = () => {
    toggleTheme()
    close()
  }

  const reload = async () => {
    close()
    try {
      const res = await fetch('/api/cache/clear', { method: 'POST' })
      if (!res.ok) throw new Error('Failed to clear cache')
      window.location.reload()
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Jump to a page, a tab, or type @ to search stocks"
    >
      <Command shouldFilter={!isStockSearch}>
        <CommandInput
          value={query}
          onValueChange={setQueryValue}
          placeholder="Search pages, tabs, or @SYMBOL…"
        />
        <CommandList>
          {isStockSearch ? (
            <>
              <CommandEmpty>No matching stocks.</CommandEmpty>
              {stockMatches.map((s) => (
                <CommandItem key={s.symbol} value={s.symbol} onSelect={() => goToStock(s.symbol)}>
                  <TrendingUpIcon className="size-4" />
                  {s.symbol}
                </CommandItem>
              ))}
              {stockQuery && !exactStockMatch && (
                <CommandItem
                  value={`__goto__${stockQuery}`}
                  disabled={verifyAndGo.isPending}
                  onSelect={() => verifyAndGo.mutate()}
                >
                  {verifyAndGo.isPending ? (
                    <Spinner className="size-4" />
                  ) : (
                    <ArrowRightIcon className="size-4" />
                  )}
                  Go to "{stockQuery}"
                </CommandItem>
              )}
              {stockError && <p className="px-2 py-1.5 text-xs text-destructive">{stockError}</p>}
            </>
          ) : (
            <>
              <CommandEmpty>No matches.</CommandEmpty>
              <CommandGroup heading="Pages">
                {PAGES.map((p) => (
                  <CommandItem key={p.to} value={p.label} onSelect={() => goTo(p.to)}>
                    <p.icon className="size-4" />
                    {p.label}
                  </CommandItem>
                ))}
                <CommandItem value="Profile" onSelect={openProfileModal}>
                  <UserRoundIcon className="size-4" />
                  Profile
                </CommandItem>
              </CommandGroup>
              <CommandGroup heading="Backtesting">
                {BACKTEST_TABS.map((t) => (
                  <CommandItem
                    key={t.view}
                    value={t.label}
                    onSelect={() => goTo('/backtesting', { view: t.view })}
                  >
                    <FlaskConicalIcon className="size-4" />
                    {t.label}
                  </CommandItem>
                ))}
                <CommandItem value="Bar Replay" onSelect={() => goTo('/backtest/replay')}>
                  <ClapperboardIcon className="size-4" />
                  Bar Replay
                </CommandItem>
              </CommandGroup>
              <CommandGroup heading="Settings">
                {SETTINGS_TABS.map((s) => (
                  <CommandItem key={s.tab} value={s.label} onSelect={() => openSettings(s.tab)}>
                    <SettingsIcon className="size-4" />
                    {s.label}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="General">
                <CommandItem value="Reload" onSelect={reload}>
                  <RefreshCwIcon className="size-4" />
                  Reload (clear cache)
                </CommandItem>
                <CommandItem value="Toggle theme" onSelect={toggleThemeAndClose}>
                  {theme === 'dark' ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
                  {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
