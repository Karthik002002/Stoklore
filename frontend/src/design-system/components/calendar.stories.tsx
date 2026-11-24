import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Calendar, DatePicker, DateRangePicker } from './calendar'
import { Row } from '../story-helpers'

const meta: Meta = { title: 'Components/Calendar · Date picker', parameters: { controls: { disable: true } } }
export default meta
type Story = StoryObj

export const Calendars: Story = {
  name: 'Calendar',
  render: () => {
    const Single = () => {
      const [d, setD] = useState<Date | undefined>(new Date(2026, 10, 24))
      return (
        <Calendar
          mode="single"
          selected={d}
          onSelect={setD}
          defaultMonth={new Date(2026, 10, 1)}
          className="rounded-md border border-border bg-card"
        />
      )
    }
    const Range = () => {
      const [r, setR] = useState<{ from?: Date; to?: Date } | undefined>({
        from: new Date(2026, 10, 10),
        to: new Date(2026, 10, 21),
      })
      return (
        <Calendar
          mode="range"
          numberOfMonths={2}
          selected={r as never}
          onSelect={setR as never}
          defaultMonth={new Date(2026, 9, 1)}
          className="rounded-md border border-border bg-card"
        />
      )
    }
    return (
      <div className="flex flex-wrap items-start gap-3">
        <Single />
        <Range />
        <Calendar
          mode="single"
          captionLayout="dropdown"
          defaultMonth={new Date(2013, 4, 1)}
          startMonth={new Date(1990, 0, 1)}
          endMonth={new Date(2027, 11, 31)}
          className="rounded-md border border-border bg-card"
        />
      </div>
    )
  },
}

/** Same API as components/DatePicker.tsx: "YYYY-MM-DD" strings in and out. */
function Pickers() {
  const [date, setDate] = useState('2026-11-24')
  const [empty, setEmpty] = useState('')
  const [range, setRange] = useState({ from: '2026-10-01', to: '2026-11-24' })
  return (
    <div className="max-w-2xl">
      <Row label="Date">
        <DatePicker value={date} onChange={setDate} />
        <code className="tabular text-2xs text-muted-foreground">{date || '""'}</code>
      </Row>
      <Row label="Empty">
        <DatePicker value={empty} onChange={setEmpty} placeholder="Entry date" />
      </Row>
      <Row label="Bounded">
        <DatePicker value={date} onChange={setDate} min="2026-11-01" max="2026-11-30" />
        <span className="text-2xs text-muted-foreground">Nov 2026 only</span>
      </Row>
      <Row label="Range">
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
        <code className="tabular text-2xs text-muted-foreground">
          {range.from} → {range.to}
        </code>
      </Row>
      <Row label="With presets">
        <DateRangePicker
          from={range.from}
          to={range.to}
          onChange={setRange}
          presets={[
            { label: 'Today', from: '2026-11-24', to: '2026-11-24' },
            { label: 'This week', from: '2026-11-23', to: '2026-11-24' },
            { label: '1M', from: '2026-10-24', to: '2026-11-24' },
            { label: '3M', from: '2026-08-24', to: '2026-11-24' },
            { label: 'FY 26-27', from: '2026-04-01', to: '2026-11-24' },
          ]}
        />
      </Row>
      <Row label="Disabled">
        <DatePicker value={date} onChange={setDate} disabled />
      </Row>
    </div>
  )
}

export const DatePickers: Story = { name: 'Date picker', render: () => <Pickers /> }
