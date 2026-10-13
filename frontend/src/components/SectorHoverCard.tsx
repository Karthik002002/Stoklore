// The sector panel's hover card: one floating card for the whole panel, fed by a tiny store, so a
// mouse move re-renders the card and nothing else - the panel has thousands of member tiles, and a
// tooltip component per tile (or state in the panel) would re-render all of them on every pixel.
//
// Anything hoverable spreads `hoverProps(tip)`; <SectorHoverCard /> is rendered once and follows the
// pointer, flipping to the other side near a window edge.
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { compact, fmt } from '@/lib/format'
import { bucketShares, croreShort, heatColor } from '@/lib/sectors'
import { cn } from '@/lib/utils'
import type { Sector, SectorMember } from '@/services/api'

export type Tip =
  | { kind: 'member'; m: SectorMember; sector?: Sector }
  | { kind: 'sector'; s: Sector }
  | { kind: 'breadth'; s: Sector }

const useTip = create<{ tip: Tip | null; x: number; y: number }>(() => ({ tip: null, x: 0, y: 0 }))

/** Close the card - for a click that opens something over it (the chart modal), since the element
 *  under the pointer never gets its mouseleave then. */
export const hideTip = () => useTip.setState({ tip: null })

/** Spread on anything that should show a card on hover. */
export const hoverProps = (tip: Tip) => ({
  onMouseEnter: (e: React.MouseEvent) => useTip.setState({ tip, x: e.clientX, y: e.clientY }),
  onMouseMove: (e: React.MouseEvent) => useTip.setState({ x: e.clientX, y: e.clientY }),
  onMouseLeave: () => useTip.setState({ tip: null }),
})

// The five move buckets, worst to best - shared with the breadth bar.
export const BUCKETS = [
  { label: 'Down more than 2%', color: 'rgb(220, 38, 38)' },
  { label: 'Down up to 2%', color: 'rgba(239, 68, 68, 0.55)' },
  { label: 'Unchanged', color: 'rgba(148, 163, 184, 0.5)' },
  { label: 'Up to 2%', color: 'rgba(34, 197, 94, 0.55)' },
  { label: 'Up more than 2%', color: 'rgb(22, 163, 74)' },
]

const pct = (v: number | null | undefined, digits = 2) =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${fmt(v, digits)}%`
const tone = (v: number | null | undefined) =>
  v == null || v === 0 ? 'text-muted-foreground' : v > 0 ? 'text-up' : 'text-down'

/** A big % change in a coloured pill - the headline of every card. */
function Move({ v }: { v: number | null | undefined }) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-sm font-semibold tabular-nums',
        v == null || v === 0
          ? 'bg-muted text-muted-foreground'
          : v > 0
            ? 'bg-up/15 text-up'
            : 'bg-down/15 text-down',
      )}
    >
      {v == null ? '—' : `${v > 0 ? '▲' : v < 0 ? '▼' : ''} ${pct(v)}`}
    </span>
  )
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="truncate font-medium tabular-nums">{value}</p>
      {sub && <p className="truncate text-[10px] text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  )
}

function Breadth({ s }: { s: Sector }) {
  const shares = bucketShares(s.buckets)
  return (
    <div className="space-y-1.5">
      <div className="flex h-2 overflow-hidden rounded-sm bg-muted">
        {shares.map((w, i) =>
          w > 0 ? <div key={i} style={{ width: `${w}%`, background: BUCKETS[i].color }} /> : null,
        )}
      </div>
      {BUCKETS.map((b, i) => (
        <div key={b.label} className="flex items-center gap-2 text-[11px]">
          <span className="size-2 shrink-0 rounded-sm" style={{ background: b.color }} />
          <span className="flex-1 text-muted-foreground">{b.label}</span>
          <span className="font-medium tabular-nums">{s.buckets[i]}</span>
          <span className="w-10 text-right text-muted-foreground tabular-nums">{fmt(shares[i], 0)}%</span>
        </div>
      ))}
    </div>
  )
}

function MemberCard({ m, sector }: { m: SectorMember; sector?: Sector }) {
  const members = sector?.members ?? []
  const share = sector?.mcap_cr && m.mcap_cr ? (m.mcap_cr / sector.mcap_cr) * 100 : null
  const bySize = members.indexOf(m) + 1
  const byMove =
    [...members]
      .filter((x) => x.change_pct != null)
      .sort((a, b) => b.change_pct! - a.change_pct!)
      .indexOf(m) + 1
  const vsSector =
    m.change_pct != null && sector?.change_pct != null ? m.change_pct - sector.change_pct : null
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{m.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{sector?.name ?? 'Sector member'}</p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px]',
            m.symbol ? 'border-primary/40 text-primary' : 'border-dashed text-muted-foreground',
          )}
        >
          {m.symbol ?? 'no symbol'}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-semibold tabular-nums">₹{fmt(m.price)}</span>
        <Move v={m.change_pct} />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-2">
        <Stat
          label="Market cap"
          value={croreShort(m.mcap_cr)}
          sub={share == null ? undefined : `${fmt(share, 1)}% of the sector`}
        />
        <Stat
          label="Volume"
          value={m.volume_k == null ? '—' : compact(m.volume_k * 1000)}
          sub="shares today"
        />
        {members.length > 0 && (
          <Stat label="Size rank" value={`#${bySize} of ${members.length}`} sub="by market cap" />
        )}
        {byMove > 0 && (
          <Stat
            label="Move rank"
            value={`#${byMove} of ${members.length}`}
            sub={
              vsSector == null ? undefined : <span className={tone(vsSector)}>{pct(vsSector)} vs sector</span>
            }
          />
        )}
      </div>
      <p className={cn('border-t pt-1.5 text-[11px]', m.symbol ? 'text-primary' : 'text-muted-foreground')}>
        {m.symbol ? 'Click to open the chart' : 'No NSE/BSE symbol matched - chart unavailable'}
      </p>
    </>
  )
}

function SectorCard({ s }: { s: Sector }) {
  const ranked = s.members.filter((m) => m.change_pct != null).sort((a, b) => b.change_pct! - a.change_pct!)
  const top = ranked.slice(0, 3)
  const bottom = ranked
    .slice(-3)
    .reverse()
    .filter((m) => !top.includes(m))
  const row = (m: SectorMember) => (
    <div key={m.id ?? m.name} className="flex items-center gap-2 text-[11px]">
      <span className="size-2 shrink-0 rounded-sm" style={{ background: heatColor(m.change_pct) }} />
      <span className="flex-1 truncate">{m.name}</span>
      <span className={cn('tabular-nums', tone(m.change_pct))}>{pct(m.change_pct)}</span>
    </div>
  )
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{s.name}</p>
          <p className="text-[11px] text-muted-foreground">{s.members.length} members</p>
        </div>
        <Move v={s.change_pct} />
      </div>
      <div className="grid grid-cols-2 gap-x-3 border-t pt-2">
        <Stat label="Market cap" value={croreShort(s.mcap_cr)} />
        <Stat
          label="Change today"
          value={
            <span className={tone(s.mcap_change_cr)}>
              {s.mcap_change_cr == null
                ? '—'
                : `${s.mcap_change_cr >= 0 ? '+' : ''}${croreShort(s.mcap_change_cr)}`}
            </span>
          }
        />
      </div>
      <div className="border-t pt-2">
        <Breadth s={s} />
      </div>
      {top.length > 0 && (
        <div className="grid grid-cols-2 gap-3 border-t pt-2">
          <div className="min-w-0 space-y-1">
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Leaders</p>
            {top.map(row)}
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-[10px] tracking-wide text-muted-foreground uppercase">Laggards</p>
            {bottom.map(row)}
          </div>
        </div>
      )}
      <p className="border-t pt-1.5 text-[11px] text-muted-foreground">Click to open its members</p>
    </>
  )
}

function BreadthCard({ s }: { s: Sector }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{s.name} · breadth</p>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            <span className="text-up">{s.advance ?? 0} up</span> ·{' '}
            <span className="text-down">{s.decline ?? 0} down</span>
            {(s.unchanged ?? 0) > 0 && ` · ${s.unchanged} flat`}
          </p>
        </div>
        <Move v={s.change_pct} />
      </div>
      <div className="border-t pt-2">
        <Breadth s={s} />
      </div>
    </>
  )
}

const OFFSET = 14
const WIDTH = 288 // w-72

/** Render once; it shows whatever `hoverProps` last pointed it at. */
export default function SectorHoverCard() {
  const { tip, x, y } = useTip()
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    if (ref.current) setHeight(ref.current.offsetHeight)
  }, [tip])
  if (!tip) return null
  const left = x + OFFSET + WIDTH > window.innerWidth ? x - OFFSET - WIDTH : x + OFFSET
  const top = y + OFFSET + height > window.innerHeight ? Math.max(8, y - OFFSET - height) : y + OFFSET
  // Portalled to <body>: the home grid places panels with CSS transforms, and `position: fixed`
  // inside a transformed ancestor is fixed to that ancestor, not the window.
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-[60] w-72 space-y-2 rounded-lg border bg-popover/95 p-3 text-xs text-popover-foreground shadow-xl backdrop-blur-sm"
      style={{ left, top }}
    >
      {tip.kind === 'member' && <MemberCard m={tip.m} sector={tip.sector} />}
      {tip.kind === 'sector' && <SectorCard s={tip.s} />}
      {tip.kind === 'breadth' && <BreadthCard s={tip.s} />}
    </div>,
    document.body,
  )
}
