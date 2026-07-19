import { useEffect, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Streamdown } from 'streamdown'
import { ArrowLeftIcon, ExternalLinkIcon, Trash2Icon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { compact, fmt, inr } from '@/lib/format'
import DeleteStockButton from './DeleteStockButton'
import StockChart from './StockChart'

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
    fetch(`/api/stocks/${symbol}`).then((r) => r.json()).then(setData)
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
              {up ? '+' : ''}{fmt(change)}% today
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

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Latest events</h2>
        {news.length === 0 && <p className="text-sm text-muted-foreground">No recent news.</p>}
        <ul className="space-y-2">
          {news.map((n, i) => (
            <li key={i} className="rounded-xl border bg-card p-4">
              <a
                href={n.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-start gap-1.5 font-medium hover:underline"
              >
                {n.title}
                <ExternalLinkIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
              </a>
              {n.summary && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{n.summary}</p>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">AI reports</h2>
        {reports.length === 0 && <p className="text-sm text-muted-foreground">No stored reports for this stock.</p>}
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
