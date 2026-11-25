import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Streamdown } from 'streamdown'
import { ArrowLeftIcon, DatabaseIcon, FlaskConicalIcon, Trash2Icon } from 'lucide-react'
import SourceSelect from '@/components/SourceSelect'
import {
  Badge,
  Button,
  Change,
  EmptyState,
  Input,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  Spinner,
  Stat,
  StatStrip,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/design-system'
import { compact, fmt, formatDateTime, inr, timeAgo } from '@/lib/format'
import { useMaxHistoryCollector } from '@/lib/useMaxHistoryCollector'
import { usePageTitle } from '@/lib/usePageTitle'
import { getBacktests, getEmaCrossover } from '@/services/api'
import type { DailyBar } from '@/lib/types'
import type { StockDetail as StockDetailData } from '@/services/api'
import DeleteStockButton from './DeleteStockButton'
import NewsTagBadges from '@/components/NewsTagBadges'
import EventActionsMenu from './EventActionsMenu'
import PriceChart from './PriceChart'
import ScreenerPanel from './ScreenerPanel'
import StockChart from './StockChart'
import StockFinancials from './StockFinancials'

// Reuses PriceChart (candles/line toggle, EMA overlays, volume pane, tooltip) - same as the
// range-picker chart above, just fed the full collected history instead of a fetched range.
function MaxHistoryChart({ rows, controls }: { rows: DailyBar[]; controls: React.ReactNode }) {
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
        volume: r.volume ?? 0,
      })),
    }),
    [rows],
  )

  return (
    <PriceChart
      data={data}
      isLoading={false}
      title="Full price history"
      leftControls={controls}
      emptyMessage="No history collected yet."
    />
  )
}

function MaxHistorySection({ symbol }: { symbol: string }) {
  const {
    maxHistory: history,
    hasMaxData: alreadyCollected,
    status,
    sources,
    source,
    setSource,
    collect,
  } = useMaxHistoryCollector(symbol)

  const controls = (
    <div className="flex items-center gap-1.5">
      <SourceSelect sources={sources} value={source} onChange={setSource} />
      <Tooltip>
        {/* disabled <button>s can swallow hover in some browsers - a wrapping span keeps the
            tooltip working regardless of the button's disabled state. */}
        <TooltipTrigger render={<span className="inline-flex" />}>
          <Button
            size="xs"
            variant="outline"
            onClick={() => collect.mutate()}
            disabled={status?.running || alreadyCollected}
          >
            {status?.running ? <Spinner className="size-3" /> : <DatabaseIcon />}
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
  )

  if (history && history.length > 0) return <MaxHistoryChart rows={history} controls={controls} />
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Full price history</PanelTitle>
        <span className="flex-1" />
        {controls}
      </PanelHeader>
      <PanelBody className="text-muted-foreground">
        {status?.running ? (
          'Collecting full history… this can take a moment.'
        ) : status?.error ? (
          <span className="text-down">{status.error}</span>
        ) : (
          'Not collected yet - collect it to chart this stock’s whole history.'
        )}
      </PanelBody>
    </Panel>
  )
}

const EMA_PRESETS = [
  [20, 50],
  [20, 100],
  [50, 200],
]

function EmaCrossover({ symbol }: { symbol: string }) {
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
    <Panel>
      <PanelHeader>
        <PanelTitle>EMA crossover</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="number"
            min="1"
            value={short}
            onChange={(e) => setShort(Number(e.target.value))}
            numeric
            className="w-20"
            aria-label="Short EMA period"
          />
          <span className="text-sm text-muted-foreground">vs</span>
          <Input
            type="number"
            min="2"
            value={long}
            onChange={(e) => setLong(Number(e.target.value))}
            numeric
            className="w-20"
            aria-label="Long EMA period"
          />
          <span className="text-sm text-muted-foreground">day EMA</span>
          {isFetching && <Spinner className="size-4" />}
          <div className="ml-auto flex gap-1">
            {EMA_PRESETS.map(([s, l]) => (
              <Button
                key={`${s}-${l}`}
                variant="ghost"
                size="xs"
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
              <Badge variant={data.crossover === 'bullish' ? 'success' : 'destructive'}>
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
            {data.lastCrossoverDate && (
              <span className="text-sm text-muted-foreground">
                Last crossover: {timeAgo(data.lastCrossoverDate)}
              </span>
            )}
          </div>
        )}
      </PanelBody>
    </Panel>
  )
}

function BacktestSummary({ symbol }: { symbol: string }) {
  const { data: backtests } = useQuery({
    queryKey: ['backtests', symbol],
    queryFn: () => getBacktests(symbol),
  })
  const latest = backtests?.[0]

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Backtest summary</PanelTitle>
        <span className="flex-1" />
        <Button variant="ghost" size="xs" render={<Link to="/backtesting" />}>
          <FlaskConicalIcon /> Backtesting
        </Button>
      </PanelHeader>
      <PanelBody>
        {!latest && (
          <p className="text-muted-foreground">
            No saved backtest for {symbol} yet — run one from the Backtesting tab.
          </p>
        )}
        {latest && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Change value={latest.total_return_pct} variant="pill" />
              <span className="text-muted-foreground">
                EMA{latest.short_period}/{latest.long_period} · {latest.num_trades} trade
                {latest.num_trades === 1 ? '' : 's'} · {latest.win_rate}% win rate
              </span>
              <span className="ml-auto text-2xs text-muted-foreground">{timeAgo(latest.created_at)}</span>
            </div>
            {latest.lessons && (
              <p className="mt-2 border-t border-border pt-2 text-muted-foreground">{latest.lessons}</p>
            )}
          </>
        )}
      </PanelBody>
    </Panel>
  )
}

const ORIGIN_LABELS: Record<string, string> = { yfinance: 'Yahoo Finance', cogencis: 'Cogencis' }

// [label, quote key, how to print it]
const STAT_FIELDS: [string, string, (v: never) => string][] = [
  ['Market Cap', 'marketCap', (v: number) => `₹${compact(v)}`],
  ['P/E (trailing)', 'trailingPE', fmt],
  ['P/E (forward)', 'forwardPE', fmt],
  ['P/B', 'priceToBook', fmt],
  ['Book Value', 'bookValue', inr],
  ['EPS', 'trailingEps', inr],
  ['Dividend Yield', 'dividendYield', (v: number) => `${fmt(v)}%`],
  ['Beta', 'beta', fmt],
  ['52W High', 'fiftyTwoWeekHigh', inr],
  ['52W Low', 'fiftyTwoWeekLow', inr],
  ['Volume', 'regularMarketVolume', compact],
  ['Avg Volume', 'averageVolume', compact],
]

export default function StockDetail() {
  const { exchange, symbol } = useParams({ from: '/stock/$exchange/$symbol' })
  usePageTitle(`${symbol} · ${exchange}`)
  const navigate = useNavigate()
  const onBack = () => navigate({ to: '/' })
  const [data, setData] = useState<StockDetailData | null>(null)

  useEffect(() => {
    fetch(`/api/stocks/${symbol}`)
      .then((r) => r.json())
      .then(setData)
  }, [symbol])

  const deleteReport = (id: number) => {
    setData((d) => (d ? { ...d, reports: d.reports.filter((r) => r.id !== id) } : d))
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-1 text-muted-foreground">
          <ArrowLeftIcon /> All stocks
        </Button>
        <DeleteStockButton symbol={symbol} onDeleted={onBack} className="text-muted-foreground" />
      </div>

      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-4 p-3">
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <h1 className="text-xl font-bold tracking-tight normal-case">{symbol}</h1>
              {/* Which listing this URL names. Every number below is sourced NSE-side whichever it
                  says - see the note under the price. */}
              <Badge variant="outline">{exchange}</Badge>
              {quote.sector && <Badge variant="secondary">{quote.sector}</Badge>}
            </div>
            <p className="mt-0.5 text-muted-foreground">{quote.shortName ?? '—'}</p>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="tabular text-2xl">{inr(quote.currentPrice)}</span>
            {change != null && (
              <span>
                <Change value={change} /> <span className="text-muted-foreground">today</span>
              </span>
            )}
            {exchange === 'BSE' && (
              <span className="text-2xs text-muted-foreground">Quoted from the NSE listing</span>
            )}
          </div>
        </div>
        {STAT_FIELDS.some(([, key]) => quote[key] != null) && (
          <StatStrip className="border-t border-border">
            {STAT_FIELDS.filter(([, key]) => quote[key] != null).map(([label, key, format]) => (
              <Stat key={key} label={label} value={format(quote[key] as never)} />
            ))}
          </StatStrip>
        )}
      </Panel>

      <StockChart symbol={symbol} title="Price chart" />

      <MaxHistorySection symbol={symbol} />

      <div className="grid gap-2 lg:grid-cols-2">
        <EmaCrossover symbol={symbol} />
        <BacktestSummary symbol={symbol} />
      </div>

      <Panel>
        <PanelHeader>
          <PanelTitle>Financials (quarterly)</PanelTitle>
        </PanelHeader>
        <StockFinancials symbol={symbol} />
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>Screener.in — fundamentals, statements &amp; filings</PanelTitle>
        </PanelHeader>
        <PanelBody>
          <ScreenerPanel symbol={symbol} />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>Latest events</PanelTitle>
        </PanelHeader>
        {news.length === 0 && (
          <EmptyState
            title="No recent news"
            description="Events for this stock show up here as they are scraped."
          />
        )}
        <ul>
          {news.map((n, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: news items have no stable id
            <li key={i} className="border-b border-border/60 px-3 py-2 last:border-0">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">{n.title}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <NewsTagBadges tags={n.laya_tags} />
                  {n.sentiment_label && (
                    <Badge
                      variant={
                        n.sentiment_label.toLowerCase() === 'positive'
                          ? 'success'
                          : n.sentiment_label.toLowerCase() === 'negative'
                            ? 'destructive'
                            : 'outline'
                      }
                    >
                      {n.sentiment_label}
                    </Badge>
                  )}
                  <EventActionsMenu url={n.url} label={n.title} />
                </div>
              </div>
              {n.summary && <p className="mt-0.5 line-clamp-2 text-muted-foreground">{n.summary}</p>}
              {(n.source || n.published_at || n.origin) && (
                <p className="mt-1 flex items-center gap-1.5 text-2xs text-muted-foreground">
                  {n.source}
                  {n.source && n.published_at && ' · '}
                  {n.published_at && <time>{formatDateTime(n.published_at)}</time>}
                  {n.origin && <Badge variant="outline">{ORIGIN_LABELS[n.origin] ?? n.origin}</Badge>}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>AI reports</PanelTitle>
        </PanelHeader>
        {reports.length === 0 && (
          <EmptyState
            title="No stored reports"
            description="Ask the agent for a report on this stock and it lands here."
          />
        )}
        {reports.map((r) => (
          <article key={r.id} className="relative border-b border-border/60 p-3 last:border-0">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Delete report"
              className="absolute top-2 right-2 text-muted-foreground"
              onClick={() => deleteReport(r.id)}
            >
              <Trash2Icon />
            </Button>
            <Streamdown className="text-xs">{r.content_markdown}</Streamdown>
            <time className="mt-2 block text-2xs text-muted-foreground">{formatDateTime(r.scraped_at)}</time>
          </article>
        ))}
      </Panel>
    </div>
  )
}
