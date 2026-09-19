import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlusIcon, Trash2Icon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { getDashboardFields, getDashboardParams, getDashboardSources } from '@/services/api'
import type { DashboardPanel, PanelOp, PanelQuery, PanelType } from '@/services/api'
import { PanelBody } from './panels'
import { PANEL_META, TYPE_SOURCE, missingParam } from './shared'
import type { PanelContext } from './shared'

// Editing one panel, live: every change lands on the board as you make it, and the preview at the
// top draws the panel with your change - there is no Apply, because the whole board already has Save
// and Discard. The fields offered come from the data itself: numbers to plot, text to group by.

const NONE = '__none__'
const OPS: { value: PanelOp; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'ne', label: '≠' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'contains', label: 'contains' },
  { value: 'in', label: 'one of' },
  { value: 'set', label: 'has a value' },
]
const AGGS = ['last', 'first', 'avg', 'sum', 'min', 'max', 'count'] as const
const BUCKETS = [
  { value: 'run', label: 'Per run' },
  { value: 'hour', label: 'Per hour' },
  { value: 'day', label: 'Per day' },
  { value: 'week', label: 'Per week' },
  { value: 'month', label: 'Per month' },
  { value: 'all', label: 'Whole range' },
] as const

const uses = (type: PanelType) => ({
  value: ['timeseries', 'stat', 'bar', 'pie', 'heatmap', 'treemap'].includes(type),
  size: type === 'treemap',
  group: ['timeseries', 'bar', 'pie', 'heatmap', 'treemap'].includes(type),
  bucket: ['timeseries', 'stat', 'heatmap'].includes(type),
  sort: ['bar', 'pie', 'table'].includes(type),
  limit: ['table', 'bar', 'pie', 'health', 'notifications', 'heatmap', 'treemap'].includes(type),
})

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5 border-t px-4 py-3">
      <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  )
}

export default function PanelEditor({
  panel,
  ctx,
  variableNames,
  onChange,
  onClose,
}: {
  panel: DashboardPanel
  ctx: PanelContext
  variableNames: string[]
  onChange: (panel: DashboardPanel) => void
  onClose: () => void
}) {
  const { data: catalogue } = useQuery({
    queryKey: ['dashboardSources'],
    queryFn: getDashboardSources,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const q = panel.query
  const source = catalogue?.sources.find((s) => s.id === q.source)
  const { data: options } = useQuery({
    queryKey: ['dashboardParams', q.source, q.params],
    queryFn: () => getDashboardParams(q.source, q.params ?? {}),
    enabled: !!q.source,
  })
  const ready = !missingParam(panel)
  const { data: fields = [] } = useQuery({
    queryKey: ['dashboardFields', q.source, q.params, ctx.variables],
    queryFn: () =>
      getDashboardFields({
        query: { source: q.source, params: q.params ?? {} },
        variables: ctx.variables,
        time_from: null,
        time_to: null,
      }),
    enabled: ready,
  })
  const numbers = fields.filter((f) => f.type === 'number')
  const groupable = fields.filter((f) => f.type !== 'time')
  const use = uses(panel.type)

  const set = (patch: Partial<DashboardPanel>) => onChange({ ...panel, ...patch })
  const setQuery = (patch: Partial<PanelQuery>) => onChange({ ...panel, query: { ...q, ...patch } })

  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const changeType = (type: PanelType) => {
    const forced = TYPE_SOURCE[type]
    onChange({
      ...panel,
      type,
      // Run health reads runs and notifications reads notifications - anything else would draw nothing.
      query: forced && q.source !== forced ? { source: forced, params: {}, limit: q.limit } : q,
    })
  }

  const filters = q.filters ?? []
  const setFilter = (i: number, patch: Partial<(typeof filters)[number]>) =>
    setQuery({ filters: filters.map((f, j) => (j === i ? { ...f, ...patch } : f)) })

  return (
    <aside
      aria-label="Edit panel"
      className="absolute inset-y-0 right-0 z-30 flex w-[26rem] max-w-full flex-col border-l bg-card shadow-2xl duration-200 animate-in fade-in-0 slide-in-from-right-8"
    >
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <p className="flex-1 text-sm font-medium">Edit panel</p>
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <XIcon />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="h-52 border-b bg-muted/20 p-3">
          <div className="flex h-full flex-col rounded-lg border bg-card p-2">
            <p className="mb-1 truncate text-xs font-medium">{panel.title || 'Untitled panel'}</p>
            <div className="min-h-0 flex-1">
              <PanelBody panel={panel} ctx={ctx} onDrill={() => {}} onOpenRow={() => {}} />
            </div>
          </div>
        </div>

        <section className="space-y-2.5 px-4 py-3">
          <Field label="Title">
            <Input
              id="panel-title"
              value={panel.title}
              onChange={(e) => set({ title: e.target.value })}
              className="h-8"
            />
          </Field>
          <Field label="Visualisation" hint={PANEL_META[panel.type].hint}>
            <div className="grid grid-cols-4 gap-1">
              {(Object.keys(PANEL_META) as PanelType[]).map((type) => {
                const meta = PANEL_META[type]
                return (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={panel.type === type}
                    onClick={() => changeType(type)}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 text-[10px] transition-colors hover:bg-muted',
                      panel.type === type && 'border-sky-500 bg-sky-500/10',
                    )}
                  >
                    <meta.icon className="size-4" />
                    <span className="truncate">{meta.label}</span>
                  </button>
                )
              })}
            </div>
          </Field>
        </section>

        <Section title="Data">
          <Field label="Source" hint={source?.description}>
            <Select
              value={q.source}
              onValueChange={(v) =>
                setQuery({ source: String(v), params: {}, value: null, group_by: null, filters: [] })
              }
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue placeholder="Pick a source" />
              </SelectTrigger>
              <SelectContent>
                {(catalogue?.sources ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {source?.params.map((param) => (
            <Field key={param.name} label={param.label}>
              <Select
                value={q.params?.[param.name] || NONE}
                onValueChange={(v) => {
                  const next = { ...(q.params ?? {}), [param.name]: v === NONE ? '' : String(v) }
                  // A different workflow has different series and fields.
                  if (param.name === 'workflow_id') next.series = ''
                  setQuery({ params: next })
                }}
              >
                <SelectTrigger className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={NONE}>
                    {param.required
                      ? 'Pick one…'
                      : param.name === 'series'
                        ? 'First series'
                        : 'All workflows'}
                  </SelectItem>
                  {(options?.[param.name] ?? []).map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ))}
        </Section>

        {ready && (use.value || use.group || use.bucket || use.sort || use.limit) && (
          <Section title="Query">
            {use.value && (
              <div className="grid grid-cols-2 gap-2">
                <Field label={panel.type === 'treemap' ? 'Colour by' : 'Value'}>
                  <Select
                    value={q.value || NONE}
                    onValueChange={(v) => setQuery({ value: v === NONE ? null : String(v) })}
                  >
                    <SelectTrigger className="h-8 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value={NONE}>Count rows</SelectItem>
                      {numbers.map((f) => (
                        <SelectItem key={f.name} value={f.name}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Aggregate">
                  <Select
                    value={q.value ? (q.agg ?? 'last') : 'count'}
                    disabled={!q.value}
                    onValueChange={(v) => setQuery({ agg: v as PanelQuery['agg'] })}
                  >
                    <SelectTrigger className="h-8 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AGGS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {a}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}
            {use.size && (
              <Field
                label="Tile size"
                hint="Turnover, market cap or volume make big names big; Equal gives every tile the same area."
              >
                <Select
                  value={q.size || NONE}
                  onValueChange={(v) => setQuery({ size: v === NONE ? null : String(v) })}
                >
                  <SelectTrigger className="h-8 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={NONE}>Equal</SelectItem>
                    {numbers.map((f) => (
                      <SelectItem key={f.name} value={f.name}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {(use.group || use.bucket) && (
              <div className="grid grid-cols-2 gap-2">
                {use.group && (
                  <Field
                    label={
                      panel.type === 'heatmap' ? 'Rows' : panel.type === 'treemap' ? 'A tile per' : 'Group by'
                    }
                  >
                    <Select
                      value={q.group_by || NONE}
                      onValueChange={(v) => setQuery({ group_by: v === NONE ? null : String(v) })}
                    >
                      <SelectTrigger className="h-8 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        <SelectItem value={NONE}>None</SelectItem>
                        {groupable.map((f) => (
                          <SelectItem key={f.name} value={f.name}>
                            {f.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                {use.bucket && (
                  <Field label="Over time">
                    <Select
                      value={q.bucket ?? (panel.type === 'heatmap' ? 'day' : 'run')}
                      onValueChange={(v) => setQuery({ bucket: v as PanelQuery['bucket'] })}
                    >
                      <SelectTrigger className="h-8 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BUCKETS.map((b) => (
                          <SelectItem key={b.value} value={b.value}>
                            {b.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </div>
            )}
            {(use.sort || use.limit) && (
              <div className="grid grid-cols-2 gap-2">
                {use.sort && (
                  <Field label="Order">
                    <Select
                      value={q.sort ?? 'desc'}
                      onValueChange={(v) => setQuery({ sort: v as PanelQuery['sort'] })}
                    >
                      <SelectTrigger className="h-8 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="desc">
                          {panel.type === 'table' ? 'Newest first' : 'Largest first'}
                        </SelectItem>
                        <SelectItem value="asc">
                          {panel.type === 'table' ? 'Oldest first' : 'Smallest first'}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                {use.limit && (
                  <Field label="Limit">
                    <Input
                      id="panel-limit"
                      type="number"
                      min={1}
                      max={5000}
                      value={q.limit ?? ''}
                      placeholder="No limit"
                      onChange={(e) =>
                        setQuery({ limit: e.target.value ? Math.max(1, Number(e.target.value)) : undefined })
                      }
                      className="h-8"
                    />
                  </Field>
                )}
              </div>
            )}
          </Section>
        )}

        {ready && (
          <Section title="Filters">
            {filters.map((f, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: filters are positional and have no id
              <div key={i} className="grid grid-cols-[1fr_4.5rem_1fr_auto] items-center gap-1">
                <Select
                  value={f.field || NONE}
                  onValueChange={(v) => setFilter(i, { field: v === NONE ? '' : String(v) })}
                >
                  <SelectTrigger className="h-8 w-full" aria-label="Field">
                    <SelectValue placeholder="Field" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {fields.map((field) => (
                      <SelectItem key={field.name} value={field.name}>
                        {field.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={f.op} onValueChange={(v) => setFilter(i, { op: v as PanelOp })}>
                  <SelectTrigger className="h-8 w-full" aria-label="Comparison">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPS.map((op) => (
                      <SelectItem key={op.value} value={op.value}>
                        {op.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  disabled={f.op === 'set'}
                  id={`filter-${i}`}
                  value={f.value}
                  onChange={(e) => setFilter(i, { value: e.target.value })}
                  placeholder="value or $var"
                  className="h-8 font-mono text-xs"
                  aria-label="Value"
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Remove filter"
                  onClick={() => setQuery({ filters: filters.filter((_, j) => j !== i) })}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setQuery({ filters: [...filters, { field: '', op: 'eq', value: '' }] })}
            >
              <PlusIcon className="size-3.5" />
              Add filter
            </Button>
            {variableNames.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Use {variableNames.map((n) => `$${n}`).join(', ')} as a value to follow the dropdown at the
                top — set to All, the filter drops out.
              </p>
            )}
          </Section>
        )}

        {!['table', 'health', 'notifications'].includes(panel.type) && (
          <Section title="Display">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Unit">
                <Input
                  id="panel-unit"
                  value={panel.options.unit ?? ''}
                  onChange={(e) => set({ options: { ...panel.options, unit: e.target.value } })}
                  placeholder="%, ₹, s"
                  className="h-8"
                />
              </Field>
              <Field label="Decimals">
                <Input
                  id="panel-decimals"
                  type="number"
                  min={0}
                  max={6}
                  value={panel.options.decimals ?? ''}
                  placeholder="Auto"
                  onChange={(e) =>
                    set({
                      options: {
                        ...panel.options,
                        decimals: e.target.value === '' ? undefined : Number(e.target.value),
                      },
                    })
                  }
                  className="h-8"
                />
              </Field>
            </div>
            {panel.type === 'treemap' && (
              <Field
                label="Colour scale (±)"
                hint="The move that shows full green or red. Blank uses the largest one."
              >
                <Input
                  id="panel-scale"
                  type="number"
                  min={0}
                  value={panel.options.scale ?? ''}
                  placeholder="Auto"
                  onChange={(e) =>
                    set({
                      options: {
                        ...panel.options,
                        scale: e.target.value === '' ? undefined : Math.abs(Number(e.target.value)),
                      },
                    })
                  }
                  className="h-8"
                />
              </Field>
            )}
            {panel.type === 'stat' && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  id="panel-tone"
                  type="checkbox"
                  className="accent-sky-500"
                  checked={panel.options.tone === 'bad'}
                  onChange={(e) =>
                    set({ options: { ...panel.options, tone: e.target.checked ? 'bad' : undefined } })
                  }
                />
                A rise is bad (failures, durations) — show it red
              </label>
            )}
          </Section>
        )}
      </div>
    </aside>
  )
}
