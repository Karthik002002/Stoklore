import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconAlertTriangle, IconDownload, IconFilter, IconX } from '@tabler/icons-react'
import {
  Badge,
  Button,
  Change,
  Delivery,
  HeatLegend,
  IndexCard,
  Pagination,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  PnlCalendar,
  RsPill,
  Sparkline,
  Stat,
  StatStrip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSortHead,
  Tabs,
  TabsList,
  TabsTab,
  Treemap,
} from '../index'
import { sortRows } from '@/lib/sortRows'
import type { Sort } from '@/lib/sortRows'
import { AppShell } from './AppShell'
import { EVENTS, INDICES, novemberPnl, SECTORS, STOCKS, walk } from './data'

const meta: Meta = { title: 'Pages/Home', parameters: { fullBleed: true, controls: { disable: true } } }
export default meta
type Story = StoryObj

function Home() {
  const [sort, setSort] = useState<Sort>({ key: 'rs', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [banner, setBanner] = useState(true)
  const rows = sortRows(STOCKS, sort, {
    symbol: (s) => s.symbol,
    ltp: (s) => s.ltp,
    pct: (s) => s.pct,
    rs: (s) => s.rs,
    deliv: (s) => s.deliv,
    vol: (s) => s.volX,
  })
  return (
    <AppShell page="Stocks" className="flex flex-col gap-1">
      {banner && (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-subtle px-2.5 py-1.5">
          <IconAlertTriangle className="size-3.5 text-warning" />
          <span className="flex-1">
            <b>3 trades from last week aren't reviewed.</b>{' '}
            <span className="text-muted-foreground">Reviews feed your win rate and setup stats.</span>
          </span>
          <Button variant="outline" size="xs">
            Review now
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={() => setBanner(false)}>
            <IconX />
          </Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-1 lg:grid-cols-4">
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
      <StatStrip bordered>
        <Stat label="Day P&L" value="+₹6,842" tone="up" delta="5 positions · 3 green" />
        <Stat label="Open risk" value="₹9,820" hint="65% of ₹15,000 cap" />
        <Stat label="Net P&L (FY)" value="₹1,84,250" tone="up" delta="▲ 12.4% vs last FY" deltaTone="up" />
        <Stat label="Win rate" value="58.3%" hint="84 of 144 closed" />
        <Stat label="Breadth" value="1,284 / 702" tone="up" hint="advancers / decliners" />
      </StatStrip>
      <div className="grid gap-1 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel>
          <PanelHeader>
            <PanelTitle>Stocks</PanelTitle>
            <Tabs defaultValue="all">
              <TabsList size="sm">
                <TabsTab value="all">All</TabsTab>
                <TabsTab value="watch">Watchlist</TabsTab>
                <TabsTab value="bo">Breakouts</TabsTab>
                <TabsTab value="res">Results soon</TabsTab>
              </TabsList>
            </Tabs>
            <span className="flex-1" />
            <Button variant="outline" size="xs">
              <IconFilter />
              Filters <Badge variant="secondary">2</Badge>
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="Export">
              <IconDownload />
            </Button>
          </PanelHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableSortHead
                  label="Symbol"
                  k="symbol"
                  sort={sort}
                  onSort={setSort}
                  align="left"
                  first="asc"
                />
                <TableHead>Sector</TableHead>
                <TableSortHead label="LTP" k="ltp" sort={sort} onSort={setSort} />
                <TableSortHead label="Chg %" k="pct" sort={sort} onSort={setSort} />
                <TableSortHead label="RS" k="rs" sort={sort} onSort={setSort} />
                <TableSortHead label="Deliv" k="deliv" sort={sort} onSort={setSort} />
                <TableSortHead label="Vol ×50D" k="vol" sort={sort} onSort={setSort} />
                <TableHead>20D</TableHead>
                <TableHead>Flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s, i) => (
                <TableRow key={s.symbol}>
                  <TableCell className="font-semibold">{s.symbol}</TableCell>
                  <TableCell className="text-muted-foreground">{s.sector}</TableCell>
                  <TableCell className="text-right">
                    {s.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right">
                    <Change value={s.pct} variant="pill" />
                  </TableCell>
                  <TableCell className="text-right">
                    <RsPill rs={s.rs} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Delivery pct={s.deliv} avg={s.delivAvg} bar />
                  </TableCell>
                  <TableCell className={`text-right ${s.volX >= 2 ? 'text-up' : 'text-muted-foreground'}`}>
                    {s.volX.toFixed(1)}×
                  </TableCell>
                  <TableCell>
                    <Sparkline points={walk(i + 7, 20, s.pct > 0 ? 0.1 : -0.1)} />
                  </TableCell>
                  <TableCell>
                    {s.flag ? (
                      <Badge variant={s.flag[1]}>{s.flag[0]}</Badge>
                    ) : s.asm ? (
                      <Badge variant="destructive">{s.asm}</Badge>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="border-t border-border bg-panel-head px-2 py-1">
            <Pagination page={page} pageSize={12} total={1842} onPageChange={setPage} />
          </div>
        </Panel>
        <div className="flex flex-col gap-1">
          <Panel>
            <PanelHeader>
              <PanelTitle>Sectors</PanelTitle>
              <span className="flex-1" />
              <HeatLegend low="−" high="+" />
            </PanelHeader>
            <Treemap items={SECTORS} height={200} />
          </Panel>
          <Panel>
            <PanelHeader>
              <PanelTitle>P&amp;L calendar</PanelTitle>
            </PanelHeader>
            <PanelBody>
              <PnlCalendar month="2026-11" values={novemberPnl()} />
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader>
              <PanelTitle>Events</PanelTitle>
              <span className="flex-1" />
              <Badge dot variant="success">
                Live
              </Badge>
            </PanelHeader>
            {EVENTS.slice(0, 4).map((e) => (
              <div key={e.text} className="flex gap-2 border-b border-border/60 px-2 py-1.5 last:border-0">
                <span className="tabular w-9 shrink-0 text-2xs text-muted-foreground">{e.time}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-2xs font-semibold">{e.symbol}</span>
                    <Badge variant={e.tone}>{e.tag}</Badge>
                  </div>
                  <div className="truncate text-2xs">{e.text}</div>
                </div>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </AppShell>
  )
}

export const Home_: Story = { name: 'Home', render: () => <Home /> }
