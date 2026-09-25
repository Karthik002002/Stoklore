import { Link, Outlet } from '@tanstack/react-router'
import {
  IconBolt,
  IconChartCandle,
  IconChartHistogram,
  IconCpu,
  IconRobot,
  IconSitemap,
  IconFlask,
  IconLayoutDashboard,
  IconLayoutGrid,
  IconNews,
  IconRefresh,
  IconTrendingUp,
  IconUsersGroup,
  IconWallet,
  IconSettings,
} from '@tabler/icons-react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Toaster } from 'sonner'
import { Button } from '@/components/ui/button'
import { getEngineSettings } from '@/services/api'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import ActivityTracker from './ActivityTracker'
import ChatWidget from './ChatWidget'
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

const NAV_ITEMS: NavItem[] = [
  { to: '/', icon: IconLayoutDashboard, label: 'Stocks' },
  { to: '/events', icon: IconNews, label: 'Events' },
  { to: '/top-news', icon: IconTrendingUp, label: 'Top news' },
  { to: '/holdings', icon: IconWallet, label: 'Holdings' },
  { to: '/shareholding', icon: IconUsersGroup, label: 'Shareholding' },
  { to: '/backtesting', icon: IconFlask, label: 'Backtesting' },
  { to: '/paper', icon: IconChartCandle, label: 'Paper Trading' },
  { to: '/live', icon: IconBolt, label: 'Live Trading' },
  { to: '/engine', icon: IconCpu, label: 'Algo engine' },
  { to: '/simulation', icon: IconChartHistogram, label: 'Trade Simulation' },
  { to: '/agent', icon: IconRobot, label: 'Agent' },
  { to: '/workflows', icon: IconSitemap, label: 'Workflows' },
  { to: '/dashboards', icon: IconLayoutGrid, label: 'Dashboards' },
]

// Icon-rail nav item: TanStack Router's Link auto-applies an "active" class on route match
// (see the [&.active] selector), no route-matching hook needed.
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

function App() {
  // Background runs finish while you're on another page - see agent/useRunNotifications.ts.
  useRunNotifications()
  // the engine's user-chosen name (Settings > Algo engine) labels its nav icon
  const { data: engineName } = useQuery({
    queryKey: ['engineSettings'],
    queryFn: getEngineSettings,
    select: (s) => s.name,
  })
  const isBarReplay = window.location.pathname.includes('/backtest/replay')
  return (
    <TooltipProvider>
      <LoginGate>
        <div className="flex min-h-screen ">
          <aside className="no-print sticky top-0 flex h-screen w-14 shrink-0 flex-col items-center gap-1 border-r bg-background py-4">
            <Link
              to="/"
              aria-label="NSE Research"
              className="mb-5 flex size-8 items-center justify-center rounded-xl p-2 [animation:gradient-move_4s_ease-in-out_infinite] [background-image:linear-gradient(135deg,rgba(126,20,255,0.4),rgba(134,59,255,0.4),rgba(71,191,255,0.4),rgba(126,20,255,0.4))] [background-size:200%_200%]"
            >
              <img src="/favicon.svg" alt="" className="size-full drop-shadow-sm" />
            </Link>

            <nav className="flex flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <NavIcon
                  key={item.to}
                  {...item}
                  label={item.to === '/engine' ? (engineName ?? item.label) : item.label}
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
        {!isBarReplay && <ChatWidget />}
        <CommandPalette />
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
