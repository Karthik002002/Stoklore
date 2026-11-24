import type { Meta, StoryObj } from '@storybook/react-vite'
import { Tabs, TabsCount, TabsList, TabsPanel, TabsTab } from './tabs'
import { Button } from './button'
import { Row } from '../story-helpers'

const meta: Meta = { title: 'Components/Tabs', parameters: { controls: { disable: true } } }
export default meta
type Story = StoryObj

export const Variants: Story = {
  render: () => (
    <div className="max-w-2xl">
      <Row label="Segment">
        <Tabs defaultValue="overview">
          <TabsList>
            {['Overview', 'Financials', 'Shareholding', 'Events'].map((t) => (
              <TabsTab key={t} value={t.toLowerCase()}>
                {t}
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
      </Row>
      <Row label="Segment sm">
        <Tabs defaultValue="pct">
          <TabsList size="sm">
            <TabsTab value="pct">%</TabsTab>
            <TabsTab value="abs">₹</TabsTab>
            <TabsTab value="rs">RS</TabsTab>
          </TabsList>
        </Tabs>
      </Row>
      <Row label="Line">
        <Tabs defaultValue="single">
          <TabsList variant="line">
            <TabsTab value="single">Single</TabsTab>
            <TabsTab value="multiple">Multiple</TabsTab>
            <TabsTab value="comparison">Comparison</TabsTab>
            <TabsTab value="x" disabled>
              Disabled
            </TabsTab>
          </TabsList>
        </Tabs>
      </Row>
    </div>
  ),
}

/** The dock under the chart: line tabs inside a panel header, with counts and a header action. */
export const InPanelHeader: Story = {
  render: () => (
    <div className="max-w-3xl overflow-hidden rounded-md border border-border bg-card">
      <Tabs defaultValue="positions" className="gap-0">
        <div className="flex items-stretch gap-2 border-b border-border bg-panel-head px-2">
          <TabsList variant="line" className="border-0">
            <TabsTab value="positions">
              Positions <TabsCount>4</TabsCount>
            </TabsTab>
            <TabsTab value="orders">
              Orders <TabsCount>2</TabsCount>
            </TabsTab>
            <TabsTab value="journal">Journal</TabsTab>
            <TabsTab value="alerts">
              Alerts <TabsCount>7</TabsCount>
            </TabsTab>
          </TabsList>
          <span className="flex-1" />
          <span className="self-center text-2xs text-muted-foreground">Day P&amp;L</span>
          <span className="tabular self-center text-up">+₹6,842.50</span>
          <Button variant="outline" size="xs" className="self-center">
            Exit all
          </Button>
        </div>
        {['positions', 'orders', 'journal', 'alerts'].map((v) => (
          <TabsPanel key={v} value={v} className="p-3 text-muted-foreground">
            {v} panel content
          </TabsPanel>
        ))}
      </Tabs>
    </div>
  ),
}

export const Vertical: Story = {
  render: () => (
    <Tabs defaultValue="general" orientation="vertical" className="w-96">
      <TabsList className="w-28">
        {['General', 'Accounts', 'Shortcuts', 'Engine'].map((t) => (
          <TabsTab
            key={t}
            value={t.toLowerCase()}
            className="justify-start border-r-0 border-b border-border last:border-b-0"
          >
            {t}
          </TabsTab>
        ))}
      </TabsList>
      <TabsPanel value="general" className="flex-1 text-muted-foreground">
        General settings…
      </TabsPanel>
    </Tabs>
  ),
}
