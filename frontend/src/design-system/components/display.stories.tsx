import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './button'
import { Avatar, AvatarFallback, AvatarImage, Progress, Separator, Skeleton, Spinner } from './display'
import { Row } from '../story-helpers'

const meta: Meta = { title: 'Components/Feedback & display', parameters: { controls: { disable: true } } }
export default meta
type Story = StoryObj

export const Loading: Story = {
  name: 'Spinner · Skeleton',
  render: () => (
    <div className="max-w-xl">
      <Row label="Spinner">
        <Spinner />
        <Spinner className="size-5" />
        <Spinner className="text-up" />
        <Button variant="outline" size="sm" disabled>
          <Spinner className="size-3 text-current" />
          Syncing
        </Button>
      </Row>
      <Row label="Skeleton">
        <div className="flex w-72 flex-col gap-1.5">
          {[80, 60, 72].map((w) => (
            <Skeleton key={w} className="h-2.5" style={{ width: `${w}%` }} />
          ))}
        </div>
      </Row>
      <Row label="Table rows">
        <div className="w-96 overflow-hidden rounded-md border border-border">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="grid h-(--row-h) grid-cols-[1fr_60px_60px] items-center gap-3 border-b border-border/60 px-2 last:border-0"
            >
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="h-2.5" />
              <Skeleton className="h-2.5" />
            </div>
          ))}
        </div>
      </Row>
    </div>
  ),
}

export const Progresses: Story = {
  name: 'Progress',
  render: () => (
    <div className="flex max-w-md flex-col gap-4">
      {[
        { label: 'Emergency fund', v: 82, tone: 'accent', note: '₹4.1L / ₹5L' },
        { label: 'House down-payment', v: 34, tone: 'warning', note: '₹6.8L / ₹20L · behind' },
        { label: 'Open risk vs cap', v: 65, tone: 'accent', limit: 80, note: '₹9,820 / ₹15,000' },
        { label: 'Gross exposure', v: 92, tone: 'down', limit: 80, note: '112% of equity' },
      ].map((g) => (
        <div key={g.label} className="flex flex-col gap-1">
          <div className="flex justify-between">
            <span>{g.label}</span>
            <span className="tabular text-muted-foreground">{g.note}</span>
          </div>
          <Progress value={g.v} tone={g.tone as 'accent'} limit={g.limit} />
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <span>Small · delivery %</span>
        <Progress value={62} size="sm" className="w-16" />
      </div>
      <div className="flex flex-col gap-1">
        <span>Indeterminate</span>
        <Progress value={null} />
      </div>
    </div>
  ),
}

export const Display: Story = {
  name: 'Avatar · Separator',
  render: () => (
    <div className="max-w-xl">
      <Row label="Avatar">
        <Avatar size="sm">
          <AvatarFallback>K</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>KR</AvatarFallback>
        </Avatar>
        <Avatar size="lg">
          <AvatarFallback>AP</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarImage src="https://invalid.example/x.png" alt="" />
          <AvatarFallback>Z</AvatarFallback>
        </Avatar>
        <span className="text-2xs text-muted-foreground">last one: broken image → fallback</span>
      </Row>
      <Row label="Separator">
        <div className="flex h-5 items-center gap-2">
          <span>NIFTY 24,318</span>
          <Separator orientation="vertical" />
          <span>BANKNIFTY 52,104</span>
          <Separator orientation="vertical" />
          <span>VIX 13.42</span>
        </div>
      </Row>
      <Row label="Horizontal">
        <div className="w-64">
          <span>Above</span>
          <Separator className="my-2" />
          <span>Below</span>
        </div>
      </Row>
    </div>
  ),
}
