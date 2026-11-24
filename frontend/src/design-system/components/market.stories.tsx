import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from './badge'
import {
  Change,
  Delivery,
  IndexCard,
  Meter,
  Quote,
  RangeBar,
  ResultsBadge,
  RsPill,
  Sparkline,
  SurveillanceBadge,
  TickerStrip,
  TickPrice,
  WatchlistRow,
} from './market'
import { Panel, PanelHeader, PanelTitle } from './panel'
import { Row } from '../story-helpers'

const meta: Meta = { title: 'Trading/Market', parameters: { controls: { disable: true } } }
export default meta
type Story = StoryObj

function walk(seed: number, n: number, drift: number) {
  let s = seed
  let v = 100
  return Array.from({ length: n }, () => {
    s = (s * 16807) % 2147483647
    v *= 1 + (s / 2147483647 - 0.5 + drift) * 0.04
    return v
  })
}

export const Pills: Story = {
  name: 'Change · RS · delivery · badges',
  render: () => (
    <div className="max-w-2xl">
      <Row label="Change">
        <Change value={3.4} />
        <Change value={-2.14} />
        <Change value={0} />
        <Change value={null} />
        <Change value={1250} unit="₹" digits={0} />
        <Change value={-0.8} unit="R" />
      </Row>
      <Row label="Change pill">
        <Change value={3.4} variant="pill" />
        <Change value={-4.95} variant="pill" />
        <Change value={0} variant="pill" />
      </Row>
      <Row label="Quote">
        <Quote ltp={986.25} change={32.45} pct={3.4} />
        <Quote ltp={64.8} change={-3.37} pct={-4.95} size="lg" />
      </Row>
      <Row label="RS">
        <RsPill rs={95} />
        <RsPill rs={61} />
        <RsPill rs={23} />
        <RsPill rs={null} />
      </Row>
      <Row label="Delivery">
        <Delivery pct={62} avg={44} />
        <Delivery pct={41} avg={43} />
        <Delivery pct={18} avg={39} />
        <Delivery pct={62} avg={44} bar />
        <Delivery pct={18} avg={39} bar />
      </Row>
      <Row label="Results">
        <ResultsBadge days={0} />
        <ResultsBadge days={2} />
        <ResultsBadge days={5} />
        <ResultsBadge days={11} />
        <span className="text-2xs text-muted-foreground">(nothing past 14 days)</span>
      </Row>
      <Row label="Surveillance">
        <SurveillanceBadge label="ASM Stage I" details="Long-term ASM, stage I" />
        <SurveillanceBadge label="ST-ASM Stage II" />
      </Row>
    </div>
  ),
}

export const Charts: Story = {
  name: 'Sparkline · range',
  render: () => (
    <div className="max-w-2xl">
      <Row label="Sparkline">
        <Sparkline points={walk(3, 30, 0.12)} />
        <Sparkline points={walk(5, 30, -0.12)} />
        <Sparkline points={walk(9, 30, 0.05)} tone="accent" />
        <Sparkline points={walk(7, 30, 0.1)} area className="h-8 w-32" />
        <Sparkline points={walk(4, 60, 0)} baseline={100} area className="h-8 w-40" />
      </Row>
      <Row label="52W range">
        <RangeBar low={612.4} high={1065.6} value={986.25} className="w-full" />
      </Row>
      <Row label="At high">
        <RangeBar low={2410} high={5602} value={5590} className="w-full" />
      </Row>
    </div>
  ),
}

const INDICES = [
  { label: 'NIFTY 50', value: 24318.45, pct: 0.84 },
  { label: 'BANKNIFTY', value: 52104.1, pct: 0.41 },
  { label: 'MIDCAP 100', value: 56880.75, pct: -0.62 },
  { label: 'SMALLCAP 100', value: 18240.3, pct: -1.12 },
  { label: 'INDIA VIX', value: 13.42, pct: -3.1 },
  { label: 'USDINR', value: 84.12, pct: 0.05 },
  { label: 'GOLD', value: 76480, pct: 0.32 },
]

export const Indices: Story = {
  name: 'Index cards · ticker',
  render: () => (
    <div className="flex max-w-5xl flex-col gap-2">
      <div className="grid grid-cols-2 gap-1 md:grid-cols-4">
        {INDICES.slice(0, 4).map((i, k) => (
          <IndexCard
            key={i.label}
            name={i.label}
            value={i.value}
            pct={i.pct}
            points={walk(k + 2, 40, i.pct > 0 ? 0.08 : -0.08)}
          />
        ))}
      </div>
      <div className="rounded-md border border-border bg-panel-head py-1">
        <TickerStrip items={INDICES} />
      </div>
      <div className="rounded-md border border-border bg-panel-head py-1">
        <TickerStrip items={INDICES} scroll />
      </div>
    </div>
  ),
}

const WL = [
  { symbol: 'RELIANCE', sub: 'Oil & Gas', ltp: 2914.6, pct: 1.82 },
  { symbol: 'TATAMOTORS', sub: 'Auto', ltp: 986.25, pct: 3.4, held: true },
  { symbol: 'KAYNES', sub: 'Electronics', ltp: 5480.75, pct: 4.02 },
  { symbol: 'HDFCBANK', sub: 'Banks', ltp: 1702.9, pct: 0.05, results: 4 },
  { symbol: 'ZOMATO', sub: 'Consumer Tech', ltp: 262.15, pct: -2.14 },
  { symbol: 'SUZLON', sub: 'Capital Goods', ltp: 64.8, pct: -4.95, asm: true },
]

/** Prices tick every 0.8s so the flash is visible. */
function LiveWatchlist() {
  const [rows, setRows] = useState(WL)
  const [sel, setSel] = useState('TATAMOTORS')
  useEffect(() => {
    const id = setInterval(() => {
      setRows((r) =>
        r.map((x) => {
          if (Math.random() < 0.6) return x
          const d = (Math.random() - 0.5) * 0.004
          const ltp = Math.round(x.ltp * (1 + d) * 20) / 20
          return { ...x, ltp, pct: x.pct + d * 100 }
        }),
      )
    }, 800)
    return () => clearInterval(id)
  }, [])
  return (
    <Panel className="w-72">
      <PanelHeader>
        <PanelTitle>Watchlist</PanelTitle>
        <span className="flex-1" />
        <span className="text-2xs text-muted-foreground">live</span>
        <span className="size-1.5 animate-pulse rounded-full bg-up" />
      </PanelHeader>
      {rows.map((r) => (
        <WatchlistRow
          key={r.symbol}
          symbol={r.symbol}
          sub={r.sub}
          ltp={r.ltp}
          pct={r.pct}
          selected={r.symbol === sel}
          onClick={() => setSel(r.symbol)}
          trailing={
            r.held ? (
              <Badge variant="accent">held</Badge>
            ) : r.asm ? (
              <Badge variant="destructive">ASM</Badge>
            ) : r.results ? (
              <ResultsBadge days={r.results} />
            ) : null
          }
        />
      ))}
    </Panel>
  )
}

export const Watchlist: Story = { name: 'Watchlist (live ticks)', render: () => <LiveWatchlist /> }

function Ticking() {
  const [v, setV] = useState(986.25)
  useEffect(() => {
    const id = setInterval(
      () => setV((x) => Math.round(x * (1 + (Math.random() - 0.5) * 0.003) * 20) / 20),
      900,
    )
    return () => clearInterval(id)
  }, [])
  return <TickPrice value={v} className="text-xl" />
}

export const Tick: Story = { name: 'Tick price', render: () => <Ticking /> }

export const Meters: Story = {
  name: 'Meters (book risk)',
  render: () => (
    <Panel className="max-w-sm">
      <PanelHeader>
        <PanelTitle>Book risk</PanelTitle>
      </PanelHeader>
      <div className="flex flex-col gap-3 p-2">
        <Meter label="Open risk" value={9820} max={15000} limit={12000} />
        <Meter label="Open risk (near cap)" value={13900} max={15000} limit={12000} />
        <Meter label="Gross exposure" value={112} max={100} limit={80} format={(v) => `${v}%`} />
        <Meter label="Correlated heat" value={2.9} max={6} limit={4} format={(v) => `${v}R`} />
      </div>
    </Panel>
  ),
}
