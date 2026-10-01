// A full-screen chart for any stock, from anywhere: the Bar Replay chart (paper/PaperPositionChart's
// PaperChart - your saved indicators and chart settings, paper positions and alerts on it) with the
// paper order ticket beside it, so seeing a name and putting on a paper position is one click and
// one form. Mounted once in App; any table opens it with <ChartButton symbol=... /> or openChart().
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CandlestickChartIcon, ExternalLinkIcon, PanelRightCloseIcon, PanelRightOpenIcon, XIcon } from 'lucide-react'
import { create } from 'zustand'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { OrderPanel } from '@/paper/PaperTrades'
import { PaperChart } from '@/paper/PaperPositionChart'
import { getPaperAccounts } from '@/services/api'

const useChartModal = create<{ symbol: string | null }>(() => ({ symbol: null }))

/** Opens the chart modal on a stock. */
export const openChart = (symbol: string) => useChartModal.setState({ symbol: symbol.toUpperCase() })
const closeChart = () => useChartModal.setState({ symbol: null })

/** The chart icon at the head of a table row. Doesn't trigger the row's own click (which usually
 *  opens the stock page). */
export function ChartButton({ symbol, className }: { symbol: string; className?: string }) {
  return (
    <button
      type="button"
      aria-label={`Chart ${symbol}`}
      title={`Chart ${symbol}`}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        openChart(symbol)
      }}
      className={cn(
        'inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      <CandlestickChartIcon className="size-3.5" />
    </button>
  )
}

const ACCOUNT_KEY = 'chartModal.account'
const readAccount = () => {
  try {
    const v = Number(localStorage.getItem(ACCOUNT_KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

export default function ChartModal() {
  const symbol = useChartModal((s) => s.symbol)
  const { data: accounts = [] } = useQuery({ queryKey: ['paperAccounts'], queryFn: getPaperAccounts, enabled: !!symbol })
  // the paper account last traded from here, else the first one
  const [picked, setPicked] = useState<number | null>(readAccount)
  const account = accounts.find((a) => a.id === picked)?.id ?? accounts[0]?.id ?? null
  const [ticket, setTicket] = useState(true)
  const pick = (id: number) => {
    setPicked(id)
    try {
      localStorage.setItem(ACCOUNT_KEY, String(id))
    } catch {
      // private window: the choice lasts this session
    }
  }

  return (
    <Dialog open={!!symbol} onOpenChange={(open) => !open && closeChart()}>
      <DialogContent
        showCloseButton={false}
        className="top-2 right-2 bottom-2 left-2 flex w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{symbol} chart</DialogTitle>
        {symbol && (
          <PaperChart
            key={`${symbol}-${account}`}
            symbol={symbol}
            account={account}
            trailing={
              <div className="flex items-center gap-1 border-l pl-2">
                {accounts.length > 0 && (
                  <Select value={String(account)} onValueChange={(v) => pick(Number(v))}>
                    <SelectTrigger size="sm" className="w-44" title="Paper account: its positions show on the chart, orders go to it">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={ticket ? 'Hide order ticket' : 'Show order ticket'}
                  title={ticket ? 'Hide order ticket' : 'New paper order'}
                  onClick={() => setTicket((t) => !t)}
                >
                  {ticket ? <PanelRightCloseIcon className="size-4" /> : <PanelRightOpenIcon className="size-4" />}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  nativeButton={false}
                  aria-label="Open as a page"
                  title="Open as a page"
                  render={<Link to="/paper/$symbol" params={{ symbol }} search={{ account: account ?? undefined }} onClick={closeChart} />}
                >
                  <ExternalLinkIcon className="size-4" />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={closeChart}>
                  <XIcon className="size-4" />
                </Button>
              </div>
            }
            side={
              ticket && (
                <aside className="w-80 shrink-0 overflow-y-auto border-l">
                  {account == null ? (
                    <p className="p-4 text-sm text-muted-foreground">
                      No paper account yet -{' '}
                      <Link to="/paper" className="underline" onClick={closeChart}>
                        create one
                      </Link>{' '}
                      to trade from the chart.
                    </p>
                  ) : (
                    <OrderPanel key={`${symbol}-${account}`} accountId={account} symbol={symbol} className="space-y-3 p-4" />
                  )}
                </aside>
              )
            }
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
