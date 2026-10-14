// /chart - a TradingView-style workspace: the chart takes the screen, your watchlists sit in a
// sidebar on the right, and picking a row (or ↑ / ↓) puts that stock on the chart. The chart is the
// one every other screen uses (paper/PaperPositionChart's PaperChart): your indicators, template,
// timeframe, alerts and paper positions come with it. Trading opens the chart modal's ticket.
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import {
  ExternalLinkIcon,
  ListIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  ShoppingCartIcon,
  XIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { openChart } from '@/components/ChartModal'
import SortTh from '@/components/SortTh'
import SymbolCombobox from '@/components/SymbolCombobox'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Spinner } from '@/components/ui/spinner'
import { compact, fmt } from '@/lib/format'
import { sortRows } from '@/lib/sortRows'
import type { Sort } from '@/lib/sortRows'
import { prefillTicket } from '@/lib/ticketPrefill'
import { usePageTitle } from '@/lib/usePageTitle'
import { cn } from '@/lib/utils'
import { PaperChart } from '@/paper/PaperPositionChart'
import type { TrackedStock } from '@/services/api'
import { addStock, getStockDetail, getStocks, getWatchlist, getWatchlistNames } from '@/services/api'

const ALL = 'All'
const LAST_KEY = 'chartPage.last' // { symbol, list } - where the page reopens without a URL
const readLast = (): { symbol?: string; list?: string } => {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/** A list's badge: the first letters of its first two words - "Small Cap" SC, "Screener Stocks" SS,
 *  "Test" T - so lists starting with the same letter still tell apart. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')

const pctText = (v: number | null | undefined) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${fmt(v, 2)}%`)
const tone = (v: number | null | undefined) =>
  v == null || v === 0 ? 'text-muted-foreground' : v > 0 ? 'text-up' : 'text-down'
/** The rupee move, from the price and its % change (the list sends only those two). */
const absChange = (s: TrackedStock) =>
  s.price == null || s.changePercent == null ? null : s.price - s.price / (1 + s.changePercent / 100)

/** The selected stock, the way TradingView's watchlist shows it under the list. */
function DetailCard({ symbol }: { symbol: string }) {
  const { data, isPending } = useQuery({
    queryKey: ['stockDetail', symbol],
    queryFn: () => getStockDetail(symbol),
    staleTime: 60_000,
  })
  const q = data?.quote ?? {}
  const price = q.currentPrice ?? null
  const prev = (q.previousClose as number | undefined) ?? null
  const change = price != null && prev ? price - prev : null
  const pct =
    (q.regularMarketChangePercent as number | undefined) ??
    (change != null && prev ? (change / prev) * 100 : null)
  const lo = q.fiftyTwoWeekLow as number | undefined
  const hi = q.fiftyTwoWeekHigh as number | undefined
  const where = price != null && lo != null && hi != null && hi > lo ? ((price - lo) / (hi - lo)) * 100 : null
  const vol = q.regularMarketVolume as number | undefined
  const avg = q.averageVolume as number | undefined

  return (
    <div className="space-y-2.5 border-t p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{symbol}</p>
          <p className="truncate text-muted-foreground">
            {isPending ? 'Loading…' : [q.shortName, q.sector].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
        <Link
          to="/stock/$exchange/$symbol"
          params={{ exchange: 'NSE', symbol }}
          className="flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground"
          title="Open the stock page"
        >
          <ExternalLinkIcon className="size-3.5" />
        </Link>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">{price == null ? '—' : `₹${fmt(price)}`}</span>
        <span className={cn('font-medium tabular-nums', tone(pct))}>
          {change == null ? '' : `${change >= 0 ? '+' : ''}${fmt(change)} `}
          {pctText(pct)}
        </span>
      </div>
      {where != null && (
        <div>
          <div className="flex justify-between text-[10px] text-muted-foreground uppercase">
            <span>52W low ₹{fmt(lo)}</span>
            <span>high ₹{fmt(hi)}</span>
          </div>
          <div className="relative mt-1 h-1.5 rounded-full bg-gradient-to-r from-down/50 via-muted to-up/50">
            <div
              className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground"
              style={{ left: `${Math.min(100, Math.max(0, where))}%` }}
            />
          </div>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {[
          ['Prev close', prev == null ? '—' : `₹${fmt(prev)}`],
          ['Volume', vol == null ? '—' : `${compact(vol)}${avg ? ` · ${fmt(vol / avg, 1)}× avg` : ''}`],
          ['Mkt cap', q.marketCap == null ? '—' : `₹${compact(q.marketCap as number)}`],
          ['P/E', q.trailingPE == null ? '—' : fmt(q.trailingPE as number, 1)],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[10px] text-muted-foreground uppercase">{k}</dt>
            <dd className="truncate font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export default function ChartPage() {
  const search = useSearch({ from: '/chart' })
  const navigate = useNavigate({ from: '/chart' })
  const queryClient = useQueryClient()
  const [sidebar, setSidebar] = useState(true)
  const [sort, setSort] = useState<Sort>(null)

  const { data: stocks = [], isPending } = useQuery({
    queryKey: ['stocks'],
    queryFn: getStocks,
    refetchInterval: 30_000,
  })
  const { data: watchlist = [] } = useQuery({ queryKey: ['watchlist'], queryFn: getWatchlist })
  const { data: lists = [] } = useQuery({ queryKey: ['watchlists'], queryFn: getWatchlistNames })

  const last = useMemo(readLast, [])
  const list =
    search.list ?? (last.list && (last.list === ALL || lists.includes(last.list)) ? last.list : ALL)
  const rows = useMemo(() => {
    const members = new Set(watchlist.filter((w) => w.list_name === list).map((w) => w.symbol))
    const base = list === ALL ? stocks : stocks.filter((s) => members.has(s.symbol))
    return sortRows(base, sort, {
      symbol: (s) => s.symbol,
      last: (s) => s.price,
      chg: (s) => absChange(s),
      pct: (s) => s.changePercent,
    })
  }, [stocks, watchlist, list, sort])
  const symbol = (search.symbol ?? last.symbol ?? rows[0]?.symbol ?? '').toUpperCase()
  usePageTitle(symbol ? `${symbol} · Chart` : 'Chart')

  const go = (next: { symbol?: string; list?: string }) => {
    const target = { symbol: next.symbol ?? symbol, list: next.list ?? list }
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify(target))
    } catch {
      // private window: the URL still carries it
    }
    navigate({ search: target, replace: true })
  }

  // ↑ / ↓ walk the list, like TradingView - never while typing, and not under an open dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      const el = e.target as HTMLElement | null
      if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return
      if (document.querySelector('[role="dialog"]') || !rows.length) return
      const at = rows.findIndex((r) => r.symbol === symbol)
      const next = rows[Math.min(rows.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next && next.symbol !== symbol) {
        e.preventDefault()
        go({ symbol: next.symbol })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const refresh = () =>
    ['stocks', 'watchlist', 'watchlists'].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }))
  const add = useMutation({
    mutationFn: async (sym: string) => {
      if (!stocks.some((s) => s.symbol === sym)) await addStock(sym)
      if (list !== ALL) {
        const res = await fetch(`/api/watchlist/${sym}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ list_name: list }),
        })
        if (!res.ok) throw new Error(`Couldn't add ${sym} to ${list}`)
      }
      return sym
    },
    onSuccess: (sym) => {
      refresh()
      toast.success(list === ALL ? `${sym} tracked` : `${sym} added to ${list}`)
      go({ symbol: sym })
    },
    onError: (e) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (sym: string) =>
      fetch(`/api/watchlist/${sym}?list_name=${encodeURIComponent(list)}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  })

  const sidebarPanel = sidebar && (
    <aside className="flex w-80 shrink-0 flex-col border-l bg-background">
      <div className="flex items-center gap-1.5 border-b p-2">
        {/* the lists as round tabs, like TradingView's: initials in a circle, the full name on hover */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {[ALL, ...lists].map((l) => {
            const active = l === list
            const count = l === ALL ? stocks.length : watchlist.filter((w) => w.list_name === l).length
            return (
              <Tooltip key={l}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`${l === ALL ? 'All tracked' : l} (${count})`}
                      aria-pressed={active}
                      onClick={() => go({ list: l })}
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors',
                        active
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground',
                      )}
                    />
                  }
                >
                  {l === ALL ? <ListIcon className="size-3.5" /> : initials(l)}
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {l === ALL ? 'All tracked' : l} · {count}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
        <span
          className="shrink-0 text-[11px] text-muted-foreground tabular-nums"
          title={list === ALL ? 'All tracked' : list}
        >
          {list === ALL ? 'All' : list} · {rows.length}
        </span>
      </div>
      <div className="border-b p-2">
        <SymbolCombobox
          value=""
          onChange={(sym) => sym && add.mutate(sym.toUpperCase())}
          className="w-full"
        />
        {add.isPending && (
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Spinner className="size-3" /> Adding…
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full font-mono text-xs">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b text-[10px] tracking-widest text-muted-foreground uppercase">
              <SortTh label="Symbol" k="symbol" sort={sort} onSort={setSort} align="left" first="asc" />
              <SortTh label="Last" k="last" sort={sort} onSort={setSort} />
              <SortTh label="Chg" k="chg" sort={sort} onSort={setSort} />
              <SortTh label="Chg%" k="pct" sort={sort} onSort={setSort} />
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-muted-foreground">
                  <Spinner className="mx-auto size-4" />
                </td>
              </tr>
            )}
            {!isPending && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  {list === ALL ? 'No tracked stocks yet.' : `${list} is empty.`} Add one above.
                </td>
              </tr>
            )}
            {rows.map((s) => {
              const active = s.symbol === symbol
              const chg = absChange(s)
              return (
                <tr
                  key={s.symbol}
                  onClick={() => go({ symbol: s.symbol })}
                  className={cn(
                    'group cursor-pointer border-b border-border/40',
                    active
                      ? 'bg-primary/10 outline outline-1 -outline-offset-1 outline-primary/50'
                      : 'hover:bg-muted/40',
                  )}
                >
                  <td className="px-2 py-1.5 font-semibold">
                    <span className="flex items-center gap-1">
                      {s.symbol}
                      {list !== ALL && (
                        <button
                          type="button"
                          aria-label={`Remove ${s.symbol} from ${list}`}
                          title={`Remove from ${list}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            remove.mutate(s.symbol)
                          }}
                          className="ml-auto rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                        >
                          <XIcon className="size-3" />
                        </button>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {s.price == null ? '—' : fmt(s.price)}
                  </td>
                  <td className={cn('px-2 py-1.5 text-right tabular-nums', tone(chg))}>
                    {chg == null ? '—' : `${chg >= 0 ? '+' : ''}${fmt(chg)}`}
                  </td>
                  <td className={cn('px-2 py-1.5 text-right tabular-nums', tone(s.changePercent))}>
                    {pctText(s.changePercent)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {symbol && <DetailCard symbol={symbol} />}
    </aside>
  )

  return (
    // The whole viewport beside the nav rail, like the position pages.
    <div className="fixed inset-y-0 right-0 left-[var(--sidebar-w,3.5rem)] z-40 flex flex-col bg-background">
      {symbol ? (
        <PaperChart
          key={symbol}
          symbol={symbol}
          account={null}
          // Right-click → Buy/Sell here opens the chart modal with its ticket ready.
          onNewOrder={(direction, price) => {
            openChart(symbol)
            prefillTicket({ symbol, direction, price })
          }}
          trailing={
            <div className="flex items-center gap-1 border-l pl-2">
              <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => openChart(symbol)}>
                <ShoppingCartIcon className="size-3.5" /> Trade
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={sidebar ? 'Hide watchlist' : 'Show watchlist'}
                title={sidebar ? 'Hide watchlist' : 'Show watchlist'}
                onClick={() => setSidebar((v) => !v)}
              >
                {sidebar ? (
                  <PanelRightCloseIcon className="size-4" />
                ) : (
                  <PanelRightOpenIcon className="size-4" />
                )}
              </Button>
            </div>
          }
          side={sidebarPanel}
        />
      ) : (
        <div className="flex flex-1">
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
            {isPending ? <Spinner className="size-4" /> : 'Add a stock to the watchlist to chart it.'}
          </div>
          {sidebarPanel}
        </div>
      )}
    </div>
  )
}
