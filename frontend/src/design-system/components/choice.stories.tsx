import type { Meta, StoryObj } from '@storybook/react-vite'
import { Checkbox, Radio, RadioGroup, Switch } from './choice'
import { Label } from './field'
import { Row } from '../story-helpers'

const meta: Meta = {
  title: 'Components/Checkbox · Switch · Radio',
  parameters: { controls: { disable: true } },
}
export default meta
type Story = StoryObj

export const All: Story = {
  render: () => (
    <div className="max-w-xl">
      <Row label="Checkbox">
        <Label>
          <Checkbox defaultChecked />
          Journal it
        </Label>
        <Label>
          <Checkbox />
          Place GTT
        </Label>
        <Label>
          <Checkbox indeterminate />
          Some rows
        </Label>
        <Label>
          <Checkbox disabled defaultChecked />
          Disabled
        </Label>
        <Label>
          <Checkbox aria-invalid />
          Accept terms
        </Label>
      </Row>
      <Row label="Switch">
        <Label>
          <Switch defaultChecked />
          Bracket
        </Label>
        <Label>
          <Switch />
          Auto-refresh
        </Label>
        <Label>
          <Switch size="sm" defaultChecked />
          Small
        </Label>
        <Label>
          <Switch disabled />
          Disabled
        </Label>
      </Row>
      <Row label="Radio">
        <RadioGroup defaultValue="cnc" aria-label="Product">
          {['CNC', 'MIS', 'NRML'].map((p) => (
            <Label key={p}>
              <Radio value={p.toLowerCase()} />
              {p}
            </Label>
          ))}
          <Label>
            <Radio value="mtf" disabled />
            MTF
          </Label>
        </RadioGroup>
      </Row>
    </div>
  ),
}

/** Settings-style rows: label + hint on the left, control on the right. */
export const SettingsRows: Story = {
  render: () => (
    <div className="w-96 overflow-hidden rounded-md border border-border bg-card">
      {[
        ['Compact rows', '26px tables', <Switch key="a" defaultChecked />],
        ['Sound on fill', 'Plays when an order fills', <Switch key="b" />],
        ['Confirm market orders', 'Ask before sending MKT', <Checkbox key="c" defaultChecked />],
      ].map(([t, d, c]) => (
        <div
          key={t as string}
          className="flex min-h-9.5 items-center justify-between gap-2 border-b border-border/60 px-2 last:border-0"
        >
          <div>
            <div>{t}</div>
            <div className="text-2xs text-muted-foreground">{d}</div>
          </div>
          {c}
        </div>
      ))}
    </div>
  ),
}
