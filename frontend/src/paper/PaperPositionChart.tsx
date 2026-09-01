import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { fmt, inr } from '@/lib/format'
import { usePageTitle } from '@/lib/usePageTitle'
import type { ReplayBar, ReplayOrder } from '@/features/bar-replay/store'
import type { PaperModifyRequest, PaperPosition } from '@/services/api'
import ReplayChart from '@/features/bar-replay/ReplayChart'
import { riskReward } from '@/features/bar-replay/orderEngine'
import { useBarReplayStore } from '@/features/bar-replay/store'
import { closePaperPosition, getPaperPositions, getStockChart, modifyPaperPosition } from '@/services/api'

// Ranges the chart endpoint serves. Deliberately not Bar Replay's timeframe list: this page reads
// a live position rather than stepping history, so it wants "how far back do I look", and the
// /api/stocks/{symbol}/chart endpoint already answers exactly that (from price_history when it's
// collected, from Yahoo when it isn't) with no "Collect max data" gate in front of it.
const RANGES = ['1mo', '6mo', 'ytd', '1y']

// A paper position is the same object the replay chart already knows how to draw - an entry, a
// direction, a quantity and two ladders of legs - so it's mapped rather than re-rendered. The whole
// point of this page is that the chart component is the Bar Replay one, unmodified.
const asOrder = (p: PaperPosition): ReplayOrder => ({
  // The chart works in string ids; the API works in row ids. Converted here, and converted back
  // by `find` below, so neither side has to know about the other's.
  id: String(p.id),
  direction: p.direction,
  entryPrice: p.entry_price,
  quantity: p.quantity,
  status: p.status,
  stopLosses: p.stop_losses ?? [],
  targets: p.targets ?? [],
})

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'up' | 'down'
}) {
  return (
    <div>
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p
        className={`text-sm font-semibold tabular-nums ${
          tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : ''
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-[11px] text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  )
}

export default function PaperPositionChart() {
  const { symbol } = useParams({ from: '/paper/$symbol' })
  const { account } = useSearch({ from: '/paper/$symbol' })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [range, setRange] = useState('6mo')
  // Read-only view of the Bar Replay chart config: whatever indicators and candle colours are set
  // up over there render here too. Configured in one place (Bar Replay's own controls), not two -
  // this page has no chart settings of its own.
  const indicators = useBarReplayStore((st) => st.indicators)
  const chartSettings = useBarReplayStore((st) => st.settings)
  usePageTitle(`${symbol} · Paper position`)

  const { data: positions = [], isPending } = useQuery({
    queryKey: ['paperPositions', account ?? null],
    queryFn: () => getPaperPositions(account ?? null),
    // Same cadence as the holdings table - the position lines move as the engine marks them.
    refetchInterval: 10_000,
  })
  const mine = useMemo(() => positions.filter((p) => p.symbol === symbol), [positions, symbol])

  const { data: chart, isPending: chartPending } = useQuery({
    queryKey: ['stockChart', symbol, range],
    queryFn: () => getStockChart(symbol, range),
  })
  // The chart endpoint sends a unix `time` and no `date`. ReplayChart only reads `date` for bars
  // whose time is a string (see its `stamp`), so these never reach that branch - hence the cast
  // rather than inventing a date field the API does not send.
  const bars = (chart?.bars ?? []) as unknown as ReplayBar[]

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['paperPositions'] })

  // Every on-chart edit goes straight to the server - nothing about this page is persisted
  // locally, so a reload shows exactly what the account actually holds.
  const modify = useMutation({
    mutationFn: ({ id, stop_losses, targets }: { id: number } & PaperModifyRequest) =>
      modifyPaperPosition(id, { stop_losses, targets }),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  })
  const close = useMutation({
    mutationFn: (id: number) => closePaperPosition(id),
    onSuccess: (data) => {
      refresh()
      queryClient.invalidateQueries({ queryKey: ['manualTrades'] })
      toast.success(`Closed at ${inr(data.closed_at)}`)
      navigate({ to: '/paper', search: { view: 'holdings', account } })
    },
    onError: (e) => toast.error(e.message),
  })

  const legsOf = (p: PaperPosition) => ({ stop_losses: p.stop_losses ?? [], targets: p.targets ?? [] })
  const find = (id: string) => mine.find((p) => String(p.id) === id)

  // The handlers ReplayChart already calls, pointed at the paper API instead of the replay store.
  const adjustOrder = (id: string, field: 'entry' | 'stopLoss' | 'target', price: number, legId: string) => {
    const p = find(id)
    if (!p) return
    const key = field === 'stopLoss' ? 'stop_losses' : 'targets'
    const legs = legsOf(p)
    modify.mutate({
      id: p.id,
      ...legs,
      [key]: legs[key].map((l) => (l.id === legId ? { ...l, price: Math.round(price * 100) / 100 } : l)),
    })
  }
  const removeLevel = (id: string, field: 'stopLoss' | 'target', legId: string) => {
    const p = find(id)
    if (!p) return
    const key = field === 'stopLoss' ? 'stop_losses' : 'targets'
    const legs = legsOf(p)
    modify.mutate({ id: p.id, ...legs, [key]: legs[key].filter((l) => l.id !== legId) })
  }
  const adjustLegQty = (id: string, field: 'stopLoss' | 'target', legId: string, qty: number) => {
    const p = find(id)
    if (!p || !(qty > 0)) return
    const key = field === 'stopLoss' ? 'stop_losses' : 'targets'
    const legs = legsOf(p)
    modify.mutate({ id: p.id, ...legs, [key]: legs[key].map((l) => (l.id === legId ? { ...l, qty } : l)) })
  }
  const moveToBreakeven = (id: string) => {
    const p = find(id)
    if (!p?.stop_losses?.length) return
    modify.mutate({
      id: p.id,
      ...legsOf(p),
      stop_losses: p.stop_losses.map((l) => ({ ...l, price: p.entry_price })),
    })
  }
  const placeLevel = (id: string, field: 'stopLoss' | 'target', price: number) => {
    const p = find(id)
    if (!p) return
    const key = field === 'stopLoss' ? 'stop_losses' : 'targets'
    const legs = legsOf(p)
    const covered = legs[key].reduce((s, l) => s + l.qty, 0)
    const remaining = p.quantity - covered
    if (remaining <= 0) {
      toast.error(`Every share is already covered on that side`)
      return
    }
    modify.mutate({
      id: p.id,
      ...legs,
      [key]: [
        ...legs[key],
        { id: crypto.randomUUID(), price: Math.round(price * 100) / 100, qty: remaining },
      ],
    })
  }

  const position = mine[0] ?? null
  const rr = position ? riskReward(asOrder(position)).rr : null
  const pctFrom = (price: number | null | undefined) =>
    position?.entry_price && price != null
      ? ((price - position.entry_price) / position.entry_price) * 100
      : null
  const signed = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${fmt(v, 2)}%`)

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            size="icon-sm"
            variant="ghost"
            nativeButton={false}
            aria-label="Back to holdings"
            render={<Link to="/paper" search={{ view: 'holdings', account }} />}
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
          <h1 className="text-lg font-semibold">{symbol}</h1>
          {position && (
            <span className="text-xs text-muted-foreground capitalize">
              {position.direction} · {position.quantity} qty
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {RANGES.map((r) => (
            <Button
              key={r}
              size="sm"
              variant={range === r ? 'secondary' : 'ghost'}
              className="h-7 font-mono text-[11px] uppercase"
              onClick={() => setRange(r)}
            >
              {r}
            </Button>
          ))}
        </div>
      </div>

      {position && (
        <div className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-3 sm:grid-cols-4 lg:grid-cols-7">
          <Metric label="Entry" value={inr(position.entry_price)} />
          <Metric
            label="Current"
            value={position.current_price == null ? '—' : inr(position.current_price)}
            sub={position.pnl_pct == null ? undefined : signed(position.pnl_pct)}
            tone={position.pnl_pct == null ? undefined : position.pnl_pct >= 0 ? 'up' : 'down'}
          />
          <Metric label="Value" value={inr(position.value ?? position.entry_price * position.quantity)} />
          <Metric
            label="Unrealised"
            value={position.pnl == null ? '—' : inr(position.pnl)}
            tone={position.pnl == null ? undefined : position.pnl >= 0 ? 'up' : 'down'}
          />
          <Metric
            label="Stop loss"
            value={position.stop_losses?.length ? inr(position.stop_losses[0].price) : '—'}
            sub={
              position.stop_losses?.length ? signed(pctFrom(position.stop_losses[0].price)) : 'unprotected'
            }
          />
          <Metric
            label="Target"
            value={position.targets?.length ? inr(position.targets[0].price) : '—'}
            sub={position.targets?.length ? signed(pctFrom(position.targets[0].price)) : 'none set'}
          />
          <Metric label="R:R" value={rr == null ? '—' : `${fmt(rr, 2)}R`} />
        </div>
      )}

      {/* ReplayChart is absolutely positioned inside its parent, so it needs a sized relative box -
          exactly how BarReplay hosts it. Everything it draws here (entry line, SL/target ladders,
          the pills and their actions) is the same code path the replay chart runs; only the
          handlers differ, and they write to the paper API rather than a local store. */}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border bg-card">
        {chartPending || isPending ? (
          <p className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" /> Loading {symbol}…
          </p>
        ) : bars.length === 0 ? (
          <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No price history for {symbol}.
          </p>
        ) : (
          <ReplayChart
            bars={bars}
            indicators={indicators}
            orders={mine.map(asOrder)}
            resetKey={`${symbol}-${range}`}
            settings={chartSettings}
            onAdjustOrder={adjustOrder}
            onRemoveLevel={removeLevel}
            onAdjustLegQty={adjustLegQty}
            onMoveToBreakeven={moveToBreakeven}
            onPlaceLevel={placeLevel}
            onRequestClose={(order) => close.mutate(Number(order.id))}
            onCancelPending={(id) => close.mutate(Number(id))}
          />
        )}
      </div>

      {!position && !isPending && (
        <p className="text-xs text-muted-foreground">
          No open position in {symbol} on this account — the chart is showing price only.
        </p>
      )}
    </div>
  )
}
