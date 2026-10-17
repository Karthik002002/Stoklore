// /leaders - "strongest stocks in the strongest sectors", from the NSE bhavcopy history
// (app/routers/strength.py). Three tabs:
//
//   Scan        stocks passing your filters (RS, trend template, near the 52-week high, a VCP read,
//               optionally only in leading/improving sectors) -> straight into the scan slideshow;
//   Rotation    a Relative Rotation Graph of the ET sectors against NIFTY 50, weekly or daily;
//   RS ranking  every rated stock, sortable.
//
// Everything is an objective reading - a percentile, a checklist, a measured contraction. Nothing
// here says buy; the chart is still where the decision is made.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { ArrowUpRightIcon, PlayIcon } from 'lucide-react'
import { ChartButton, startScan } from '@/components/ChartModal'
import RsPill from '@/components/RsPill'
import SectorHoverCard, { hoverProps } from '@/components/SectorHoverCard'
import SortTh from '@/components/SortTh'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fmt } from '@/lib/format'
import { sortRows } from '@/lib/sortRows'
import type { Sort } from '@/lib/sortRows'
import { usePageTitle } from '@/lib/usePageTitle'
import { useStrength } from '@/lib/useStrength'
import { cn } from '@/lib/utils'
import type { RrgSector, StrengthStock } from '@/services/api'
import { getRrg, getSectors } from '@/services/api'

const TEMPLATE_LABELS: Record<string, string> = {
  above_150_200: 'Price above the 150- and 200-day averages',
  '150_above_200': '150-day average above the 200-day',
  '200_rising': '200-day average rising for a month',
  '50_above_150_200': '50-day average above the 150- and 200-day',
  above_50: 'Price above the 50-day average',
  '30pct_above_low': 'At least 30% above the 52-week low',
  within_25pct_of_high: 'Within 25% of the 52-week high',
  rs_70_plus: 'RS rating 70 or more',
}
const QUADRANTS = {
  leading: { label: 'Leading', color: '#22c55e' },
  weakening: { label: 'Weakening', color: '#eab308' },
  lagging: { label: 'Lagging', color: '#ef4444' },
  improving: { label: 'Improving', color: '#3b82f6' },
} as const

const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${fmt(v, d)}%`)
const tone = (v: number | null | undefined) => (v == null || v === 0 ? '' : v > 0 ? 'text-up' : 'text-down')

function TemplateScore({ s }: { s: StrengthStock }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn('cursor-help tabular-nums', s.template_score === 8 ? 'font-semibold text-up' : '')}
          />
        }
      >
        {s.template_score}/8
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-xs">
        <ul className="space-y-0.5">
          {Object.entries(s.template).map(([k, v]) => (
            <li key={k}>
              {v == null ? '·' : v ? '✓' : '✗'} {TEMPLATE_LABELS[k] ?? k}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}

/** The stock table both the Scan and RS tabs use. */
/** Rows rendered per batch; the next batch loads as the table is scrolled near its end. */
const BATCH = 50

function StockTable({ rows, sectorOf }: { rows: StrengthStock[]; sectorOf: Map<string, string> }) {
  const [sort, setSort] = useState<Sort>(null)
  // infinite scroll: a sentinel row under the last one; when it scrolls into view, 50 more render.
  // Back to the first batch whenever the rows or the order change (a new search or sort).
  const [shown, setShown] = useState(BATCH)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  // keyed on what the rows ARE, not the array: the filtered lists are rebuilt on every render
  const rowsKey = `${rows.length}:${rows[0]?.symbol}:${rows.at(-1)?.symbol}`
  useEffect(() => {
    setShown(BATCH)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [rowsKey, sort])
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => entries[0]?.isIntersecting && setShown((n) => n + BATCH),
      { root: scrollRef.current, rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  })
  const sorted = sortRows(rows, sort, {
    symbol: (s) => s.symbol,
    rs: (s) => s.rs,
    r3m: (s) => s.r3m,
    vs: (s) => s.vs_nifty_6m,
    high: (s) => s.from_high_pct,
    tt: (s) => s.template_score,
    pivot: (s) => s.to_pivot_pct,
    vol: (s) => s.vol_ratio,
    value: (s) => s.avg_value_cr,
  })
  return (
    <div ref={scrollRef} className="max-h-[70vh] overflow-auto rounded-xl border bg-card">
      <table className="w-full min-w-[60rem] font-mono text-xs">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b text-[10px] tracking-widest text-muted-foreground uppercase">
            <th className="w-6" />
            <SortTh label="Symbol" k="symbol" sort={sort} onSort={setSort} align="left" first="asc" />
            <th className="px-2 py-1 text-left font-medium">Sector</th>
            <SortTh label="RS" k="rs" sort={sort} onSort={setSort} />
            <SortTh label="3M" k="r3m" sort={sort} onSort={setSort} />
            <SortTh label="6M vs Nifty" k="vs" sort={sort} onSort={setSort} />
            <SortTh label="From 52wH" k="high" sort={sort} onSort={setSort} />
            <SortTh label="Template" k="tt" sort={sort} onSort={setSort} />
            <th className="px-2 py-1 text-right font-medium">Contractions</th>
            <SortTh label="Vol 10/50" k="vol" sort={sort} onSort={setSort} />
            <SortTh label="To pivot" k="pivot" sort={sort} onSort={setSort} />
            <SortTh label="₹Cr/day" k="value" sort={sort} onSort={setSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={12} className="py-8 text-center text-muted-foreground">
                Nothing passes these filters.
              </td>
            </tr>
          )}
          {sorted.slice(0, shown).map((s) => (
            <tr key={s.symbol} className="border-b border-border/40 hover:bg-muted/40">
              <td className="py-1 pl-1">
                <ChartButton symbol={s.symbol} />
              </td>
              <td className="px-2 py-1 font-semibold">
                {s.symbol}
                {s.vcp && (
                  <span className="ml-1.5 rounded border border-primary/50 px-1 text-[9px] text-primary">
                    VCP
                  </span>
                )}
              </td>
              <td className="max-w-40 truncate px-2 py-1 text-muted-foreground">
                {sectorOf.get(s.symbol) ?? '—'}
              </td>
              <td className="px-2 py-1 text-right">
                <RsPill rs={s.rs} />
              </td>
              <td className={cn('px-2 py-1 text-right tabular-nums', tone(s.r3m))}>{pct(s.r3m)}</td>
              <td className={cn('px-2 py-1 text-right tabular-nums', tone(s.vs_nifty_6m))}>
                {pct(s.vs_nifty_6m)}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">{pct(s.from_high_pct)}</td>
              <td className="px-2 py-1 text-right">
                <TemplateScore s={s} />
              </td>
              <td className="px-2 py-1 text-right text-muted-foreground tabular-nums">
                {s.contractions.length ? s.contractions.map((c) => fmt(c, 0)).join(' → ') + '%' : '—'}
              </td>
              <td className={cn('px-2 py-1 text-right tabular-nums', s.volume_dry && 'text-up')}>
                {s.vol_ratio == null ? '—' : `${fmt(s.vol_ratio, 2)}×`}
              </td>
              <td className={cn('px-2 py-1 text-right tabular-nums', s.near_pivot && 'text-up')}>
                {pct(s.to_pivot_pct)}
              </td>
              <td className="px-2 py-1 text-right text-muted-foreground tabular-nums">
                {fmt(s.avg_value_cr, 1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown < sorted.length && (
        <div
          ref={sentinelRef}
          className="flex items-center justify-center gap-2 p-3 text-xs text-muted-foreground"
        >
          <Spinner className="size-3.5" /> {shown} of {sorted.length}
        </div>
      )}
    </div>
  )
}

/** The Relative Rotation Graph: RS-Ratio across, RS-Momentum up, 100/100 in the middle. Calm by
 *  default - one dot per sector, no tails, no labels - and the sectors you hover or pin get their
 *  recent path and their name. The scale is set by the middle 90% of points (the 5th to 95th
 *  percentile of distance from 100), so one runaway sector doesn't squash the rest into a smear;
 *  anything past it is drawn on the edge with a ring. */
function RrgChart({
  sectors,
  focus,
  pinned,
  hover,
  onPin,
}: {
  sectors: RrgSector[]
  focus: string | null
  pinned: Set<string>
  /** Mouse handlers for a sector (or one period of it): highlight it and show its hover card. */
  hover: Hover
  onPin: (id: string) => void
}) {
  const W = 720
  const H = 520
  const pad = 30
  const span = (vals: number[], floor: number) => {
    const d = vals.map((v) => Math.abs(v - 100)).sort((a, b) => a - b)
    return Math.max(floor, d[Math.floor(d.length * 0.95)] ?? floor) * 1.15
  }
  const lasts = sectors.map((s) => s.tail[s.tail.length - 1])
  const spanX = span(
    lasts.map((p) => p.ratio),
    0.5,
  )
  const spanY = span(
    lasts.map((p) => p.momentum),
    0.3,
  )
  const clampX = (r: number) => Math.min(100 + spanX, Math.max(100 - spanX, r))
  const clampY = (m: number) => Math.min(100 + spanY, Math.max(100 - spanY, m))
  const x = (r: number) => pad + ((clampX(r) - 100 + spanX) / (2 * spanX)) * (W - 2 * pad)
  const y = (m: number) => H - pad - ((clampY(m) - 100 + spanY) / (2 * spanY)) * (H - 2 * pad)
  const cx = x(100)
  const cy = y(100)
  const active = (id: string) => focus === id || pinned.has(id)
  const anyActive = focus != null || pinned.size > 0
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <rect x={cx} y={pad} width={W - pad - cx} height={cy - pad} fill="#22c55e" opacity={0.07} />
      <rect x={cx} y={cy} width={W - pad - cx} height={H - pad - cy} fill="#eab308" opacity={0.07} />
      <rect x={pad} y={cy} width={cx - pad} height={H - pad - cy} fill="#ef4444" opacity={0.07} />
      <rect x={pad} y={pad} width={cx - pad} height={cy - pad} fill="#3b82f6" opacity={0.07} />
      <line x1={cx} y1={pad} x2={cx} y2={H - pad} stroke="currentColor" opacity={0.25} />
      <line x1={pad} y1={cy} x2={W - pad} y2={cy} stroke="currentColor" opacity={0.25} />
      {(
        [
          ['Leading', W - pad - 8, pad + 16, 'end', '#22c55e'],
          ['Weakening', W - pad - 8, H - pad - 8, 'end', '#eab308'],
          ['Lagging', pad + 8, H - pad - 8, 'start', '#ef4444'],
          ['Improving', pad + 8, pad + 16, 'start', '#3b82f6'],
        ] as const
      ).map(([t, tx, ty, anchor, color]) => (
        <text
          key={t}
          x={tx}
          y={ty}
          textAnchor={anchor}
          fontSize={12}
          fontWeight={600}
          fill={color}
          opacity={0.75}
        >
          {t}
        </text>
      ))}
      <text x={W - pad} y={H - 8} textAnchor="end" fontSize={10} fill="currentColor" opacity={0.45}>
        RS-Ratio →
      </text>
      <text x={pad} y={pad - 10} fontSize={10} fill="currentColor" opacity={0.45}>
        ↑ RS-Momentum
      </text>
      {/* inactive dots first, so the highlighted ones draw on top */}
      {[...sectors]
        .sort((a, b) => Number(active(a.id)) - Number(active(b.id)))
        .map((s) => {
          const color = QUADRANTS[s.quadrant].color
          const last = s.tail[s.tail.length - 1]
          const on = active(s.id)
          const clipped = clampX(last.ratio) !== last.ratio || clampY(last.momentum) !== last.momentum
          const lx = x(last.ratio)
          const ly = y(last.momentum)
          return (
            <g
              key={s.id}
              opacity={anyActive && !on ? 0.25 : 1}
              {...hover(s)}
              onClick={() => onPin(s.id)}
              className="cursor-pointer"
            >
              {on && (
                <>
                  <polyline
                    points={s.tail.map((p) => `${x(p.ratio)},${y(p.momentum)}`).join(' ')}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.75}
                    strokeLinejoin="round"
                  />
                  {s.tail.slice(0, -1).map((p, i) => (
                    <circle
                      key={i}
                      cx={x(p.ratio)}
                      cy={y(p.momentum)}
                      r={2}
                      fill={color}
                      opacity={0.35 + (0.5 * i) / s.tail.length}
                    />
                  ))}
                </>
              )}
              {/* a bigger invisible target so small dots are easy to hover */}
              <circle cx={lx} cy={ly} r={9} fill="transparent" />
              <circle
                cx={lx}
                cy={ly}
                r={on ? 6 : 4}
                fill={color}
                stroke={clipped ? 'currentColor' : 'var(--background)'}
                strokeWidth={clipped ? 1.5 : 1}
              />
              {on && (
                <text
                  x={lx + (lx > W - 160 ? -9 : 9)}
                  y={ly - 8}
                  textAnchor={lx > W - 160 ? 'end' : 'start'}
                  fontSize={11}
                  fontWeight={600}
                  fill="currentColor"
                  paintOrder="stroke"
                  stroke="var(--background)"
                  strokeWidth={3}
                >
                  {s.name}
                </text>
              )}
            </g>
          )
        })}
    </svg>
  )
}

/** The same rotation as a timeline: a row per sector, a cell per period coloured by the quadrant it
 *  was in, newest on the right - "improving, improving, leading, leading" reads as a story where the
 *  graph is a tangle. Sorted by where each sector is now: leading first. */
function RrgTimeline({
  sectors,
  focus,
  pinned,
  hover,
  onPin,
}: {
  sectors: RrgSector[]
  focus: string | null
  pinned: Set<string>
  hover: Hover
  onPin: (id: string) => void
}) {
  const order = { leading: 0, improving: 1, weakening: 2, lagging: 3 }
  const rows = [...sectors].sort(
    (a, b) =>
      order[a.quadrant] - order[b.quadrant] ||
      b.tail[b.tail.length - 1].ratio - a.tail[a.tail.length - 1].ratio,
  )
  const dates = rows[0]?.tail.map((p) => p.date) ?? []
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="text-[10px] text-muted-foreground">
            <th className="px-2 py-1 text-left font-medium">Sector</th>
            {dates.map((d) => (
              <th key={d} className="px-0.5 py-1 font-normal tabular-nums">
                {d.slice(5)}
              </th>
            ))}
            <th className="px-2 py-1 text-right font-medium">Ratio / Mom.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const last = s.tail[s.tail.length - 1]
            return (
              <tr
                key={s.id}
                onClick={() => onPin(s.id)}
                className={cn(
                  'cursor-pointer hover:bg-muted/40',
                  (focus === s.id || pinned.has(s.id)) && 'bg-muted/50',
                )}
              >
                <td className="max-w-56 px-2 py-0.5">
                  <span className="flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate" {...hover(s)}>
                      {s.name}
                    </span>
                    <SectorStocksLink id={s.id} name={s.name} />
                  </span>
                </td>
                {s.tail.map((p) => {
                  const q = strengthQuadrant(p.ratio, p.momentum)
                  return (
                    <td key={p.date} className="px-0.5 py-0.5" {...hover(s, p.date)}>
                      <div
                        className="h-4 min-w-6 rounded-sm"
                        style={{
                          background: QUADRANTS[q].color,
                          opacity: 0.25 + Math.min(0.65, Math.abs(p.ratio - 100) / 4),
                        }}
                      />
                    </td>
                  )
                })}
                <td className="px-2 py-0.5 text-right text-muted-foreground tabular-nums">
                  {fmt(last.ratio, 1)} / {fmt(last.momentum, 1)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Opens the home page with this sector expanded in the Sector Performance panel - its stocks. */
function SectorStocksLink({ id, name }: { id: string; name: string }) {
  return (
    <Link
      to="/"
      search={{ tab: 'home', sector: id }}
      onClick={(e) => e.stopPropagation()}
      title={`Open ${name} on the home page - its stocks`}
      aria-label={`${name} stocks`}
      className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      Stocks
      <ArrowUpRightIcon className="size-3" />
    </Link>
  )
}

type Hover = (
  s: RrgSector,
  at?: string,
) => {
  onMouseEnter: (e: React.MouseEvent) => void
  onMouseMove: (e: React.MouseEvent) => void
  onMouseLeave: () => void
}

const strengthQuadrant = (ratio: number, momentum: number): RrgSector['quadrant'] =>
  ratio >= 100 ? (momentum >= 100 ? 'leading' : 'weakening') : momentum >= 100 ? 'improving' : 'lagging'

export default function LeadersPage() {
  usePageTitle('Leaders')
  // tab, timeframe and rotation view come from the URL (router.tsx leadersRoute); defaults are left out
  const url = useSearch({ from: '/leaders' })
  const navigate = useNavigate({ from: '/leaders' })
  const tab = url.tab ?? 'scan'
  const setTab = (t: 'scan' | 'rotation' | 'rs') =>
    navigate({ search: (p) => ({ ...p, tab: t === 'scan' ? undefined : t }), replace: true })
  const { status, table, bySymbol } = useStrength()
  const { data: sectorData } = useQuery({ queryKey: ['sectors', 'NSE'], queryFn: () => getSectors('NSE') })
  const tf = url.tf ?? 'weekly'
  const setTf = (v: 'weekly' | 'daily') =>
    navigate({ search: (p) => ({ ...p, tf: v === 'weekly' ? undefined : v }), replace: true })
  const [focus, setFocus] = useState<string | null>(null)
  const [pinned, setPinned] = useState<Set<string>>(new Set())
  const rrgView = url.view ?? 'graph'
  const setRrgView = (v: 'graph' | 'timeline') =>
    navigate({ search: (p) => ({ ...p, view: v === 'graph' ? undefined : v }), replace: true })
  const [rrgAll, setRrgAll] = useState(false)
  const hover: Hover = (sec, at) => {
    const et = sectorData?.sectors.find((x) => x.id === sec.id)
    const leaders = (et?.members ?? [])
      .map((m) => (m.symbol ? bySymbol.get(m.symbol) : undefined))
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => b.rs - a.rs)
      .slice(0, 3)
      .map((x) => ({ symbol: x.symbol, rs: x.rs, r3m: x.r3m }))
    const hp = hoverProps({ kind: 'rotation', s: sec, at, et, leaders })
    return {
      onMouseEnter: (e) => {
        setFocus(sec.id)
        hp.onMouseEnter(e)
      },
      onMouseMove: hp.onMouseMove,
      onMouseLeave: () => {
        setFocus(null)
        hp.onMouseLeave()
      },
    }
  }
  const pin = (id: string) =>
    setPinned((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const ready = !!status?.partial_ready
  const rrg = useQuery({
    queryKey: ['rrg', tf, status?.last],
    queryFn: () => getRrg(tf),
    enabled: ready,
    staleTime: 3_600_000,
  })

  // filters
  const [minRs, setMinRs] = useState(70)
  const [minTemplate, setMinTemplate] = useState(7)
  const [maxFromHigh, setMaxFromHigh] = useState(15)
  const [vcpOnly, setVcpOnly] = useState(false)
  const [strongSectors, setStrongSectors] = useState(true)
  const [minValue, setMinValue] = useState(1)
  const [search, setSearch] = useState('')

  const sectorOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of sectorData?.sectors ?? [])
      for (const mem of s.members) if (mem.symbol) m.set(mem.symbol, s.name)
    return m
  }, [sectorData])
  const strong = useMemo(
    () =>
      new Set(
        (rrg.data?.sectors ?? [])
          .filter((s) => s.quadrant === 'leading' || s.quadrant === 'improving')
          .map((s) => s.name),
      ),
    [rrg.data],
  )
  const stocks = table.data?.stocks ?? []
  const scan = stocks.filter(
    (s) =>
      s.rs >= minRs &&
      s.template_score >= minTemplate &&
      -s.from_high_pct <= maxFromHigh &&
      s.avg_value_cr >= minValue &&
      (!vcpOnly || s.vcp) &&
      (!strongSectors || !strong.size || strong.has(sectorOf.get(s.symbol) ?? '')),
  )
  const needle = search.trim().toUpperCase()
  const ranked = needle ? stocks.filter((s) => s.symbol.includes(needle)) : stocks

  const num = (v: number, set: (n: number) => void, label: string, step = 1) => (
    <label className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type="number"
        step={step}
        value={v}
        onChange={(e) => set(Number(e.target.value) || 0)}
        className="h-7 w-16"
      />
    </label>
  )

  return (
    <div className="space-y-4 p-1">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Leaders</h1>
          <p className="text-sm text-muted-foreground">
            The strongest stocks in the strongest sectors - relative strength, trend template and base
            tightness across the NSE main board, from NSE's daily bhavcopy.
            {table.data?.as_of && ` Data to ${table.data.as_of}.`}
          </p>
        </div>
        <div className="flex gap-0.5 rounded-lg bg-muted/50 p-0.5">
          {(['scan', 'rotation', 'rs'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium',
                tab === t ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t === 'scan' ? 'Scan' : t === 'rotation' ? 'Sector rotation' : 'RS ranking'}
            </button>
          ))}
        </div>
      </div>

      {status && !status.ready && (
        // the first backfill: progress on top, and whatever is rated so far underneath
        <div className="space-y-2 rounded-xl border border-dashed p-3">
          <div className="flex items-center gap-3 text-sm">
            <Spinner className="size-4" />
            <span className="font-medium">Collecting a year of NSE price history…</span>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {status.days} of {status.days + status.missing} days
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${(status.days / Math.max(1, status.days + status.missing)) * 100}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            One bhavcopy file per trading day, newest first, fetched slowly in the background (first run only
            - then one file each evening).{' '}
            {status.partial_ready
              ? `Results below are rated on the ${table.data?.days ?? status.days} days collected so far: the 12-month return, the 200-day average and part of the trend template fill in as the year completes.`
              : 'Results appear after the first 20 days.'}
          </p>
        </div>
      )}

      {ready && table.isPending && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" /> Rating the market…
        </p>
      )}

      {ready && tab === 'scan' && table.data && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card p-3">
            {num(minRs, setMinRs, 'RS ≥')}
            {num(minTemplate, setMinTemplate, 'Template ≥')}
            {num(maxFromHigh, setMaxFromHigh, 'Within % of 52wH')}
            {num(minValue, setMinValue, '₹Cr/day ≥', 0.5)}
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={vcpOnly}
                onChange={(e) => setVcpOnly(e.target.checked)}
                className="accent-primary"
              />
              VCP only
            </label>
            <label
              className="flex items-center gap-1.5 text-xs"
              title="Only sectors in the Leading or Improving quadrant of the weekly rotation"
            >
              <input
                type="checkbox"
                checked={strongSectors}
                onChange={(e) => setStrongSectors(e.target.checked)}
                className="accent-primary"
              />
              Leading / improving sectors only{strong.size ? ` (${strong.size})` : ''}
            </label>
            <Button
              size="sm"
              className="ml-auto gap-1.5"
              disabled={!scan.length}
              onClick={() =>
                startScan(
                  `Leaders · RS ${minRs}+ · TT ${minTemplate}+${vcpOnly ? ' · VCP' : ''}`,
                  'leaders',
                  [...scan].sort((a, b) => b.rs - a.rs).map((s) => s.symbol),
                )
              }
            >
              <PlayIcon className="size-3.5" /> Scan {scan.length}
            </Button>
          </div>
          <StockTable rows={scan} sectorOf={sectorOf} />
          <p className="text-xs text-muted-foreground">
            {table.data.skipped.length} stocks with a split or bonus gap in the last year are left out -
            unadjusted prices would make their returns and 52-week high wrong.
          </p>
        </>
      )}

      {ready && tab === 'rotation' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                [tf, setTf, ['weekly', 'daily']],
                [rrgView, setRrgView, ['graph', 'timeline']],
              ] as const
            ).map(([value, set, opts], k) => (
              <div key={k} className="flex gap-0.5 rounded-lg bg-muted/50 p-0.5">
                {opts.map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => (set as (v: string) => void)(o)}
                    className={cn(
                      'rounded-md px-3 py-1 text-xs font-medium capitalize',
                      value === o ? 'bg-background shadow-sm' : 'text-muted-foreground',
                    )}
                  >
                    {o}
                  </button>
                ))}
              </div>
            ))}
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={rrgAll}
                onChange={(e) => setRrgAll(e.target.checked)}
                className="accent-primary"
              />
              All sectors (default: the 20 largest)
            </label>
            {pinned.size > 0 && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline"
                onClick={() => setPinned(new Set())}
              >
                Clear {pinned.size} pinned
              </button>
            )}
            <p className="ml-auto text-xs text-muted-foreground">
              Hover a sector for its path, click to pin it. Sectors are ET's, rebuilt from their members
              (cap-weighted) against NIFTY 50.
            </p>
          </div>
          {rrg.isPending ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" /> Building sector history…
            </p>
          ) : (
            (() => {
              const shown = [...(rrg.data?.sectors ?? [])]
                .sort((a, b) => (b.mcap_cr ?? 0) - (a.mcap_cr ?? 0))
                .slice(0, rrgAll ? undefined : 20)
              return (
                // one height for both columns: the chart fills it, the list scrolls inside it
                <div className="grid h-[calc(100vh-16rem)] min-h-[420px] gap-4 lg:grid-cols-[1fr_18rem]">
                  <div className="min-h-0 rounded-xl border bg-card p-2">
                    {rrgView === 'graph' ? (
                      <RrgChart sectors={shown} focus={focus} pinned={pinned} hover={hover} onPin={pin} />
                    ) : (
                      <RrgTimeline sectors={shown} focus={focus} pinned={pinned} hover={hover} onPin={pin} />
                    )}
                  </div>
                  <div className="min-h-0 space-y-3 overflow-y-auto rounded-xl border bg-card p-2">
                    {(['leading', 'improving', 'weakening', 'lagging'] as const).map((q) => {
                      const list = shown.filter((s) => s.quadrant === q)
                      return (
                        <div key={q}>
                          <p
                            className="mb-1 px-1.5 text-xs font-semibold"
                            style={{ color: QUADRANTS[q].color }}
                          >
                            {QUADRANTS[q].label} · {list.length}
                          </p>
                          {list.map((s) => {
                            const last = s.tail[s.tail.length - 1]
                            return (
                              <div key={s.id} className="flex items-center">
                                <button
                                  type="button"
                                  {...hover(s)}
                                  onClick={() => pin(s.id)}
                                  className={cn(
                                    'flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left text-xs hover:bg-muted',
                                    (focus === s.id || pinned.has(s.id)) && 'bg-muted',
                                  )}
                                >
                                  {pinned.has(s.id) && (
                                    <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                                  )}
                                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                                  <span className="shrink-0 text-muted-foreground tabular-nums">
                                    {fmt(last.ratio, 1)} / {fmt(last.momentum, 1)}
                                  </span>
                                </button>
                                <SectorStocksLink id={s.id} name={s.name} />
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()
          )}
        </div>
      )}

      <SectorHoverCard />
      {ready && tab === 'rs' && table.data && (
        <>
          <Input
            placeholder="Find a symbol"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-56"
          />
          <StockTable rows={ranked} sectorOf={sectorOf} />
        </>
      )}
    </div>
  )
}
