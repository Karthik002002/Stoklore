import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { RefreshCwIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDateTime } from '@/lib/format'
import EventActionsMenu from './EventActionsMenu'

function NewsCard({ n }) {
  const open = () => window.open(n.url, '_blank', 'noopener,noreferrer')

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            role="link"
            tabIndex={0}
            onClick={open}
            onKeyDown={(e) => e.key === 'Enter' && open()}
            className="relative flex h-[150px] cursor-pointer flex-col rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
          />
        }
      >
        <EventActionsMenu url={n.url} label={n.title} className="absolute top-2 right-2" />
        <p className="line-clamp-3 pr-6 font-medium">{n.title}</p>
        {n.summary && <p className="mt-1.5 line-clamp-4 text-sm text-muted-foreground">{n.summary}</p>}
        {(n.source || n.published_at) && (
          <p className="mt-2 text-xs text-muted-foreground">
            {n.source}
            {n.source && n.published_at && ' · '}
            {n.published_at && <time>{formatDateTime(n.published_at)}</time>}
          </p>
        )}
        {n.affected_symbols?.length > 0 && (
          <div
            className="mt-auto flex flex-wrap items-center gap-1.5 border-t pt-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-xs text-muted-foreground">Affects:</span>
            {n.affected_symbols.map((symbol) => (
              <Link key={symbol} to="/stock/$symbol" params={{ symbol }}>
                <Badge variant="secondary" className="hover:bg-primary/15 hover:text-primary">
                  {symbol}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-sm text-left whitespace-normal">
        <div className="space-y-1.5 py-0.5">
          <p className="font-semibold">{n.title}</p>
          {n.summary && <p className="text-background/80">{n.summary}</p>}
          {(n.source || n.published_at) && (
            <p className="text-background/60">
              {n.source}
              {n.source && n.published_at && ' · '}
              {n.published_at && formatDateTime(n.published_at)}
            </p>
          )}
          {n.affected_symbols?.length > 0 && (
            <p className="text-background/60">Affects: {n.affected_symbols.join(', ')}</p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export default function TopNews() {
  const [news, setNews] = useState(null)
  const [error, setError] = useState(null)
  const [onlyAffecting, setOnlyAffecting] = useState(false)
  const [reloading, setReloading] = useState(false)

  const load = (force = false) => {
    if (force) setReloading(true)
    fetch(`/api/top-news${force ? '?force=true' : ''}`)
      .then(async (r) => {
        if (!r.ok) {
          const { detail } = await r.json().catch(() => ({}))
          throw new Error(detail || 'Failed to load top news')
        }
        return r.json()
      })
      .then((data) => {
        setNews(data)
        setError(null)
      })
      .catch((e) => setError(e.message))
      .finally(() => setReloading(false))
  }

  useEffect(() => load(false), [])

  const visible = onlyAffecting ? news?.filter((n) => n.affected_symbols?.length > 0) : news

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Top news</h2>
        <div className="flex items-center gap-2">
          <Button
            variant={onlyAffecting ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setOnlyAffecting((v) => !v)}
          >
            Affecting my watchlist only
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Reload top news"
            onClick={() => load(true)}
            disabled={reloading}
          >
            <RefreshCwIcon className={`size-4 ${reloading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {error && (
        <p className="py-24 text-center text-muted-foreground">
          {error} — add one in Settings &gt; Cogencis.
        </p>
      )}

      {!error && !news && (
        <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
          <Spinner className="size-4" /> Loading top news…
        </div>
      )}

      {!error && visible?.length === 0 && (
        <p className="py-24 text-center text-muted-foreground">
          {onlyAffecting ? 'None of the latest stories mention a watchlisted stock.' : 'No news found.'}
        </p>
      )}

      {!error && visible?.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((n) => (
            <NewsCard key={n.url} n={n} />
          ))}
        </div>
      )}
    </div>
  )
}
