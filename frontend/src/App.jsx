import { Link, Outlet } from '@tanstack/react-router'
import {
  IconChartCandle,
  IconChartHistogram,
  IconFlask,
  IconLayoutDashboard,
  IconNews,
  IconRefresh,
  IconTrendingUp,
  IconUsersGroup,
  IconWallet,
} from '@tabler/icons-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Toaster } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import ActivityTracker from './ActivityTracker'
import ChatWidget from './ChatWidget'
import CommandPalette from './CommandPalette'
import GuiltBanner from './GuiltBanner'
import Profile from './Profile'
import Settings from './Settings'
import ThemeToggle from './ThemeToggle'

const NAV_ITEMS = [
  { to: '/', icon: IconLayoutDashboard, label: 'Stocks' },
  { to: '/events', icon: IconNews, label: 'Events' },
  { to: '/top-news', icon: IconTrendingUp, label: 'Top news' },
  { to: '/holdings', icon: IconWallet, label: 'Holdings' },
  { to: '/shareholding', icon: IconUsersGroup, label: 'Shareholding' },
  { to: '/backtesting', icon: IconFlask, label: 'Backtesting' },
  { to: '/paper', icon: IconChartCandle, label: 'Paper Trading' },
  { to: '/simulation', icon: IconChartHistogram, label: 'Trade Simulation' },
]

// Icon-rail nav item: TanStack Router's Link auto-applies an "active" class on route match
// (see the [&.active] selector), no route-matching hook needed.
function NavIcon({ to, icon: Icon, label }) {
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
function TooltipIcon({ label, children }) {
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
      toast.error(err.message)
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
  const isBarReplay = window.location.pathname.includes('/backtest/replay')
  return (
    <TooltipProvider>
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
              <NavIcon key={item.to} {...item} />
            ))}
          </nav>

          <div className="mt-auto flex flex-col items-center gap-1">
            <TooltipIcon label="Reload">
              <ReloadButton />
            </TooltipIcon>
            <TooltipIcon label="Profile">
              <Profile />
            </TooltipIcon>
            <TooltipIcon label="Settings">
              <Settings />
            </TooltipIcon>
            <TooltipIcon label="Toggle theme">
              <ThemeToggle />
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
      <Toaster position="top-center" richColors closeButton />
    </TooltipProvider>
  )
}

export default App
