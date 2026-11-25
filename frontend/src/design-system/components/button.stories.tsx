import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconChevronDown, IconDownload, IconEdit, IconPlus } from '@tabler/icons-react'
import { Button } from './button'
import { Row } from '../story-helpers'

const meta = {
  title: 'Components/Button',
  component: Button,
  args: { children: 'Button' },
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'secondary', 'outline', 'ghost', 'destructive', 'link', 'buy', 'sell'],
    },
    size: {
      control: 'select',
      options: ['xs', 'sm', 'default', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'],
    },
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Variants: Story = {
  render: () => (
    <div>
      <Row label="Variants">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="link">Link</Button>
      </Row>
      <Row label="Trading">
        <Button variant="buy">Buy</Button>
        <Button variant="sell">Sell</Button>
        <Button variant="buy" size="lg" className="tabular w-48">
          BUY 52 @ 986.25
        </Button>
      </Row>
      <Row label="With icon">
        <Button size="sm">
          <IconPlus />
          New backtest
        </Button>
        <Button variant="outline" size="sm">
          <IconDownload />
          CSV
        </Button>
        <Button variant="ghost" size="sm">
          Indicators
          <IconChevronDown />
        </Button>
      </Row>
      <Row label="States">
        <Button disabled>Disabled</Button>
        <Button variant="outline" disabled>
          Disabled
        </Button>
        <Button variant="outline" aria-invalid>
          Invalid
        </Button>
      </Row>
    </div>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div>
      <Row label="Text">
        <Button size="xs">xs · 22</Button>
        <Button size="sm">sm · 24</Button>
        <Button>default · --control-h</Button>
        <Button size="lg">lg · 32</Button>
      </Row>
      <Row label="Icon">
        <Button variant="outline" size="icon-xs" aria-label="Edit">
          <IconEdit />
        </Button>
        <Button variant="outline" size="icon-sm" aria-label="Edit">
          <IconEdit />
        </Button>
        <Button variant="outline" size="icon" aria-label="Edit">
          <IconEdit />
        </Button>
        <Button variant="outline" size="icon-lg" aria-label="Edit">
          <IconEdit />
        </Button>
      </Row>
    </div>
  ),
}
