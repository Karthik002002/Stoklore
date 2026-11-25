import type { Meta, StoryObj } from '@storybook/react-vite'
import { HeatLegend, PnlCalendar, Treemap } from './heatmap'
import { Panel, PanelBody, PanelHeader, PanelTitle } from './panel'
import { Tabs, TabsList, TabsTab } from './tabs'
import { toast, Toaster } from './toast'

const meta: Meta = { title: 'Trading/Heatmaps', parameters: { controls: { disable: true } } }
export default meta
type Story = StoryObj

function novemberPnl() {
  const out: Record<string, number> = {}
  let s = 5
  for (let d = 1; d <= 24; d++) {
    const date = new Date(2026, 10, d)
    if (date.getDay() === 0 || date.getDay() === 6) continue
    s = (s * 16807) % 2147483647
    const r = s / 2147483647
    if (r < 0.12) continue // no trades that day
    out[`2026-11-${String(d).padStart(2, '0')}`] = Math.round((r - 0.42) * 9000)
  }
  return out
}

export const Calendar: Story = {
  name: 'P&L calendar',
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Toaster />
      <Panel className="w-96">
        <PanelHeader>
          <PanelTitle>P&amp;L calendar</PanelTitle>
          <span className="flex-1" />
          <HeatLegend />
        </PanelHeader>
        <PanelBody>
          <PnlCalendar month="2026-11" values={novemberPnl()} onDayClick={(d) => toast(`Trades on ${d}`)} />
        </PanelBody>
      </Panel>
      <Panel className="w-96">
        <PanelHeader>
          <PanelTitle>Quiet month</PanelTitle>
        </PanelHeader>
        <PanelBody>
          <PnlCalendar month="2027-02" values={{ '2027-02-03': 420, '2027-02-17': -180 }} />
        </PanelBody>
      </Panel>
    </div>
  ),
}

const SECTORS = [
  { label: 'BANKS', size: 32, change: 2.4, sub: '12 stocks' },
  { label: 'IT', size: 14, change: -1.1 },
  { label: 'OIL & GAS', size: 12, change: 0.6 },
  { label: 'AUTO', size: 8, change: 1.9 },
  { label: 'FMCG', size: 8, change: -0.4 },
  { label: 'PHARMA', size: 5, change: 0.2 },
  { label: 'METAL', size: 4, change: -2.3 },
  { label: 'CAP GOODS', size: 4, change: 1.2 },
  { label: 'POWER', size: 3.5, change: 0.9 },
  { label: 'TELECOM', size: 3, change: -0.7 },
  { label: 'REALTY', size: 1.5, change: 3.1 },
  { label: 'MEDIA', size: 0.6, change: -1.6 },
]

export const SectorTreemap: Story = {
  name: 'Treemap',
  render: () => (
    <div className="max-w-3xl">
      <Toaster />
      <Panel>
        <PanelHeader>
          <PanelTitle hint="size = weight in NIFTY 50">Sector performance</PanelTitle>
          <span className="flex-1" />
          <Tabs defaultValue="1d">
            <TabsList size="sm">
              <TabsTab value="1d">1D</TabsTab>
              <TabsTab value="1w">1W</TabsTab>
              <TabsTab value="1m">1M</TabsTab>
            </TabsList>
          </Tabs>
        </PanelHeader>
        <Treemap
          items={SECTORS}
          height={280}
          onTileClick={(i) => toast(i.label, { description: `${i.change > 0 ? '+' : ''}${i.change}% today` })}
        />
      </Panel>
      <p className="mt-2 text-2xs text-muted-foreground">
        Resize the window: the layout is recomputed against the measured width.
      </p>
    </div>
  ),
}
