import { Link, Outlet } from '@tanstack/react-router'
import { RefreshCwIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Toaster } from 'sonner'
import { Button } from '@/components/ui/button'
import ChatWidget from './ChatWidget'
import Settings from './Settings'
import ThemeToggle from './ThemeToggle'

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
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link to="/" className="text-lg font-semibold tracking-tight">
            NSE Research
          </Link>
          <span className="text-sm text-muted-foreground">
            live movers · AI reports · local llama
          </span>
          <Link
            to="/events"
            className="text-sm text-muted-foreground hover:text-foreground [&.active]:text-foreground"
          >
            Events
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <ReloadButton />
            <Settings />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>

      <ChatWidget />
      <Toaster position="top-center" richColors closeButton />
    </div>
  )
}

export default App
