import type { IndicatorConfig } from './store'
import { useState } from 'react'
import { CheckIcon, ChevronsUpDownIcon, PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { INDICATOR_COLORS, INDICATOR_TYPES } from '@/lib/indicators'

// Conventional defaults per type - what each indicator is normally read at, so adding one from
// the dropdown gives the standard reading rather than whatever the previous pick left behind.
// Anything missing falls back to 20; periodless types ignore this entirely.
const DEFAULT_PERIOD: Record<string, string> = {
  ema: '20',
  sma: '20',
  rsi: '14',
  adx: '14',
  stochastic: '14',
  williamsR: '14',
  atr: '14',
  mfi: '14',
  bollinger: '20',
  keltner: '20',
  donchian: '20',
  relVolume: '20',
  hma: '20',
  kama: '10',
  cmo: '14',
  velocity: '5',
  volumeClimax: '20',
  correlation: '20',
  zScore: '20',
  autocorrelation: '20',
  volatility: '20',
  marketStructure: '20',
}

export default function IndicatorControls({
  indicators,
  onChange,
}: {
  indicators: IndicatorConfig[]
  onChange: (indicators: IndicatorConfig[]) => void
}) {
  const [type, setType] = useState('ema')
  const [period, setPeriod] = useState(DEFAULT_PERIOD.ema)
  const [pickerOpen, setPickerOpen] = useState(false)

  // Some indicators read each bar on its own terms (candle shape) or key off the session boundary
  // (previous-day levels) - there's no lookback to configure, so the period input is hidden and
  // they're stored with period: null rather than a number nothing reads.
  const periodless = !!INDICATOR_TYPES[type]?.periodless

  const changeType = (next: string) => {
    setType(next)
    setPeriod(DEFAULT_PERIOD[next] ?? '20')
  }

  const add = () => {
    if (periodless) {
      onChange([...indicators, { key: crypto.randomUUID(), type, period: null }])
      return
    }
    const n = Number.parseInt(period, 10)
    if (n > 0) onChange([...indicators, { key: crypto.randomUUID(), type, period: n }])
  }
  const remove = (key: string) => onChange(indicators.filter((i) => i.key !== key))

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {indicators.map((ind, i) => (
        <span
          key={ind.key}
          className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
          style={{ color: INDICATOR_COLORS[i % INDICATOR_COLORS.length] }}
        >
          {INDICATOR_TYPES[ind.type].label}
          {ind.period ? ` ${ind.period}` : ''}
          <button
            type="button"
            aria-label={`Remove ${ind.type} ${ind.period}`}
            onClick={() => remove(ind.key)}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      <div className="flex items-center gap-1.5">
        {/* A searchable combobox rather than a plain Select: the registry is 30+ entries now, and
            scrolling a flat list to find "Autocorrelation" is worse than typing three letters of
            it. Same Command-over-Popover shape as SymbolCombobox, and cmdk does the filtering
            since the list is local and fixed. */}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="h-6 w-36 justify-between px-2 text-xs font-normal"
              />
            }
          >
            {INDICATOR_TYPES[type].label}
            <ChevronsUpDownIcon className="size-3 opacity-50" />
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search indicator…" />
              <CommandList>
                <CommandEmpty>No matches.</CommandEmpty>
                {Object.entries(INDICATOR_TYPES).map(([key, v]) => (
                  <CommandItem
                    key={key}
                    value={v.label}
                    onSelect={() => {
                      changeType(key)
                      setPickerOpen(false)
                    }}
                  >
                    {v.label}
                    {key === type && <CheckIcon className="ml-auto size-3.5" />}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {!periodless && (
          <Input
            type="number"
            min="1"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder="period"
            className="h-6 w-16 px-1.5 text-xs"
          />
        )}
        <Button variant="ghost" size="icon-sm" aria-label="Add indicator" onClick={add}>
          <PlusIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
