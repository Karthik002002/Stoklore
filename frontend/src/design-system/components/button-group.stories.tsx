import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconChartLine, IconChevronDown, IconLayoutColumns, IconTable } from '@tabler/icons-react'
import { Button } from './button'
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText, Toggle, ToggleGroup } from './button-group'
import { Input } from './input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'
import { Row } from '../story-helpers'

const meta: Meta = {
  title: 'Components/Button group · Toggle group',
  parameters: { controls: { disable: true } },
}
export default meta
type Story = StoryObj

export const ButtonGroups: Story = {
  name: 'Button group',
  render: () => (
    <div className="max-w-2xl">
      <Row label="Split button">
        <ButtonGroup>
          <Button size="sm">Run backtest</Button>
          <ButtonGroupSeparator className="bg-primary-foreground/25" />
          <Button size="icon-sm" aria-label="More">
            <IconChevronDown />
          </Button>
        </ButtonGroup>
      </Row>
      <Row label="Outline">
        <ButtonGroup>
          <Button variant="outline" size="sm">
            Prev
          </Button>
          <Button variant="outline" size="sm">
            Today
          </Button>
          <Button variant="outline" size="sm">
            Next
          </Button>
        </ButtonGroup>
      </Row>
      <Row label="With input">
        <ButtonGroup>
          <ButtonGroupText>₹</ButtonGroupText>
          <Input numeric className="w-24" defaultValue="2,500" />
          <Select defaultValue="trade">
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="trade">/ trade</SelectItem>
              <SelectItem value="day">/ day</SelectItem>
            </SelectContent>
          </Select>
        </ButtonGroup>
      </Row>
    </div>
  ),
}

export const ToggleGroups: Story = {
  name: 'Toggle group',
  render: () => (
    <div className="max-w-2xl">
      <Row label="Timeframe">
        <ToggleGroup defaultValue={['1d']}>
          {['5m', '1h', '1d', '1w'].map((t) => (
            <Toggle key={t} value={t}>
              {t.toUpperCase()}
            </Toggle>
          ))}
        </ToggleGroup>
      </Row>
      <Row label="Order type sm">
        <ToggleGroup size="sm" defaultValue={['lmt']}>
          <Toggle value="lmt">LMT</Toggle>
          <Toggle value="mkt">MKT</Toggle>
          <Toggle value="sl">SL</Toggle>
          <Toggle value="slm" disabled>
            SL-M
          </Toggle>
        </ToggleGroup>
      </Row>
      <Row label="Icons">
        <ToggleGroup defaultValue={['chart']} aria-label="View">
          <Toggle value="chart" aria-label="Chart">
            <IconChartLine />
          </Toggle>
          <Toggle value="table" aria-label="Table">
            <IconTable />
          </Toggle>
          <Toggle value="split" aria-label="Split">
            <IconLayoutColumns />
          </Toggle>
        </ToggleGroup>
      </Row>
      <Row label="Multiple">
        <ToggleGroup multiple defaultValue={['ema21', 'vol']}>
          <Toggle value="ema21">EMA 21</Toggle>
          <Toggle value="ema50">EMA 50</Toggle>
          <Toggle value="vol">Volume</Toggle>
          <Toggle value="vwap">VWAP</Toggle>
        </ToggleGroup>
      </Row>
    </div>
  ),
}
