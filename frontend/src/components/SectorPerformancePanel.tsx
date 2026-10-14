// Sector performance on the home page, from ET Markets (GET /api/sectors - see
// scraper.get_sector_performance). Three readings of the same 67 sectors, coarse to fine:
//
//  1. the map: every sector as a tile sized by market cap and coloured by its day, so where the
//     money moved reads at a glance;
//  2. the table: one row per sector, sortable, each with a five-way breadth bar (how many members
//     fell hard / fell / held / rose / rose hard), the members as a cap-weighted heat strip, and
//     its best and worst member;
//  3. the row opened: every member as a tile, sized and coloured the same way.
import { Fragment, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRightIcon, RefreshCwIcon } from 'lucide-react'
import { openChart } from '@/components/ChartModal'
import SectorHoverCard, { BUCKETS, hideTip, hoverProps } from '@/components/SectorHoverCard'
import TerminalPanel from '@/components/TerminalPanel'
import SortTh from '@/components/SortTh'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { fmt } from '@/lib/format'
import { dockLayout } from '@/lib/dock'
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

/** How many members fell hard, fell, held, rose, rose hard - as one stacked bar. */
function BreadthBar({ s }: { s: Sector }) {
  const shares = bucketShares(s.buckets)
  return (
    <div
      className="flex h-2.5 w-full overflow-hidden rounded-sm bg-muted"
      {...hoverProps({ kind: 'breadth', s })}
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

/** Opens a member's chart, when its name matched a symbol. Stops the click there, so a member
 *  inside a sector row doesn't also fold the row. */
const chartOf = (m: SectorMember) => (e: React.MouseEvent) => {
  e.stopPropagation()
  if (!m.symbol) return
  hideTip()
  openChart(m.symbol)
}

// How tiles can be ordered: every field either way. The tile's SIZE stays market cap whatever the
// order - only where it sits changes.
type TileSort = { key: string; dir: 'asc' | 'desc' }
const MEMBER_SORTS: [string, string][] = [
  ['mcap:desc', 'Market cap · largest first'],
  ['mcap:asc', 'Market cap · smallest first'],
  ['change:desc', 'Change · top gainers first'],
  ['change:asc', 'Change · top losers first'],
  ['volume:desc', 'Volume · highest first'],
  ['volume:asc', 'Volume · lowest first'],
  ['price:desc', 'Price · highest first'],
  ['price:asc', 'Price · lowest first'],
  ['name:asc', 'Name · A → Z'],
  ['name:desc', 'Name · Z → A'],
]
const SECTOR_SORTS: [string, string][] = [
  ['mcap:desc', 'Market cap · largest first'],
  ['mcap:asc', 'Market cap · smallest first'],
  ['change:desc', 'Change · top gainers first'],
  ['change:asc', 'Change · top losers first'],
  ['breadth:desc', 'Breadth · most advancing first'],
  ['breadth:asc', 'Breadth · most declining first'],
  ['members:desc', 'Members · most first'],
  ['members:asc', 'Members · fewest first'],
  ['name:asc', 'Name · A → Z'],
  ['name:desc', 'Name · Z → A'],
]
const MEMBER_FIELDS = {
  mcap: (m: SectorMember) => m.mcap_cr,
  change: (m: SectorMember) => m.change_pct,
  volume: (m: SectorMember) => m.volume_k,
  price: (m: SectorMember) => m.price,
  name: (m: SectorMember) => m.name,
}
const SECTOR_FIELDS = {
  mcap: (s: Sector) => s.mcap_cr,
  change: (s: Sector) => s.change_pct,
  breadth: (s: Sector) => breadth(s),
  members: (s: Sector) => s.members.length,
  name: (s: Sector) => s.name,
}
const parseSort = (v: string): TileSort => {
  const [key, dir] = v.split(':')
  return { key, dir: dir === 'asc' ? 'asc' : 'desc' }
}

/** A tile order, kept in this browser so the panel opens the way it was left. */
function useTileSort(storageKey: string): [TileSort, (v: string) => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(storageKey) ?? 'mcap:desc'
    } catch {
      return 'mcap:desc'
    }
  })
  const set = (v: string) => {
    setValue(v)
    try {
      localStorage.setItem(storageKey, v)
    } catch {
      // private window: kept for this visit
    }
  }
  return [parseSort(value), set]
}

function SortSelect({
  value,
  options,
  onChange,
  label,
}: {
  value: TileSort
  options: [string, string][]
  onChange: (v: string) => void
  label: string
}) {
  return (
    <label className="flex items-center gap-1 normal-case" onClick={(e) => e.stopPropagation()}>
      <span className="text-muted-foreground">Sort</span>
      <select
        value={`${value.key}:${value.dir}`}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-6 rounded border bg-background px-1 font-mono text-[10px] text-foreground"
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  )
}

/** A member's name - a link to its chart when it has a symbol, plain text when it doesn't. */
function MemberName({ m, sector }: { m: SectorMember; sector: Sector }) {
  const hover = hoverProps({ kind: 'member', m, sector })
  if (!m.symbol) return <span {...hover}>{m.name}</span>
  return (
    <button type="button" onClick={chartOf(m)} className="hover:underline" {...hover}>
      {m.name}
    </button>
  )
}

/** The members as one strip, each as wide as its share of the sector's market cap - so a sector
 *  carried by one giant reads differently from one that rose across the board. The long tail of
 *  tiny members is folded into the end of the strip. */
// Dock magnification: segments near the pointer swell with a Gaussian falloff, so the slivers at
// the tail of a strip become wide enough to see and hover. Pure: `dockLayout` in lib/dock.ts.
const DOCK_HEIGHT = 10 // px added to the height at the pointer

function MemberStrip({ sector }: { sector: Sector }) {
  const shown = sector.members.slice(0, 40)
  const ref = useRef<HTMLDivElement>(null)
  const [pointer, setPointer] = useState<{ x: number; width: number } | null>(null)

  const weights = shown.map((m) => Math.max(m.mcap_cr ?? 0, 1))
  const { widths, swell, focus } = dockLayout(weights, pointer?.x ?? null, pointer?.width ?? 0)

  return (
    <div
      ref={ref}
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect()
        if (r) setPointer({ x: e.clientX - r.left, width: r.width })
      }}
      onMouseLeave={() => setPointer(null)}
      // no `gap`: it would take px the dock layout doesn't know about and shift every segment off
      // the computed position; each segment draws its own 1px separator inside itself instead
      className={cn('relative flex h-3 w-full items-center rounded-sm', pointer && 'z-20')}
    >
      {shown.map((m, i) => (
        <div
          key={m.id ?? m.name}
          {...hoverProps({ kind: 'member', m, sector })}
          onClick={chartOf(m)}
          className={cn(
            'min-w-0 rounded-[2px] shadow-[inset_-1px_0_0_var(--background)] transition-[flex-grow,height] duration-75 ease-out',
            m.symbol && 'cursor-pointer',
            i === focus && 'ring-1 ring-foreground/60',
          )}
          style={{
            flexGrow: widths[i],
            flexBasis: 0,
            height: 12 + swell[i] * DOCK_HEIGHT,
            background: heatColor(m.change_pct),
          }}
        />
      ))}
    </div>
  )
}

/** Every member of an opened sector as a tile, sized by market cap (square-rooted, so the giants
 *  don't crush the rest out of view) and coloured by its move. */
function MemberTiles({
  sector,
  sort,
  onSort,
}: {
  sector: Sector
  sort: TileSort
  onSort: (v: string) => void
}) {
  const members = sortRows(sector.members, sort, MEMBER_FIELDS)
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
        <span className="ml-auto flex items-center gap-3 normal-case">
          <span className="hidden xl:inline">
            size = market cap · colour = today's move · click for chart
          </span>
          <SortSelect value={sort} options={MEMBER_SORTS} onChange={onSort} label="Sort members" />
        </span>
      </div>
      <div className="flex flex-wrap gap-0.5">
        {members.map((m) => (
          <button
            type="button"
            key={m.id ?? m.name}
            {...hoverProps({ kind: 'member', m, sector })}
            // not `disabled`: a disabled button fires no mouse events, so it would get no card
            aria-disabled={!m.symbol}
            onClick={chartOf(m)}
            className={cn(
              'min-w-[4.5rem] overflow-hidden rounded-sm px-1.5 py-1 text-left ring-foreground/70',
              m.symbol ? 'hover:ring-1' : 'cursor-default',
            )}
            style={{
              flexGrow: Math.sqrt(Math.max(m.mcap_cr ?? 0, 1)),
              flexBasis: `${Math.min(18, 4.5 + Math.sqrt(Math.max(m.mcap_cr ?? 0, 0)) / 40)}rem`,
              background: heatColor(m.change_pct),
            }}
          >
            <p className="truncate text-[11px] font-semibold text-foreground">{m.name}</p>
            <p className="flex justify-between gap-1 text-[10px] text-foreground/80 tabular-nums">
              <span>{pctText(m.change_pct)}</span>
              <span className="truncate">{m.symbol ?? `₹${fmt(m.price)}`}</span>
            </p>
          </button>
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
  // one order for every opened sector's members, one for the sector map - both remembered
  const [memberSort, setMemberSort] = useTileSort('sectors.memberSort')
  const [mapSort, setMapSort] = useTileSort('sectors.mapSort')
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
          <div className="flex items-center justify-between gap-2 px-2 pt-1.5 font-mono text-[10px] text-muted-foreground uppercase">
            <span>Sector map · size = market cap</span>
            <SortSelect
              value={mapSort}
              options={SECTOR_SORTS}
              onChange={setMapSort}
              label="Sort the sector map"
            />
          </div>
          <div className="flex flex-wrap gap-0.5 border-b p-1.5">
            {sortRows(sectors, mapSort, SECTOR_FIELDS).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => toggle(s.id)}
                {...hoverProps({ kind: 'sector', s })}
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

          <div className="max-h-[600px] overflow-auto">
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
                    memberSort={memberSort}
                    onMemberSort={setMemberSort}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <SectorHoverCard />
    </TerminalPanel>
  )
}

function SectorRow({
  s,
  maxMove,
  open,
  onToggle,
  memberSort,
  onMemberSort,
}: {
  s: Sector
  maxMove: number
  open: boolean
  onToggle: () => void
  memberSort: TileSort
  onMemberSort: (v: string) => void
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
          <span className="font-semibold" {...hoverProps({ kind: 'sector', s })}>
            {s.name}
          </span>
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
          <BreadthBar s={s} />
          <p className="mt-0.5 text-[10px] tabular-nums">
            <span className="text-up">{s.advance ?? 0}▲</span>{' '}
            <span className="text-down">{s.decline ?? 0}▼</span>
            {(s.unchanged ?? 0) > 0 && <span className="text-muted-foreground"> {s.unchanged}─</span>}
          </p>
        </td>
        <td className="w-56 px-2 py-1.5">
          <MemberStrip sector={s} />
        </td>
        <td className="max-w-56 px-2 py-1.5 text-[10px]">
          {best && (
            <p className="truncate">
              <span className="text-up">▲ {pctText(best.change_pct)}</span> <MemberName m={best} sector={s} />
            </p>
          )}
          {worst && (
            <p className="truncate">
              <span className={pctClass(worst.change_pct)}>▼ {pctText(worst.change_pct)}</span>{' '}
              <MemberName m={worst} sector={s} />
            </p>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border/40 bg-muted/10">
          <td colSpan={9}>
            <MemberTiles sector={s} sort={memberSort} onSort={onMemberSort} />
          </td>
        </tr>
      )}
    </Fragment>
  )
}
