import { useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconChartLine, IconDots, IconPlus, IconSearch } from '@tabler/icons-react'
import {
  Badge,
  Button,
  Change,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  MarketDepth,
  OrderTicket,
  Panel,
  PanelHeader,
  PanelTitle,
  Quote,
  ResultsBadge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SurveillanceBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsCount,
  TabsList,
  TabsPanel,
  TabsTab,
  Toggle,
  ToggleGroup,
  WatchlistRow,
  toast,
} from '../index'
import { AppShell } from './AppShell'
import { CandleChart } from './CandleChart'
import { bars, EVENTS, POSITIONS, STOCKS } from './data'

const meta: Meta = {
  title: 'Pages/Trading workspace',
  parameters: { fullBleed: true, controls: { disable: true } },
}
export default meta
type Story = StoryObj

const INR = (v: number) => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function Workspace() {
  const [symbol, setSymbol] = useState('TATAMOTORS')
  const [filter, setFilter] = useState('')
  const [tf, setTf] = useState('1D')
  const stock = STOCKS.find((s) => s.symbol === symbol)!
  const data = useMemo(
    () => bars(symbol.length * 31 + tf.length, 90, stock.ltp / 1.12),
    [symbol, tf, stock.ltp],
  )
  const dayPnl = POSITIONS.reduce((a, p) => a + (p.ltp - p.avg) * p.qty, 0)
  const list = STOCKS.filter((s) => !filter || s.symbol.includes(filter.toUpperCase()))

  return (
    <AppShell page="Live Trading">
      <div className="grid h-full min-h-[620px] grid-cols-1 gap-1 lg:grid-cols-[230px_minmax(0,1fr)_288px]">
        {/* Watchlist */}
        <Panel className="min-h-0">
          <PanelHeader>
            <PanelTitle>Watchlist</PanelTitle>
            <Select defaultValue="swing">
              <SelectTrigger size="sm" className="w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="swing">Swing · 12</SelectItem>
                <SelectItem value="bo">Breakouts · 9</SelectItem>
              </SelectContent>
            </Select>
            <span className="flex-1" />
            <Button variant="ghost" size="icon-xs" aria-label="Add">
              <IconPlus />
            </Button>
          </PanelHeader>
          <div className="border-b border-border p-1.5">
            <InputGroup className="h-6">
              <InputGroupAddon>
                <IconSearch />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="Filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </InputGroup>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {list.map((s) => (
              <WatchlistRow
                key={s.symbol}
                symbol={s.symbol}
                sub={s.sector}
                ltp={s.ltp}
                pct={s.pct}
                selected={s.symbol === symbol}
                onClick={() => setSymbol(s.symbol)}
                trailing={
                  s.asm ? (
                    <Badge variant="destructive">ASM</Badge>
                  ) : s.results ? (
                    <ResultsBadge days={s.results} />
                  ) : null
                }
              />
            ))}
          </div>
        </Panel>

        {/* Chart + dock */}
        <div className="grid min-h-0 grid-rows-[minmax(280px,1fr)_auto] gap-1">
          <Panel className="min-h-0">
            <PanelHeader>
              <span className="font-semibold">{stock.symbol}</span>
              <span className="hidden text-2xs text-muted-foreground sm:inline">NSE · {stock.sector}</span>
              <Quote ltp={stock.ltp} change={(stock.ltp * stock.pct) / (100 + stock.pct)} pct={stock.pct} />
              {stock.asm && <SurveillanceBadge label={stock.asm} />}
              <span className="flex-1" />
              <ToggleGroup size="sm" value={[tf]} onValueChange={(v) => v[0] && setTf(v[0] as string)}>
                {['5m', '1h', '1D', '1W'].map((t) => (
                  <Toggle key={t} value={t}>
                    {t}
                  </Toggle>
                ))}
              </ToggleGroup>
              <Button variant="ghost" size="xs">
                <IconChartLine />
                Indicators
              </Button>
            </PanelHeader>
            <div className="flex flex-wrap gap-3 px-2 py-1 text-2xs text-muted-foreground">
              {(['O', 'H', 'L', 'C'] as const).map((k) => {
                const b = data.at(-1)!
                const v = { O: b.o, H: b.h, L: b.l, C: b.c }[k]
                return (
                  <span key={k}>
                    {k} <span className="tabular text-foreground">{INR(v)}</span>
                  </span>
                )
              })}
              <span>
                <span className="mr-1 inline-block h-0.5 w-2 bg-chart-1 align-middle" />
                EMA 21
              </span>
              <span>
                <span className="mr-1 inline-block h-0.5 w-2 bg-chart-2 align-middle" />
                EMA 50
              </span>
            </div>
            <CandleChart data={data} className="min-h-0 w-full flex-1" />
          </Panel>

          <Panel className="max-h-64">
            <Tabs defaultValue="positions" className="min-h-0 gap-0">
              <PanelHeader className="py-0">
                <TabsList variant="line" className="h-full self-stretch border-0">
                  <TabsTab value="positions">
                    Positions <TabsCount>{POSITIONS.length}</TabsCount>
                  </TabsTab>
                  <TabsTab value="orders">
                    Orders <TabsCount>2</TabsCount>
                  </TabsTab>
                  <TabsTab value="events">Events</TabsTab>
                </TabsList>
                <span className="flex-1" />
                <span className="text-2xs text-muted-foreground">Day P&amp;L</span>
                <Change value={dayPnl} unit="₹" />
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => toast.warning('Confirm: exit all positions')}
                >
                  Exit all
                </Button>
              </PanelHeader>
              <TabsPanel value="positions" className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Instrument</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Avg</TableHead>
                      <TableHead className="text-right">LTP</TableHead>
                      <TableHead className="text-right">P&amp;L</TableHead>
                      <TableHead className="text-right">Day</TableHead>
                      <TableHead className="text-right">SL</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {POSITIONS.map((p) => (
                      <TableRow
                        key={p.symbol}
                        data-state={p.symbol === symbol ? 'selected' : undefined}
                        onClick={() => setSymbol(p.symbol)}
                        className="cursor-pointer"
                      >
                        <TableCell className="font-semibold">{p.symbol}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{p.product}</Badge>
                        </TableCell>
                        <TableCell className={`text-right ${p.qty < 0 ? 'text-down' : ''}`}>
                          {p.qty}
                        </TableCell>
                        <TableCell className="text-right">{INR(p.avg)}</TableCell>
                        <TableCell className="text-right">{INR(p.ltp)}</TableCell>
                        <TableCell className="text-right">
                          <Change value={(p.ltp - p.avg) * p.qty} unit="₹" />
                        </TableCell>
                        <TableCell className="text-right">
                          <Change value={p.pct} />
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">{INR(p.sl)}</TableCell>
                        <TableCell className="w-8">
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={<Button variant="ghost" size="icon-xs" aria-label="Actions" />}
                            >
                              <IconDots />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem>Modify SL</DropdownMenuItem>
                              <DropdownMenuItem>Add to position</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive">Exit at market</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsPanel>
              <TabsPanel value="orders" className="p-3 text-muted-foreground">
                2 open orders
              </TabsPanel>
              <TabsPanel value="events" className="overflow-auto">
                {EVENTS.map((e) => (
                  <div key={e.text} className="flex gap-2 border-b border-border/60 px-2 py-1.5">
                    <span className="tabular w-10 text-muted-foreground">{e.time}</span>
                    <span className="font-semibold">{e.symbol}</span>
                    <Badge variant={e.tone}>{e.tag}</Badge>
                    <span className="truncate">{e.text}</span>
                  </div>
                ))}
              </TabsPanel>
            </Tabs>
          </Panel>
        </div>

        {/* Ticket + depth */}
        <div className="flex min-h-0 flex-col gap-1 overflow-auto">
          <OrderTicket
            key={symbol}
            className="max-w-none"
            symbol={symbol}
            ltp={stock.ltp}
            balance={512000}
            account="Zerodha · Swing"
            warnings={stock.asm ? [`NSE ${stock.asm}: higher margin, trade-for-trade`] : []}
            onSubmit={(o) =>
              toast.success(`${o.side.toUpperCase()} ${o.qty} ${symbol}`, {
                description: `${o.type} @ ${o.price}`,
              })
            }
          />
          <MarketDepth
            bids={[0, 1, 2, 3, 4].map((i) => ({
              price: stock.ltp - 0.05 * (i + 1),
              qty: [1240, 2410, 880, 3120, 5600][i],
              orders: [8, 14, 5, 21, 37][i],
            }))}
            asks={[0, 1, 2, 3, 4].map((i) => ({
              price: stock.ltp + 0.05 * i,
              qty: [640, 1980, 2240, 760, 4100][i],
              orders: [4, 11, 9, 6, 25][i],
            }))}
          />
        </div>
      </div>
    </AppShell>
  )
}

/** Watchlist → chart → ticket. Click a watchlist row or a position to switch the symbol; the
 *  ticket, depth and chart follow. ⌘K opens the palette; the theme selector is in the top bar. */
export const Workspace_: Story = { name: 'Trading workspace', render: () => <Workspace /> }
