import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { RadarIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'

const EVENT_LABELS = {
  news: 'News',
  price_move: 'Price move',
  volume_spike: 'Volume spike',
  corporate_action: 'Corporate action',
}

const SENTIMENT_VARIANT = { positive: 'default', negative: 'destructive', neutral: 'secondary' }

export default function EventsFeed() {
  const [eventsList, setEventsList] = useState(null)
  const [watchlist, setWatchlist] = useState([])
  const [tab, setTab] = useState('All')
  const [scanScope, setScanScope] = useState('All')
  const [scanStatus, setScanStatus] = useState(null)

  const load = (activeTab = tab) => {
    const qs = activeTab === 'All' ? '' : `?list_name=${encodeURIComponent(activeTab)}`
    fetch(`/api/events${qs}`).then((r) => r.json()).then(setEventsList)
    fetch('/api/watchlist').then((r) => r.json()).then(setWatchlist)
  }

  useEffect(() => load(tab), [tab])

  useEffect(() => {
    const poll = () => {
      fetch('/api/events/status').then((r) => r.json()).then((s) => {
        if (s.running) load() // stream new events in as symbols finish
        setScanStatus((prev) => {
          if (prev?.running && !s.running) load() // scan just finished - final refresh
          return s
        })
      })
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => clearInterval(id)
  }, [tab])

  const startScan = async () => {
    const qs = scanScope === 'All' ? '' : `?list_name=${encodeURIComponent(scanScope)}`
    const res = await fetch(`/api/events/scan${qs}`, { method: 'POST' })
    if (!res.ok) {
      const { detail } = await res.json().catch(() => ({}))
      toast.error(detail || 'Failed to start scan')
      return
    }
    setScanStatus({ running: true, done: 0, total: 0 })
  }

  const lists = [...new Set(watchlist.map((w) => w.list_name))].sort()
  const tabs = ['All', ...lists]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Watchlist events</h2>
        <div className="flex items-center gap-2">
          <Select value={scanScope} onValueChange={setScanScope} disabled={scanStatus?.running}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All watchlists</SelectItem>
              {lists.map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={startScan} disabled={scanStatus?.running}>
            {scanStatus?.running ? <Spinner className="size-4" /> : <RadarIcon className="size-4" />}
            Scan for events
          </Button>
        </div>
      </div>

      {scanStatus?.running && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Scanning watchlist for events… {scanStatus.done}/{scanStatus.total || '?'}
        </div>
      )}

      {lists.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {tabs.map((name) => (
            <Button
              key={name}
              variant={tab === name ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setTab(name)}
            >
              {name}
            </Button>
          ))}
        </div>
      )}

      {!eventsList && (
        <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
          <Spinner className="size-4" /> Loading events…
        </div>
      )}

      {eventsList?.length === 0 && (
        <p className="py-24 text-center text-muted-foreground">
          No events yet — bookmark stocks into a watchlist on the home page, then hit
          “Scan for events”.
        </p>
      )}

      {eventsList?.length > 0 && (
        <div className="space-y-2">
          {eventsList.map((e) => (
            <div key={e.id} className="flex items-start gap-3 rounded-lg border bg-card px-3 py-2.5 text-sm">
              <Badge variant="outline" className="mt-0.5 shrink-0">{EVENT_LABELS[e.event_type]}</Badge>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/stock/$symbol"
                    params={{ symbol: e.symbol }}
                    className="font-semibold hover:underline"
                  >
                    {e.symbol}
                  </Link>
                  {e.list_name && <Badge variant="ghost">{e.list_name}</Badge>}
                  {e.sentiment_label && (
                    <Badge variant={SENTIMENT_VARIANT[e.sentiment_label] || 'secondary'}>
                      {e.sentiment_label}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5">
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noreferrer" className="hover:underline">
                      {e.headline}
                    </a>
                  ) : (
                    e.headline
                  )}
                </p>
                {e.detail && <p className="mt-0.5 text-muted-foreground">{e.detail}</p>}
              </div>
              <span className="shrink-0 text-muted-foreground">
                {e.event_time ? new Date(e.event_time).toLocaleDateString() : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
