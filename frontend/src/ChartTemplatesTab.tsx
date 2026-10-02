import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PaletteIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import IndicatorControls from '@/features/bar-replay/IndicatorControls'
import ReplayChart from '@/features/bar-replay/ReplayChart'
import SettingsDialog from '@/features/bar-replay/SettingsDialog'
import { TimeframeButtons, chartQuery } from '@/features/bar-replay/ChartControls'
import { styleOf, useChartTemplate, useChartTemplates } from '@/features/bar-replay/chartTemplates'
import { DEFAULT_CHART_SETTINGS } from '@/features/bar-replay/store'
import type { ChartTemplate } from '@/features/bar-replay/chartTemplates'
import type { ReplayBar } from '@/features/bar-replay/store'

/** Settings > Chart templates: named indicator + candle-style setups, edited against a live preview
 *  and applied to every chart (Bar Replay, position, scan and modal charts all read the one store). */
export default function ChartTemplatesTab() {
  const { templates, upsert, remove } = useChartTemplates()
  const { active, apply, saveAs } = useChartTemplate()
  const [selectedId, setSelectedId] = useState<string | null>(active?.id ?? templates[0]?.id ?? null)
  const selected = templates.find((t) => t.id === selectedId) ?? null
  const [draft, setDraft] = useState<ChartTemplate | null>(selected)
  useEffect(() => setDraft(selected), [selected])
  const changed = !!draft && JSON.stringify(draft) !== JSON.stringify(selected)

  const [styleOpen, setStyleOpen] = useState(false)
  const [symbol, setSymbol] = useState('RELIANCE')
  const [tf, setTf] = useState('6mo')
  const { data, isPending, isError } = useQuery({ ...chartQuery(symbol, tf), enabled: !!symbol })
  const bars = (data?.bars ?? []) as unknown as ReplayBar[]
  const draftSettings = { ...DEFAULT_CHART_SETTINGS, ...draft?.style }

  const create = (fromChart: boolean) => {
    const name = window.prompt('Template name')?.trim()
    if (!name) return
    if (fromChart) saveAs(name)
    else upsert({ id: crypto.randomUUID(), name, indicators: [], style: styleOf(DEFAULT_CHART_SETTINGS) })
    setSelectedId(useChartTemplates.getState().templates.at(-1)!.id)
  }

  return (
    <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
      <div className="space-y-2">
        <div className="flex gap-1">
          <Button size="sm" variant="outline" className="flex-1" onClick={() => create(true)}>
            <PlusIcon className="size-3.5" /> From chart
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={() => create(false)}>
            <PlusIcon className="size-3.5" /> Blank
          </Button>
        </div>
        {templates.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No templates yet. "From chart" saves the indicators and candle style every chart uses right now.
          </p>
        )}
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSelectedId(t.id)}
            className={cn(
              'flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-sm',
              t.id === selectedId ? 'border-primary bg-muted' : 'hover:bg-muted/50',
            )}
          >
            <span className="truncate">{t.name}</span>
            <span className="text-xs text-muted-foreground">
              {t.id === active?.id ? 'in use' : `${t.indicators.length} ind.`}
            </span>
          </button>
        ))}
      </div>

      {draft ? (
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="h-8 w-56"
              aria-label="Template name"
            />
            <Button size="sm" variant="outline" onClick={() => setStyleOpen(true)}>
              <PaletteIcon className="size-3.5" /> Candles & levels
            </Button>
            <div className="ml-auto flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                aria-label="Delete template"
                onClick={() => window.confirm(`Delete template "${draft.name}"?`) && remove(draft.id)}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
              <Button size="sm" variant="outline" disabled={!changed || !draft.name.trim()} onClick={() => upsert(draft)}>
                Save
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (changed) upsert(draft)
                  apply(draft)
                  toast.success(`"${draft.name}" applied to charts`)
                }}
              >
                {changed ? 'Save & apply' : 'Apply'}
              </Button>
            </div>
          </div>
          <IndicatorControls indicators={draft.indicators} onChange={(indicators) => setDraft({ ...draft, indicators })} />

          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase().trim())}
              className="h-7 w-32 font-mono text-xs"
              aria-label="Preview symbol"
            />
            <TimeframeButtons value={tf} onChange={setTf} />
          </div>
          <div className="relative h-[28rem] overflow-hidden rounded-md border">
            {isPending ? (
              <p className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-4" /> Loading {symbol}…
              </p>
            ) : isError || bars.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No price history for {symbol}.
              </p>
            ) : (
              <ReplayChart
                bars={bars}
                indicators={draft.indicators}
                orders={[]}
                settings={draftSettings}
                resetKey={`${symbol}-${tf}`}
                readOnly
              />
            )}
          </div>

          <SettingsDialog
            open={styleOpen}
            onOpenChange={setStyleOpen}
            settings={draftSettings}
            onSave={(s) => setDraft({ ...draft, style: styleOf(s) })}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Pick or create a template to edit and preview it.</p>
      )}
    </div>
  )
}
