/** Upcoming results board meetings from NSE's event calendar (~two weeks ahead), grouped by day.
 *  "Only mine" narrows it to what you track or hold - a results day is a gap you can't stop out of. */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import RsPill from '@/components/RsPill'
import { Spinner } from '@/components/ui/spinner'
import { daysUntil } from '@/lib/bookRisk'
import { usePageTitle } from '@/lib/usePageTitle'
import { useStrength } from '@/lib/useStrength'
import { cn } from '@/lib/utils'
import {
  getLivePositions,
  getLiveStatus,
  getPaperPositions,
  getResultsCalendar,
  getSectors,
  getWatchlist,
} from '@/services/api'

const dayLabel = (iso: string) => {
  const d = daysUntil(iso)
  const date = new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  })
  return d === 0 ? `Today · ${date}` : d === 1 ? `Tomorrow · ${date}` : date
}

export default function EarningsPage() {
  usePageTitle('Earnings')
  const [mine, setMine] = useState(true)
  const { data, isPending } = useQuery({
    queryKey: ['resultsCalendar'],
    queryFn: getResultsCalendar,
    staleTime: 3_600_000,
  })
  const { data: watchlist = [] } = useQuery({ queryKey: ['watchlist'], queryFn: getWatchlist })
  const { data: paper = [] } = useQuery({
    queryKey: ['paperPositions', null],
    queryFn: () => getPaperPositions(null),
  })
  const { data: liveStatus } = useQuery({ queryKey: ['liveStatus'], queryFn: getLiveStatus })
  const { data: live = [] } = useQuery({
    queryKey: ['livePositions'],
    queryFn: getLivePositions,
    enabled: !!liveStatus?.configured,
  })
  const { data: sectorData } = useQuery({ queryKey: ['sectors', 'NSE'], queryFn: () => getSectors('NSE') })
  const { bySymbol } = useStrength()

  const sectorOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of sectorData?.sectors ?? [])
      for (const mem of s.members) if (mem.symbol) m.set(mem.symbol, s.name)
    return m
  }, [sectorData])

  // symbol -> why it's "mine": held (paper/live) beats watched
  const tagOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const w of watchlist) m.set(w.symbol, w.list_name ? `Watchlist · ${w.list_name}` : 'Watchlist')
    for (const p of paper) if (p.status === 'open') m.set(p.symbol, 'Paper position')
    for (const p of live) if (p.net_qty && p.symbol) m.set(p.symbol, 'Live position')
    return m
  }, [watchlist, paper, live])

  type Row = NonNullable<typeof data>['results'][number]
  const [focus, setFocus] = useState<string | null>(null)

  // every upcoming meeting, then the slice in view
  const upcoming = useMemo(() => (data?.results ?? []).filter((r) => daysUntil(r.date) >= 0), [data])
  const shown = useMemo(() => upcoming.filter((r) => !mine || tagOf.has(r.symbol)), [upcoming, mine, tagOf])

  // the strip: every weekday from today to the last meeting, with total / yours / held counts
  const strip = useMemo(() => {
    const last = upcoming.reduce((m, r) => (r.date > m ? r.date : m), '')
    const out: { date: string; all: number; mine: number; held: number }[] = []
    if (!last) return out
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    for (; ; d.setDate(d.getDate() + 1)) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      if (iso > last) break
      if (d.getDay() === 0 || d.getDay() === 6) continue
      const rows = upcoming.filter((r) => r.date === iso)
      out.push({
        date: iso,
        all: rows.length,
        mine: rows.filter((r) => tagOf.has(r.symbol)).length,
        held: rows.filter((r) => tagOf.get(r.symbol)?.endsWith('position')).length,
      })
    }
    return out
  }, [upcoming, tagOf])
  const peak = Math.max(1, ...strip.map((s) => s.all))

  const held = useMemo(
    () =>
      upcoming
        .filter((r) => tagOf.get(r.symbol)?.endsWith('position'))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [upcoming, tagOf],
  )

  const days = useMemo(() => {
    const out = new Map<string, Row[]>()
    for (const r of shown) {
      if (focus && r.date !== focus) continue
      if (!out.has(r.date)) out.set(r.date, [])
      out.get(r.date)!.push(r)
    }
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [shown, focus])

  const when = (iso: string) => {
    const d = daysUntil(iso)
    return d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d}d`
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Earnings</h1>
          <p className="text-xs text-muted-foreground">
            Results board meetings on NSE, about two weeks ahead. Holding through one is a gap your stop can't
            catch.
          </p>
        </div>
        <div className="flex rounded-md border p-0.5 text-xs">
          {(
            [
              [true, 'Only mine'],
              [false, 'All'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={String(v)}
              type="button"
              onClick={() => setMine(v)}
              className={cn(
                'rounded px-2.5 py-1',
                mine === v ? 'bg-foreground/15 text-foreground' : 'text-muted-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {isPending ? (
        <Spinner />
      ) : (
        <>
          {/* exposure first: the one thing that needs action */}
          <div
            className={cn(
              'rounded-lg border px-3 py-2 text-sm',
              held.length ? 'border-down/50 bg-down/10' : 'border-up/40 bg-up/5',
            )}
          >
            {held.length ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-down">
                  {held.length} open position{held.length > 1 ? 's' : ''} report{held.length > 1 ? '' : 's'}{' '}
                  results
                </span>
                {held.map((r) => (
                  <Link
                    key={r.symbol + r.date}
                    to="/chart"
                    search={{ symbol: r.symbol }}
                    className="rounded border border-down/40 px-1.5 py-0.5 text-xs hover:bg-down/15"
                  >
                    <b>{r.symbol}</b> {when(r.date)}
                  </Link>
                ))}
              </div>
            ) : (
              <span className="text-up">No open position reports results in this window.</span>
            )}
          </div>

          {/* two weeks at a glance: bar = meetings that day, coloured part = yours, red dot = a holding */}
          <div className="rounded-lg border p-3">
            <div className="flex h-36 items-end gap-1.5">
              {strip.map((s) => {
                const d = new Date(`${s.date}T00:00:00`)
                const active = focus === s.date
                return (
                  <button
                    key={s.date}
                    type="button"
                    onClick={() => setFocus(active ? null : s.date)}
                    title={`${dayLabel(s.date)}: ${s.all} meetings, ${s.mine} yours`}
                    className={cn(
                      'group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-md px-0.5 pt-1 transition-colors',
                      active ? 'bg-foreground/10' : 'hover:bg-foreground/5',
                      focus && !active && 'opacity-40',
                    )}
                  >
                    <span className="text-[10px] tabular-nums text-muted-foreground">{s.all || ''}</span>
                    <div
                      className="flex w-full max-w-10 flex-col justify-end overflow-hidden rounded-sm bg-foreground/15"
                      style={{ height: `${(s.all / peak) * 70}%`, minHeight: s.all ? 3 : 0 }}
                    >
                      <div
                        className="w-full bg-primary/70"
                        style={{ height: `${s.all ? (s.mine / s.all) * 100 : 0}%` }}
                      />
                    </div>
                    <span className={cn('size-1.5 rounded-full', s.held ? 'bg-down' : 'bg-transparent')} />
                    <span
                      className={cn(
                        'text-[10px] leading-tight',
                        daysUntil(s.date) === 0 ? 'font-semibold text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {d.toLocaleDateString('en-GB', { weekday: 'narrow' })}
                      <br />
                      {d.getDate()}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-sm bg-foreground/15" /> all meetings
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-sm bg-primary/70" /> watched or held
              </span>
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-down" /> an open position reports
              </span>
              <span>click a day to focus it</span>
            </div>
          </div>

          {!days.length ? (
            <p className="text-sm text-muted-foreground">
              {mine
                ? 'Nothing you track or hold has results in this window.'
                : 'No results meetings scheduled.'}
            </p>
          ) : (
            days.map(([date, rows]) => (
              <section key={date}>
                <h2 className={cn('mb-2 text-xs font-semibold', daysUntil(date) <= 2 && 'text-down')}>
                  {dayLabel(date)} <span className="font-normal text-muted-foreground">· {rows.length}</span>
                </h2>
                {/* tiles: RS sets the edge colour, the bar under the name is distance from the 52w high */}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-2">
                  {rows
                    .sort((a, b) => (bySymbol.get(b.symbol)?.rs ?? 0) - (bySymbol.get(a.symbol)?.rs ?? 0))
                    .map((r) => {
                      const st = bySymbol.get(r.symbol)
                      const tag = tagOf.get(r.symbol)
                      const isHeld = tag?.endsWith('position')
                      const fromHigh = st?.from_high_pct
                      return (
                        <Link
                          key={r.symbol + r.purpose}
                          to="/chart"
                          search={{ symbol: r.symbol }}
                          title={[tag, r.detail ?? r.purpose].filter(Boolean).join('\n')}
                          className={cn(
                            'flex flex-col gap-1 rounded-md border border-l-4 p-2 text-xs transition-colors hover:bg-foreground/5',
                            st == null
                              ? 'border-l-border'
                              : st.rs >= 80
                                ? 'border-l-up'
                                : st.rs >= 50
                                  ? 'border-l-foreground/30'
                                  : 'border-l-down',
                            isHeld && 'ring-1 ring-down',
                          )}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate font-semibold text-sm">{r.symbol}</span>
                            <RsPill rs={st?.rs} />
                          </div>
                          <span className="truncate text-[10px] text-muted-foreground">
                            {sectorOf.get(r.symbol) ?? '—'}
                          </span>
                          <div className="flex items-center justify-between text-[10px] tabular-nums">
                            <span className={cn(st && (st.r1m >= 0 ? 'text-up' : 'text-down'))}>
                              1M {st ? `${st.r1m >= 0 ? '+' : ''}${st.r1m.toFixed(1)}%` : '—'}
                            </span>
                            <span className="text-muted-foreground">
                              {fromHigh != null ? `${fromHigh.toFixed(0)}% from high` : ''}
                            </span>
                          </div>
                          {fromHigh != null && (
                            <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
                              <div
                                className={cn(
                                  'h-full',
                                  fromHigh > -10 ? 'bg-up' : fromHigh > -25 ? 'bg-amber-500' : 'bg-down',
                                )}
                                style={{
                                  width: `${Math.max(4, 100 + Math.max(-60, fromHigh) * (100 / 60))}%`,
                                }}
                              />
                            </div>
                          )}
                          {tag && (
                            <span
                              className={cn('truncate text-[10px]', isHeld ? 'text-down' : 'text-primary')}
                            >
                              {tag}
                            </span>
                          )}
                        </Link>
                      )
                    })}
                </div>
              </section>
            ))
          )}
        </>
      )}
    </div>
  )
}
