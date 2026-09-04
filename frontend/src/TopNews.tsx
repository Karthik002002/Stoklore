import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { RefreshCwIcon, SearchIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDateTime, timeAgoShort } from '@/lib/format'
import { usePageTitle } from '@/lib/usePageTitle'
import EventActionsMenu from './EventActionsMenu'

/** One story in the feed. `affected_symbols` is filled in per request by matching the story's
 *  ISINs against the watchlist (app/routers/top_news.py), so it is not stored anywhere. */
type NewsItem = {
  title: string
  summary: string | null
  url: string
  published_at: string | null
  source: string | null
  isins: string | null
  affected_symbols: string[]
}
type NewsPage = { items: NewsItem[]; total: number }

function NewsRow({ n }: { n: NewsItem }) {
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
            className="group flex cursor-pointer items-center gap-3 border-b px-2 py-1.5 font-mono text-xs transition-colors hover:bg-muted/50"
          />
        }
      >
        {n.published_at && (
          <time className="w-8 shrink-0 text-right text-muted-foreground">
            {timeAgoShort(n.published_at)}
          </time>
        )}
        {n.source && <span className="w-24 shrink-0 truncate font-semibold text-primary">{n.source}</span>}
        <p className="min-w-0 flex-1 truncate">{n.title}</p>
        {n.affected_symbols.length > 0 && (
          <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {n.affected_symbols.map((symbol) => (
              <Link key={symbol} to="/stock/$exchange/$symbol" params={{ exchange: 'NSE', symbol }}>
                <Badge variant="secondary" className="hover:bg-primary/15 hover:text-primary">
                  {symbol}
                </Badge>
              </Link>
            ))}
          </div>
        )}
        <EventActionsMenu
          url={n.url}
          label={n.title}
          className="shrink-0 opacity-0 group-hover:opacity-100"
        />
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
          {n.affected_symbols.length > 0 && (
            <p className="text-background/60">Affects: {n.affected_symbols.join(', ')}</p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

const PAGE_SIZE = 30

export default function TopNews() {
  usePageTitle('Top news')
  const [news, setNews] = useState<NewsItem[] | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [onlyAffecting, setOnlyAffecting] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [query, setQuery] = useState('')
  const sentinelRef = useRef<HTMLDivElement>(null)

  const fetchPage = (offset: number, force = false): Promise<NewsPage> =>
    fetch(`/api/top-news?offset=${offset}&limit=${PAGE_SIZE}${force ? '&force=true' : ''}`).then(
      async (r) => {
        if (!r.ok) {
          const { detail } = await r.json().catch(() => ({}))
          throw new Error(detail || 'Failed to load top news')
        }
        return r.json()
      },
    )

  const load = (force = false) => {
    if (force) setReloading(true)
    fetchPage(0, force)
      .then(({ items, total }) => {
        setNews(items)
        setTotal(total)
        setError(null)
      })
      .catch((e) => setError(e.message))
      .finally(() => setReloading(false))
  }

  useEffect(() => load(false), [])

  const hasMore = news && (total == null || news.length < total)

  // Loads the next 30-story page once the sentinel at the bottom of the list scrolls into view.
  useEffect(() => {
    if (!hasMore || loadingMore || error) return
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setLoadingMore(true)
        fetchPage(news?.length ?? 0)
          .then(({ items, total }) => {
            setNews((prev) => [...(prev ?? []), ...items])
            setTotal(total)
          })
          .catch((e) => setError(e.message))
          .finally(() => setLoadingMore(false))
      },
      { rootMargin: '300px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loadingMore, error, news?.length])

  const visible = useMemo(() => {
    let v = onlyAffecting ? news?.filter((n) => n.affected_symbols.length > 0) : news
    if (query.trim() && v) {
      const q = query.trim().toLowerCase()
      v = v.filter((n) => n.title.toLowerCase().includes(q) || n.summary?.toLowerCase().includes(q))
    }
    return v
  }, [news, onlyAffecting, query])

  return (
    <div className="space-y-3 font-mono">
      <div className="flex items-center gap-2">
        <h2 className="shrink-0 text-sm font-medium text-muted-foreground">Top news</h2>
        {news && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {news.length}
            {total != null && ` / ${total}`}
          </span>
        )}
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="h-7 pl-7 font-mono text-xs"
          />
        </div>
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

      {!error && visible && visible.length > 0 && (
        <div className="rounded-lg border">
          {visible.map((n) => (
            <NewsRow key={n.url} n={n} />
          ))}
          {hasMore && (
            <div
              ref={sentinelRef}
              className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground"
            >
              {loadingMore && (
                <>
                  <Spinner className="size-3.5" /> Loading more…
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
