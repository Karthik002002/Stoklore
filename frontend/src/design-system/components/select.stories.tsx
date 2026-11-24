import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select'
import { Row } from '../story-helpers'

const meta: Meta = { title: 'Components/Select', parameters: { controls: { disable: true } } }
export default meta
type Story = StoryObj

const SECTORS = [
  'Auto',
  'Banks',
  'Capital Goods',
  'Consumer Tech',
  'Electronics',
  'FMCG',
  'IT',
  'Metal',
  'Oil & Gas',
  'Pharma',
  'Realty',
]

export const Variants: Story = {
  render: () => (
    <div className="max-w-xl">
      <Row label="Default">
        <Select defaultValue="swing">
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Journal</SelectLabel>
              <SelectItem value="swing">Zerodha · Swing</SelectItem>
              <SelectItem value="intra">Dhan · Intraday</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Paper</SelectLabel>
              <SelectItem value="paper">Paper · Breakouts</SelectItem>
              <SelectItem value="algo" disabled>
                Algo (disabled)
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Row>
      <Row label="Small">
        <Select defaultValue="1d">
          <SelectTrigger size="sm" className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['5m', '15m', '1h', '1d', '1w'].map((t) => (
              <SelectItem key={t} value={t}>
                {t.toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row label="Searchable">
        <Select>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Sector…" />
          </SelectTrigger>
          <SelectContent>
            {SECTORS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-2xs text-muted-foreground">search box appears at 6+ items</span>
      </Row>
      <Row label="Invalid">
        <Select>
          <SelectTrigger className="w-48" aria-invalid>
            <SelectValue placeholder="Pick an account" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">Zerodha</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      <Row label="Disabled">
        <Select disabled defaultValue="a">
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">Zerodha · Swing</SelectItem>
          </SelectContent>
        </Select>
      </Row>
    </div>
  ),
}
