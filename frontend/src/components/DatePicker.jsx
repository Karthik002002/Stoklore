import { CalendarIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

// The app's one date control, on top of shadcn's Calendar (components/ui/calendar.jsx, added
// through the CLI so it matches the project's base-nova style).
//
// It replaced <input type="date"> everywhere. The native control was fine functionally but looked
// different in every browser, couldn't be styled to match the rest of the app, and on Firefox/Linux
// is a bare text box - a date picker that renders as a text box is how you get a filter nobody uses.
//
// Values in and out are "YYYY-MM-DD" STRINGS, not Date objects, because that is what every caller
// already had: the API sends and receives them, react-hook-form stores them, and the URL carries
// them. Converting at the edges here keeps that single representation instead of spreading Date
// juggling across five call sites.

// Not exported: the whole app speaks "YYYY-MM-DD" and only this file needs Date objects, so
// keeping them private also keeps fast refresh working for the components below.
/** "YYYY-MM-DD" -> Date, in the LOCAL timezone. Deliberately not new Date("2026-08-25"), which the
 *  spec parses as UTC midnight and renders as the 24th anywhere west of Greenwich. */
function toDate(value) {
  if (!value) return undefined
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return undefined
  const parsed = new Date(y, m - 1, d)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

/** Date -> "YYYY-MM-DD", local again for the same reason. */
function toValue(date) {
  if (!date) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const label = (value, placeholder) =>
  value
    ? toDate(value)?.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : placeholder

/** One date. `value`/`onChange` speak "YYYY-MM-DD"; `min`/`max` bound the selectable range. */
export default function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  className = '',
  disabled = false,
  min,
  max,
  align = 'start',
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            className={`justify-start gap-1.5 font-normal ${value ? '' : 'text-muted-foreground'} ${className}`}
          />
        }
      >
        <CalendarIcon className="size-3.5 shrink-0" />
        <span className="truncate">{label(value, placeholder)}</span>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto p-0">
        <Calendar
          mode="single"
          autoFocus
          // Opens on the month being edited rather than on today - a jump to a 2013 replay bar
          // otherwise starts thirteen years of clicking away from itself.
          defaultMonth={toDate(value)}
          selected={toDate(value)}
          onSelect={(date) => onChange(toValue(date))}
          disabled={[...(min ? [{ before: toDate(min) }] : []), ...(max ? [{ after: toDate(max) }] : [])]}
          captionLayout="dropdown"
          startMonth={toDate(min) ?? new Date(1990, 0, 1)}
          endMonth={toDate(max) ?? new Date(new Date().getFullYear() + 1, 11, 31)}
        />
      </PopoverContent>
    </Popover>
  )
}

/** A from/to pair in ONE popover, so picking a range is one gesture instead of two menus and a
 *  mental note. Reports `{ from, to }` as the same "YYYY-MM-DD" strings; either end may be empty
 *  while the range is half-picked, and callers are expected to tolerate that rather than fire a
 *  request on a partial range. */
export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder = 'Pick a range',
  className = '',
  disabled = false,
  min,
  max,
  align = 'start',
}) {
  const range = { from: toDate(from), to: toDate(to) }
  const text = from || to ? `${label(from, 'Start') ?? 'Start'} → ${label(to, 'End') ?? 'End'}` : placeholder

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            className={`justify-start gap-1.5 font-normal ${from || to ? '' : 'text-muted-foreground'} ${className}`}
          />
        }
      >
        <CalendarIcon className="size-3.5 shrink-0" />
        <span className="truncate">{text}</span>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto p-0">
        <Calendar
          mode="range"
          autoFocus
          numberOfMonths={2}
          defaultMonth={range.from}
          selected={range}
          onSelect={(next) => onChange({ from: toValue(next?.from), to: toValue(next?.to) })}
          disabled={[...(min ? [{ before: toDate(min) }] : []), ...(max ? [{ after: toDate(max) }] : [])]}
          captionLayout="dropdown"
          startMonth={toDate(min) ?? new Date(1990, 0, 1)}
          endMonth={toDate(max) ?? new Date(new Date().getFullYear() + 1, 11, 31)}
        />
      </PopoverContent>
    </Popover>
  )
}
