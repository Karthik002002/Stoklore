import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Streamdown } from 'streamdown'
import { ArrowLeftIcon, DatabaseIcon, ExternalLinkIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { compact, fmt, inr } from '@/lib/format'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { collectMaxHistory, getEmaCrossover, getMaxHistory, getMaxHistoryStatus } from '@/services/api'
import DeleteStockButton from './DeleteStockButton'
import PriceChart from './PriceChart'
import StockChart from './StockChart'
import StockFinancials from './StockFinancials'

// Reuses PriceChart (candles/line toggle, EMA overlays, volume pane, tooltip) - same as the
// range-picker chart above, just fed the full collected history instead of a fetched range.
function MaxHistoryChart({ rows }) {
  const data = useMemo(
    () => ({
      interval: '1d',
      visibleFrom: null,
      bars: rows.map((r) => ({
        time: Math.floor(new Date(r.date).getTime() / 1000),
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
      })),
    }),
    [rows],
  )

  return (
    <PriceChart data={data} isLoading={false} leftControls={null} emptyMessage="No history collected yet." />
  )
}

function MaxHistorySection({ symbol }) {
  const queryClient = useQueryClient()
  const wasRunning = useRef(false)

  const { data: history } = useQuery({
    queryKey: ['maxHistory', symbol],
    queryFn: () => getMaxHistory(symbol),
  })
  const { data: status } = useQuery({
    queryKey: ['maxHistoryStatus', symbol],
    queryFn: () => getMaxHistoryStatus(symbol),
    refetchInterval: (query) => (query.state.data?.running ? 1500 : false),
  })

  useEffect(() => {
    if (wasRunning.current && !status?.running) {
      queryClient.invalidateQueries({ queryKey: ['maxHistory', symbol] })
    }
    wasRunning.current = !!status?.running
  }, [status?.running, symbol, queryClient])

  const collect = useMutation({
    mutationFn: () => collectMaxHistory(symbol),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['maxHistoryStatus', symbol] }),
    onError: (e) => toast.error(e.message),
  })

  const alreadyCollected = history?.length > 0

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Full price history</h2>
        <Tooltip>
          {/* disabled <button>s can swallow hover in some browsers - a wrapping span keeps the
              tooltip working regardless of the button's disabled state, same trick as App.jsx's
              TooltipIcon. */}
          <TooltipTrigger render={<span className="inline-flex" />}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => collect.mutate()}
              disabled={status?.running || alreadyCollected}
            >
              {status?.running ? <Spinner className="size-4" /> : <DatabaseIcon className="size-4" />}
              Collect max history
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {status?.running
              ? 'Collecting full history…'
              : alreadyCollected
                ? 'Max data is already available'
                : 'Fetch this stock’s entire price history'}
          </TooltipContent>
        </Tooltip>
      </div>
      {status?.running && (
        <p className="mb-3 text-sm text-muted-foreground">
          Collecting full history from NSE listing… this can take a moment.
        </p>
      )}
      {history?.length > 0 && <MaxHistoryChart rows={history} />}
    </section>
  )
}

const EMA_PRESETS = [
  [20, 50],
  [20, 100],
  [50, 200],
]

function EmaCrossover({ symbol }) {
  const [short, setShort] = useState(20)
  const [long, setLong] = useState(50)
  const valid = short > 0 && long > 0 && short < long

  const { data, isFetching, error } = useQuery({
    queryKey: ['emaCrossover', symbol, short, long],
    queryFn: () => getEmaCrossover(symbol, short, long),
    enabled: valid,
    retry: false,
  })

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
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
        {isFetching && <Spinner className="size-4" />}
        <div className="ml-auto flex gap-1">
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

      {!valid && (
        <p className="mt-2 text-sm text-destructive">Short period must be less than the long period.</p>
      )}
      {valid && error && (
        <p className="mt-2 text-sm text-muted-foreground">
          Not enough synced price history yet — run a price sync first.
        </p>
      )}
      {valid && data && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {data.crossover ? (
            <Badge variant={data.crossover === 'bullish' ? 'default' : 'destructive'}>
              {data.crossover === 'bullish' ? 'Golden cross' : 'Death cross'}
            </Badge>
          ) : (
            (() => {
              const pct = ((data.shortEma - data.longEma) / data.longEma) * 100
              const above = pct >= 0
              return (
                <Badge variant="secondary" className={above ? 'text-up' : 'text-down'}>
                  {above ? '+' : ''}
                  {fmt(pct)}% {above ? 'above' : 'below'}
                </Badge>
              )
            })()
          )}
          <span className="text-sm text-muted-foreground tabular-nums">
            EMA{short}: {inr(data.shortEma)} · EMA{long}: {inr(data.longEma)}
          </span>
        </div>
      )}
    </div>
  )
}

const STAT_FIELDS = [
  ['Market Cap', 'marketCap', (v) => `₹${compact(v)}`],
  ['P/E (trailing)', 'trailingPE', fmt],
  ['P/E (forward)', 'forwardPE', fmt],
  ['P/B', 'priceToBook', fmt],
  ['Book Value', 'bookValue', inr],
  ['EPS', 'trailingEps', inr],
  ['Dividend Yield', 'dividendYield', (v) => `${fmt(v)}%`],
  ['Beta', 'beta', fmt],
  ['52W High', 'fiftyTwoWeekHigh', inr],
  ['52W Low', 'fiftyTwoWeekLow', inr],
  ['Volume', 'regularMarketVolume', compact],
  ['Avg Volume', 'averageVolume', compact],
]

export default function StockDetail() {
  const { symbol } = useParams({ from: '/stock/$symbol' })
  const navigate = useNavigate()
  const onBack = () => navigate({ to: '/' })
  const [data, setData] = useState(null)

  useEffect(() => {
    fetch(`/api/stocks/${symbol}`)
      .then((r) => r.json())
      .then(setData)
  }, [symbol])

  const deleteReport = (id) => {
    setData((d) => ({ ...d, reports: d.reports.filter((r) => r.id !== id) }))
    fetch(`/api/reports/${id}`, { method: 'DELETE' })
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Spinner className="size-4" /> Loading {symbol}…
      </div>
    )
  }

  const { quote, news, reports } = data
  const change = quote.regularMarketChangePercent
  const up = change != null && change >= 0

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 text-muted-foreground">
          <ArrowLeftIcon className="size-4" /> All stocks
        </Button>
        <DeleteStockButton symbol={symbol} onDeleted={onBack} className="text-muted-foreground" />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{symbol}</h1>
            {quote.sector && <Badge variant="secondary">{quote.sector}</Badge>}
          </div>
          <p className="mt-1 text-muted-foreground">{quote.shortName ?? '—'}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-semibold tabular-nums">{inr(quote.currentPrice)}</p>
          {change != null && (
            <p className={`font-medium tabular-nums ${up ? 'text-up' : 'text-down'}`}>
              {up ? '+' : ''}
              {fmt(change)}% today
            </p>
          )}
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Fundamentals</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {STAT_FIELDS.filter(([, key]) => quote[key] != null).map(([label, key, format]) => (
            <div key={key} className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{format(quote[key])}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Price chart</h2>
        <StockChart symbol={symbol} />
      </section>

      <MaxHistorySection symbol={symbol} />

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">EMA crossover</h2>
        <EmaCrossover symbol={symbol} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Financials (quarterly)</h2>
        <StockFinancials symbol={symbol} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Latest events</h2>
        {news.length === 0 && <p className="text-sm text-muted-foreground">No recent news.</p>}
        <ul className="space-y-2">
          {news.map((n, i) => (
            <li key={i} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <a
                  href={n.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-start gap-1.5 font-medium hover:underline"
                >
                  {n.title}
                  <ExternalLinkIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                </a>
                {n.sentiment_label && (
                  <Badge
                    variant="secondary"
                    className={
                      n.sentiment_label.toLowerCase() === 'positive'
                        ? 'shrink-0 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : n.sentiment_label.toLowerCase() === 'negative'
                          ? 'shrink-0 bg-red-500/15 text-red-600 dark:text-red-400'
                          : 'shrink-0 text-muted-foreground'
                    }
                  >
                    {n.sentiment_label}
                  </Badge>
                )}
              </div>
              {n.summary && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{n.summary}</p>}
              {n.published_at && (
                <time className="mt-2 block text-xs text-muted-foreground">
                  {new Date(n.published_at).toLocaleString()}
                </time>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">AI reports</h2>
        {reports.length === 0 && (
          <p className="text-sm text-muted-foreground">No stored reports for this stock.</p>
        )}
        <div className="space-y-4">
          {reports.map((r) => (
            <article key={r.id} className="relative rounded-xl border bg-card p-5">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete report"
                className="absolute top-3 right-3 text-muted-foreground"
                onClick={() => deleteReport(r.id)}
              >
                <Trash2Icon className="size-4" />
              </Button>
              <Streamdown className="text-sm">{r.content_markdown}</Streamdown>
              <time className="mt-3 block text-xs text-muted-foreground">
                {new Date(r.scraped_at).toLocaleString()}
              </time>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
