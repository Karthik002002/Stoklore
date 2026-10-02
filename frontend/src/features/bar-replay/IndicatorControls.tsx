import type { IndicatorConfig } from './store'
import { useState } from 'react'
import { CheckIcon, ChevronsUpDownIcon, EyeOffIcon, PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { INDICATOR_TYPES, indicatorLineColor } from '@/lib/indicators'
import { cn } from '@/lib/utils'

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

const STYLES = [
  { value: 0, label: 'Solid' },
  { value: 1, label: 'Dotted' },
  { value: 2, label: 'Dashed' },
]

/** Everything about one indicator on the chart: period, line colours, width, style, levels. Edits
 *  apply as they're made - the chart is the preview. */
function IndicatorEditor({
  ind,
  index,
  onChange,
}: {
  ind: IndicatorConfig
  index: number
  onChange: (next: IndicatorConfig) => void
}) {
  const type = INDICATOR_TYPES[ind.type]
  const lines = type.lines ?? [{ key: '', label: 'Line' }]
  const defaultLevels = ind.type === 'rsi' ? 'RSI levels in Settings' : (type.levels ?? []).join(', ') || 'none'
  const [levelsText, setLevelsText] = useState(ind.levels?.join(', ') ?? '')
  const commitLevels = () => {
    const parsed = levelsText
      .split(',')
      .map((x) => Number.parseFloat(x))
      .filter((x) => Number.isFinite(x))
    onChange({ ...ind, levels: levelsText.trim() ? parsed : undefined })
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border p-2 text-xs">
      {!type.periodless && (
        <label className="flex items-center justify-between">
          Period
          <Input
            type="number"
            min="1"
            defaultValue={ind.period ?? ''}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10)
              if (n > 0) onChange({ ...ind, period: n })
            }}
            className="h-6 w-16 px-1.5 text-xs"
          />
        </label>
      )}
      {lines.map((line, li) => (
        <label key={line.key} className="flex items-center justify-between">
          {lines.length > 1 ? line.label : 'Colour'}
          <input
            type="color"
            value={indicatorLineColor(ind, index, { ...line, key: line.key || null }, li)}
            onChange={(e) => onChange({ ...ind, colors: { ...ind.colors, [line.key]: e.target.value } })}
            className="h-6 w-10 cursor-pointer rounded border bg-transparent p-0.5"
          />
        </label>
      ))}
      <div className="flex items-center justify-between">
        Width
        <div className="flex gap-0.5">
          {[1, 2, 3, 4].map((w) => (
            <Button
              key={w}
              size="sm"
              variant={(ind.lineWidth ?? 1) === w ? 'secondary' : 'ghost'}
              className="h-6 w-6 px-0 text-xs"
              onClick={() => onChange({ ...ind, lineWidth: w })}
            >
              {w}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between">
        Style
        <div className="flex gap-0.5">
          {STYLES.map((st) => (
            <Button
              key={st.value}
              size="sm"
              variant={ind.lineStyle === st.value ? 'secondary' : 'ghost'}
              className="h-6 px-1.5 text-xs"
              onClick={() => onChange({ ...ind, lineStyle: ind.lineStyle === st.value ? undefined : st.value })}
            >
              {st.label}
            </Button>
          ))}
        </div>
      </div>
      {type.pane === 'separate' && (
        <label className="flex items-center justify-between gap-2">
          Levels
          <Input
            value={levelsText}
            onChange={(e) => setLevelsText(e.target.value)}
            onBlur={commitLevels}
            onKeyDown={(e) => e.key === 'Enter' && commitLevels()}
            placeholder={defaultLevels}
            className="h-6 w-40 px-1.5 text-xs"
          />
        </label>
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={!!ind.hidden} onChange={(e) => onChange({ ...ind, hidden: e.target.checked })} />
        Hide
      </label>
    </div>
  )
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
  // The chip whose properties are open below the list.
  const [editing, setEditing] = useState<string | null>(null)
  const editingIndex = indicators.findIndex((i) => i.key === editing)

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
  const update = (next: IndicatorConfig) => onChange(indicators.map((i) => (i.key === next.key ? next : i)))

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {indicators.map((ind, i) => (
        <span
          key={ind.key}
          className={cn(
            'flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
            editing === ind.key && 'border-foreground',
            ind.hidden && 'opacity-50',
          )}
          style={{ color: indicatorLineColor(ind, i, { key: INDICATOR_TYPES[ind.type].lines?.[0]?.key ?? null, color: INDICATOR_TYPES[ind.type].lines?.[0]?.color }, 0) }}
        >
          <button
            type="button"
            title="Edit properties"
            className="flex items-center gap-1"
            onClick={() => setEditing(editing === ind.key ? null : ind.key)}
          >
            {ind.hidden && <EyeOffIcon className="size-3" />}
            {INDICATOR_TYPES[ind.type].label}
            {ind.period ? ` ${ind.period}` : ''}
          </button>
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
      {editingIndex >= 0 && (
        <div className="basis-full">
          <IndicatorEditor key={editing} ind={indicators[editingIndex]} index={editingIndex} onChange={update} />
        </div>
      )}
    </div>
  )
}
