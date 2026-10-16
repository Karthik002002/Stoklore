import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import {
  IconBolt,
  IconChartCandle,
  IconChartLine,
  IconChevronRight,
  IconLayoutSidebarLeftCollapse,
  IconChartHistogram,
  IconCpu,
  IconRobot,
  IconShieldHalf,
  IconSitemap,
  IconFlask,
  IconLayoutDashboard,
  IconLayoutGrid,
  IconNews,
  IconPlayerTrackNext,
  IconRefresh,
  IconTrendingUp,
  IconUsersGroup,
  IconWallet,
  IconSettings,
} from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useShortcut, useShortcutLabel } from '@/lib/shortcuts'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Toaster } from 'sonner'
import { Button } from '@/components/ui/button'
import { getEngineSettings } from '@/services/api'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import ActivityTracker from './ActivityTracker'
import ChatWidget from './ChatWidget'
import ChartModal from '@/components/ChartModal'
import CommandPalette from './CommandPalette'
import VoiceCapture from './VoiceCapture'
import useRunNotifications from './agent/useRunNotifications'
import WatchlistManager from './WatchlistManager'
import GuiltBanner from './GuiltBanner'
import Profile from './Profile'
import type { ComponentType } from 'react'
import type { LinkProps } from '@tanstack/react-router'
import ThemeToggle from './ThemeToggle'
import LoginGate from './LoginGate'
import SignOutButton from './SignOutButton'

type NavItem = { to: LinkProps['to']; icon: ComponentType<{ className?: string }>; label: string }

// The rail shows one icon per group; hovering it opens the group's pages as a menu beside the rail
// (like an admin sidebar's flyout), so the rail stays short however many pages there are.
type NavGroup = { label: string; icon: ComponentType<{ className?: string }>; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Markets',
    icon: IconLayoutDashboard,
    items: [
      { to: '/', icon: IconLayoutDashboard, label: 'Stocks' },
      { to: '/chart', icon: IconChartLine, label: 'Chart' },
      { to: '/events', icon: IconNews, label: 'Events' },
      { to: '/top-news', icon: IconTrendingUp, label: 'Top news' },
      { to: '/shareholding', icon: IconUsersGroup, label: 'Shareholding' },
    ],
  },
  {
    label: 'Trading',
    icon: IconChartCandle,
    items: [
      { to: '/holdings', icon: IconWallet, label: 'Holdings' },
      { to: '/paper', icon: IconChartCandle, label: 'Paper Trading' },
      { to: '/live', icon: IconBolt, label: 'Live Trading' },
      { to: '/risk', icon: IconShieldHalf, label: 'Book risk' },
    ],
  },
  {
    label: 'Practice',
    icon: IconFlask,
    items: [
      { to: '/backtesting', icon: IconFlask, label: 'Backtesting' },
      { to: '/backtest/replay', icon: IconPlayerTrackNext, label: 'Bar Replay' },
      { to: '/simulation', icon: IconChartHistogram, label: 'Trade Simulation' },
    ],
  },
  {
    label: 'Automation',
    icon: IconCpu,
    items: [
      { to: '/engine', icon: IconCpu, label: 'Algo engine' },
      { to: '/agent', icon: IconRobot, label: 'Agent' },
      { to: '/workflows', icon: IconSitemap, label: 'Workflows' },
      { to: '/dashboards', icon: IconLayoutGrid, label: 'Dashboards' },
    ],
  },
]

/** Is this page the one on screen (or a page under it)? "/" only matches itself. */
const isActive = (to: string, pathname: string) =>
  to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)

/** One group on the rail: its icon (lit when a page in it is open), and on hover a menu of its
 *  pages to the right. Clicking the icon opens the same menu, for touch. */
function NavGroupIcon({
  group,
  pathname,
  labelFor,
}: {
  group: NavGroup
  pathname: string
  labelFor: (i: NavItem) => string
}) {
  const [open, setOpen] = useState(false)
  const current = group.items.find((i) => isActive(String(i.to), pathname))
  const Icon = current?.icon ?? group.icon
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        openOnHover
        delay={60}
        closeDelay={120}
        aria-label={group.label}
        className={cn(
          'relative flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          current && 'bg-primary/10 text-primary',
          open && 'bg-muted text-foreground',
        )}
      >
        <Icon className="size-5" />
        {current && <span className="absolute -left-2 h-5 w-0.5 rounded-r bg-primary" />}
        {/* a small corner wedge inside the button, like a toolbar's "has a submenu" mark */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute right-[3px] bottom-[3px] size-0 border-b-[5px] border-l-[5px] border-b-current border-l-transparent',
            open ? 'opacity-90' : 'opacity-45',
          )}
        />
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={10} className="w-52 gap-0 p-1">
        <p className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {group.label}
        </p>
        {group.items.map((item) => {
          const active = isActive(String(item.to), pathname)
          return (
            <Link
              key={String(item.to)}
              to={item.to}
              onClick={() => setOpen(false)}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted',
                active ? 'bg-primary/10 font-medium text-primary' : 'text-foreground',
              )}
            >
              <item.icon className="size-4 shrink-0" />
              {labelFor(item)}
            </Link>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

// A single page on the rail (Settings, at the foot) - TanStack Router's Link adds an "active" class on
// a route match (the [&.active] selector).
function NavIcon({ to, icon: Icon, label }: NavItem) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to={to}
            className="relative flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&.active]:bg-primary/10 [&.active]:text-primary"
          />
        }
      >
        <Icon className="size-5" />
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

// Wraps an icon-button component (which owns its own click behavior) in a hover tooltip via a
// plain <span> - avoids composing two base-ui trigger primitives (Tooltip + Dialog/etc) on one
// element, which base-ui doesn't support cleanly. The span only intercepts hover, not clicks.
function TooltipIcon({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function ReloadButton() {
  const [loading, setLoading] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/cache/clear', { method: 'POST' })
      if (!res.ok) throw new Error('Failed to clear cache')
      window.location.reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear cache')
      setLoading(false)
    }
  }

  return (
    <Button variant="ghost" size="icon" onClick={reload} disabled={loading} aria-label="Reload">
      <IconRefresh className={`size-4 ${loading ? 'animate-spin' : ''}`} />
    </Button>
  )
}

// The nav rail can be hidden for more chart room. The choice is per browser (localStorage), and its
// width is published as --sidebar-w so the full-screen pages pinned beside it (Bar Replay, the
// position charts: `fixed ... left-[var(--sidebar-w)]`) slide over with it.
const SIDEBAR_KEY = 'sidebar.hidden'
const readHidden = () => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}

function useSidebar() {
  const [hidden, setHidden] = useState(readHidden)
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', hidden ? '0px' : '3.5rem')
    try {
      localStorage.setItem(SIDEBAR_KEY, hidden ? '1' : '0')
    } catch {
      // private window: the choice lasts this session
    }
  }, [hidden])
  useShortcut('global.sidebar', () => setHidden((h) => !h))
  return [hidden, setHidden] as const
}

function App() {
  const [sidebarHidden, setSidebarHidden] = useSidebar()
  const sidebarKey = useShortcutLabel('global.sidebar')
  // Background runs finish while you're on another page - see agent/useRunNotifications.ts.
  useRunNotifications()
  // the engine's user-chosen name (Settings > Algo engine) labels its nav icon
  const { data: engineName } = useQuery({
    queryKey: ['engineSettings'],
    queryFn: getEngineSettings,
    select: (s) => s.name,
  })
  // Full-screen workspaces whose bottom-right corner is taken (Bar Replay's controls, the chart page's
  // watchlist) get no floating chat button. Read from the router, so it follows navigation.
  const pathname = useRouterState({ select: (st) => st.location.pathname })
  const hideChat = pathname.includes('/backtest/replay') || pathname === '/chart'
  return (
    <TooltipProvider>
      <LoginGate>
        <div className="flex min-h-screen ">
          {sidebarHidden && (
            // A sliver on the left edge to bring the rail back - visible enough to find, small
            // enough to stay off the charts that now use the whole width.
            <button
              type="button"
              aria-label="Show sidebar"
              title={`Show sidebar (${sidebarKey})`}
              onClick={() => setSidebarHidden(false)}
              className="no-print fixed top-1/2 left-0 z-50 flex h-12 w-3 -translate-y-1/2 items-center justify-center rounded-r-md border border-l-0 bg-background text-muted-foreground opacity-60 hover:w-5 hover:opacity-100"
            >
              <IconChevronRight className="size-3" />
            </button>
          )}
          <aside
            className={`no-print sticky top-0 h-screen w-14 shrink-0 flex-col items-center gap-1 border-r bg-background py-4 ${sidebarHidden ? 'hidden' : 'flex'}`}
          >
            <Link
              to="/"
              aria-label="NSE Research"
              className="mb-5 flex size-8 items-center justify-center rounded-xl p-2 [animation:gradient-move_4s_ease-in-out_infinite] [background-image:linear-gradient(135deg,rgba(126,20,255,0.4),rgba(134,59,255,0.4),rgba(71,191,255,0.4),rgba(126,20,255,0.4))] [background-size:200%_200%]"
            >
              <img src="/favicon.svg" alt="" className="size-full drop-shadow-sm" />
            </Link>

            <nav className="flex flex-col gap-1">
              {NAV_GROUPS.map((group) => (
                <NavGroupIcon
                  key={group.label}
                  group={group}
                  pathname={pathname}
                  labelFor={(item) => (item.to === '/engine' ? (engineName ?? item.label) : item.label)}
                />
              ))}
            </nav>

            <div className="mt-auto flex flex-col items-center gap-1">
              <TooltipIcon label="Reload">
                <ReloadButton />
              </TooltipIcon>
              <TooltipIcon label="Profile">
                <Profile />
              </TooltipIcon>
              <NavIcon to="/settings" icon={IconSettings} label="Settings" />
              <TooltipIcon label="Toggle theme">
                <ThemeToggle />
              </TooltipIcon>
              <TooltipIcon label="Sign out">
                <SignOutButton />
              </TooltipIcon>
              <TooltipIcon label={`Hide sidebar (${sidebarKey})`}>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Hide sidebar"
                  onClick={() => setSidebarHidden(true)}
                >
                  <IconLayoutSidebarLeftCollapse className="size-4" />
                </Button>
              </TooltipIcon>
            </div>
          </aside>

          {/* Full available width, no centered max-width column - the dashboard/table views are
            dense and horizontal, so capping them at a reading-width column wasted most of the
            screen. min-w-0 is what actually lets wide tables scroll inside this flex child
            instead of forcing the whole page to overflow sideways. */}
          <main className={`min-w-0 flex-1 px-2 py-3 `}>
            <GuiltBanner />
            <Outlet />
          </main>
        </div>

        <ActivityTracker />
        {!hideChat && <ChatWidget />}
        <CommandPalette />
        <ChartModal />
        <VoiceCapture />
        <WatchlistManager />
      </LoginGate>
      {/* Outside the gate: a toast is how a failed sign-in and a dropped session announce
          themselves, so it has to exist while the login dialog is up. */}
      <Toaster position="top-center" richColors closeButton />
    </TooltipProvider>
  )
}

export default App
