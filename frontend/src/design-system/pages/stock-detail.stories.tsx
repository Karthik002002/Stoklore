import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconBell, IconExternalLink, IconPlus, IconSparkles } from '@tabler/icons-react'
import {
  Badge,
  Button,
  Change,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  Quote,
  RangeBar,
  RsPill,
  Stat,
  StatStrip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  Toggle,
  ToggleGroup,
} from '../index'
import { AppShell } from './AppShell'
import { CandleChart } from './CandleChart'
import { bars, EVENTS } from './data'

const meta: Meta = {
  title: 'Pages/Stock detail',
  parameters: { fullBleed: true, controls: { disable: true } },
}
export default meta
type Story = StoryObj

const Q = ['Sep 25', 'Dec 25', 'Mar 26', 'Jun 26', 'Sep 26']
const FIN: [string, number[], boolean?][] = [
  ['Revenue', [101450, 113575, 119033, 108048, 117210]],
  ['EBITDA', [11960, 15214, 17150, 13900, 16480]],
  ['EBITDA %', [11.8, 13.4, 14.4, 12.9, 14.1], true],
  ['Net profit', [3764, 7025, 17407, 5566, 8120]],
  ['EPS', [9.8, 18.3, 45.4, 14.5, 21.2]],
]
const SHP = [
  ['Sep 25', 46.4, 18.1, 15.2],
  ['Dec 25', 46.4, 17.4, 16.0],
  ['Mar 26', 42.6, 17.9, 17.3],
  ['Jun 26', 42.6, 18.8, 17.6],
  ['Sep 26', 42.6, 19.6, 18.1],
] as const

function StockDetail() {
  return (
    <AppShell page="Stocks" crumbs={['Discover', 'Stocks', 'TATAMOTORS']} className="flex flex-col gap-1">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3 p-3 pb-2">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h1 className="text-lg font-bold tracking-tight">TATAMOTORS</h1>
              <Badge variant="outline">NSE</Badge>
              <HoverCard>
                <HoverCardTrigger render={<Badge variant="outline" className="cursor-help" />}>
                  Auto · Passenger cars
                </HoverCardTrigger>
                <HoverCardContent align="start">
                  <div className="flex justify-between font-semibold">
                    Auto · 1W <Change value={1.9} />
                  </div>
                  <div className="mt-1 text-2xs text-muted-foreground">
                    14 / 17 up · leaders TATAMOTORS, M&amp;M
                  </div>
                </HoverCardContent>
              </HoverCard>
              <Badge variant="success">Results ✓ 8 Nov</Badge>
              <RsPill rs={88} />
            </div>
            <div className="flex gap-3 text-2xs text-muted-foreground">
              Tata Motors Ltd · INE155A01022
              {['Screener', 'TradingView', 'NSE'].map((l) => (
                <a
                  key={l}
                  href={`#${l}`}
                  className="inline-flex items-center gap-0.5 text-accent hover:underline"
                >
                  {l}
                  <IconExternalLink className="size-3" />
                </a>
              ))}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Quote ltp={986.25} change={32.45} pct={3.4} size="lg" />
            <span className="text-2xs text-muted-foreground">vol 21.1M · 2.3× 50D avg</span>
            <div className="flex gap-1">
              <Button variant="outline" size="xs">
                <IconBell />
                Alert
              </Button>
              <Button variant="outline" size="xs">
                <IconPlus />
                Watchlist
              </Button>
              <Button variant="buy" size="xs">
                Buy
              </Button>
              <Button variant="sell" size="xs">
                Sell
              </Button>
            </div>
          </div>
        </div>
        <div className="px-3 pb-2">
          <RangeBar low={612.4} high={1065.6} value={986.25} />
        </div>
        <StatStrip className="border-t border-border">
          {[
            ['Mkt cap', '₹3.63L Cr'],
            ['P/E', '9.8'],
            ['P/B', '3.1'],
            ['ROE', '31.4%'],
            ['ROCE', '19.2%'],
            ['D/E', '1.12'],
            ['EPS TTM', '₹100.6'],
            ['Div yield', '0.61%'],
            ['Promoter', '42.6%'],
            ['Pledged', '0.0%'],
            ['Beta', '1.11'],
            ['Deliv 20D', '58.3%'],
          ].map(([l, v]) => (
            <Stat key={l} label={l} value={v} className="py-1.5 [&>span:nth-child(2)]:text-xs" />
          ))}
        </StatStrip>
      </Panel>

      <Tabs defaultValue="overview" className="gap-1">
        <TabsList variant="line" className="w-full">
          {['Overview', 'Financials', 'Shareholding', 'Events', 'AI reports'].map((t) => (
            <TabsTab key={t} value={t.toLowerCase()}>
              {t}
            </TabsTab>
          ))}
        </TabsList>

        <TabsPanel value="overview" className="grid gap-1 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Panel className="h-96">
            <PanelHeader>
              <PanelTitle>Price chart</PanelTitle>
              <span className="flex-1" />
              <ToggleGroup size="sm" defaultValue={['1y']}>
                {['3m', '6m', '1y', '5y', 'max'].map((r) => (
                  <Toggle key={r} value={r}>
                    {r.toUpperCase()}
                  </Toggle>
                ))}
              </ToggleGroup>
            </PanelHeader>
            <CandleChart data={bars(17, 120, 700)} className="min-h-0 w-full flex-1" />
          </Panel>
          <div className="flex flex-col gap-1">
            <Panel>
              <PanelHeader>
                <PanelTitle>EMA crossover backtest</PanelTitle>
              </PanelHeader>
              <StatStrip>
                <Stat label="Return" value="+64%" tone="up" />
                <Stat label="Trades" value="11" />
                <Stat label="Win" value="55%" />
              </StatStrip>
            </Panel>
            <Panel>
              <PanelHeader>
                <PanelTitle>Latest events</PanelTitle>
              </PanelHeader>
              {EVENTS.slice(0, 3).map((e) => (
                <div key={e.text} className="border-b border-border/60 px-2 py-1.5 text-2xs last:border-0">
                  <div className="flex items-center gap-1.5">
                    <span className="tabular text-muted-foreground">{e.time}</span>
                    <Badge variant={e.tone}>{e.tag}</Badge>
                  </div>
                  <div className="mt-0.5">{e.text}</div>
                </div>
              ))}
            </Panel>
          </div>
        </TabsPanel>

        <TabsPanel value="financials">
          <Panel>
            <PanelHeader>
              <PanelTitle hint="₹ Cr, standalone">Quarterly</PanelTitle>
            </PanelHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead />
                  {Q.map((q) => (
                    <TableHead key={q} className="text-right">
                      {q}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">QoQ</TableHead>
                  <TableHead className="text-right">YoY</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {FIN.map(([k, v, pct]) => {
                  const qoq = pct ? v[4] - v[3] : ((v[4] - v[3]) / v[3]) * 100
                  const yoy = pct ? v[4] - v[0] : ((v[4] - v[0]) / v[0]) * 100
                  return (
                    <TableRow key={k}>
                      <TableCell className="text-muted-foreground">{k}</TableCell>
                      {v.map((x, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: quarter columns
                        <TableCell key={i} className="text-right">
                          {pct || k === 'EPS' ? x.toFixed(1) : x.toLocaleString('en-IN')}
                        </TableCell>
                      ))}
                      <TableCell className="text-right">
                        <Change value={qoq} unit={pct ? '' : '%'} digits={1} />
                        {pct && <span className="text-muted-foreground">pp</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Change value={yoy} unit={pct ? '' : '%'} digits={1} />
                        {pct && <span className="text-muted-foreground">pp</span>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Panel>
        </TabsPanel>

        <TabsPanel value="shareholding">
          <Panel className="max-w-xl">
            <PanelHeader>
              <PanelTitle>Shareholding</PanelTitle>
            </PanelHeader>
            <PanelBody className="flex flex-col gap-1.5">
              {SHP.map(([q, p, f, d]) => (
                <div key={q} className="grid grid-cols-[52px_1fr_auto] items-center gap-2">
                  <span className="text-2xs text-muted-foreground">{q}</span>
                  <div className="flex h-2.5 gap-px">
                    <span className="bg-chart-1" style={{ width: `${p}%` }} />
                    <span className="bg-chart-2" style={{ width: `${f}%` }} />
                    <span className="bg-chart-3" style={{ width: `${d}%` }} />
                    <span className="flex-1 bg-chart-4" />
                  </div>
                  <span className="tabular text-2xs">FII {f}%</span>
                </div>
              ))}
              <div className="mt-1 flex gap-3 text-2xs text-muted-foreground">
                {[
                  ['Promoter', 'bg-chart-1'],
                  ['FII', 'bg-chart-2'],
                  ['DII', 'bg-chart-3'],
                  ['Public', 'bg-chart-4'],
                ].map(([l, c]) => (
                  <span key={l} className="inline-flex items-center gap-1">
                    <i className={`size-2 rounded-xs ${c}`} />
                    {l}
                  </span>
                ))}
              </div>
            </PanelBody>
          </Panel>
        </TabsPanel>

        <TabsPanel value="events">
          <Panel>
            {EVENTS.map((e) => (
              <div key={e.text} className="flex gap-2 border-b border-border/60 px-2 py-1.5 last:border-0">
                <span className="tabular w-10 text-muted-foreground">{e.time}</span>
                <Badge variant={e.tone}>{e.tag}</Badge>
                <span>{e.text}</span>
              </div>
            ))}
          </Panel>
        </TabsPanel>

        <TabsPanel value="ai reports">
          <Panel className="max-w-2xl">
            <PanelHeader>
              <PanelTitle>AI report</PanelTitle>
              <span className="flex-1" />
              <Button variant="outline" size="xs">
                <IconSparkles />
                Regenerate
              </Button>
            </PanelHeader>
            <PanelBody className="leading-relaxed">
              <p>
                <b>Thesis:</b> JLR margins recovering, domestic PV share stable at 13%, EV order book at a
                record. Breakout above the 6-week base on 2.3× volume.
              </p>
              <p className="mt-2 text-muted-foreground">
                Risks: JLR China demand, commodity costs, the demerger timeline.
              </p>
            </PanelBody>
          </Panel>
        </TabsPanel>
      </Tabs>
    </AppShell>
  )
}

export const StockDetail_: Story = { name: 'Stock detail', render: () => <StockDetail /> }
