import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  PlusIcon,
  BookmarkIcon,
  CheckIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  RadarIcon,
  RefreshCwIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import TerminalPanel, { TerminalRow } from '@/components/TerminalPanel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fmt, formatDate, inr } from '@/lib/format'
import { usePageTitle } from '@/lib/usePageTitle'
import {
  getEvents,
  getEventsAttention,
  getIndices,
  getStocks,
  getTopNews,
  getWatchlist,
  getWatchlistNames,
  pingActivity,
} from '@/services/api'
import DeleteStockButton from './DeleteStockButton'

// --- formatting helpers, shared by every panel ------------------------------------------------
const pctClass = (v) => (v == null ? 'text-muted-foreground' : v >= 0 ? 'text-up' : 'text-down')
const signedPct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${fmt(v)}%`)
const arrow = (v) => (v == null ? '' : v >= 0 ? '▲' : '▼')
const num = (v) => (v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 2 }))
const clock = (secs) =>
  [Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':')

// NSE cash-market hours, evaluated in IST regardless of the viewer's own timezone (the exchange's
// clock is the only one that matters here) - 9:15-15:30, weekdays. Holidays aren't accounted for;
// there's no exchange-holiday calendar in this app, so a trading holiday reads as "OPEN".
// ponytail: add a holiday list if that ever misleads anyone in practice.
const OPEN_MINUTES = 9 * 60 + 15
const CLOSE_MINUTES = 15 * 60 + 30

function nseSession() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date())
  const get = (type) => parts.find((p) => p.type === type)?.value
  const weekday = get('weekday')
  const minutes = Number(get('hour')) * 60 + Number(get('minute'))
  const time = `${get('hour')}:${get('minute')} IST`
  if (weekday === 'Sat' || weekday === 'Sun') return { open: false, label: 'CLOSED · WEEKEND', time }
  if (minutes < OPEN_MINUTES) return { open: false, label: 'PRE-OPEN', time }
  if (minutes >= CLOSE_MINUTES) return { open: false, label: 'CLOSED', time }
  return { open: true, label: 'OPEN', time }
}

// --- ticker tape -----------------------------------------------------------------------------
// The index list is rendered twice back-to-back and the strip slides exactly one copy's width
// (see index.css's ticker-scroll), so the wrap-around is seamless rather than snapping back.
function TickerTape({ indices }) {
  if (!indices?.length) return null
  return (
    <div className="overflow-hidden rounded-md border bg-card/40 py-1.5">
      <div className="flex w-max animate-[ticker-scroll_40s_linear_infinite] hover:[animation-play-state:paused]">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0">
            {indices.map((i) => (
              <span
                key={i.name}
                className="flex items-center gap-1.5 px-4 font-mono text-xs whitespace-nowrap"
              >
                <span className="text-muted-foreground">{i.name}</span>
                <span className="tabular-nums">{num(i.price)}</span>
                <span className={`tabular-nums ${pctClass(i.changePercent)}`}>
                  {arrow(i.changePercent)} {signedPct(i.changePercent)}
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// --- panels ----------------------------------------------------------------------------------
function IndicesPanel({ indices, isFetching, onRefresh }) {
  return (
    <TerminalPanel
      title="Indices"
      accent="text-amber-500"
      actions={<RefreshButton busy={isFetching} onClick={onRefresh} label="Refresh indices" />}
    >
      {!indices ? (
        <PanelLoading />
      ) : (
        <table className="w-full font-mono text-xs">
          <thead>
            <tr className="border-b text-[10px] tracking-widest text-muted-foreground uppercase">
              <th className="px-2 py-1 text-left font-medium">Symbol</th>
              <th className="px-2 py-1 text-right font-medium">Price</th>
              <th className="px-2 py-1 text-right font-medium">Chg%</th>
            </tr>
          </thead>
          <tbody>
            {indices.map((i) => (
              <tr key={i.name} className="border-b border-border/40 last:border-0">
                <td className="px-2 py-1 font-semibold">{i.name}</td>
                <td className="px-2 py-1 text-right tabular-nums">{num(i.price)}</td>
                <td className={`px-2 py-1 text-right tabular-nums ${pctClass(i.changePercent)}`}>
                  {signedPct(i.changePercent)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TerminalPanel>
  )
}

// Breadth / movers are derived entirely from the tracked-stock list already on screen - this is
// "how is *your* universe doing", not a market-wide feed (the app has no such data source), so
// the counts deliberately say "tracked" rather than implying full-market breadth.
function MarketPulsePanel({ stocks }) {
  const rated = useMemo(() => (stocks ?? []).filter((s) => s.changePercent != null), [stocks])
  const advancers = rated.filter((s) => s.changePercent > 0)
  const decliners = rated.filter((s) => s.changePercent < 0)
  const advanceRatio = rated.length ? Math.round((advancers.length / rated.length) * 100) : null
  // Split by sign before slicing, so a mostly-green day never lists a gainer under "Top losers"
  // (which a plain sort-and-take-the-tail would do once there are fewer than 6 tracked stocks).
  const sorted = [...rated].sort((a, b) => b.changePercent - a.changePercent)
  const gainers = advancers.length ? sorted.filter((s) => s.changePercent > 0).slice(0, 3) : []
  const losers = sorted
    .filter((s) => s.changePercent < 0)
    .slice(-3)
    .reverse()
  const session = nseSession()

  return (
    <TerminalPanel title="Market Pulse" accent="text-cyan-500">
      <div className="border-b px-2 py-2">
        <div className="flex items-baseline justify-between font-mono">
          <span className="text-2xl font-semibold tabular-nums">{advanceRatio ?? '—'}</span>
          <span className="text-[10px] tracking-widest text-muted-foreground uppercase">Advance ratio</span>
        </div>
        <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="bg-up" style={{ width: `${advanceRatio ?? 0}%` }} />
          <div className="flex-1 bg-down" />
        </div>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
          {advancers.length} up · {decliners.length} down · {rated.length} tracked
        </p>
      </div>

      <TerminalRow
        label="NSE session"
        value={session.label}
        valueClassName={session.open ? 'text-up' : 'text-muted-foreground'}
      />
      <TerminalRow label="Exchange time" value={session.time} />

      <MoverList title="Top gainers" rows={gainers} />
      <MoverList title="Top losers" rows={losers} />
    </TerminalPanel>
  )
}

function MoverList({ title, rows }) {
  if (rows.length === 0) return null
  return (
    <div className="border-b last:border-0">
      <p className="bg-muted/20 px-2 py-1 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
        {title}
      </p>
      {rows.map((s) => (
        <TerminalRow
          key={s.symbol}
          label={s.symbol}
          value={`${arrow(s.changePercent)} ${signedPct(s.changePercent)}`}
          valueClassName={pctClass(s.changePercent)}
        />
      ))}
    </div>
  )
}

// Surfaces GET /api/events/attention - which tracked stocks are getting more event coverage than
// their own normal pace (see docs/events-feed.md). Same scores the Events page charts, condensed.
function AttentionPanel({ attention }) {
  const hot = (attention ?? [])
    .filter((a) => a.is_new_attention || (a.ratio != null && a.ratio >= 1.3))
    .slice(0, 8)
  return (
    <TerminalPanel title="Unusual Attention" accent="text-fuchsia-500">
      {!attention ? (
        <PanelLoading />
      ) : hot.length === 0 ? (
        <PanelEmpty>Nothing above its usual coverage pace.</PanelEmpty>
      ) : (
        hot.map((a) => (
          <Link
            key={a.symbol}
            to="/stock/$symbol"
            params={{ symbol: a.symbol }}
            className="block hover:bg-muted/40"
          >
            <TerminalRow
              label={
                <>
                  <span className="font-semibold text-foreground">{a.symbol}</span>{' '}
                  <span className="text-muted-foreground">
                    {a.recent_count} evt{a.recent_count === 1 ? '' : 's'}
                  </span>
                </>
              }
              value={a.is_new_attention ? 'NEW' : `${a.ratio}×`}
              valueClassName="text-fuchsia-500"
            />
          </Link>
        ))
      )}
    </TerminalPanel>
  )
}

function EventsPanel({ events }) {
  return (
    <TerminalPanel title="Recent Events" accent="text-emerald-500">
      {!events ? (
        <PanelLoading />
      ) : events.length === 0 ? (
        <PanelEmpty>
          No events yet — run a scan from the{' '}
          <Link to="/events" className="underline">
            Events
          </Link>{' '}
          page.
        </PanelEmpty>
      ) : (
        events.slice(0, 12).map((e) => (
          <div key={e.id} className="border-b border-border/40 px-2 py-1 font-mono text-xs last:border-0">
            <div className="flex items-center gap-2">
              <Link
                to="/stock/$symbol"
                params={{ symbol: e.symbol }}
                className="shrink-0 font-semibold hover:underline"
              >
                {e.symbol}
              </Link>
              <span className="truncate text-muted-foreground" title={e.headline}>
                {e.headline}
              </span>
              <span
                className={`ml-auto shrink-0 text-[10px] uppercase ${
                  e.sentiment_label === 'positive'
                    ? 'text-up'
                    : e.sentiment_label === 'negative'
                      ? 'text-down'
                      : 'text-muted-foreground'
                }`}
              >
                {e.event_time ? formatDate(e.event_time) : ''}
              </span>
            </div>
          </div>
        ))
      )}
    </TerminalPanel>
  )
}

function NewsPanel({ news, error }) {
  return (
    <TerminalPanel title="Market News" accent="text-blue-500">
      {error ? (
        <PanelEmpty>Cogencis isn’t configured — add a token in Settings → Cogencis.</PanelEmpty>
      ) : !news ? (
        <PanelLoading />
      ) : news.length === 0 ? (
        <PanelEmpty>No stories cached yet.</PanelEmpty>
      ) : (
        news.slice(0, 12).map((n) => (
          <a
            key={n.url}
            href={n.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 border-b border-border/40 px-2 py-1 font-mono text-xs last:border-0 hover:bg-muted/40"
          >
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {n.published_at ? formatDate(n.published_at) : '—'}
            </span>
            <span className="truncate" title={n.title}>
              {n.title}
            </span>
            {n.affected_symbols?.length > 0 && (
              <span className="ml-auto shrink-0 text-[10px] text-amber-500">
                {n.affected_symbols.slice(0, 2).join(' ')}
              </span>
            )}
          </a>
        ))
      )}
    </TerminalPanel>
  )
}

function PanelLoading() {
  return (
    <div className="flex items-center justify-center gap-2 py-8 font-mono text-xs text-muted-foreground">
      <Spinner className="size-3.5" /> LOADING…
    </div>
  )
}

function PanelEmpty({ children }) {
  return <p className="px-2 py-6 text-center font-mono text-xs text-muted-foreground">{children}</p>
}

function RefreshButton({ busy, onClick, label }) {
  return (
    <Button size="icon-sm" variant="ghost" className="size-5" aria-label={label} onClick={onClick}>
      {busy ? <Spinner className="size-3" /> : <RefreshCwIcon className="size-3" />}
    </Button>
  )
}

// --- status bar ------------------------------------------------------------------------------
// Everything here is measured, not decorative: SESSION counts up from page mount, LAT is the last
// /api/stocks round-trip, MEM only renders where the browser actually exposes it (Chromium's
// performance.memory), and FEEDS reflects real query error state.
function StatusBar({ session, latencyMs, symbolCount, stale, lastUpdated }) {
  const mem = performance.memory?.usedJSHeapSize
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-card/40 px-3 py-1.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
      <span className="text-foreground">NSE TERMINAL</span>
      <span>
        SESSION: <span className="text-foreground tabular-nums">{clock(session)}</span>
      </span>
      <span>
        SYMBOLS: <span className="text-foreground tabular-nums">{symbolCount}</span>
      </span>
      <span>
        FEEDS: <span className={stale ? 'text-down' : 'text-up'}>{stale ? 'DEGRADED' : 'CONNECTED'}</span>
      </span>
      <span className="ml-auto">
        LAT:{' '}
        <span className="text-foreground tabular-nums">{latencyMs == null ? '—' : `${latencyMs}ms`}</span>
      </span>
      {mem != null && (
        <span>
          MEM: <span className="text-foreground tabular-nums">{Math.round(mem / 1048576)}MB</span>
        </span>
      )}
      <span>
        UPDATED: <span className="text-foreground tabular-nums">{lastUpdated ?? '—'}</span>
      </span>
    </div>
  )
}

// --- watchlist management (unchanged behaviour, terminal styling) -----------------------------
function AddStock({ onAdded }) {
  const [symbol, setSymbol] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!symbol.trim() || loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/stocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: symbol.trim() }),
      })
      if (!res.ok) {
        const { detail } = await res.json().catch(() => ({}))
        throw new Error(detail || 'Failed to add stock')
      }
      const { symbol: added } = await res.json()
      toast.success(`${added} added`)
      setSymbol('')
      onAdded()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex gap-1">
      <Input
        value={symbol}
        onChange={(e) => setSymbol(e.target.value)}
        placeholder="ADD SYMBOL"
        className="h-7 w-36 font-mono text-xs uppercase placeholder:normal-case"
        disabled={loading}
      />
      <Button type="submit" size="icon-sm" className="size-7" disabled={loading} aria-label="Add stock">
        {loading ? <Spinner className="size-3.5" /> : <PlusIcon className="size-3.5" />}
      </Button>
    </form>
  )
}

function WatchlistButton({ symbol, lists, current, onChange }) {
  const save = async (listName) => {
    await fetch(`/api/watchlist/${symbol}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list_name: listName }),
    })
    toast.success(`${symbol} saved to ${listName}`)
    onChange()
  }

  const remove = async () => {
    await fetch(`/api/watchlist/${symbol}`, { method: 'DELETE' })
    toast.success(`${symbol} removed from watchlist`)
    onChange()
  }

  const createNew = () => {
    const name = window.prompt('New watchlist name (e.g. Banking, IT, Long term)')
    if (name?.trim()) save(name.trim())
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6"
            aria-label={`Save ${symbol} to watchlist`}
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <BookmarkIcon
          className={`size-3.5 ${current ? 'text-primary' : 'text-muted-foreground'}`}
          fill={current ? 'currentColor' : 'none'}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
        {lists.map((name) => (
          <DropdownMenuItem key={name} onClick={() => save(name)}>
            {name}
            {current === name && <CheckIcon className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
        {lists.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={createNew}>
          <PlusIcon className="size-4" /> New watchlist…
        </DropdownMenuItem>
        {current && (
          <DropdownMenuItem variant="destructive" onClick={remove}>
            Remove from {current}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CreateWatchlistDialog({ onCreated }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim() || loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) {
        const { detail } = await res.json().catch(() => ({}))
        throw new Error(detail || 'Failed to create watchlist')
      }
      toast.success(`${name.trim()} created`)
      onCreated(name.trim())
      setName('')
      setOpen(false)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost" size="icon-sm" className="size-6" aria-label="New watchlist" />}
      >
        <PlusIcon className="size-3.5" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New watchlist</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex gap-2">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Banking, IT, Long term"
          />
          <Button type="submit" disabled={loading}>
            {loading ? <Spinner className="size-4" /> : 'Create'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function WatchlistTabMenu({ name, stockCount, onRenamed, onDeleted }) {
  const [editOpen, setEditOpen] = useState(false)
  const [newName, setNewName] = useState(name)
  const [loading, setLoading] = useState(false)

  const openEdit = () => {
    setNewName(name)
    setEditOpen(true)
  }

  const rename = async (e) => {
    e.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed || trimmed === name || loading) return
    setLoading(true)
    try {
      const res = await fetch(`/api/watchlists/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_name: trimmed }),
      })
      if (!res.ok) {
        const { detail } = await res.json().catch(() => ({}))
        throw new Error(detail || 'Failed to rename watchlist')
      }
      toast.success(`Renamed to ${trimmed}`)
      onRenamed(trimmed)
      setEditOpen(false)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const remove = async () => {
    if (stockCount > 0 || loading) return
    setLoading(true)
    try {
      const res = await fetch(`/api/watchlists/${encodeURIComponent(name)}`, { method: 'DELETE' })
      if (!res.ok) {
        const { detail } = await res.json().catch(() => ({}))
        throw new Error(detail || 'Failed to delete watchlist')
      }
      toast.success(`${name} deleted`)
      onDeleted()
      setEditOpen(false)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" className="size-5" aria-label={`${name} options`} />}
        >
          <EllipsisVerticalIcon className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={openEdit}>
            <PencilIcon className="size-4" /> Edit
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit watchlist</DialogTitle>
          </DialogHeader>
          <form onSubmit={rename} className="flex gap-2">
            <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Button type="submit" disabled={loading || !newName.trim() || newName.trim() === name}>
              Save
            </Button>
          </form>
          <DialogFooter>
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Button variant="destructive" disabled={stockCount > 0 || loading} onClick={remove}>
                  Delete
                </Button>
              </TooltipTrigger>
              {stockCount > 0 && (
                <TooltipContent>
                  Move or remove its {stockCount} stock{stockCount === 1 ? '' : 's'} to delete this watchlist
                </TooltipContent>
              )}
            </Tooltip>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// --- page ------------------------------------------------------------------------------------
export default function StocksList() {
  usePageTitle()
  useEffect(() => {
    pingActivity('review').catch(() => {})
  }, [])

  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [tab, setTab] = useState('All')
  const [dragName, setDragName] = useState(null)
  const [session, setSession] = useState(0)
  const [latencyMs, setLatencyMs] = useState(null)
  const mountedAt = useRef(Date.now())

  useEffect(() => {
    const id = setInterval(() => setSession(Math.floor((Date.now() - mountedAt.current) / 1000)), 1000)
    return () => clearInterval(id)
  }, [])

  // Timed so the status bar's LAT figure is a real round-trip, not a guess - react-query v5 has
  // no onSuccess hook to measure from, so the timing wraps the fetch itself.
  const timedStocks = async () => {
    const t0 = performance.now()
    const data = await getStocks()
    setLatencyMs(Math.round(performance.now() - t0))
    return data
  }

  const stocksQuery = useQuery({ queryKey: ['stocks'], queryFn: timedStocks, refetchInterval: 30_000 })
  const indicesQuery = useQuery({ queryKey: ['indices'], queryFn: getIndices, refetchInterval: 60_000 })
  const { data: watchlist = [] } = useQuery({ queryKey: ['watchlist'], queryFn: getWatchlist })
  const { data: listNames = [] } = useQuery({ queryKey: ['watchlists'], queryFn: getWatchlistNames })
  const listParam = tab === 'All' ? undefined : tab
  const { data: events } = useQuery({
    queryKey: ['events', listParam ?? 'all'],
    queryFn: () => getEvents(listParam),
    refetchInterval: 120_000,
  })
  const { data: attention } = useQuery({
    queryKey: ['eventsAttention', listParam ?? 'all'],
    queryFn: () => getEventsAttention(listParam),
    refetchInterval: 120_000,
  })
  // Needs a Cogencis token - a 400 here is a config state, not a failure worth retrying.
  const newsQuery = useQuery({ queryKey: ['topNews'], queryFn: getTopNews, retry: false })

  const stocks = stocksQuery.data
  const load = () => {
    ;['stocks', 'watchlist', 'watchlists'].forEach((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    )
  }

  const listOf = Object.fromEntries(watchlist.map((w) => [w.symbol, w.list_name]))
  const lists = listNames
  const stockCountOf = (name) => watchlist.filter((w) => w.list_name === name).length
  const visible = tab === 'All' ? stocks : stocks?.filter((s) => listOf[s.symbol] === tab)

  const dropOn = (targetName) => {
    if (!dragName || dragName === targetName) return
    const next = [...lists]
    next.splice(next.indexOf(dragName), 1)
    next.splice(next.indexOf(targetName), 0, dragName)
    queryClient.setQueryData(['watchlists'], next)
    fetch('/api/watchlists/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: next }),
    })
  }

  const lastUpdated = stocksQuery.dataUpdatedAt
    ? new Date(stocksQuery.dataUpdatedAt).toLocaleTimeString('en-GB')
    : null

  return (
    <div className="space-y-2">
      <TickerTape indices={indicesQuery.data} />

      <div className="grid gap-2 lg:grid-cols-4">
        <IndicesPanel
          indices={indicesQuery.data}
          isFetching={indicesQuery.isFetching}
          onRefresh={() => indicesQuery.refetch()}
        />

        <TerminalPanel
          className="lg:col-span-2"
          title={`Watchlist · ${tab}`}
          accent="text-primary"
          actions={
            <>
              <AddStock onAdded={load} />
              <Button
                size="icon-sm"
                variant="ghost"
                className="size-5"
                aria-label="Events"
                render={<Link to="/events" />}
              >
                <RadarIcon className="size-3" />
              </Button>
              <RefreshButton
                busy={stocksQuery.isFetching}
                onClick={() => stocksQuery.refetch()}
                label="Refresh prices"
              />
            </>
          }
        >
          <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/20 px-1.5 py-1">
            {lists.length > 0 && (
              <Button
                variant={tab === 'All' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 font-mono text-[11px]"
                onClick={() => setTab('All')}
              >
                ALL
              </Button>
            )}
            {lists.map((name) => (
              <div
                key={name}
                draggable
                onDragStart={() => setDragName(name)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  dropOn(name)
                }}
                onDragEnd={() => setDragName(null)}
                className={`flex cursor-grab items-center rounded transition-opacity active:cursor-grabbing ${
                  dragName === name ? 'opacity-40' : ''
                }`}
              >
                <Button
                  variant={tab === name ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-6 font-mono text-[11px] uppercase"
                  onClick={() => setTab(name)}
                >
                  {name}
                </Button>
                <WatchlistTabMenu
                  name={name}
                  stockCount={stockCountOf(name)}
                  onRenamed={(newName) => {
                    load()
                    setTab(newName)
                  }}
                  onDeleted={() => {
                    load()
                    setTab('All')
                  }}
                />
              </div>
            ))}
            <CreateWatchlistDialog
              onCreated={(name) => {
                load()
                setTab(name)
              }}
            />
          </div>

          {!stocks && <PanelLoading />}

          {visible?.length === 0 && (
            <PanelEmpty>
              {tab === 'All'
                ? 'No stocks tracked yet — add one above, or ask the chat about an NSE ticker.'
                : `Nothing in ${tab} yet — save a stock to it with the bookmark button.`}
            </PanelEmpty>
          )}

          {visible?.length > 0 && (
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="border-b text-[10px] tracking-widest text-muted-foreground uppercase">
                  <th className="px-2 py-1 text-left font-medium">Symbol</th>
                  <th className="px-2 py-1 text-right font-medium">Price</th>
                  <th className="px-2 py-1 text-right font-medium">Chg%</th>
                  <th className="px-2 py-1 text-right font-medium">Rpts</th>
                  <th className="px-2 py-1 text-right font-medium">Updated</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr
                    key={s.symbol}
                    className="cursor-pointer border-b border-border/40 last:border-0 hover:bg-muted/40"
                    onClick={() => navigate({ to: '/stock/$symbol', params: { symbol: s.symbol } })}
                  >
                    <td className="px-2 py-1 font-semibold">{s.symbol}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{inr(s.price)}</td>
                    <td className={`px-2 py-1 text-right tabular-nums ${pctClass(s.changePercent)}`}>
                      {arrow(s.changePercent)} {signedPct(s.changePercent)}
                    </td>
                    <td className="px-2 py-1 text-right text-muted-foreground tabular-nums">
                      {s.report_count}
                    </td>
                    <td className="px-2 py-1 text-right text-[10px] text-muted-foreground">
                      {formatDate(s.last_scraped)}
                    </td>
                    <td className="px-1 py-1 text-right whitespace-nowrap">
                      <WatchlistButton
                        symbol={s.symbol}
                        lists={lists}
                        current={listOf[s.symbol]}
                        onChange={load}
                      />
                      <DeleteStockButton
                        symbol={s.symbol}
                        onDeleted={load}
                        stopPropagation
                        className="text-muted-foreground"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TerminalPanel>

        <MarketPulsePanel stocks={stocks} />
      </div>

      <div className="grid gap-2 lg:grid-cols-3">
        <AttentionPanel attention={attention} />
        <EventsPanel events={events} />
        <NewsPanel news={newsQuery.data} error={newsQuery.isError} />
      </div>

      <StatusBar
        session={session}
        latencyMs={latencyMs}
        symbolCount={stocks?.length ?? 0}
        stale={stocksQuery.isError || indicesQuery.isError}
        lastUpdated={lastUpdated}
      />
    </div>
  )
}
