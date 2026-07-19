import { Link, Outlet } from '@tanstack/react-router'
import { Toaster } from 'sonner'
import ChatWidget from './ChatWidget'
import ThemeToggle from './ThemeToggle'

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
          <div className="ml-auto">
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
