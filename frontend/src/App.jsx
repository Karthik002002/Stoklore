import { useState } from 'react'
import { Toaster } from 'sonner'
import ChatWidget from './ChatWidget'
import StockDetail from './StockDetail'
import StocksList from './StocksList'
import ThemeToggle from './ThemeToggle'

function App() {
  const [symbol, setSymbol] = useState(null)

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <button
            onClick={() => setSymbol(null)}
            className="text-lg font-semibold tracking-tight"
          >
            NSE Research
          </button>
          <span className="text-sm text-muted-foreground">
            live movers · AI reports · local llama
          </span>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {symbol ? (
          <StockDetail symbol={symbol} onBack={() => setSymbol(null)} />
        ) : (
          <StocksList onSelect={setSymbol} />
        )}
      </main>

      <ChatWidget />
      <Toaster position="top-center" richColors closeButton />
    </div>
  )
}

export default App
