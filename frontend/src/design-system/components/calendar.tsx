import type { ComponentProps } from 'react'
import * as React from 'react'
import { DayPicker, getDefaultClassNames } from 'react-day-picker'
import type { DayButton } from 'react-day-picker'
import { IconCalendar, IconChevronDown, IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

// Calendar: same props as components/ui/calendar.tsx (react-day-picker). DatePicker /
// DateRangePicker: same props as components/DatePicker.tsx - values in and out are "YYYY-MM-DD"
// strings and Date objects never leave this file.

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = 'label',
  locale,
  formatters,
  components,
  ...props
}: ComponentProps<typeof DayPicker>) {
  const d = getDefaultClassNames()
  const navButton =
    'grid size-(--cell-size) place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground aria-disabled:opacity-40 select-none'
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('group/calendar p-2 [--cell-size:--spacing(7)]', className)}
      captionLayout={captionLayout}
      locale={locale}
      formatters={{
        formatMonthDropdown: (date) => date.toLocaleString(locale?.code, { month: 'short' }),
        ...formatters,
      }}
      classNames={{
        root: cn('w-fit', d.root),
        months: cn('relative flex flex-col gap-4 md:flex-row', d.months),
        month: cn('flex w-full flex-col gap-2', d.month),
        nav: cn('absolute inset-x-0 top-0 flex w-full items-center justify-between', d.nav),
        button_previous: cn(navButton, d.button_previous),
        button_next: cn(navButton, d.button_next),
        month_caption: cn(
          'flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)',
          d.month_caption,
        ),
        dropdowns: cn(
          'flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-xs font-semibold',
          d.dropdowns,
        ),
        dropdown_root: cn('relative rounded-sm border border-input px-1.5 hover:bg-muted', d.dropdown_root),
        dropdown: cn('absolute inset-0 bg-popover opacity-0', d.dropdown),
        caption_label: cn(
          'font-semibold select-none',
          captionLayout === 'label'
            ? 'text-xs'
            : 'flex h-6 items-center gap-1 text-xs [&>svg]:size-3 [&>svg]:text-muted-foreground',
          d.caption_label,
        ),
        month_grid: cn('w-full border-collapse', d.month_grid),
        weekdays: cn('flex', d.weekdays),
        weekday: cn('flex-1 text-label font-normal text-muted-foreground uppercase select-none', d.weekday),
        week: cn('mt-0.5 flex w-full', d.week),
        week_number_header: cn('w-(--cell-size) select-none', d.week_number_header),
        week_number: cn('text-[10px] text-muted-foreground select-none', d.week_number),
        day: cn('group/day relative aspect-square h-full w-full p-0 text-center select-none', d.day),
        range_start: cn('rounded-l-sm bg-accent-subtle', d.range_start),
        range_middle: cn('rounded-none bg-accent-subtle', d.range_middle),
        range_end: cn('rounded-r-sm bg-accent-subtle', d.range_end),
        today: cn('[&>button]:shadow-[inset_0_-2px_var(--accent)]', d.today),
        outside: cn('text-muted-foreground/50 aria-selected:text-muted-foreground', d.outside),
        disabled: cn('text-muted-foreground opacity-40', d.disabled),
        hidden: cn('invisible', d.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className: c, rootRef, ...p }) => (
          <div data-slot="calendar" ref={rootRef} className={c} {...p} />
        ),
        Chevron: ({ className: c, orientation }) =>
          orientation === 'left' ? (
            <IconChevronLeft className={cn('size-3.5', c)} />
          ) : orientation === 'right' ? (
            <IconChevronRight className={cn('size-3.5', c)} />
          ) : (
            <IconChevronDown className={cn('size-3', c)} />
          ),
        DayButton: (p) => <CalendarDayButton locale={locale} {...p} />,
        WeekNumber: ({ children, ...p }) => (
          <td {...p}>
            <div className="flex size-(--cell-size) items-center justify-center">{children}</div>
          </td>
        ),
        ...components,
      }}
      {...props}
    />
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  locale,
  ...props
}: ComponentProps<typeof DayButton> & { locale?: { code?: string } }) {
  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString(locale?.code)}
      data-selected-single={
        modifiers.selected && !modifiers.range_start && !modifiers.range_end && !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        'tabular flex size-auto aspect-square w-full min-w-(--cell-size) rounded-sm text-xs font-normal text-foreground hover:bg-muted',
        'group-data-[focused=true]/day:ring-2 group-data-[focused=true]/day:ring-ring',
        'data-[selected-single=true]:bg-accent data-[selected-single=true]:text-accent-foreground',
        'data-[range-start=true]:bg-accent data-[range-start=true]:text-accent-foreground data-[range-end=true]:bg-accent data-[range-end=true]:text-accent-foreground',
        'data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-transparent',
        className,
      )}
      {...props}
    />
  )
}

type DateFieldProps = {
  placeholder?: string
  className?: string
  disabled?: boolean
  /** Inclusive bounds, "YYYY-MM-DD". */
  min?: string | null
  max?: string | null
  align?: 'start' | 'center' | 'end'
}

/** "YYYY-MM-DD" -> local Date (not new Date(str), which parses as UTC midnight). */
function toDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return undefined
  const parsed = new Date(y, m - 1, d)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function toValue(date: Date | undefined) {
  if (!date) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const bounds = (min: string | null | undefined, max: string | null | undefined) => {
  const before = toDate(min)
  const after = toDate(max)
  return [...(before ? [{ before }] : []), ...(after ? [{ after }] : [])]
}

const label = (value: string | null | undefined, placeholder: string) =>
  value
    ? toDate(value)?.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : placeholder

const triggerClass = (empty: boolean, className: string) =>
  cn('tabular justify-start gap-1.5 font-normal', empty && 'text-muted-foreground', className)

function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  className = '',
  disabled = false,
  min,
  max,
  align = 'start',
}: DateFieldProps & { value?: string | null; onChange: (value: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            className={triggerClass(!value, className)}
          />
        }
      >
        <IconCalendar className="size-3.5 shrink-0" />
        <span className="truncate">{label(value, placeholder)}</span>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto p-0">
        <Calendar
          mode="single"
          autoFocus
          defaultMonth={toDate(value)}
          selected={toDate(value)}
          onSelect={(date) => onChange(toValue(date))}
          disabled={bounds(min, max)}
          captionLayout="dropdown"
          startMonth={toDate(min) ?? new Date(1990, 0, 1)}
          endMonth={toDate(max) ?? new Date(new Date().getFullYear() + 1, 11, 31)}
        />
      </PopoverContent>
    </Popover>
  )
}

function DateRangePicker({
  from,
  to,
  onChange,
  placeholder = 'Pick a range',
  className = '',
  disabled = false,
  min,
  max,
  align = 'start',
  presets,
}: DateFieldProps & {
  from?: string | null
  to?: string | null
  onChange: (range: { from: string; to: string }) => void
  /** Quick ranges down the side: [{ label: '1M', from, to }]. New. */
  presets?: { label: string; from: string; to: string }[]
}) {
  const range = { from: toDate(from), to: toDate(to) }
  const text = from || to ? `${label(from, 'Start')} → ${label(to, 'End')}` : placeholder
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            className={triggerClass(!(from || to), className)}
          />
        }
      >
        <IconCalendar className="size-3.5 shrink-0" />
        <span className="truncate">{text}</span>
      </PopoverTrigger>
      <PopoverContent align={align} className="flex w-auto p-0">
        {presets && (
          <div className="flex flex-col gap-0.5 border-r border-border p-1.5">
            {presets.map((p) => (
              <Button
                key={p.label}
                variant={p.from === from && p.to === to ? 'secondary' : 'ghost'}
                size="xs"
                className="justify-start"
                onClick={() => onChange({ from: p.from, to: p.to })}
              >
                {p.label}
              </Button>
            ))}
          </div>
        )}
        <Calendar
          mode="range"
          autoFocus
          numberOfMonths={2}
          defaultMonth={range.from}
          selected={range}
          onSelect={(next) => onChange({ from: toValue(next?.from), to: toValue(next?.to) })}
          disabled={bounds(min, max)}
          captionLayout="dropdown"
          startMonth={toDate(min) ?? new Date(1990, 0, 1)}
          endMonth={toDate(max) ?? new Date(new Date().getFullYear() + 1, 11, 31)}
        />
      </PopoverContent>
    </Popover>
  )
}

export { Calendar, CalendarDayButton, DatePicker, DateRangePicker }
