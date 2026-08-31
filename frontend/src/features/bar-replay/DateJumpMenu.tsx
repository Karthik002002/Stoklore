import { CalendarIcon, FlagIcon, ShuffleIcon } from 'lucide-react'
import DatePicker from '@/components/DatePicker'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// Picks a bar to jump to - by exact date, the earliest bar in the collected range, or a random
// one. The date picker sits in the menu itself rather than behind a hidden native input calling
// showPicker(): that trick needed a user gesture, wasn't supported everywhere, and put the one
// control in the app the user couldn't see coming.
export default function DateJumpMenu({
  bars,
  value,
  onSelect,
  triggerClassName,
  placeholder = 'Date…',
}: {
  /** The bars the picker can jump to. Every one carries a date - the daily path stores it
   *  directly, the intraday path stamps it (see lib/replay.ts). */
  bars: { date: string; time?: number | string }[]
  /** The currently-shown bar's date, as "YYYY-MM-DD". */
  value?: string | null
  onSelect: (date: string) => void
  triggerClassName?: string
  placeholder?: string
}) {
  const hasBars = bars.length > 0

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" className={triggerClassName}>
              <CalendarIcon className="size-3.5 text-muted-foreground" />
              <span className="truncate">{value || placeholder}</span>
            </Button>
          }
        />
        <DropdownMenuContent align="start">
          {/* Bounded to the bars actually collected - jumping to a date with no data is a jump
              to a blank chart. closeOnClick={false} so choosing a month doesn't shut the menu. */}
          <div className="p-1">
            <DatePicker
              value={value}
              onChange={(next) => next && onSelect(next)}
              placeholder="Date…"
              className="w-full"
              disabled={!hasBars}
              min={bars[0]?.date}
              max={bars[bars.length - 1]?.date}
            />
          </div>
          <DropdownMenuItem disabled={!hasBars} onClick={() => onSelect(bars[0].date)}>
            <FlagIcon /> First available date
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hasBars}
            onClick={() => onSelect(bars[Math.floor(Math.random() * bars.length)].date)}
          >
            <ShuffleIcon /> Random bar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
