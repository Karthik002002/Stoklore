// A full-screen chart for any stock, from anywhere: the Bar Replay chart (paper/PaperPositionChart's
// PaperChart - your saved indicators and chart settings, paper positions and alerts on it) with the
// paper order ticket beside it, so seeing a name and putting on a paper position is one click and
// one form. Mounted once in App; any table opens it with <ChartButton symbol=... /> or openChart().
//
// It is also the scanner: <ScanButton symbols=...> (or a watchlist's Scan) flips the same chart
// through a list of stocks like a slideshow - a timer and/or the arrow keys - while 1/2/3 marks the
// one on screen A/B/C, so a swing trader can read fifty charts in a row without touching the symbol
// box. Scans and their marks live in Postgres (app/routers/scans.py); /scans reviews them.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  CandlestickChartIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PauseIcon,
  PlayIcon,
  XIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { create } from 'zustand'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { inr } from '@/lib/format'
import { cn } from '@/lib/utils'
import { OrderPanel } from '@/paper/PaperTrades'
import { PaperChart } from '@/paper/PaperPositionChart'
import { createScan, getPaperAccounts, getScan, getStockChart, markScan, updateScan } from '@/services/api'
import type { Scan, ScanMark, ScanPriority } from '@/services/api'

type ModalState = { symbol: string | null; scan: Scan | null; index: number }
const useChartModal = create<ModalState>(() => ({ symbol: null, scan: null, index: 0 }))

/** Opens the chart modal on a stock. */
export const openChart = (symbol: string) =>
  useChartModal.setState({ symbol: symbol.toUpperCase(), scan: null, index: 0 })
const closeChart = () => useChartModal.setState({ symbol: null, scan: null, index: 0 })
const showScan = (scan: Scan, index: number) =>
  useChartModal.setState({ scan, index, symbol: scan.symbols[index] ?? scan.symbols[0] })

/** Starts a scan over these stocks, in this order, and opens it. */
export async function startScan(name: string, source: string, symbols: string[]) {
  try {
    showScan(await createScan(name, source, symbols), 0)
  } catch (e) {
    toast.error((e as Error).message)
  }
}

/** Opens a saved scan where it was left (or from the top, if it was finished). */
export async function resumeScan(id: number, at?: number) {
  try {
    const scan = await getScan(id)
    showScan(scan, at ?? (scan.finished_at ? 0 : scan.position))
  } catch (e) {
    toast.error((e as Error).message)
  }
}

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

/** "Scan these": slideshow every stock a table is showing, in its order. */
export function ScanButton({
  symbols,
  name,
  source,
  className,
}: {
  symbols: string[]
  name: string
  source: string
  className?: string
}) {
  const list = [...new Set(symbols.filter(Boolean))]
  if (!list.length) return null
  return (
    <button
      type="button"
      title={`Scan these ${list.length} - one chart at a time, mark A/B/C as you go`}
      aria-label={`Scan ${list.length} stocks`}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        startScan(name, source, list)
      }}
      className={cn(
        'inline-flex h-5 items-center gap-0.5 rounded px-1 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      <PlayIcon className="size-3" />
      Scan
    </button>
  )
}

const ACCOUNT_KEY = 'chartModal.account'
const SECONDS_KEY = 'chartModal.scanSeconds'
const SPEEDS = [2, 3, 5, 8, 12, 20]
const read = (key: string) => {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}
const write = (key: string, v: number) => {
  try {
    localStorage.setItem(key, String(v))
  } catch {
    // private window: the choice lasts this session
  }
}

export const PRIORITY: Record<ScanPriority, { label: string; className: string }> = {
  A: { label: 'act now', className: 'bg-up/20 text-up border-up/50' },
  B: { label: 'watch closely', className: 'bg-amber-500/20 text-amber-500 border-amber-500/50' },
  C: { label: 'maybe later', className: 'bg-sky-500/20 text-sky-500 border-sky-500/50' },
}
const KEYS: Record<string, ScanPriority> = { '1': 'A', '2': 'B', '3': 'C' }

export default function ChartModal() {
  const { symbol, scan, index } = useChartModal()
  const queryClient = useQueryClient()
  const { data: accounts = [] } = useQuery({ queryKey: ['paperAccounts'], queryFn: getPaperAccounts, enabled: !!symbol })
  // the paper account last traded from here, else the first one
  const [picked, setPicked] = useState<number | null>(() => read(ACCOUNT_KEY))
  const account = accounts.find((a) => a.id === picked)?.id ?? accounts[0]?.id ?? null
  const [ticket, setTicket] = useState(true)
  const [range, setRange] = useState('6mo')

  // --- scan state ----------------------------------------------------------------------------
  const [playing, setPlaying] = useState(false)
  const [seconds, setSeconds] = useState(() => read(SECONDS_KEY) ?? 5)
  const [marks, setMarks] = useState<Record<string, ScanMark>>({})
  const [note, setNote] = useState('')
  const [done, setDone] = useState(false)
  const noteRef = useRef<HTMLInputElement>(null)
  const scanId = scan?.id
  useEffect(() => {
    // a new scan: its saved marks, paused, ticket out of the way (the chart is the point)
    setMarks(Object.fromEntries((scan?.marks ?? []).map((m) => [m.symbol, m])))
    setPlaying(false)
    setDone(false)
    if (scan) setTicket(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId])
  useEffect(() => setNote((symbol && marks[symbol]?.note) || ''), [symbol, marks])

  const total = scan?.symbols.length ?? 0
  const go = useCallback(
    (to: number) => {
      if (!scan) return
      if (to >= total) {
        setPlaying(false)
        setDone(true)
        updateScan(scan.id, { finished: true }).catch(() => {})
        queryClient.invalidateQueries({ queryKey: ['scans'] })
        return
      }
      const i = Math.max(0, to)
      setDone(false)
      useChartModal.setState({ index: i, symbol: scan.symbols[i] })
      updateScan(scan.id, { position: i }).catch(() => {})
    },
    [scan, total, queryClient],
  )

  // the next chart loads while this one is read, so a flip is instant
  useEffect(() => {
    const next = scan?.symbols[index + 1]
    if (next)
      queryClient.prefetchQuery({ queryKey: ['stockChart', next, range], queryFn: () => getStockChart(next, range) })
  }, [scan, index, range, queryClient])

  // the timer: one flip per `seconds` while playing
  useEffect(() => {
    if (!scan || !playing) return
    const id = setTimeout(() => go(index + 1), seconds * 1000)
    return () => clearTimeout(id)
  }, [scan, playing, index, seconds, go])

  const mark = useCallback(
    async (priority: ScanPriority | null, withNote = note) => {
      if (!scan || !symbol) return
      setPlaying(false) // deciding is not rushed: marking stops the clock
      const bars = queryClient.getQueryData<{ bars: { close: number }[] }>(['stockChart', symbol, range])?.bars
      const price = bars?.at(-1)?.close ?? null
      const prev = marks[symbol]
      setMarks((m) => ({ ...m, [symbol]: { symbol, priority, note: withNote || null, price, marked_at: new Date().toISOString() } }))
      try {
        const r = await markScan(scan.id, symbol, { priority, note: withNote || null, price })
        setMarks((m) => {
          const next = { ...m }
          if (r.mark) next[symbol] = r.mark
          else delete next[symbol]
          return next
        })
        queryClient.invalidateQueries({ queryKey: ['scans'] })
      } catch (e) {
        setMarks((m) => (prev ? { ...m, [symbol]: prev } : Object.fromEntries(Object.entries(m).filter(([k]) => k !== symbol))))
        toast.error((e as Error).message)
      }
    },
    [scan, symbol, note, marks, range, queryClient],
  )

  // keys: → / ← flip, Space play/pause, 1-3 mark, 0 clear, N note. Never while typing in a field.
  // Handled keys stop here (stopPropagation), so nothing else in the dialog acts on them too.
  useEffect(() => {
    if (!scan) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return
      if (e.key === 'ArrowRight' || e.key === 'l') go(index + 1)
      else if (e.key === 'ArrowLeft' || e.key === 'h') go(index - 1)
      else if (e.key === ' ') setPlaying((p) => (done ? p : !p))
      else if (KEYS[e.key]) mark(KEYS[e.key])
      else if (e.key === '0') mark(null, '')
      else if (e.key === 'n' || e.key === 'N') noteRef.current?.focus()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    // capture phase: Base UI's DialogPopup stops arrow keys (its "composite keys") from bubbling out
    // of the dialog, so a bubbling listener on window never sees ← / →
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [scan, index, done, go, mark])

  const pick = (id: number) => {
    setPicked(id)
    write(ACCOUNT_KEY, id)
  }
  const counts = Object.values(marks).reduce<Record<string, number>>(
    (c, m) => (m.priority ? { ...c, [m.priority]: (c[m.priority] ?? 0) + 1 } : c),
    {},
  )
  const current = symbol ? marks[symbol] : undefined

  const scanControls = scan && (
    <div className="flex items-center gap-1 border-l pl-2">
      <Button
        size="icon-sm"
        variant={playing ? 'secondary' : 'ghost'}
        aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
        title={playing ? 'Pause (Space)' : `Play - a new chart every ${seconds}s (Space)`}
        disabled={done}
        onClick={() => setPlaying((p) => !p)}
      >
        {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
      </Button>
      <Select
        value={String(seconds)}
        onValueChange={(v) => {
          setSeconds(Number(v))
          write(SECONDS_KEY, Number(v))
        }}
      >
        <SelectTrigger size="sm" className="w-16" title="Seconds per chart">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SPEEDS.map((s) => (
            <SelectItem key={s} value={String(s)}>
              {s}s
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="icon-sm" variant="ghost" aria-label="Previous (←)" title="Previous (←)" disabled={index === 0} onClick={() => go(index - 1)}>
        <ChevronLeftIcon className="size-4" />
      </Button>
      <span className="min-w-14 text-center font-mono text-xs tabular-nums" title={scan.name}>
        {index + 1} / {total}
      </span>
      <Button size="icon-sm" variant="ghost" aria-label="Next (→)" title="Next (→)" onClick={() => go(index + 1)}>
        <ChevronRightIcon className="size-4" />
      </Button>
      <span className="ml-1 flex gap-1 font-mono text-[11px]">
        {(['A', 'B', 'C'] as const).map((p) => (
          <span key={p} className={cn('rounded border px-1', PRIORITY[p].className)} title={`${PRIORITY[p].label}: ${counts[p] ?? 0}`}>
            {p} {counts[p] ?? 0}
          </span>
        ))}
      </span>
    </div>
  )

  const markBar = scan && symbol && (
    <div className="shrink-0 border-t">
      {/* the clock: fills over `seconds`, restarts on every chart */}
      <div className="h-0.5 bg-muted">
        {playing && !done && (
          <div key={`${index}-${seconds}`} className="h-full bg-primary" style={{ animation: `scan-clock ${seconds}s linear forwards` }} />
        )}
      </div>
      {done ? (
        <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
          <span className="font-medium">Scan finished</span>
          <span className="text-muted-foreground">
            {counts.A ?? 0} A · {counts.B ?? 0} B · {counts.C ?? 0} C of {total}
          </span>
          <Button size="sm" nativeButton={false} render={<Link to="/scans/$scanId" params={{ scanId: String(scan.id) }} onClick={closeChart} />}>
            Review
          </Button>
          <Button size="sm" variant="ghost" onClick={() => go(0)}>
            Scan again from the top
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
          <span className="font-semibold">{symbol}</span>
          {(['A', 'B', 'C'] as const).map((p, i) => (
            <button
              key={p}
              type="button"
              onClick={() => mark(current?.priority === p ? null : p)}
              className={cn(
                'rounded border px-2 py-0.5 font-medium',
                current?.priority === p ? PRIORITY[p].className : 'text-muted-foreground hover:bg-muted',
              )}
              title={`${PRIORITY[p].label} (${i + 1})`}
            >
              <kbd className="mr-1 font-mono opacity-60">{i + 1}</kbd>
              {p} · {PRIORITY[p].label}
            </button>
          ))}
          <input
            ref={noteRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                mark(current?.priority ?? null, note)
                e.currentTarget.blur()
              }
              if (e.key === 'Escape') {
                e.stopPropagation()
                e.currentTarget.blur()
              }
            }}
            placeholder="Note (N) - Enter saves"
            className="h-7 min-w-48 flex-1 rounded border bg-transparent px-2 outline-none focus:border-ring"
          />
          {current?.price != null && <span className="text-muted-foreground">marked at {inr(current.price)}</span>}
          <span className="ml-auto text-muted-foreground">
            <kbd className="font-mono">←</kbd>/<kbd className="font-mono">→</kbd> flip · <kbd className="font-mono">Space</kbd> play · <kbd className="font-mono">0</kbd> clear
          </span>
        </div>
      )}
    </div>
  )

  return (
    <Dialog open={!!symbol} onOpenChange={(open) => !open && closeChart()}>
      <DialogContent
        showCloseButton={false}
        className="top-2 right-2 bottom-2 left-2 flex w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{scan ? `Scan ${scan.name}` : `${symbol} chart`}</DialogTitle>
        {symbol && (
          <PaperChart
            key={`${symbol}-${account}`}
            symbol={symbol}
            account={account}
            range={range}
            onRangeChange={setRange}
            leading={
              current?.priority ? (
                <span className={cn('rounded border px-1.5 font-mono text-[11px] font-semibold', PRIORITY[current.priority].className)}>
                  {current.priority}
                </span>
              ) : undefined
            }
            trailing={
              <>
                {scanControls}
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
              </>
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
            footer={markBar}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
