import { TrendingDownIcon, TrendingUpIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fmt, formatDate, inr } from '@/lib/format'

export function ReturnBadge({ pct }) {
  const up = pct >= 0
  const Icon = up ? TrendingUpIcon : TrendingDownIcon
  return (
    <Badge variant={up ? 'default' : 'destructive'} className="gap-1">
      <Icon className="size-3" />
      {up ? '+' : ''}
      {fmt(pct)}%
    </Badge>
  )
}

export function TradesTable({ trades }) {
  if (trades.length === 0) {
    return <p className="text-sm text-muted-foreground">No completed trades in this window.</p>
  }
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Entry</TableHead>
            <TableHead>Exit</TableHead>
            <TableHead className="text-right">Entry price</TableHead>
            <TableHead className="text-right">Exit price</TableHead>
            <TableHead className="text-right">Return</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((t, i) => (
            <TableRow key={i}>
              <TableCell>{formatDate(t.entry_date)}</TableCell>
              <TableCell>
                {formatDate(t.exit_date)}
                {t.open && (
                  <Badge variant="outline" className="ml-1.5 text-[10px]">
                    Open
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{inr(t.entry_price)}</TableCell>
              <TableCell className="text-right tabular-nums">{inr(t.exit_price)}</TableCell>
              <TableCell className="text-right">
                <ReturnBadge pct={t.return_pct} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// Summary badges + trade breakdown for a {summary, trades} backtest result - shared by the
// manual EMA-crossover form and the auto (Pine Script) preview/execute views, since both
// produce the same shape (see backtest.run_ema_crossover and lib/runPineScript.js).
export function BacktestResultView({ result }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <ReturnBadge pct={result.summary.total_return_pct} />
        <span className="text-sm text-muted-foreground">
          {result.summary.num_trades} trade{result.summary.num_trades === 1 ? '' : 's'} ·{' '}
          {result.summary.win_rate}% win rate
        </span>
      </div>
      <TradesTable trades={result.trades} />
    </div>
  )
}

// Indicator-only Pine scripts (plot() but no strategy()) have no trades - just show each named
// plot's most recent values.
export function PlotsResultView({ plots }) {
  const names = Object.keys(plots)
  if (names.length === 0) {
    return <p className="text-sm text-muted-foreground">Script produced no plots.</p>
  }
  return (
    <div className="space-y-3">
      {names.map((name) => {
        const values = plots[name].slice(-10)
        return (
          <div key={name} className="rounded-lg border bg-card p-3 text-sm">
            <p className="mb-1 font-medium">{name}</p>
            <p className="text-muted-foreground tabular-nums">
              {values.map((v) => fmt(v?.value ?? v, 2)).join(', ')}
            </p>
          </div>
        )
      })}
    </div>
  )
}
