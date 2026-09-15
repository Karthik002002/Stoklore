import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { BellIcon, CheckCheckIcon, CircleCheckIcon, CircleXIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import DataTable from '@/components/DataTable'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { formatDateTime, formatDuration, timeAgoShort } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  deleteWorkflowNotification,
  getRunWorkflow,
  getTelegramConfig,
  getWorkflowNotifications,
  getWorkflowSeries,
  readWorkflowNotifications,
  saveWorkflowNotify,
} from '@/services/api'
import type { Workflow, WorkflowNotification, WorkflowNotify } from '@/services/api'
import { Block } from './RunDiagram'
import { POLL_MS, formatRelative, formatSlot, isArmed, secondsBetween, useWorkflow } from './status'
import { Check } from './TriggerForm'

// One workflow's notifications: the inbox on the left, the rules deciding what reaches you on the
// right. Every notification is kept here - including the ones the rules held back from the global
// feed - so muting a workflow never loses what it said.
//
// Opening one (`?open=<id>`, which is also where a click in the alerts feed or on a desktop
// notification lands) shows the message, the run that made it, and the data that run collected;
// the workflow's own details are underneath either way.

const EVENT = {
  failure: { label: 'Failed', icon: CircleXIcon, tone: 'text-down' },
  success: { label: 'Succeeded', icon: CircleCheckIcon, tone: 'text-up' },
  output: { label: 'Filed', icon: BellIcon, tone: 'text-primary' },
} as const

const eventOf = (n: WorkflowNotification) => EVENT[n.meta?.event ?? 'output'] ?? EVENT.output

function Delivery({ n }: { n: WorkflowNotification }) {
  if (n.meta?.delivered !== false) return null
  return n.meta.held_until ? (
    <Badge variant="outline" title="Quiet hours - delivered when they end">
      held until {formatSlot(n.meta.held_until)}
    </Badge>
  ) : (
    <Badge variant="outline" title="Muted, snoozed or switched off by a rule - kept here only">
      kept quiet
    </Badge>
  )
}

export default function WorkflowNotifications() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { workflowId } = useParams({ from: '/workflows/$workflowId' })
  const { filter, open } = useSearch({ from: '/workflows/$workflowId/notifications' })
  const { workflow } = useWorkflow(workflowId)
  const key = ['workflowNotifications', workflowId]

  const { data: all = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () => getWorkflowNotifications(workflowId),
    refetchInterval: POLL_MS,
  })
  const unread = all.filter((n) => !n.acknowledged_at)
  const shown = filter === 'unread' ? unread : all
  const opened = all.find((n) => n.id === open)

  const setSearch = (next: { filter?: 'unread'; open?: number }) =>
    navigate({
      to: '/workflows/$workflowId/notifications',
      params: { workflowId },
      search: (prev) => ({ ...prev, ...next }),
      replace: true,
    })

  const settle = () => {
    queryClient.invalidateQueries({ queryKey: key })
    queryClient.invalidateQueries({ queryKey: ['workflows'] })
  }

  const markRead = useMutation({
    mutationFn: (ids?: number[]) => readWorkflowNotifications(workflowId, ids),
    // Read instantly; the server catches up. A dot that lingers after a click reads as a bug.
    onMutate: (ids) =>
      queryClient.setQueryData<WorkflowNotification[]>(key, (list) =>
        list?.map((n) =>
          !ids || ids.includes(n.id)
            ? { ...n, acknowledged_at: n.acknowledged_at ?? new Date().toISOString() }
            : n,
        ),
      ),
    onError: (e: Error) => toast.error(e.message),
    onSettled: settle,
  })

  const remove = useMutation({
    mutationFn: (id: number) => deleteWorkflowNotification(workflowId, id),
    onMutate: (id) =>
      queryClient.setQueryData<WorkflowNotification[]>(key, (list) => list?.filter((n) => n.id !== id)),
    onSuccess: (_r, id) => {
      if (open === id) setSearch({ open: undefined })
      toast.success('Notification deleted')
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: settle,
  })

  // Opening an unread one reads it - whether by a click here or by arriving from a link.
  const openedId = opened && !opened.acknowledged_at ? opened.id : undefined
  useEffect(() => {
    if (openedId) markRead.mutate([openedId])
    // markRead is a fresh object each render; only a newly opened id should fire it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedId])

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[1fr_20rem]">
      <div className="relative flex min-h-0 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-1 border-b px-4 py-2">
          {(
            [
              [undefined, 'All', all.length],
              ['unread', 'Unread', unread.length],
            ] as const
          ).map(([f, label, count]) => (
            <button
              key={label}
              type="button"
              onClick={() => setSearch({ filter: f })}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs transition-colors hover:bg-muted',
                filter === f && 'bg-muted font-medium',
              )}
            >
              {label} <span className="text-muted-foreground tabular-nums">{count}</span>
            </button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={!unread.length || markRead.isPending}
            onClick={() => markRead.mutate(undefined)}
          >
            <CheckCheckIcon className="size-3.5" />
            Mark all read
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="space-y-1.5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/40" />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {filter === 'unread'
                ? 'All caught up.'
                : 'Nothing yet. Failures and anything it files land here.'}
            </p>
          ) : (
            shown.map((n) => {
              const meta = eventOf(n)
              return (
                <div
                  key={n.id}
                  className={cn(
                    'group flex items-start gap-1 rounded-lg transition-colors hover:bg-muted/50',
                    open === n.id ? 'bg-muted' : !n.acknowledged_at && 'bg-primary/5',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSearch({ open: n.id })}
                    className="flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left"
                  >
                    <meta.icon className={cn('mt-0.5 size-3.5 shrink-0', meta.tone)} />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'line-clamp-2 text-xs whitespace-pre-line',
                          !n.acknowledged_at && 'font-medium',
                        )}
                      >
                        {n.message}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        {meta.label}
                        {n.triggered_at && (
                          <span title={formatDateTime(n.triggered_at)}>
                            · {timeAgoShort(n.triggered_at)} ago
                          </span>
                        )}
                        <Delivery n={n} />
                      </span>
                    </span>
                    {!n.acknowledged_at && (
                      <span
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                        aria-label="Unread"
                      />
                    )}
                  </button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="mt-1.5 mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label="Delete notification"
                    onClick={() => remove.mutate(n.id)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              )
            })
          )}
        </div>

        {opened && workflow && (
          <NotificationDrawer
            notification={opened}
            workflow={workflow}
            onClose={() => setSearch({ open: undefined })}
            onDelete={() => remove.mutate(opened.id)}
          />
        )}
      </div>

      <aside className="min-h-0 overflow-y-auto border-t bg-muted/20 p-4 lg:border-t-0 lg:border-l">
        {workflow && <RulesPanel workflow={workflow} />}
      </aside>
    </div>
  )
}

function NotificationDrawer({
  notification: n,
  workflow,
  onClose,
  onDelete,
}: {
  notification: WorkflowNotification
  workflow: Workflow
  onClose: () => void
  onDelete: () => void
}) {
  const workflowId = workflow.id
  const runId = n.meta?.run_id ?? undefined
  const meta = eventOf(n)

  const { data: graph } = useQuery({
    queryKey: ['agentWorkflow', runId],
    queryFn: () => getRunWorkflow(runId as string),
    enabled: !!runId,
  })
  const { data: collected, isLoading: loadingData } = useQuery({
    queryKey: ['workflowSeries', workflowId, undefined, runId],
    queryFn: () => getWorkflowSeries(workflowId, undefined, runId),
    enabled: !!runId,
  })

  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const run = graph?.run
  // Straight to the step that broke, when there is one.
  const failedNode = graph?.nodes.find((x) => x.data.status === 'error' && x.data.kind !== 'reply')?.id
  const columns = (collected?.columns ?? []).map((c) => ({
    id: c,
    header: c,
    accessorKey: c,
    cell: (cell: { getValue: () => unknown }) => {
      const v = cell.getValue()
      return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '—')
    },
  }))

  return (
    <aside
      aria-label="Notification details"
      className="absolute inset-y-0 right-0 z-10 flex w-[34rem] max-w-full flex-col border-l bg-card shadow-2xl duration-200 animate-in fade-in-0 slide-in-from-right-8"
    >
      <header className="flex items-start gap-2 border-b px-4 py-3">
        <meta.icon className={cn('mt-0.5 size-4 shrink-0', meta.tone)} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{meta.label}</p>
          <p className="text-[11px] text-muted-foreground">
            {n.triggered_at && formatDateTime(n.triggered_at)}
          </p>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onDelete}
          aria-label="Delete notification"
          title="Delete"
        >
          <Trash2Icon />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <XIcon />
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <Block title="Message" copy={n.message ?? ''} tone={n.meta?.event === 'failure' ? 'bad' : undefined}>
          <pre className="font-sans text-xs break-words whitespace-pre-wrap">{n.message}</pre>
        </Block>

        <p className="text-xs text-muted-foreground">
          {n.meta?.delivered === false
            ? n.meta.held_until
              ? `Held for quiet hours — delivered ${formatSlot(n.meta.held_until)}.`
              : 'Kept quiet — muted, snoozed or switched off by a rule, so only this inbox has it.'
            : n.meta?.delivered_at
              ? `Delivered ${formatSlot(n.meta.delivered_at)}${workflow.notify.telegram ? ', also to Telegram' : ''}.`
              : 'Delivered.'}
        </p>

        <section>
          <h3 className="mb-1 text-[11px] font-medium text-muted-foreground">The run</h3>
          {!runId ? (
            <p className="text-xs text-muted-foreground">Not tied to a run — it predates run tracking.</p>
          ) : !run ? (
            <Spinner className="size-4" />
          ) : (
            <Link
              to="/workflows/$workflowId/runs/$runId"
              params={{ workflowId, runId }}
              search={{ node: failedNode }}
              className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs transition-colors hover:bg-muted/50"
            >
              <span>
                <span
                  className={cn(
                    'font-medium',
                    run.status === 'failed'
                      ? 'text-down'
                      : run.status === 'running'
                        ? 'text-primary'
                        : 'text-up',
                  )}
                >
                  {run.status === 'failed' ? 'Failed' : run.status === 'running' ? 'Running' : 'Succeeded'}
                </span>
                <span className="text-muted-foreground">
                  {' '}
                  · {formatDateTime(run.created_at)} ·{' '}
                  {formatDuration(secondsBetween(run.created_at, run.finished_at))}
                </span>
              </span>
              <span className="text-primary">
                {failedNode ? 'Open the failing step →' : 'Open the diagram →'}
              </span>
            </Link>
          )}
        </section>

        {runId && (
          <section>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-[11px] font-medium text-muted-foreground">Collected in this run</h3>
              {!!collected?.rows.length && (
                <Link
                  to="/workflows/$workflowId/data"
                  params={{ workflowId }}
                  search={{ series: collected.selected ?? undefined }}
                  className="text-[11px] text-primary hover:underline"
                >
                  Open in Data →
                </Link>
              )}
            </div>
            {loadingData ? (
              <Spinner className="size-4" />
            ) : collected?.rows.length ? (
              <>
                <p className="mb-1 text-[11px] text-muted-foreground">
                  {collected.rows.length} row{collected.rows.length === 1 ? '' : 's'} in{' '}
                  <strong>{collected.selected}</strong>
                  {collected.series.length > 1 && ` (+${collected.series.length - 1} more series in Data)`}
                </p>
                <DataTable
                  columns={columns as never}
                  data={collected.rows as never}
                  sortable
                  containerClassName="max-h-72 rounded-lg border"
                />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Nothing collected in this run.</p>
            )}
          </section>
        )}

        <section className="rounded-lg border bg-muted/20 p-3 text-xs">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-medium text-muted-foreground">The workflow</h3>
            <Link
              to="/workflows/$workflowId"
              params={{ workflowId }}
              className="text-[11px] text-primary hover:underline"
            >
              Overview →
            </Link>
          </div>
          <p className="font-medium">{workflow.name}</p>
          {workflow.description && <p className="mt-1 text-muted-foreground">{workflow.description}</p>}
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Runs</dt>
            <dd>{workflow.trigger_label}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>{isArmed(workflow) ? 'Armed' : workflow.trigger.kind === 'manual' ? 'Manual' : 'Off'}</dd>
            {isArmed(workflow) && workflow.next_run_at && (
              <>
                <dt className="text-muted-foreground">Next run</dt>
                <dd>{formatRelative(workflow.next_run_at)}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Nodes</dt>
            <dd>{workflow.graph?.nodes?.length ?? 0}</dd>
          </dl>
        </section>
      </div>
    </aside>
  )
}

const SNOOZES = [
  { key: '1h', label: 'for 1 hour', until: () => new Date(Date.now() + 3600_000) },
  { key: '4h', label: 'for 4 hours', until: () => new Date(Date.now() + 4 * 3600_000) },
  {
    key: 'tomorrow',
    label: 'until tomorrow 09:00',
    until: () => {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      d.setHours(9, 0, 0, 0)
      return d
    },
  },
  { key: 'week', label: 'for a week', until: () => new Date(Date.now() + 7 * 86400_000) },
]

function RulesPanel({ workflow }: { workflow: Workflow }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [rules, setRules] = useState<WorkflowNotify>(workflow.notify)
  const saving = useRef(0)

  // Follow the server's copy (another tab, the list) - but never over a change still in flight.
  useEffect(() => {
    if (!saving.current) setRules(workflow.notify)
  }, [workflow.notify])

  const { data: telegram } = useQuery({ queryKey: ['telegramConfig'], queryFn: getTelegramConfig })
  const telegramReady = !!telegram?.has_token && !!telegram?.chat_id

  const save = useMutation({
    mutationFn: (next: WorkflowNotify) => saveWorkflowNotify(workflow.id, next),
    onMutate: () => {
      saving.current += 1
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<Workflow[]>(['workflows'], (list) =>
        list?.map((w) => (w.id === saved.id ? { ...w, notify: saved.notify } : w)),
      )
      toast.success('Notification rules saved', { id: 'notify-rules' })
    },
    onError: (e: Error) => {
      toast.error(e.message, { id: 'notify-rules' })
      setRules(workflow.notify)
    },
    onSettled: () => {
      saving.current -= 1
    },
  })

  // Every control saves on change: rules are a handful of switches, and a Save button for them is
  // one more thing to forget.
  const update = (patch: Partial<WorkflowNotify>) => {
    const next = { ...rules, ...patch }
    setRules(next)
    save.mutate(next)
  }

  const snoozedUntil =
    rules.snooze_until && new Date(rules.snooze_until) > new Date() ? rules.snooze_until : null

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium text-muted-foreground">What reaches you</h3>
        {save.isPending && <Spinner className="size-3.5" />}
      </div>

      <section className="space-y-2">
        <p className="text-xs font-medium">Tell me when it</p>
        <Check checked={rules.on_failure} onChange={(v) => update({ on_failure: v })}>
          fails
        </Check>
        <Check checked={rules.on_output} onChange={(v) => update({ on_output: v })}>
          files something (an output node)
        </Check>
        <Check checked={rules.on_success} onChange={(v) => update({ on_success: v })}>
          succeeds — every run, even quiet ones
        </Check>
        <p className="text-[11px] text-muted-foreground">
          Switched-off failures and outputs are still kept in this inbox; they just don't reach you.
        </p>
      </section>

      <section className="space-y-2">
        <p className="text-xs font-medium">Pause</p>
        <Check checked={rules.muted} onChange={(v) => update({ muted: v })}>
          Mute until I turn it back on
        </Check>
        {snoozedUntil ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-xs">
            <span>Snoozed until {formatSlot(snoozedUntil)}</span>
            <Button size="xs" variant="ghost" onClick={() => update({ snooze_until: null })}>
              Resume
            </Button>
          </div>
        ) : (
          <Select
            value=""
            onValueChange={(v) => {
              const pick = SNOOZES.find((s) => s.key === v)
              if (pick) update({ snooze_until: pick.until().toISOString() })
            }}
          >
            <SelectTrigger className="h-8 w-full" aria-label="Snooze">
              <SelectValue placeholder="Snooze…" />
            </SelectTrigger>
            <SelectContent>
              {SNOOZES.map((s) => (
                <SelectItem key={s.key} value={s.key}>
                  Snooze {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </section>

      <section className="space-y-2">
        <Check
          checked={!!rules.quiet_start}
          onChange={(on) =>
            update(on ? { quiet_start: '22:00', quiet_end: '07:00' } : { quiet_start: null, quiet_end: null })
          }
        >
          <span className="font-medium">Quiet hours</span> — hold them, deliver when it ends
        </Check>
        {rules.quiet_start && (
          <div className="flex items-center gap-1.5 pl-5">
            <Input
              type="time"
              value={rules.quiet_start}
              onChange={(e) => e.target.value && update({ quiet_start: e.target.value })}
              className="h-8"
              aria-label="Quiet from"
            />
            <span className="text-xs text-muted-foreground">–</span>
            <Input
              type="time"
              value={rules.quiet_end ?? '07:00'}
              onChange={(e) => e.target.value && update({ quiet_end: e.target.value })}
              className="h-8"
              aria-label="Quiet until"
            />
          </div>
        )}
      </section>

      <section className="space-y-2">
        <p className="text-xs font-medium">Also</p>
        <Check checked={rules.digest} onChange={(v) => update({ digest: v })}>
          Include in the 18:00 daily digest
        </Check>
        <Check
          checked={rules.telegram}
          onChange={(v) => update({ telegram: v })}
          disabled={!telegramReady && !rules.telegram}
        >
          Send to Telegram
        </Check>
        {!telegramReady && (
          <button
            type="button"
            className={cn(buttonVariants({ size: 'xs', variant: 'link' }), 'h-auto px-0 pl-5')}
            onClick={() =>
              navigate({
                to: '.',
                search: (prev: Record<string, unknown>) => ({ ...prev, settings: 'telegram' }),
              } as never)
            }
          >
            Set up Telegram in Settings →
          </button>
        )}
      </section>

      {isArmed(workflow) || workflow.trigger.kind === 'manual' ? null : (
        <p className="rounded-lg border border-dashed px-3 py-2 text-[11px] text-muted-foreground">
          This workflow is off, so it won't run on its own — these rules apply when you run it.
        </p>
      )}
    </div>
  )
}
