import { Link, Outlet } from '@tanstack/react-router'
import { LayoutDashboardIcon, NewspaperIcon, RefreshCwIcon, TrendingUpIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Toaster } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import ChatWidget from './ChatWidget'
import Settings from './Settings'
import ThemeToggle from './ThemeToggle'

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboardIcon, label: 'Stocks' },
  { to: '/events', icon: NewspaperIcon, label: 'Events' },
  { to: '/top-news', icon: TrendingUpIcon, label: 'Top news' },
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
            className="relative flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&.active]:bg-primary/10 [&.active]:text-primary"
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
      <RefreshCwIcon className={`size-4 ${loading ? 'animate-spin' : ''}`} />
    </Button>
  )
}

function App() {
  return (
    <TooltipProvider>
      <div className="flex min-h-screen bg-muted/30">
        <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col items-center gap-1 border-r bg-background py-4">
          <Link
            to="/"
            aria-label="NSE Research"
            className="mb-5 flex size-10 items-center justify-center rounded-xl p-2 [animation:gradient-move_4s_ease-in-out_infinite] [background-image:linear-gradient(135deg,rgba(126,20,255,0.4),rgba(134,59,255,0.4),rgba(71,191,255,0.4),rgba(126,20,255,0.4))] [background-size:200%_200%]"
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
            <TooltipIcon label="Settings">
              <Settings />
            </TooltipIcon>
            <TooltipIcon label="Toggle theme">
              <ThemeToggle />
            </TooltipIcon>
          </div>
        </aside>

        <main className="mx-auto w-full max-w-5xl px-4 py-8">
          <Outlet />
        </main>
      </div>

      <ChatWidget />
      <Toaster position="top-center" richColors closeButton />
    </TooltipProvider>
  )
}

export default App
