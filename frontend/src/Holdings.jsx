import { useEffect, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCwIcon, TrendingDownIcon, TrendingUpIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Group } from '@visx/group'
import { Pie } from '@visx/shape'
import { useTooltip, TooltipWithBounds, defaultStyles } from '@visx/tooltip'
import { localPoint } from '@visx/event'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { BrokerLogo, brokerLabel } from '@/BrokerLogo'
import { fmt, inr } from '@/lib/format'
import { usePageTitle } from '@/lib/usePageTitle'
import { getHoldings, setActiveBroker } from '@/services/api'

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {sub}
    </div>
  )
}

const CHART_COLORS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5']
const DONUT_SIZE = 112
const DONUT_RADIUS = DONUT_SIZE / 2

// Symbol concentration donut - top 5 by current value + "Other".
function ExposureDonut({ holdings, currentValue }) {
  const { tooltipData, tooltipLeft, tooltipTop, tooltipOpen, showTooltip, hideTooltip } = useTooltip()
  if (currentValue <= 0) return null

  const bySymbol = [...holdings]
    .map((h) => ({ symbol: h.symbol, value: (h.ltp ?? h.avg_price ?? 0) * (h.qty ?? 0) }))
    .sort((a, b) => b.value - a.value)
  const top = bySymbol.slice(0, 5)
  const otherValue = bySymbol.slice(5).reduce((sum, s) => sum + s.value, 0)
  const slices = otherValue > 0 ? [...top, { symbol: 'Other', value: otherValue }] : top

  return (
    <div className="relative flex items-center gap-6 rounded-xl border bg-card p-4">
      <svg width={DONUT_SIZE} height={DONUT_SIZE} className="shrink-0">
        <Group top={DONUT_RADIUS} left={DONUT_RADIUS}>
          <Pie
            data={slices}
            pieValue={(d) => d.value}
            outerRadius={DONUT_RADIUS}
            innerRadius={DONUT_RADIUS - 20}
            padAngle={0.01}
          >
            {(pie) =>
              pie.arcs.map((arc, i) => (
                <path
                  key={arc.data.symbol}
                  d={pie.path(arc)}
                  fill={`var(--${CHART_COLORS[i % CHART_COLORS.length]})`}
                  onMouseMove={(e) => {
                    const point = localPoint(e) ?? { x: 0, y: 0 }
                    showTooltip({ tooltipData: arc.data, tooltipLeft: point.x, tooltipTop: point.y })
                  }}
                  onMouseLeave={hideTooltip}
                />
              ))
            }
          </Pie>
        </Group>
      </svg>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-xs text-muted-foreground">Exposure by symbol</p>
        {slices.map((s, i) => (
          <div key={s.symbol} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-1.5 truncate">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: `var(--${CHART_COLORS[i % CHART_COLORS.length]})` }}
              />
              {s.symbol}
            </span>
            <span className="tabular-nums text-muted-foreground">{fmt((s.value / currentValue) * 100)}%</span>
          </div>
        ))}
      </div>
      {tooltipOpen && tooltipData && (
        <TooltipWithBounds
          left={tooltipLeft}
          top={tooltipTop}
          style={{ ...defaultStyles, background: 'var(--foreground)', color: 'var(--background)' }}
        >
          {tooltipData.symbol}: {inr(tooltipData.value)} ({fmt((tooltipData.value / currentValue) * 100)}%)
        </TooltipWithBounds>
      )}
    </div>
  )
}

function ChangeLine({ pct }) {
  if (pct == null) return null
  const up = pct >= 0
  const Icon = up ? TrendingUpIcon : TrendingDownIcon
  return (
    <span
      className={`inline-flex items-center gap-1 text-sm font-medium tabular-nums ${up ? 'text-up' : 'text-down'}`}
    >
      <Icon className="size-3.5" />
      {up ? '+' : ''}
      {fmt(pct)}%
    </span>
  )
}

// The active broker lives in the URL (?broker=dhan) - shareable/bookmarkable, and survives a
// refresh without a round trip to read it back from settings first. Still persisted server-side
// via setActiveBroker so it's remembered as the default next time /holdings is opened with no
// query param at all (see router.jsx's validateSearch).
function BrokerSelect({ broker, onChange }) {
  const save = useMutation({ mutationFn: setActiveBroker, onError: (e) => toast.error(e.message) })

  const select = (next) => {
    onChange(next)
    save.mutate(next)
  }

  return (
    <Select value={broker} onValueChange={select}>
      <SelectTrigger className="w-36">
        <SelectValue>
          {(value) => (
            <span className="inline-flex items-center gap-1.5">
              <BrokerLogo broker={value} /> {brokerLabel(value)}
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-44" alignItemWithTrigger={false}>
        <SelectItem value="dhan">
          <BrokerLogo broker="dhan" /> Dhan
        </SelectItem>
        <SelectItem value="kite">
          <BrokerLogo broker="kite" /> Kite
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

export default function Holdings() {
  usePageTitle('Holdings')
  const { broker, kiteLogin } = useSearch({ from: '/holdings' })
  const navigate = useNavigate({ from: '/holdings' })
  const queryClient = useQueryClient()
  const [reloading, setReloading] = useState(false)

  const setBroker = (next) => navigate({ search: { broker: next }, replace: true })

  // Lands here after the Kite login redirect (api.py's /api/kite/callback) - surface whether it
  // worked, then drop kiteLogin from the URL so refreshing the page doesn't re-show the toast.
  useEffect(() => {
    if (!kiteLogin) return
    if (kiteLogin === 'success') {
      toast.success('Connected to Kite')
      queryClient.invalidateQueries({ queryKey: ['brokerConfig'] })
      queryClient.invalidateQueries({ queryKey: ['holdings'] })
    } else {
      toast.error('Kite login failed - check your API key/secret in Settings > Kite')
    }
    navigate({ search: { broker }, replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kiteLogin])

  const { data, error, refetch } = useQuery({
    queryKey: ['holdings', broker],
    queryFn: () => getHoldings(broker, false),
    retry: false,
  })

  const reload = async () => {
    setReloading(true)
    try {
      await getHoldings(broker, true)
      await refetch()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setReloading(false)
    }
  }

  const holdings = data?.holdings ?? []
  const investedValue = holdings.reduce((sum, h) => sum + (h.avg_price ?? 0) * (h.qty ?? 0), 0)
  const currentValue = holdings.reduce((sum, h) => sum + (h.ltp ?? h.avg_price ?? 0) * (h.qty ?? 0), 0)
  const pnl = currentValue - investedValue
  const pnlPct = investedValue > 0 ? (pnl / investedValue) * 100 : null
  const winners = holdings.filter((h) => (h.ltp ?? h.avg_price ?? 0) >= (h.avg_price ?? 0)).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Holdings</h2>
        <div className="flex items-center gap-2">
          <BrokerSelect broker={broker} onChange={setBroker} />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Reload holdings"
            onClick={reload}
            disabled={reloading}
          >
            <RefreshCwIcon className={`size-4 ${reloading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex flex-col items-center gap-3 py-24 text-center text-muted-foreground">
          <p>{error.message}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate({ search: (prev) => ({ ...prev, settings: 'broker', broker }) })}
          >
            Configure
          </Button>
        </div>
      )}

      {!error && !data && (
        <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
          <Spinner className="size-4" /> Syncing holdings…
        </div>
      )}

      {!error && data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="Available balance" value={inr(data.available_balance)} />
            <StatCard label="Invested value" value={inr(investedValue)} />
            <StatCard label="Current value" value={inr(currentValue)} />
            <StatCard label="P&L" value={inr(pnl)} sub={<ChangeLine pct={pnlPct} />} />
            <StatCard
              label="Positions"
              value={holdings.length}
              sub={
                holdings.length > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="text-up">{winners} up</span> ·{' '}
                    <span className="text-down">{holdings.length - winners} down</span>
                  </p>
                )
              }
            />
          </div>

          {holdings.length === 0 && (
            <p className="py-24 text-center text-muted-foreground">No holdings found for this broker.</p>
          )}

          {holdings.length > 0 && <ExposureDonut holdings={holdings} currentValue={currentValue} />}

          {holdings.length > 0 && (
            <div className="overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Symbol</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Entry price</TableHead>
                    <TableHead className="text-right">Current price</TableHead>
                    <TableHead className="text-right">Invested</TableHead>
                    <TableHead className="text-right">Current value</TableHead>
                    <TableHead className="text-right">P&L</TableHead>
                    <TableHead className="text-right">P&L %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holdings.map((h) => {
                    const invested = (h.avg_price ?? 0) * (h.qty ?? 0)
                    const current = (h.ltp ?? h.avg_price ?? 0) * (h.qty ?? 0)
                    const rowPnl = current - invested
                    const rowPnlPct =
                      h.avg_price && h.ltp != null ? ((h.ltp - h.avg_price) / h.avg_price) * 100 : null
                    return (
                      <TableRow
                        key={h.isin ?? h.symbol}
                        className="cursor-pointer"
                        onClick={() => navigate({ to: '/stock/$symbol', params: { symbol: h.symbol } })}
                      >
                        <TableCell className="font-semibold">{h.symbol}</TableCell>
                        <TableCell className="text-right tabular-nums">{h.qty}</TableCell>
                        <TableCell className="text-right tabular-nums">{inr(h.avg_price)}</TableCell>
                        <TableCell className="text-right tabular-nums">{inr(h.ltp)}</TableCell>
                        <TableCell className="text-right tabular-nums">{inr(invested)}</TableCell>
                        <TableCell className="text-right tabular-nums">{inr(current)}</TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${rowPnl >= 0 ? 'text-up' : 'text-down'}`}
                        >
                          {inr(rowPnl)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <ChangeLine pct={rowPnlPct} />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
