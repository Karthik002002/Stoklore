// Sector performance on the home page, from ET Markets (GET /api/sectors - see
// scraper.get_sector_performance). Three readings of the same 67 sectors, coarse to fine:
//
//  1. the map: every sector as a tile sized by market cap and coloured by its day, so where the
//     money moved reads at a glance;
//  2. the table: one row per sector, sortable, each with a five-way breadth bar (how many members
//     fell hard / fell / held / rose / rose hard), the members as a cap-weighted heat strip, and
//     its best and worst member;
//  3. the row opened: every member as a tile, sized and coloured the same way.
import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRightIcon, RefreshCwIcon } from 'lucide-react'
import TerminalPanel from '@/components/TerminalPanel'
import SortTh from '@/components/SortTh'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { fmt } from '@/lib/format'
import { breadth, bucketShares, croreShort, heatColor, sectorSummary } from '@/lib/sectors'
import { sortRows } from '@/lib/sortRows'
import type { Sort } from '@/lib/sortRows'
import { cn } from '@/lib/utils'
import type { Sector, SectorMember } from '@/services/api'
import { getSectors } from '@/services/api'

const pctText = (v: number | null | undefined, digits = 2) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${fmt(v, digits)}%`
const pctClass = (v: number | null | undefined) =>
  v == null || v === 0 ? 'text-muted-foreground' : v > 0 ? 'text-up' : 'text-down'

// The five move buckets, worst to best - colours step from deep red to deep green, the same
// reading as ET's own bar.
const BUCKETS = [
  { label: 'down more than 2%', color: 'rgb(220, 38, 38)' },
  { label: 'down up to 2%', color: 'rgba(239, 68, 68, 0.55)' },
  { label: 'unchanged', color: 'rgba(148, 163, 184, 0.5)' },
  { label: 'up to 2%', color: 'rgba(34, 197, 94, 0.55)' },
  { label: 'up more than 2%', color: 'rgb(22, 163, 74)' },
]

/** How many members fell hard, fell, held, rose, rose hard - as one stacked bar. */
function BreadthBar({ buckets }: { buckets: number[] }) {
  const shares = bucketShares(buckets)
  return (
    <div
      className="flex h-2.5 w-full overflow-hidden rounded-sm bg-muted"
      title={BUCKETS.map((b, i) => `${buckets[i]} ${b.label}`).join('\n')}
    >
      {shares.map((w, i) =>
        w > 0 ? <div key={i} style={{ width: `${w}%`, background: BUCKETS[i].color }} /> : null,
      )}
    </div>
  )
}

/** The sector's day as a bar out from a centre line, scaled to the biggest move on the board. */
function ChangeBar({ pct, max }: { pct: number | null; max: number }) {
  const w = pct == null || !max ? 0 : Math.min(Math.abs(pct) / max, 1) * 50
  return (
    <div className="relative h-2 w-full rounded-sm bg-muted/50">
      <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
      {w > 0 && (
        <div
          className={cn(
            'absolute inset-y-0',
            (pct ?? 0) >= 0 ? 'left-1/2 rounded-r-sm bg-up/70' : 'right-1/2 rounded-l-sm bg-down/70',
          )}
          style={{ width: `${w}%` }}
        />
      )}
    </div>
  )
}

const memberTitle = (m: SectorMember) =>
  `${m.name}  ${pctText(m.change_pct)}\n₹${fmt(m.price)} · ${croreShort(m.mcap_cr)}${m.volume_k != null ? ` · vol ${fmt(m.volume_k, 0)}k` : ''}`

/** The members as one strip, each as wide as its share of the sector's market cap - so a sector
 *  carried by one giant reads differently from one that rose across the board. The long tail of
 *  tiny members is folded into the end of the strip. */
function MemberStrip({ members }: { members: SectorMember[] }) {
  const shown = members.slice(0, 40)
  return (
    <div className="flex h-3 w-full gap-px overflow-hidden rounded-sm bg-muted/40">
      {shown.map((m) => (
        <div
          key={m.id ?? m.name}
          title={memberTitle(m)}
          style={{ flexGrow: Math.max(m.mcap_cr ?? 0, 1), flexBasis: 0, background: heatColor(m.change_pct) }}
        />
      ))}
    </div>
  )
}

/** Every member of an opened sector as a tile, sized by market cap (square-rooted, so the giants
 *  don't crush the rest out of view) and coloured by its move. */
function MemberTiles({ members }: { members: SectorMember[] }) {
  const up = members.filter((m) => (m.change_pct ?? 0) > 0).length
  const down = members.filter((m) => (m.change_pct ?? 0) < 0).length
  const ranked = [...members]
    .filter((m) => m.change_pct != null)
    .sort((a, b) => b.change_pct! - a.change_pct!)
  return (
    <div className="space-y-2 px-2 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground uppercase">
        <span>
          {members.length} members · <span className="text-up">{up} up</span> ·{' '}
          <span className="text-down">{down} down</span>
        </span>
        {ranked[0] && (
          <span>
            best <span className="text-foreground normal-case">{ranked[0].name}</span>{' '}
            <span className="text-up">{pctText(ranked[0].change_pct)}</span>
          </span>
        )}
        {ranked.length > 1 && (
          <span>
            worst <span className="text-foreground normal-case">{ranked.at(-1)!.name}</span>{' '}
            <span className={pctClass(ranked.at(-1)!.change_pct)}>{pctText(ranked.at(-1)!.change_pct)}</span>
          </span>
        )}
        <span className="ml-auto normal-case">tile size = market cap · colour = today's move</span>
      </div>
      <div className="flex flex-wrap gap-0.5">
        {members.map((m) => (
          <div
            key={m.id ?? m.name}
            title={memberTitle(m)}
            className="min-w-[4.5rem] overflow-hidden rounded-sm px-1.5 py-1"
            style={{
              flexGrow: Math.sqrt(Math.max(m.mcap_cr ?? 0, 1)),
              flexBasis: `${Math.min(18, 4.5 + Math.sqrt(Math.max(m.mcap_cr ?? 0, 0)) / 40)}rem`,
              background: heatColor(m.change_pct),
            }}
          >
            <p className="truncate text-[11px] font-semibold text-foreground">{m.name}</p>
            <p className="flex justify-between gap-1 text-[10px] text-foreground/80 tabular-nums">
              <span>{pctText(m.change_pct)}</span>
              <span className="truncate">₹{fmt(m.price)}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SectorPerformancePanel() {
  const [exchange, setExchange] = useState<'NSE' | 'BSE'>('NSE')
  const [sort, setSort] = useState<Sort>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const { data, isPending, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['sectors', exchange],
    queryFn: () => getSectors(exchange),
    refetchInterval: 300_000,
  })

  const sectors = data?.sectors ?? []
  const summary = sectorSummary(sectors)
  const maxMove = Math.max(0, ...sectors.map((s) => Math.abs(s.change_pct ?? 0)))
  const needle = filter.trim().toLowerCase()
  const shown = sortRows(
    needle
      ? sectors.filter(
          (s) =>
            s.name.toLowerCase().includes(needle) ||
            s.members.some((m) => m.name.toLowerCase().includes(needle)),
        )
      : sectors,
    sort,
    {
      name: (s) => s.name,
      mcap: (s) => s.mcap_cr,
      chgcr: (s) => s.mcap_change_cr,
      chg: (s) => s.change_pct,
      breadth: (s) => breadth(s),
      members: (s) => s.members.length,
    },
  )
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <TerminalPanel
      title="Sector Performance"
      accent="text-cyan-500"
      actions={
        <>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter sector / company"
            className="h-6 w-44 rounded border bg-background px-1.5 font-mono text-[10px] outline-none focus:border-ring"
          />
          <select
            value={exchange}
            onChange={(e) => setExchange(e.target.value as 'NSE' | 'BSE')}
            className="h-6 rounded border bg-background px-1 font-mono text-[10px] uppercase"
            aria-label="Exchange"
          >
            <option value="NSE">NSE</option>
            <option value="BSE">BSE</option>
          </select>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6"
            aria-label="Refresh sectors"
            onClick={() => refetch()}
          >
            <RefreshCwIcon className={cn('size-3', isFetching && 'animate-spin')} />
          </Button>
        </>
      }
    >
      {isPending ? (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
          <Spinner className="size-3.5" /> Loading sectors…
        </div>
      ) : isError ? (
        <p className="py-8 text-center font-mono text-xs text-muted-foreground">{(error as Error).message}</p>
      ) : (
        <>
          {/* the day in one line */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b bg-muted/20 px-2 py-1.5 font-mono text-[11px]">
            <span>
              <span className="text-up">{summary.up} ▲</span>{' '}
              <span className="text-down">{summary.down} ▼</span>
              {summary.flat > 0 && <span className="text-muted-foreground"> {summary.flat} ─</span>}
              <span className="text-muted-foreground"> sectors</span>
            </span>
            <span>
              <span className="text-muted-foreground">mcap </span>
              {croreShort(summary.mcap)}{' '}
              <span className={pctClass(summary.changePct)}>
                {pctText(summary.changePct)} ({summary.change >= 0 ? '+' : ''}
                {croreShort(summary.change)})
              </span>
            </span>
            {summary.best && (
              <span>
                <span className="text-muted-foreground">best </span>
                {summary.best.name} <span className="text-up">{pctText(summary.best.change_pct)}</span>
              </span>
            )}
            {summary.worst && (
              <span>
                <span className="text-muted-foreground">worst </span>
                {summary.worst.name}{' '}
                <span className={pctClass(summary.worst.change_pct)}>
                  {pctText(summary.worst.change_pct)}
                </span>
              </span>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground">
              ET Markets · {sectors[0]?.updated ?? '—'}
            </span>
          </div>

          {/* the map: every sector, sized by market cap, coloured by its day; click opens its row */}
          <div className="flex flex-wrap gap-0.5 border-b p-1.5">
            {[...sectors]
              .sort((a, b) => (b.mcap_cr ?? 0) - (a.mcap_cr ?? 0))
              .map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle(s.id)}
                  title={`${s.name}  ${pctText(s.change_pct)}\n${croreShort(s.mcap_cr)} · ${s.advance ?? 0} up / ${s.decline ?? 0} down`}
                  className={cn(
                    'min-w-[4rem] overflow-hidden rounded-sm px-1.5 py-1 text-left ring-foreground/60 hover:ring-1',
                    open.has(s.id) && 'ring-1',
                  )}
                  style={{
                    flexGrow: Math.sqrt(Math.max(s.mcap_cr ?? 0, 1)),
                    flexBasis: `${Math.min(14, 4 + Math.sqrt(Math.max(s.mcap_cr ?? 0, 0)) / 120)}rem`,
                    background: heatColor(s.change_pct),
                  }}
                >
                  <p className="truncate font-mono text-[10px] font-semibold text-foreground">{s.name}</p>
                  <p className="font-mono text-[10px] text-foreground/80 tabular-nums">
                    {pctText(s.change_pct)}
                  </p>
                </button>
              ))}
          </div>

          <div className="max-h-[640px] overflow-auto">
            <table className="w-full min-w-[56rem] font-mono text-xs">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b text-[10px] tracking-widest text-muted-foreground uppercase">
                  <th className="w-6" />
                  <SortTh label="Sector" k="name" sort={sort} onSort={setSort} align="left" first="asc" />
                  <SortTh label="Mcap" k="mcap" sort={sort} onSort={setSort} />
                  <SortTh label="Δ Mcap" k="chgcr" sort={sort} onSort={setSort} />
                  <SortTh label="Chg%" k="chg" sort={sort} onSort={setSort} />
                  <th className="w-24 px-2 py-1" />
                  <SortTh label="Breadth" k="breadth" sort={sort} onSort={setSort} align="left" />
                  <th className="px-2 py-1 text-left font-medium">Members by mcap</th>
                  <th className="px-2 py-1 text-left font-medium">Best / worst</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-muted-foreground">
                      No sector or company matches “{filter}”.
                    </td>
                  </tr>
                )}
                {shown.map((s) => (
                  <SectorRow
                    key={s.id}
                    s={s}
                    maxMove={maxMove}
                    open={open.has(s.id)}
                    onToggle={() => toggle(s.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </TerminalPanel>
  )
}

function SectorRow({
  s,
  maxMove,
  open,
  onToggle,
}: {
  s: Sector
  maxMove: number
  open: boolean
  onToggle: () => void
}) {
  const ranked = s.members.filter((m) => m.change_pct != null).sort((a, b) => b.change_pct! - a.change_pct!)
  const best = ranked[0]
  const worst = ranked.length > 1 ? ranked.at(-1) : undefined
  return (
    <Fragment>
      <tr
        className={cn('cursor-pointer border-b border-border/40 hover:bg-muted/40', open && 'bg-muted/30')}
        onClick={onToggle}
      >
        <td className="pl-1 text-muted-foreground">
          <ChevronRightIcon className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        </td>
        <td className="px-2 py-1.5">
          <span className="font-semibold">{s.name}</span>
          <span className="ml-1.5 text-[10px] text-muted-foreground">{s.members.length}</span>
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">{croreShort(s.mcap_cr)}</td>
        <td className={cn('px-2 py-1.5 text-right tabular-nums', pctClass(s.mcap_change_cr))}>
          {s.mcap_change_cr == null
            ? '—'
            : `${s.mcap_change_cr >= 0 ? '+' : ''}${croreShort(s.mcap_change_cr)}`}
        </td>
        <td className={cn('px-2 py-1.5 text-right font-semibold tabular-nums', pctClass(s.change_pct))}>
          {pctText(s.change_pct)}
        </td>
        <td className="px-2 py-1.5">
          <ChangeBar pct={s.change_pct} max={maxMove} />
        </td>
        <td className="w-44 px-2 py-1.5">
          <BreadthBar buckets={s.buckets} />
          <p className="mt-0.5 text-[10px] tabular-nums">
            <span className="text-up">{s.advance ?? 0}▲</span>{' '}
            <span className="text-down">{s.decline ?? 0}▼</span>
            {(s.unchanged ?? 0) > 0 && <span className="text-muted-foreground"> {s.unchanged}─</span>}
          </p>
        </td>
        <td className="w-56 px-2 py-1.5">
          <MemberStrip members={s.members} />
        </td>
        <td className="max-w-56 px-2 py-1.5 text-[10px]">
          {best && (
            <p className="truncate">
              <span className="text-up">▲ {pctText(best.change_pct)}</span> {best.name}
            </p>
          )}
          {worst && (
            <p className="truncate">
              <span className={pctClass(worst.change_pct)}>▼ {pctText(worst.change_pct)}</span> {worst.name}
            </p>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border/40 bg-muted/10">
          <td colSpan={9}>
            <MemberTiles members={s.members} />
          </td>
        </tr>
      )}
    </Fragment>
  )
}
