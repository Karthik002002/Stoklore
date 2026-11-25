import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge, Kbd, KbdGroup } from './badge'
import { Row } from '../story-helpers'

const meta = {
  title: 'Components/Badge · Kbd',
  component: Badge,
  args: { children: 'Results ✓', variant: 'success', dot: false },
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'default',
        'secondary',
        'success',
        'warning',
        'destructive',
        'accent',
        'outline',
        'ghost',
        'link',
      ],
    },
  },
} satisfies Meta<typeof Badge>
export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Variants: Story = {
  render: () => (
    <div className="max-w-2xl">
      <Row label="Variants">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="success">Success</Badge>
        <Badge variant="warning">Warning</Badge>
        <Badge variant="destructive">Destructive</Badge>
        <Badge variant="accent">Accent</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="link" render={<a href="#x" />}>
          Link
        </Badge>
      </Row>
      <Row label="Status dot">
        <Badge dot variant="success">
          Live
        </Badge>
        <Badge dot variant="warning">
          Paper
        </Badge>
        <Badge dot variant="destructive">
          Halted
        </Badge>
        <Badge dot variant="secondary">
          Draft
        </Badge>
        <Badge dot variant="success">
          NSE open
        </Badge>
      </Row>
      <Row label="In the app">
        <Badge variant="success">Results ✓ 8 Nov</Badge>
        <Badge variant="secondary">Results 28 Nov</Badge>
        <Badge variant="destructive">ASM Stage 1</Badge>
        <Badge variant="warning">Bulk deal</Badge>
        <Badge variant="outline">Breakout</Badge>
        <Badge variant="outline">CNC</Badge>
        <Badge variant="accent">#stage-2</Badge>
      </Row>
    </div>
  ),
}

export const Keys: Story = {
  name: 'Kbd',
  render: () => (
    <div className="max-w-xl">
      <Row label="Single">
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
        <Kbd>↵</Kbd>
        <Kbd>esc</Kbd>
        <Kbd>⌫</Kbd>
      </Row>
      <Row label="Combo">
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
        <KbdGroup>
          <Kbd>G</Kbd>
          <Kbd>S</Kbd>
        </KbdGroup>
        <span className="text-muted-foreground">
          Open chart <Kbd>C</Kbd>
        </span>
      </Row>
    </div>
  ),
}
