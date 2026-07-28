import { useState } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { INDICATOR_COLORS, INDICATOR_TYPES } from '@/lib/indicators'

const DEFAULT_PERIOD = { ema: '20', sma: '20', rsi: '14' }

export default function IndicatorControls({ indicators, onChange }) {
  const [type, setType] = useState('ema')
  const [period, setPeriod] = useState(DEFAULT_PERIOD.ema)

  const changeType = (next) => {
    setType(next)
    setPeriod(DEFAULT_PERIOD[next] ?? '20')
  }

  const add = () => {
    const n = Number.parseInt(period, 10)
    if (n > 0) onChange([...indicators, { key: crypto.randomUUID(), type, period: n }])
  }
  const remove = (key) => onChange(indicators.filter((i) => i.key !== key))

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {indicators.map((ind, i) => (
        <span
          key={ind.key}
          className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
          style={{ color: INDICATOR_COLORS[i % INDICATOR_COLORS.length] }}
        >
          {INDICATOR_TYPES[ind.type].label} {ind.period}
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
        <Select value={type} onValueChange={changeType}>
          <SelectTrigger size="sm" className="h-6 w-20 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(INDICATOR_TYPES).map(([key, v]) => (
              <SelectItem key={key} value={key}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          min="1"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          placeholder="period"
          className="h-6 w-16 px-1.5 text-xs"
        />
        <Button variant="ghost" size="icon-sm" aria-label="Add indicator" onClick={add}>
          <PlusIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
