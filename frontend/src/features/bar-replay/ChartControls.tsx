import { useState } from 'react'
import { ActivityIcon, CheckIcon, ChevronDownIcon, LayoutTemplateIcon, SaveIcon, SettingsIcon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getIntradayBars, getStockChart } from '@/services/api'
import IndicatorControls from './IndicatorControls'
import SettingsDialog from './SettingsDialog'
import { useChartTemplate } from './chartTemplates'
import { useBarReplayStore } from './store'

// Every timeframe a stock chart can show, fine -> coarse. The intraday ones are Bar Replay's
// (minute dataset, GET /api/prices/{symbol}/intraday); the rest are the chart endpoint's ranges
// (scraper.CHART_RANGES - 1d/5d are intraday bars, 5y weekly, max monthly).
export const CHART_TIMEFRAMES = [
  { value: '1m', label: '1m', intraday: true },
  { value: '5m', label: '5m', intraday: true },
  { value: '15m', label: '15m', intraday: true },
  { value: '1H', label: '1H', intraday: true },
  { value: '4H', label: '4H', intraday: true },
  { value: '1d', label: '1D' },
  { value: '5d', label: '5D' },
  { value: '1mo', label: '1MO' },
  { value: '6mo', label: '6MO' },
  { value: 'ytd', label: 'YTD' },
  { value: '1y', label: '1Y' },
  { value: '5y', label: '5Y' },
  { value: 'max', label: 'MAX' },
]

/** The query for one stock at one timeframe - shared so a host can prefetch or read the same cache
 *  entry the chart fills. The intraday key is Bar Replay's, so the two share the cache too. */
export const chartQuery = (symbol: string, tf: string) =>
  CHART_TIMEFRAMES.find((t) => t.value === tf)?.intraday
    ? { queryKey: ['intradayBars', symbol, tf], queryFn: () => getIntradayBars(symbol, tf) }
    : { queryKey: ['stockChart', symbol, tf], queryFn: () => getStockChart(symbol, tf) }

const TF_GROUPS = [
  { label: 'Intraday bars', items: CHART_TIMEFRAMES.filter((t) => t.intraday) },
  { label: 'Range', items: CHART_TIMEFRAMES.filter((t) => !t.intraday) },
]

/** The timeframe picker: one dropdown, intraday bar sizes and look-back ranges in two groups. */
export function TimeframeSelect({ value, onChange }: { value: string; onChange: (tf: string) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as string)}>
      <SelectTrigger size="sm" className="h-7 w-20 font-mono text-xs" title="Timeframe">
        <SelectValue>{(v: string) => CHART_TIMEFRAMES.find((t) => t.value === v)?.label ?? v}</SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {TF_GROUPS.map((g, i) => (
          <SelectGroup key={g.label}>
            {i > 0 && <SelectSeparator />}
            <SelectLabel>{g.label}</SelectLabel>
            {g.items.map((t) => (
              <SelectItem key={t.value} value={t.value} className="font-mono text-xs">
                {t.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Template picker, plus a Save button the moment the chart drifts from the applied template. */
export function TemplateMenu() {
  const { templates, active, dirty, apply, saveActive, saveAs } = useChartTemplate()
  const saveNew = () => {
    const name = window.prompt('Template name')?.trim()
    if (name) saveAs(name)
  }
  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" />}>
          <LayoutTemplateIcon className="size-3.5" />
          {active?.name ?? 'Template'}
          {dirty && <span className="text-muted-foreground">*</span>}
          <ChevronDownIcon className="size-3 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {templates.map((t) => (
            <DropdownMenuItem key={t.id} onClick={() => apply(t)}>
              {t.name}
              {t.id === active?.id && <CheckIcon className="ml-auto size-3.5" />}
            </DropdownMenuItem>
          ))}
          {templates.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={saveNew}>Save current as new…</DropdownMenuItem>
          <DropdownMenuItem render={<Link to="/settings" search={{ tab: 'chart-templates' }} />}>
            Manage templates…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {dirty && (
        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={saveActive}>
          <SaveIcon className="size-3.5" /> Save
        </Button>
      )}
    </div>
  )
}

/** Indicators, template and chart settings for any chart drawn from the Bar Replay store - the same
 *  config Bar Replay's bottom bar edits, so a change here shows on every chart. */
export function ChartControls() {
  const indicators = useBarReplayStore((s) => s.indicators)
  const setIndicators = useBarReplayStore((s) => s.setIndicators)
  const settings = useBarReplayStore((s) => s.settings)
  const setSettings = useBarReplayStore((s) => s.setSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger render={<Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" />}>
          <ActivityIcon className="size-3.5" />
          Indicators
          {indicators.length > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {indicators.length}
            </Badge>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80">
          <IndicatorControls indicators={indicators} onChange={setIndicators} />
        </PopoverContent>
      </Popover>
      <TemplateMenu />
      <Button size="icon-sm" variant="ghost" aria-label="Chart settings" onClick={() => setSettingsOpen(true)}>
        <SettingsIcon className="size-4" />
      </Button>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} onSave={setSettings} />
    </div>
  )
}
