import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  IconChartLine,
  IconDots,
  IconDownload,
  IconHistory,
  IconPlus,
  IconScale,
  IconTarget,
  IconTrendingUp,
  IconWallet,
} from '@tabler/icons-react'
import { Badge } from './badge'
import { Button } from './button'
import { Progress } from './display'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'
import { Tabs, TabsCount, TabsList, TabsTab } from './tabs'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
  PanelSection,
  PanelTitle,
  Stat,
  StatStrip,
} from './panel'

const meta: Meta = {
  title: 'Components/Panel · Card · Stats · Empty',
  parameters: { controls: { disable: true } },
}
export default meta
type Story = StoryObj

const watch = [
  ['RELIANCE', '2,914.60', '+1.82%', true],
  ['TATAMOTORS', '986.25', '+3.40%', true],
  ['ZOMATO', '262.15', '−2.14%', false],
  ['SUZLON', '64.80', '−4.95%', false],
] as const

export const Panels: Story = {
  render: () => (
    <div className="grid max-w-5xl gap-1 md:grid-cols-[260px_1fr]">
      <Panel>
        <PanelHeader>
          <PanelTitle>Watchlist</PanelTitle>
          <Select defaultValue="swing">
            <SelectTrigger size="sm" className="w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="swing">Swing · 24</SelectItem>
              <SelectItem value="bo">Breakouts · 9</SelectItem>
            </SelectContent>
          </Select>
          <span className="flex-1" />
          <Button variant="ghost" size="icon-xs" aria-label="Add">
            <IconPlus />
          </Button>
        </PanelHeader>
        {watch.map(([s, p, c, up]) => (
          <div
            key={s}
            className="grid h-(--row-h) grid-cols-[1fr_auto_60px] items-center gap-2 border-b border-border/60 px-2 hover:bg-muted"
          >
            <span className="font-semibold">{s}</span>
            <span className="tabular">{p}</span>
            <span className={`tabular text-right ${up ? 'text-up' : 'text-down'}`}>{c}</span>
          </div>
        ))}
        <PanelSection>Recently viewed</PanelSection>
        <div className="grid h-(--row-h) grid-cols-[1fr_auto] items-center px-2">
          <span className="font-semibold">KAYNES</span>
          <span className="tabular text-up">+4.02%</span>
        </div>
      </Panel>
      <Panel>
        <PanelHeader className="py-0">
          <Tabs defaultValue="positions" className="self-stretch">
            <TabsList variant="line" className="h-full border-0">
              <TabsTab value="positions">
                Positions <TabsCount>4</TabsCount>
              </TabsTab>
              <TabsTab value="orders">
                Orders <TabsCount>2</TabsCount>
              </TabsTab>
            </TabsList>
          </Tabs>
          <span className="flex-1" />
          <span className="text-2xs text-muted-foreground">Day P&amp;L</span>
          <span className="tabular text-up">+₹6,842.50</span>
          <Button variant="outline" size="xs">
            Exit all
          </Button>
        </PanelHeader>
        <PanelBody className="text-muted-foreground">Panel body — tables, charts, forms.</PanelBody>
        <PanelFooter>
          <span className="text-2xs text-muted-foreground">Updated 11:42:08</span>
          <span className="flex-1" />
          <Button variant="ghost" size="xs">
            <IconDownload />
            CSV
          </Button>
        </PanelFooter>
      </Panel>
    </div>
  ),
}

export const Stats: Story = {
  render: () => (
    <div className="flex max-w-4xl flex-col gap-3">
      <StatStrip bordered>
        <Stat
          label="Net P&L"
          value="₹1,84,250"
          tone="up"
          delta="▲ 12.4% vs last FY"
          deltaTone="up"
          icon={IconTrendingUp}
        />
        <Stat label="Win rate" value="58.3%" hint="84 of 144 closed" />
        <Stat label="Expectancy" value="0.42R" hint="Avg win 1.9R · loss −1.0R" icon={IconScale} />
        <Stat label="Max drawdown" value="−₹38,900" tone="down" delta="−7.8% · 19d to recover" />
      </StatStrip>
      <Panel>
        <PanelHeader>
          <PanelTitle hint="EMA cross · NIFTY 500 · 2019–2026">Backtest result</PanelTitle>
          <span className="flex-1" />
          <Badge variant="success">PASS</Badge>
        </PanelHeader>
        <StatStrip>
          <Stat label="Net" value="+38.4%" tone="up" />
          <Stat label="CAGR" value="17.9%" />
          <Stat label="Sharpe" value="1.42" />
          <Stat label="Max DD" value="−12.6%" tone="down" />
          <Stat label="Trades" value="214" />
          <Stat label="Win" value="47.2%" />
          <Stat label="PF" value="1.81" />
        </StatStrip>
      </Panel>
      <StatStrip bordered className="max-w-md">
        <Stat
          size="lg"
          label="Net worth"
          value="₹48,62,400"
          delta="+₹1,92,100 this month"
          deltaTone="up"
          icon={IconWallet}
        />
      </StatStrip>
    </div>
  ),
}

/** components/ui/card.tsx API, drawn as a panel. */
export const Cards: Story = {
  name: 'Card (compat)',
  render: () => (
    <div className="grid max-w-3xl gap-2 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Emergency fund</CardTitle>
          <CardDescription>SIP ₹12,000 / month</CardDescription>
          <CardAction>
            <Badge variant="success">On track</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <div className="flex justify-between">
            <span className="tabular">₹4.1L</span>
            <span className="tabular text-muted-foreground">of ₹5L</span>
          </div>
          <Progress value={82} />
        </CardContent>
        <CardFooter className="justify-between">
          <span className="text-2xs text-muted-foreground">ETA Mar 2027</span>
          <Button variant="ghost" size="icon-xs" aria-label="More">
            <IconDots />
          </Button>
        </CardFooter>
      </Card>
      <Card size="sm">
        <CardHeader>
          <CardTitle>House down-payment</CardTitle>
          <CardDescription>needs ₹41,500 / month</CardDescription>
          <CardAction>
            <Badge variant="warning">Behind</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Progress value={34} tone="warning" />
        </CardContent>
      </Card>
    </div>
  ),
}

export const Empty: Story = {
  name: 'Empty state',
  render: () => (
    <div className="grid max-w-4xl gap-2 md:grid-cols-3">
      <EmptyState
        bordered
        icon={IconHistory}
        title="No backtests yet"
        description="Pick a strategy and a date range to run your first backtest."
      >
        <Button size="sm">
          <IconPlus />
          New backtest
        </Button>
      </EmptyState>
      <Panel>
        <PanelHeader>
          <PanelTitle>Alerts</PanelTitle>
        </PanelHeader>
        <EmptyState
          icon={IconTarget}
          title="No alerts"
          description="Alerts fire on price, volume or indicator conditions."
        >
          <Button variant="outline" size="sm">
            Create alert
          </Button>
        </EmptyState>
      </Panel>
      <EmptyState
        bordered
        icon={IconChartLine}
        title="No matches"
        description="No stocks pass these filters. Loosen RS or delivery %."
      >
        <Button variant="ghost" size="sm">
          Clear filters
        </Button>
      </EmptyState>
    </div>
  ),
}
