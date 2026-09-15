import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import TagInput from '@/components/TagInput'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { getAlerts, getWorkflowCatalogue, getWorkflows, previewTrigger } from '@/services/api'
import type { WorkflowTrigger, WorkflowTriggerKind } from '@/services/api'
import { TIME_KINDS, formatRelative, formatSlot } from './status'

// Picking what sets a workflow off. Each kind shows only its own fields, and a preview underneath
// asks the server what those fields MEAN - the next five runs, holidays skipped - so "the 31st",
// a window that ends before it starts, or a cron typo shows its consequence before anything is
// armed. The server does the calendar maths; this form never duplicates it.

const KINDS: { kind: WorkflowTriggerKind; label: string }[] = [
  { kind: 'manual', label: 'Manual only' },
  { kind: 'schedule', label: 'Daily at a time' },
  { kind: 'interval', label: 'Every N minutes / hours' },
  { kind: 'weekly', label: 'Weekly on chosen days' },
  { kind: 'monthly', label: 'Monthly on a date' },
  { kind: 'market', label: 'Around the market open / close' },
  { kind: 'cron', label: 'Cron expression' },
  { kind: 'event_scan', label: 'After the daily event scan' },
  { kind: 'price_alert', label: 'When a price alert fires' },
  { kind: 'order_event', label: 'On a live order event' },
  { kind: 'workflow_done', label: 'After another workflow' },
]

/** What switching to a kind starts from - a sensible, valid trigger, never an empty one. */
const DEFAULTS: Record<WorkflowTriggerKind, WorkflowTrigger> = {
  manual: { kind: 'manual' },
  schedule: { kind: 'schedule', time: '09:15' },
  interval: {
    kind: 'interval',
    every: 15,
    unit: 'minutes',
    window: { start: '09:15', end: '15:30' },
    trading_days_only: true,
  },
  weekly: { kind: 'weekly', days: [0], time: '08:30' },
  monthly: { kind: 'monthly', day: 1, time: '10:00' },
  market: { kind: 'market', anchor: 'open', offset: 5 },
  cron: { kind: 'cron', expr: '*/15 9-15 * * 1-5' },
  event_scan: { kind: 'event_scan' },
  price_alert: { kind: 'price_alert', alert_ids: [], symbols: [] },
  order_event: { kind: 'order_event', events: ['filled'] },
  workflow_done: { kind: 'workflow_done', workflow_id: '', on: 'success' },
}

/** What the trigger node hands downstream - app/services/workflow_triggers.py sets these. */
const PAYLOAD: Record<WorkflowTriggerKind, string[]> = {
  manual: ['started_at'],
  schedule: ['scheduled_for'],
  interval: ['scheduled_for'],
  weekly: ['scheduled_for'],
  monthly: ['scheduled_for'],
  market: ['scheduled_for'],
  cron: ['scheduled_for'],
  event_scan: ['started_at'],
  price_alert: ['symbol', 'price', 'condition', 'message', 'alert_id'],
  order_event: ['event', 'symbol', 'message', 'order_id'],
  workflow_done: ['workflow_name', 'status', 'summary', 'run_id'],
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function useDebounced<T>(value: T, ms: number) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}

export function Check({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2 text-xs',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  )
}

export function Chip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={cn(
        'rounded-md border px-2 py-0.5 text-[11px] transition-colors',
        active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}

const toggleIn = <T,>(list: T[], item: T) =>
  list.includes(item) ? list.filter((x) => x !== item) : [...list, item]

export default function TriggerForm({
  value,
  onChange,
  workflowId,
  triggerNodeId,
}: {
  value: WorkflowTrigger
  onChange: (trigger: WorkflowTrigger) => void
  /** This workflow, so it can't be chained after itself. */
  workflowId?: string
  /** The graph's trigger node, so the template hint names a reference that actually resolves. */
  triggerNodeId?: string
}) {
  const kind = value.kind
  const set = (patch: Partial<WorkflowTrigger>) => onChange({ ...value, ...patch })
  const isTime = TIME_KINDS.includes(kind)

  const { data: catalogue } = useQuery({ queryKey: ['workflowCatalogue'], queryFn: getWorkflowCatalogue })
  const { data: workflows = [] } = useQuery({
    queryKey: ['workflows'],
    queryFn: getWorkflows,
    enabled: kind === 'workflow_done',
  })
  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts', 'price'],
    queryFn: () => getAlerts({ kind: 'price', limit: 200 }),
    enabled: kind === 'price_alert',
  })

  const settled = useDebounced(JSON.stringify(value), 350)
  const { data: preview, isFetching } = useQuery({
    queryKey: ['triggerPreview', settled],
    queryFn: () => previewTrigger(JSON.parse(settled)),
    enabled: kind !== 'manual',
    placeholderData: keepPreviousData,
  })

  const changeKind = (next: WorkflowTriggerKind) =>
    // A time typed for one clock kind carries over to the next, rather than resetting to a default.
    onChange({
      ...DEFAULTS[next],
      ...(value.time && DEFAULTS[next].time ? { time: value.time } : {}),
    })

  const time = (
    <Input
      type="time"
      value={value.time ?? '09:15'}
      onChange={(e) => set({ time: e.target.value })}
      className="h-8"
      aria-label="Time (IST)"
    />
  )

  return (
    <div className="space-y-2.5">
      <Select value={kind} onValueChange={(v) => changeKind(v as WorkflowTriggerKind)}>
        <SelectTrigger className="w-full" aria-label="Trigger">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {KINDS.map((k) => (
            <SelectItem key={k.kind} value={k.kind}>
              {k.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {kind === 'schedule' && <Field label="At (IST)">{time}</Field>}

      {kind === 'interval' && (
        <>
          <Field label="Repeat every">
            <div className="flex gap-1.5">
              <Input
                type="number"
                min={1}
                value={value.every ?? 15}
                onChange={(e) => set({ every: Math.max(1, Number(e.target.value) || 1) })}
                className="h-8 w-20"
                aria-label="Every"
              />
              <Select
                value={value.unit ?? 'minutes'}
                onValueChange={(v) => set({ unit: v as 'minutes' | 'hours' })}
              >
                <SelectTrigger className="h-8 flex-1" aria-label="Unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">minutes</SelectItem>
                  <SelectItem value="hours">hours</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Field>
          <Check
            checked={!!value.window}
            onChange={(on) => set({ window: on ? { start: '09:15', end: '15:30' } : null })}
          >
            Only between
          </Check>
          {value.window && (
            <div className="flex items-center gap-1.5">
              <Input
                type="time"
                value={value.window.start}
                onChange={(e) =>
                  set({ window: { ...(value.window ?? { end: '15:30' }), start: e.target.value } })
                }
                className="h-8"
                aria-label="Window start"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <Input
                type="time"
                value={value.window.end}
                onChange={(e) =>
                  set({ window: { ...(value.window ?? { start: '09:15' }), end: e.target.value } })
                }
                className="h-8"
                aria-label="Window end"
              />
            </div>
          )}
        </>
      )}

      {kind === 'weekly' && (
        <>
          <Field label="On">
            <div className="flex flex-wrap gap-1">
              {WEEKDAYS.map((d, i) => (
                <Chip
                  key={d}
                  active={(value.days ?? []).includes(i)}
                  onClick={() => set({ days: toggleIn(value.days ?? [], i).sort() })}
                >
                  {d}
                </Chip>
              ))}
            </div>
          </Field>
          <Field label="At (IST)">{time}</Field>
        </>
      )}

      {kind === 'monthly' && (
        <>
          <Field label="On day">
            <Select
              value={String(value.day ?? 1)}
              onValueChange={(v) => set({ day: v === 'last' ? 'last' : Number(v) })}
            >
              <SelectTrigger className="h-8 w-full" aria-label="Day of month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 31 }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {i + 1}
                  </SelectItem>
                ))}
                <SelectItem value="last">Last day of the month</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="At (IST)">{time}</Field>
          {typeof value.day === 'number' && value.day > 28 && (
            <p className="text-[11px] text-muted-foreground">Shorter months run on their last day.</p>
          )}
        </>
      )}

      {kind === 'market' && (
        <Field label="Minutes from the">
          <div className="flex gap-1.5">
            <Select
              value={value.anchor ?? 'open'}
              onValueChange={(v) => set({ anchor: v as 'open' | 'close' })}
            >
              <SelectTrigger className="h-8 flex-1" aria-label="Anchor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">open (09:15)</SelectItem>
                <SelectItem value="close">close (15:30)</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number"
              value={value.offset ?? 0}
              onChange={(e) => set({ offset: Number(e.target.value) || 0 })}
              className="h-8 w-20"
              aria-label="Offset in minutes"
              title="Negative runs before it"
            />
          </div>
        </Field>
      )}

      {kind === 'cron' && (
        <Field label="minute hour day month weekday">
          <Input
            value={value.expr ?? ''}
            onChange={(e) => set({ expr: e.target.value })}
            placeholder="*/15 9-15 * * 1-5"
            className="h-8 font-mono text-xs"
            aria-label="Cron expression"
          />
        </Field>
      )}

      {isTime && kind !== 'market' && (
        <Check checked={!!value.trading_days_only} onChange={(on) => set({ trading_days_only: on })}>
          Trading days only — skips weekends and NSE holidays
        </Check>
      )}

      {kind === 'price_alert' && (
        <>
          <Field label="Which alerts (none picked = any)">
            <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
              {alerts
                .filter((a) => a.kind === 'price' && a.active)
                .map((a) => (
                  <Chip
                    key={a.id}
                    active={(value.alert_ids ?? []).includes(a.id)}
                    onClick={() => set({ alert_ids: toggleIn(value.alert_ids ?? [], a.id) })}
                    title={a.note ?? undefined}
                  >
                    {a.symbol} · {a.condition}
                    {a.price != null ? ` ${a.price}` : ''}
                  </Chip>
                ))}
              {!alerts.some((a) => a.kind === 'price' && a.active) && (
                <p className="text-[11px] text-muted-foreground">
                  No armed price alerts — any that fire later count.
                </p>
              )}
            </div>
          </Field>
          <Field label="Only for symbols (optional)">
            <TagInput
              value={value.symbols ?? []}
              onChange={(symbols) => set({ symbols: symbols.map((s) => s.toUpperCase()) })}
              placeholder="RELIANCE, Enter…"
            />
          </Field>
        </>
      )}

      {kind === 'order_event' && (
        <Field label="On (none picked = any)">
          <div className="flex flex-wrap gap-1">
            {(catalogue?.order_events ?? []).map((e) => (
              <Chip
                key={e}
                active={(value.events ?? []).includes(e)}
                onClick={() => set({ events: toggleIn(value.events ?? [], e) })}
              >
                {e}
              </Chip>
            ))}
          </div>
        </Field>
      )}

      {kind === 'workflow_done' && (
        <>
          <Field label="After">
            <Select
              value={value.workflow_id || undefined}
              onValueChange={(v) => set({ workflow_id: v as string })}
            >
              <SelectTrigger className="h-8 w-full" aria-label="Upstream workflow">
                <SelectValue placeholder="Pick a workflow" />
              </SelectTrigger>
              <SelectContent>
                {workflows
                  .filter((w) => w.id !== workflowId)
                  .map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="When it">
            <Select
              value={value.on ?? 'success'}
              onValueChange={(v) => set({ on: v as WorkflowTrigger['on'] })}
            >
              <SelectTrigger className="h-8 w-full" aria-label="Run on">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="success">succeeds</SelectItem>
                <SelectItem value="failure">fails</SelectItem>
                <SelectItem value="any">finishes either way</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </>
      )}

      {kind !== 'manual' && (
        <div className="space-y-1.5 rounded-lg border bg-background/60 p-2 text-[11px]" aria-live="polite">
          {preview?.error ? (
            <p className="text-down">{preview.error}</p>
          ) : isTime ? (
            <>
              <p className="flex items-center justify-between font-medium">
                Next runs
                {isFetching && <Spinner className="size-3" />}
              </p>
              {preview?.next.length ? (
                <ol className="space-y-0.5 tabular-nums">
                  {preview.next.map((iso, i) => (
                    <li key={iso} className="flex justify-between gap-2">
                      <span className={i ? 'text-muted-foreground' : ''}>{formatSlot(iso)}</span>
                      {i === 0 && <span className="text-muted-foreground">{formatRelative(iso)}</span>}
                    </li>
                  ))}
                </ol>
              ) : (
                !isFetching && <p className="text-muted-foreground">No upcoming runs.</p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">
              Runs each time it happens. One run at a time — an event during a run is skipped.
            </p>
          )}
          <p className="text-muted-foreground">
            In templates:{' '}
            {PAYLOAD[kind].map((field) => (
              <code
                key={field}
                className="mr-1 break-all"
              >{`{{ ${triggerNodeId ?? 'trigger'}.${field} }}`}</code>
            ))}
          </p>
        </div>
      )}
    </div>
  )
}
