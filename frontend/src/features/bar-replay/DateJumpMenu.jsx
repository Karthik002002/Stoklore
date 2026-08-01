import { useRef } from 'react'
import { CalendarIcon, FlagIcon, ShuffleIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// Picks a bar to jump to - by exact date, the earliest bar in the collected range, or a random
// one. A hidden native date input backs the "Date…" option since the browser's own picker is
// still the best UI for that; the other two resolve to a date immediately, no picker needed.
export default function DateJumpMenu({ bars, value, onSelect, triggerClassName, placeholder = 'Date…' }) {
  const dateInputRef = useRef(null)
  const hasBars = bars.length > 0

  const openDatePicker = () => {
    const input = dateInputRef.current
    if (!input) return
    // showPicker needs a user gesture; this fires from the menu item's own click so it still
    // qualifies. Not every browser supports it (Safari didn't until recently) - .click() is the
    // fallback there.
    if (input.showPicker) input.showPicker()
    else input.click()
  }

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
          <DropdownMenuItem onClick={openDatePicker}>
            <CalendarIcon /> Date…
          </DropdownMenuItem>
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
      {/* sr-only, not display:none - some browsers refuse showPicker() on a display:none input */}
      <input
        ref={dateInputRef}
        type="date"
        className="sr-only"
        tabIndex={-1}
        min={bars[0]?.date}
        max={bars[bars.length - 1]?.date}
        onChange={(e) => e.target.value && onSelect(e.target.value)}
      />
    </>
  )
}
