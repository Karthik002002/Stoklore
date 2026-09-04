import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  PlusIcon,
  BookmarkIcon,
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
  DropdownMenuCheckboxItem,
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
  getMacroIndices,
  getMarketMovers,
  getStocks,
  getWatchlist,
  getWatchlistNames,
  pingActivity,
} from '@/services/api'
import type {
  AttentionScore,
  MacroIndices,
  FeedEvent,
  IndexQuote,
  MarketMovers,
  TrackedStock,
} from '@/services/api'
import DeleteStockButton from './DeleteStockButton'

const EMPTY_SET: Set<string> = new Set()

// --- formatting helpers, shared by every panel ------------------------------------------------
const pctClass = (v: number | null | undefined) =>
  v == null ? 'text-muted-foreground' : v >= 0 ? 'text-up' : 'text-down'
const signedPct = (v: number | null | undefined) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${fmt(v)}%`)
const arrow = (v: number | null | undefined) => (v == null ? '' : v >= 0 ? '▲' : '▼')
const num = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
const clock = (secs: number) =>
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
  const get = (type: string) => parts.find((p) => p.type === type)?.value
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
function TickerTape({ indices }: { indices?: IndexQuote[] }) {
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
function IndicesPanel({
  indices,
  isFetching,
  onRefresh,
}: {
  indices?: IndexQuote[]
  isFetching: boolean
  onRefresh: () => void
}) {
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
function MarketPulsePanel({ stocks }: { stocks?: TrackedStock[] }) {
  const rated = useMemo(() => (stocks ?? []).filter((s) => s.changePercent != null), [stocks])
  const advancers = rated.filter((s) => (s.changePercent ?? 0) > 0)
  const decliners = rated.filter((s) => (s.changePercent ?? 0) < 0)
  const advanceRatio = rated.length ? Math.round((advancers.length / rated.length) * 100) : null
  // Split by sign before slicing, so a mostly-green day never lists a gainer under "Top losers"
  // (which a plain sort-and-take-the-tail would do once there are fewer than 6 tracked stocks).
  const sorted = [...rated].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))
  const gainers = advancers.length ? sorted.filter((s) => (s.changePercent ?? 0) > 0).slice(0, 3) : []
  const losers = sorted
    .filter((s) => (s.changePercent ?? 0) < 0)
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

function MoverList({ title, rows }: { title: string; rows: TrackedStock[] }) {
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
function AttentionPanel({ attention }: { attention?: AttentionScore[] }) {
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
            to="/stock/$exchange/$symbol"
            params={{ exchange: 'NSE', symbol: a.symbol }}
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

function EventsPanel({ events }: { events?: FeedEvent[] }) {
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
                to="/stock/$exchange/$symbol"
                params={{ exchange: 'NSE', symbol: e.symbol }}
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

// NSE's own top gainers/losers table (nseindia.com/market-data/top-gainers-losers), served from the
// backend's once-a-day cache. Two things shape this panel:
//
// - The payload carries SEVEN index buckets (NIFTY 50 / BANK NIFTY / NIFTY NEXT 50 / >Rs20 / <Rs20 /
//   F&O / All Securities) for both directions, so the bucket is a selector, exactly like NSE's own
//   page - showing one hardcoded cut would throw away six sevenths of a response already fetched.
// - It's a post-close snapshot, not a live feed. The session date it belongs to is in the header,
//   so a Monday morning reading of Friday's table can never be mistaken for today's move.
const MOVER_DIRECTIONS = [
  { key: 'gainers', label: 'Gainers' },
  { key: 'losers', label: 'Losers' },
]

// Turnover arrives in ₹ lakh. Crore is how an Indian trader reads a day's value traded.
const crore = (lakh: number | null | undefined) =>
  lakh == null ? '—' : `${fmt(lakh / 100, lakh >= 10000 ? 0 : 1)}`
const volume = (n: number | null | undefined) =>
  n == null ? '—' : n >= 1e7 ? `${fmt(n / 1e7, 1)}Cr` : n >= 1e5 ? `${fmt(n / 1e5, 1)}L` : num(n)

function MoversPanel({
  data,
  isFetching,
  onRefresh,
}: {
  data?: MarketMovers
  isFetching: boolean
  onRefresh: () => void
}) {
  const [bucket, setBucket] = useState('allSec')
  const [direction, setDirection] = useState<'gainers' | 'losers'>('gainers')
  const groups = data?.groups ?? []
  const active = groups.find((g) => g.key === bucket) ?? groups[0]
  const rows = active?.[direction] ?? []

  return (
    <TerminalPanel
      title="Top Gainers / Losers"
      accent="text-blue-500"
      actions={
        <>
          {groups.length > 0 && (
            <select
              value={active?.key ?? ''}
              onChange={(e) => setBucket(e.target.value)}
              className="h-6 rounded border bg-background px-1 font-mono text-[10px] uppercase"
              aria-label="Index bucket"
            >
              {groups.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
          )}
          <RefreshButton busy={isFetching} onClick={onRefresh} label="Refresh movers" />
        </>
      }
    >
      {!data ? (
        <PanelLoading />
      ) : (
        <>
          <div className="flex items-center gap-1 border-b bg-muted/20 px-1.5 py-1 font-mono text-[10px]">
            {MOVER_DIRECTIONS.map((d) => (
              <Button
                key={d.key}
                variant={direction === d.key ? 'secondary' : 'ghost'}
                size="sm"
                className={`h-5 font-mono text-[10px] uppercase ${
                  direction === d.key ? (d.key === 'gainers' ? 'text-up' : 'text-down') : ''
                }`}
                onClick={() => setDirection(d.key as 'gainers' | 'losers')}
              >
                {d.label}
              </Button>
            ))}
            <span
              className="ml-auto tracking-widest text-muted-foreground uppercase"
              title={
                data.fetched_at ? `Fetched ${new Date(data.fetched_at).toLocaleString('en-GB')}` : undefined
              }
            >
              {data.stale && <span className="mr-1 text-amber-500">STALE</span>}
              {data.timestamp ?? data.trade_date ?? '—'}
            </span>
          </div>

          {rows.length === 0 ? (
            <PanelEmpty>Nothing in this bucket for that session.</PanelEmpty>
          ) : (
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="border-b text-[10px] tracking-widest text-muted-foreground uppercase">
                  <th className="px-2 py-1 text-left font-medium">Symbol</th>
                  <th className="px-2 py-1 text-right font-medium">LTP</th>
                  <th className="px-2 py-1 text-right font-medium">Chg%</th>
                  <th className="px-2 py-1 text-right font-medium">Vol</th>
                  <th className="px-2 py-1 text-right font-medium">₹Cr</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 12).map((r) => (
                  <tr key={r.symbol} className="border-b border-border/40 last:border-0 hover:bg-muted/40">
                    <td className="px-2 py-1">
                      <Link
                        to="/stock/$exchange/$symbol"
                        params={{ exchange: 'NSE', symbol: r.symbol }}
                        className="font-semibold hover:underline"
                      >
                        {r.symbol}
                      </Link>
                      {/* An ex-dividend/bonus date is often the entire reason a name is in this
                          table - marking it stops a mechanical drop reading as a sell-off. */}
                      {r.ca_purpose && (
                        <span className="ml-1 text-[9px] text-amber-500" title={r.ca_purpose}>
                          CA
                        </span>
                      )}
                      {r.series && r.series !== 'EQ' && (
                        <span className="ml-1 text-[9px] text-muted-foreground">{r.series}</span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{num(r.ltp)}</td>
                    <td className={`px-2 py-1 text-right tabular-nums ${pctClass(r.perChange)}`}>
                      {arrow(r.perChange)} {signedPct(r.perChange)}
                    </td>
                    <td className="px-2 py-1 text-right text-muted-foreground tabular-nums">
                      {volume(r.trade_quantity)}
                    </td>
                    <td className="px-2 py-1 text-right text-muted-foreground tabular-nums">
                      {crore(r.turnover)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </TerminalPanel>
  )
}

// Surfaces GET /api/macro-indices - NSE's full index-performance table
// (nseindia.com/market-data/index-performances), ~100+ indices grouped by category. A category
// filter keeps the table compact - showing every group at once would be ~150 rows of mono text.
// Defaults to "BROAD MARKET INDICES" (NIFTY 50 / NEXT 50 / MIDCAP / SMALLCAP), the most-glanced cut.
const DEFAULT_GROUP = 'BROAD MARKET INDICES'

function MacroIndicesPanel({
  data,
  isFetching,
  onRefresh,
}: {
  data?: MacroIndices
  isFetching: boolean
  onRefresh: () => void
}) {
  const [group, setGroup] = useState(DEFAULT_GROUP)
  const groups = data?.groups ?? []
  const active = groups.find((g) => g.key === group) ?? groups[0]
  const rows = active?.indices ?? []

  return (
    <TerminalPanel
      className="lg:col-span-2"
      title="Macro Indices"
      accent="text-violet-500"
      actions={
        <>
          {groups.length > 0 && (
            <select
              value={active?.key ?? ''}
              onChange={(e) => setGroup(e.target.value)}
              className="h-6 rounded border bg-background px-1 font-mono text-[10px] uppercase"
              aria-label="Index category"
            >
              {groups.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.key}
                </option>
              ))}
            </select>
          )}
          <RefreshButton busy={isFetching} onClick={onRefresh} label="Refresh macro indices" />
        </>
      }
    >
      {!data ? (
        <PanelLoading />
      ) : rows.length === 0 ? (
        <PanelEmpty>No indices in this category.</PanelEmpty>
      ) : (
        <table className="w-full font-mono text-xs">
          <thead>
            <tr className="border-b text-[10px] tracking-widest text-muted-foreground uppercase">
              <th className="px-2 py-1 text-left font-medium">Index</th>
              <th className="px-2 py-1 text-right font-medium">Last</th>
              <th className="px-2 py-1 text-right font-medium">Chg%</th>
              <th className="px-2 py-1 text-right font-medium">30d</th>
              <th className="px-2 py-1 text-right font-medium">1y</th>
              <th className="px-2 py-1 text-right font-medium">PE</th>
              <th className="px-2 py-1 text-right font-medium">Adv/Dec</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.symbol || i.name} className="border-b border-border/40 last:border-0">
                <td className="px-2 py-1 font-semibold" title={i.name}>
                  <span className="truncate">{i.name}</span>
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{num(i.last)}</td>
                <td className={`px-2 py-1 text-right tabular-nums ${pctClass(i.percentChange)}`}>
                  {arrow(i.percentChange)} {signedPct(i.percentChange)}
                </td>
                <td className={`px-2 py-1 text-right tabular-nums ${pctClass(i.perChange30d)}`}>
                  {signedPct(i.perChange30d)}
                </td>
                <td className={`px-2 py-1 text-right tabular-nums ${pctClass(i.perChange365d)}`}>
                  {signedPct(i.perChange365d)}
                </td>
                <td className="px-2 py-1 text-right text-muted-foreground tabular-nums">{i.pe ?? '—'}</td>
                <td className="px-2 py-1 text-right tabular-nums">
                  <span className="text-up">{i.advances ?? '—'}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-down">{i.declines ?? '—'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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

function PanelEmpty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-6 text-center font-mono text-xs text-muted-foreground">{children}</p>
}

function RefreshButton({ busy, onClick, label }: { busy: boolean; onClick: () => void; label: string }) {
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
function StatusBar({
  session,
  latencyMs,
  symbolCount,
  stale,
  lastUpdated,
}: {
  session: number
  latencyMs: number | null
  symbolCount: number
  stale: boolean
  /** Already formatted as a clock time, or null before the first load. */
  lastUpdated: string | null
}) {
  // Chromium only - performance.memory is non-standard, so the panel just omits MEM elsewhere.
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize
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
function AddStock({ onAdded }: { onAdded: () => void }) {
  const [symbol, setSymbol] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
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
      toast.error(err instanceof Error ? err.message : String(err))
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

// A stock can belong to any number of watchlists (composite symbol+list_name key on the
// backend), so this is a checkbox menu rather than a single-select - toggling one list on/off
// doesn't touch its membership in any other.
function WatchlistButton({
  symbol,
  lists,
  memberOf,
  onChange,
}: {
  symbol: string
  lists: string[]
  memberOf: Set<string>
  onChange: () => void
}) {
  const add = async (listName: string) => {
    await fetch(`/api/watchlist/${symbol}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list_name: listName }),
    })
    toast.success(`${symbol} added to ${listName}`)
    onChange()
  }

  const remove = async (listName: string) => {
    await fetch(`/api/watchlist/${symbol}?list_name=${encodeURIComponent(listName)}`, { method: 'DELETE' })
    toast.success(`${symbol} removed from ${listName}`)
    onChange()
  }

  const createNew = () => {
    const name = window.prompt('New watchlist name (e.g. Banking, IT, Long term)')
    if (name?.trim()) add(name.trim())
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
          className={`size-3.5 ${memberOf.size ? 'text-primary' : 'text-muted-foreground'}`}
          fill={memberOf.size ? 'currentColor' : 'none'}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
        {lists.map((name) => (
          <DropdownMenuCheckboxItem
            key={name}
            checked={memberOf.has(name)}
            onCheckedChange={(checked) => (checked ? add(name) : remove(name))}
          >
            {name}
          </DropdownMenuCheckboxItem>
        ))}
        {lists.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={createNew}>
          <PlusIcon className="size-4" /> New watchlist…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CreateWatchlistDialog({ onCreated }: { onCreated: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
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
      toast.error(err instanceof Error ? err.message : String(err))
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

function WatchlistTabMenu({
  name,
  stockCount,
  onRenamed,
  onDeleted,
}: {
  name: string
  stockCount: number
  onRenamed: (name: string) => void
  onDeleted: () => void
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [newName, setNewName] = useState(name)
  const [loading, setLoading] = useState(false)

  const openEdit = () => {
    setNewName(name)
    setEditOpen(true)
  }

  const rename = async (e: React.FormEvent) => {
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
      toast.error(err instanceof Error ? err.message : String(err))
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
      toast.error(err instanceof Error ? err.message : String(err))
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
  const navigate = useNavigate({ from: '/' })
  const { list } = useSearch({ from: '/' })
  const tab = list ?? 'All'
  const setTab = (name: string) =>
    navigate({ search: (prev) => ({ ...prev, list: name === 'All' ? undefined : name }), replace: true })
  const [dragName, setDragName] = useState<string | null>(null)
  const [session, setSession] = useState(0)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
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
  // NSE's post-close gainers/losers table. The backend only goes out to NSE once a calendar day
  // (the table doesn't move intraday), so polling it here would just re-read the same cached row -
  // an hourly refetch is enough to pick up the new session after a close.
  const moversQuery = useQuery({
    queryKey: ['marketMovers'],
    queryFn: () => getMarketMovers(),
    refetchInterval: 3_600_000,
  })
  // NSE's full index-performance table (nseindia.com/market-data/index-performances) - slow-rotating
  // macro context, 5min cache on the backend. Polled less often than the watchlist's own prices.
  const macroQuery = useQuery({
    queryKey: ['macroIndices'],
    queryFn: getMacroIndices,
    refetchInterval: 300_000,
  })
  const stocks = stocksQuery.data
  const load = () => {
    ;['stocks', 'watchlist', 'watchlists'].forEach((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    )
  }

  // A symbol can sit in more than one watchlist, so membership is a set per symbol rather than a
  // single name.
  const membersOf = useMemo(() => {
    const m = new Map()
    watchlist.forEach((w) => {
      if (!m.has(w.symbol)) m.set(w.symbol, new Set())
      m.get(w.symbol).add(w.list_name)
    })
    return m
  }, [watchlist])
  const lists = listNames
  const stockCountOf = (name: string) => watchlist.filter((w) => w.list_name === name).length
  const visible = tab === 'All' ? stocks : stocks?.filter((s) => membersOf.get(s.symbol)?.has(tab))

  const dropOn = (targetName: string) => {
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

          {visible && visible.length > 0 && (
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
                    onClick={() =>
                      navigate({
                        to: '/stock/$exchange/$symbol',
                        params: { exchange: 'NSE', symbol: s.symbol },
                      })
                    }
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
                        memberOf={membersOf.get(s.symbol) ?? EMPTY_SET}
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

        <MarketPulsePanel stocks={visible} />
      </div>

      <div className="grid gap-2 lg:grid-cols-3">
        <AttentionPanel attention={attention} />
        <EventsPanel events={events} />
        <MoversPanel
          data={moversQuery.data}
          isFetching={moversQuery.isFetching}
          onRefresh={async () => {
            await getMarketMovers(true)
            moversQuery.refetch()
          }}
        />
      </div>

      <MacroIndicesPanel
        data={macroQuery.data}
        isFetching={macroQuery.isFetching}
        onRefresh={() => macroQuery.refetch()}
      />

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
