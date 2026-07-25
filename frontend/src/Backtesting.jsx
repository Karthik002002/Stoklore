import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlayIcon, Trash2Icon, TrendingDownIcon, TrendingUpIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { fmt, formatDate, formatDateTime, inr } from '@/lib/format'
import { usePageTitle } from '@/lib/usePageTitle'
import { deleteBacktest, getBacktests, runBacktest, saveBacktest } from '@/services/api'

const EMA_PRESETS = [
  [20, 50],
  [20, 100],
  [50, 200],
]

function ReturnBadge({ pct }) {
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

function TradesTable({ trades }) {
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

function RunBacktestForm({ onSaved }) {
  const [symbol, setSymbol] = useState('')
  const [short, setShort] = useState(20)
  const [long, setLong] = useState(50)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [lessons, setLessons] = useState('')
  const [result, setResult] = useState(null)

  const valid = symbol.trim() && short > 0 && long > 0 && short < long

  const params = () => ({
    symbol: symbol.trim().toUpperCase(),
    short,
    long,
    from_date: fromDate || null,
    to_date: toDate || null,
  })

  const run = useMutation({
    mutationFn: () => runBacktest(params()),
    onSuccess: setResult,
    onError: (e) => {
      setResult(null)
      toast.error(e.message)
    },
  })

  const save = useMutation({
    mutationFn: () => saveBacktest({ ...params(), lessons: lessons.trim() || null }),
    onSuccess: () => {
      toast.success(`Backtest saved for ${symbol.trim().toUpperCase()}`)
      setLessons('')
      onSaved()
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="NSE symbol, e.g. INFY"
          className="h-8 w-40 uppercase placeholder:normal-case"
        />
        <Input
          type="number"
          min="1"
          value={short}
          onChange={(e) => setShort(Number(e.target.value))}
          className="h-8 w-20"
          aria-label="Short EMA period"
        />
        <span className="text-sm text-muted-foreground">vs</span>
        <Input
          type="number"
          min="2"
          value={long}
          onChange={(e) => setLong(Number(e.target.value))}
          className="h-8 w-20"
          aria-label="Long EMA period"
        />
        <span className="text-sm text-muted-foreground">day EMA</span>
        <div className="flex gap-1">
          {EMA_PRESETS.map(([s, l]) => (
            <Button
              key={`${s}-${l}`}
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setShort(s)
                setLong(l)
              }}
            >
              {s}/{l}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="h-8 w-36"
          aria-label="From date"
        />
        <span className="text-sm text-muted-foreground">to</span>
        <Input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="h-8 w-36"
          aria-label="To date"
        />
        <span className="text-xs text-muted-foreground">(leave blank for the full stored history)</span>
      </div>

      <Button onClick={() => run.mutate()} disabled={!valid || run.isPending}>
        {run.isPending ? <Spinner className="size-4" /> : <PlayIcon className="size-4" />}
        Run backtest
      </Button>
      {!valid && (
        <p className="text-sm text-destructive">
          Enter a symbol, with the short period less than the long period.
        </p>
      )}

      {result && (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center gap-4">
            <ReturnBadge pct={result.summary.total_return_pct} />
            <span className="text-sm text-muted-foreground">
              {result.summary.num_trades} trade{result.summary.num_trades === 1 ? '' : 's'} ·{' '}
              {result.summary.win_rate}% win rate
            </span>
          </div>
          <TradesTable trades={result.trades} />
          <div className="space-y-2">
            <p className="text-sm font-medium">Lessons learned (optional)</p>
            <Textarea
              value={lessons}
              onChange={(e) => setLessons(e.target.value)}
              placeholder="What would you do differently next time? e.g. exited too early on the golden cross, should've waited for volume confirmation"
              rows={3}
            />
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              Save this backtest
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function SavedBacktests() {
  const queryClient = useQueryClient()
  const { data: saved } = useQuery({ queryKey: ['backtests'], queryFn: () => getBacktests() })

  const remove = useMutation({
    mutationFn: deleteBacktest,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backtests'] }),
  })

  if (!saved || saved.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No saved backtests yet - run one above and save it.</p>
    )
  }

  return (
    <div className="space-y-2">
      {saved.map((b) => (
        <div key={b.id} className="rounded-lg border bg-card p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className="font-semibold">{b.symbol}</span>
              <span className="text-xs text-muted-foreground">
                EMA{b.short_period}/{b.long_period}
              </span>
              <ReturnBadge pct={b.total_return_pct} />
              <span className="text-xs text-muted-foreground">
                {b.num_trades} trade{b.num_trades === 1 ? '' : 's'} · {b.win_rate}% win rate
              </span>
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-muted-foreground">{formatDateTime(b.created_at)}</span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete backtest for ${b.symbol}`}
                onClick={() => remove.mutate(b.id)}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
          </div>
          {b.lessons && <p className="mt-1.5 text-muted-foreground">{b.lessons}</p>}
        </div>
      ))}
    </div>
  )
}

export default function Backtesting() {
  usePageTitle('Backtesting')
  const queryClient = useQueryClient()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Run a backtest</h2>
        <RunBacktestForm onSaved={() => queryClient.invalidateQueries({ queryKey: ['backtests'] })} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Saved backtests</h2>
        <SavedBacktests />
      </div>
    </div>
  )
}
