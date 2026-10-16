// /risk - the swing book's risk in one place, across every paper account and the Dhan account:
// how much is given back if every stop fills, as a share of each account; positions with no stop;
// where the risk sits by sector; positions that are really one bet (they move together); and
// positions about to be held through a results day. Read-only - it reports, the trader decides.
// The arithmetic is lib/bookRisk.ts.
import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangleIcon, ShieldAlertIcon } from 'lucide-react'
import ResultsBadge, { useNextResults } from '@/components/ResultsBadge'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { chartQuery } from '@/features/bar-replay/ChartControls'
import type { BookPosition } from '@/lib/bookRisk'
import { correlatedPairs, daysUntil, groupRisk, positionRisk } from '@/lib/bookRisk'
import { fmt, inr } from '@/lib/format'
import { accountBalance, tradesForAccount } from '@/lib/tradeAccounts'
import { usePageTitle } from '@/lib/usePageTitle'
import { cn } from '@/lib/utils'
import {
  getBalanceAdjustments,
  getLiveOrders,
  getLivePositions,
  getLiveStatus,
  getManualTrades,
  getPaperPositions,
  getTradeAccounts,
} from '@/services/api'

const LIVE = 'Dhan · live'
const OPEN_LEG = ['TRANSIT', 'PENDING', 'PART_TRADED']

function Card({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'up' | 'down' | 'warn'
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-xl font-semibold tabular-nums',
          tone === 'up' && 'text-up',
          tone === 'down' && 'text-down',
          tone === 'warn' && 'text-amber-600 dark:text-amber-400',
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

export default function RiskPage() {
  usePageTitle('Book risk')
  const { data: paper = [], isPending } = useQuery({
    queryKey: ['paperPositions', null],
    queryFn: () => getPaperPositions(null),
    refetchInterval: 15_000,
  })
  const { data: accounts = [] } = useQuery({
    queryKey: ['tradeAccounts', 'paper'],
    queryFn: () => getTradeAccounts('paper'),
  })
  const { data: trades = [] } = useQuery({ queryKey: ['manualTrades'], queryFn: getManualTrades })
  const { data: adjustments = [] } = useQuery({
    queryKey: ['balanceAdjustments'],
    queryFn: getBalanceAdjustments,
  })
  const { data: liveStatus } = useQuery({ queryKey: ['liveStatus'], queryFn: getLiveStatus })
  const live = !!liveStatus?.configured
  const { data: livePositions = [] } = useQuery({
    queryKey: ['livePositions'],
    queryFn: getLivePositions,
    enabled: live,
    refetchInterval: 15_000,
  })
  const { data: liveOrders = [] } = useQuery({
    queryKey: ['liveOrders'],
    queryFn: () => getLiveOrders(),
    enabled: live,
  })
  const results = useNextResults()

  // Both books as one list of BookPositions.
  const book = useMemo<BookPosition[]>(() => {
    const names = new Map(accounts.map((a) => [a.id, a.name]))
    const fromPaper: BookPosition[] = paper
      .filter((p) => p.status === 'open')
      .map((p) => ({
        key: `paper-${p.id}`,
        symbol: p.symbol,
        account: names.get(p.account_id) ?? `Account ${p.account_id}`,
        direction: p.direction,
        quantity: p.quantity,
        entry: p.entry_price,
        price: p.current_price,
        stops: (p.stop_losses ?? []).map((l) => ({ price: l.price, qty: l.qty })),
        sector: p.sector,
      }))
    const fromLive: BookPosition[] = livePositions
      .filter((p) => p.net_qty && p.symbol)
      .map((p) => ({
        key: `live-${p.security_id}`,
        symbol: p.symbol!,
        account: LIVE,
        direction: p.net_qty > 0 ? 'long' : 'short',
        quantity: Math.abs(p.net_qty),
        entry: (p.net_qty > 0 ? p.buy_avg : p.sell_avg) ?? 0,
        price: p.current_price ?? null,
        // the working stop legs of its Super Orders, at the broker
        stops: liveOrders
          .filter((o) => o.symbol === p.symbol && o.leg === 'STOP_LOSS_LEG' && OPEN_LEG.includes(o.status))
          .map((o) => ({
            price: (o.trigger_price ?? o.price) as number,
            qty: (o.quantity ?? 0) - (o.filled_qty ?? 0),
          }))
          .filter((s) => s.price),
        sector: null,
      }))
    return [...fromPaper, ...fromLive]
  }, [paper, accounts, livePositions, liveOrders])

  // What each account is measured against: a paper account's balance, Dhan's available cash.
  const balances = useMemo(() => {
    const out = new Map<string, number | null>()
    for (const a of accounts)
      out.set(
        a.name,
        accountBalance(
          a,
          tradesForAccount(trades, a.id),
          adjustments.filter((x) => x.account_id === a.id),
        ),
      )
    if (live) out.set(LIVE, liveStatus?.balance ?? null)
    return out
  }, [accounts, trades, adjustments, live, liveStatus])

  const byAccount = groupRisk(book, (p) => p.account)
  const bySector = groupRisk(book, (p) => p.sector || 'Unknown sector')
  const rows = book
    .map((p) => ({ p, r: positionRisk(p) }))
    .sort((a, b) => b.r.atRisk - a.r.atRisk || b.r.unprotectedValue - a.r.unprotectedValue)
  const totalRisk = rows.reduce((t, x) => t + x.r.atRisk, 0)
  const totalStopped = rows.reduce((t, x) => t + x.r.stoppedPnl, 0)
  const unprotected = rows.filter((x) => x.r.uncoveredQty > 0)
  const throughResults = rows.filter((x) => {
    const d = results.get(x.p.symbol)
    return d != null && daysUntil(d) <= 7
  })

  // Correlation over six months of daily closes, one chart fetch per held symbol (shared cache).
  const symbols = [...new Set(book.map((p) => p.symbol))].slice(0, 20)
  const charts = useQueries({
    queries: symbols.map((s) => ({ ...chartQuery(s, '6mo'), staleTime: 3_600_000 })),
  })
  const pairs = useMemo(() => {
    const bars: Record<string, { time: number | string; close: number }[]> = {}
    charts.forEach((c, i) => {
      const data = c.data as { bars?: { time: number | string; close: number }[] } | undefined
      if (data?.bars?.length) bars[symbols[i]] = data.bars
    })
    return correlatedPairs(bars)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charts.map((c) => c.dataUpdatedAt).join(), symbols.join()])
  const chartsLoading = charts.some((c) => c.isPending)

  const pctOf = (account: string, v: number) => {
    const b = balances.get(account)
    return b ? (v / b) * 100 : null
  }

  if (isPending)
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Spinner className="size-4" /> Loading positions…
      </div>
    )

  return (
    <div className="space-y-5 p-1">
      <div>
        <h1 className="text-lg font-semibold">Book risk</h1>
        <p className="text-sm text-muted-foreground">
          Every open position across your paper accounts{live ? ' and Dhan' : ''}: what the stops put at risk,
          what isn't protected, where it's concentrated, and what reports results soon.
        </p>
      </div>

      {book.length === 0 ? (
        <p className="rounded-xl border bg-card py-16 text-center text-sm text-muted-foreground">
          No open positions.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card
              label="At risk to stops"
              value={inr(totalRisk)}
              sub="given back from here if every stop fills"
              tone={totalRisk ? 'down' : undefined}
            />
            <Card
              label="If every stop fills"
              value={`${totalStopped >= 0 ? '+' : ''}${inr(totalStopped)}`}
              sub={totalStopped >= 0 ? 'still a profit - stops locked it in' : 'booked against entry'}
              tone={totalStopped >= 0 ? 'up' : 'down'}
            />
            <Card
              label="Unprotected"
              value={unprotected.length}
              sub={
                unprotected.length
                  ? `${inr(unprotected.reduce((t, x) => t + x.r.unprotectedValue, 0))} with no stop under it`
                  : 'every share has a stop'
              }
              tone={unprotected.length ? 'warn' : undefined}
            />
            <Card
              label="Results within 7 days"
              value={throughResults.length}
              sub={
                throughResults.length
                  ? throughResults.map((x) => x.p.symbol).join(', ')
                  : 'none of your positions'
              }
              tone={throughResults.length ? 'warn' : undefined}
            />
          </div>

          <Section
            title="By account"
            hint="Open risk as a share of each account - the number that decides whether the next trade fits."
          >
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Account</TableHead>
                    <TableHead className="text-right">Positions</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">At risk</TableHead>
                    <TableHead className="text-right">Of account</TableHead>
                    <TableHead className="text-right">If stopped out</TableHead>
                    <TableHead className="text-right">Unprotected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byAccount.map((g) => {
                    const pct = pctOf(g.key, g.atRisk)
                    return (
                      <TableRow key={g.key}>
                        <TableCell className={cn('font-medium', g.key === LIVE && 'text-down')}>
                          {g.key}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{g.positions}</TableCell>
                        <TableCell className="text-right tabular-nums">{inr(g.value)}</TableCell>
                        <TableCell className="text-right text-down tabular-nums">{inr(g.atRisk)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {pct == null ? (
                            '—'
                          ) : (
                            <span
                              className={cn(
                                pct > 6
                                  ? 'font-semibold text-down'
                                  : pct > 3
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : '',
                              )}
                            >
                              {fmt(pct, 2)}%
                            </span>
                          )}
                          {g.key === LIVE && (
                            <span className="block text-[10px] text-muted-foreground">of available cash</span>
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right tabular-nums',
                            g.stoppedPnl >= 0 ? 'text-up' : 'text-down',
                          )}
                        >
                          {inr(g.stoppedPnl)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right tabular-nums',
                            g.unprotected && 'text-amber-600 dark:text-amber-400',
                          )}
                        >
                          {g.unprotected || '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </Section>

          <Section
            title="Positions"
            hint="Biggest risk first. A position with no stop under some of its shares is flagged."
          >
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Position</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Entry</TableHead>
                    <TableHead className="text-right">Last</TableHead>
                    <TableHead className="text-right">Stop</TableHead>
                    <TableHead className="text-right">At risk</TableHead>
                    <TableHead className="text-right">Of account</TableHead>
                    <TableHead className="text-right">If stopped</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ p, r }) => {
                    const pct = pctOf(p.account, r.atRisk)
                    const to = p.account === LIVE ? '/live/$symbol' : '/paper/$symbol'
                    return (
                      <TableRow key={p.key}>
                        <TableCell className="whitespace-nowrap">
                          <Link to={to} params={{ symbol: p.symbol }} className="font-medium hover:underline">
                            {p.symbol}
                          </Link>
                          <span
                            className={cn(
                              'ml-1.5 text-xs capitalize',
                              p.direction === 'long' ? 'text-up' : 'text-down',
                            )}
                          >
                            {p.direction}
                          </span>
                          <ResultsBadge symbol={p.symbol} className="ml-1.5" />
                          {r.uncoveredQty > 0 && (
                            <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                              <ShieldAlertIcon className="size-3" />
                              {r.uncoveredQty === p.quantity ? 'no stop' : `${r.uncoveredQty} unprotected`}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className={cn('text-xs', p.account === LIVE && 'text-down')}>
                          {p.account}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{p.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">{inr(p.entry)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.price == null ? '—' : inr(p.price)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.stops.length ? p.stops.map((s) => inr(s.price)).join(', ') : '—'}
                        </TableCell>
                        <TableCell className="text-right text-down tabular-nums">
                          {r.atRisk ? inr(r.atRisk) : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {pct == null ? '—' : `${fmt(pct, 2)}%`}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right tabular-nums',
                            r.stoppedPnl >= 0 ? 'text-up' : 'text-down',
                          )}
                        >
                          {p.stops.length ? inr(r.stoppedPnl) : '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </Section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section
              title="By sector"
              hint="Where the risk is concentrated. Live positions carry no sector, so they sit under Unknown."
            >
              <div className="space-y-2 rounded-xl border bg-card p-3">
                {bySector.map((g) => {
                  const share = totalRisk ? (g.atRisk / totalRisk) * 100 : 0
                  return (
                    <div key={g.key} className="space-y-1 text-xs">
                      <div className="flex justify-between gap-2">
                        <span className="truncate font-medium">{g.key}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {g.positions} pos · {inr(g.atRisk)} at risk · {fmt(share, 0)}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn('h-full rounded-full', share > 40 ? 'bg-down' : 'bg-primary/70')}
                          style={{ width: `${share}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </Section>

            <Section
              title="Moving together"
              hint="Pairs whose daily returns over 6 months correlate 0.7 or more - two positions that are really one bet."
            >
              <div className="rounded-xl border bg-card p-3 text-xs">
                {chartsLoading ? (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Spinner className="size-3.5" /> Reading price history…
                  </p>
                ) : pairs.length === 0 ? (
                  <p className="text-muted-foreground">
                    No strongly correlated pairs among {symbols.length} held stocks.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {pairs.map((x) => (
                      <li key={`${x.a}-${x.b}`} className="flex items-center gap-2">
                        {Math.abs(x.r) >= 0.85 && <AlertTriangleIcon className="size-3.5 text-amber-500" />}
                        <span className="font-medium">
                          {x.a} · {x.b}
                        </span>
                        <span className="ml-auto text-muted-foreground tabular-nums">
                          r ={' '}
                          <span className={x.r > 0 ? 'text-foreground' : 'text-sky-500'}>{fmt(x.r, 2)}</span>{' '}
                          over {x.days} days
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Section>
          </div>
        </>
      )}
    </div>
  )
}
