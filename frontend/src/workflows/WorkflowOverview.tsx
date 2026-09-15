import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { CopyIcon, DatabaseIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { formatDateTime, formatDuration, timeAgoShort } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  getWorkflowHealth,
  getWorkflowNotifications,
  getWorkflowSeries,
  previewTrigger,
} from '@/services/api'
import {
  POLL_MS,
  STATE_META,
  TIME_KINDS,
  TRIGGER_ICON,
  formatRelative,
  formatSlot,
  isArmed,
  runState,
  secondsBetween,
  useWorkflow,
} from './status'
import StateIcon from './StateIcon'

// One workflow at a glance: when it runs next, what it last did, whether it's healthy, what it has
// told you, what it has collected, and what it's chained to. Each card links to the tab that has
// the whole story.

function Card({
  title,
  action,
  className,
  children,
}: {
  title: string
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('rounded-xl border bg-card p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium text-muted-foreground">{title}</h3>
        {action && <span className="text-xs">{action}</span>}
      </div>
      {children}
    </section>
  )
}

const cardLink = 'text-primary hover:underline'

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div className="rounded-lg border px-2.5 py-1.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn('truncate text-sm font-medium', tone === 'bad' && 'text-down')}>{value}</p>
    </div>
  )
}

export default function WorkflowOverview() {
  const { workflowId } = useParams({ from: '/workflows/$workflowId' })
  const { workflow, workflows } = useWorkflow(workflowId)

  const { data: health } = useQuery({
    queryKey: ['workflowHealth', workflowId],
    queryFn: () => getWorkflowHealth(workflowId),
    refetchInterval: POLL_MS,
  })
  const { data: notes = [] } = useQuery({
    queryKey: ['workflowNotifications', workflowId],
    queryFn: () => getWorkflowNotifications(workflowId),
    refetchInterval: POLL_MS,
  })
  const { data: series } = useQuery({
    queryKey: ['workflowSeries', workflowId, undefined],
    queryFn: () => getWorkflowSeries(workflowId),
  })
  const trigger = workflow?.trigger
  const { data: preview } = useQuery({
    queryKey: ['triggerPreview', JSON.stringify(trigger ?? null)],
    queryFn: () => previewTrigger(trigger as NonNullable<typeof trigger>),
    enabled: !!trigger && TIME_KINDS.includes(trigger.kind),
  })

  if (!workflow || !trigger) return null

  const state = runState(workflow)
  const TriggerIcon = TRIGGER_ICON[trigger.kind]
  const armed = isArmed(workflow)
  const upstream =
    trigger.kind === 'workflow_done' ? workflows.find((w) => w.id === trigger.workflow_id) : undefined
  const downstream = workflows.filter(
    (w) => w.trigger.kind === 'workflow_done' && w.trigger.workflow_id === workflowId,
  )
  const worst = health?.failing_nodes[0]
  const rules = workflow.notify
  const about =
    [rules.on_failure && 'failures', rules.on_success && 'successes', rules.on_output && 'what it files']
      .filter(Boolean)
      .join(', ') || 'nothing'

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Card
          title="When it runs"
          action={
            <Link to="/workflows/$workflowId/editor" params={{ workflowId }} className={cardLink}>
              Change
            </Link>
          }
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <TriggerIcon className="size-4 shrink-0 text-muted-foreground" />
            {workflow.trigger_label}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {trigger.kind === 'manual'
              ? 'Only when you press Run now.'
              : armed
                ? 'Armed — runs on its own.'
                : 'Off — arm it to run unattended.'}
          </p>
          {TIME_KINDS.includes(trigger.kind) && !!preview?.next.length && (
            <>
              <ol className="mt-3 space-y-1 text-xs tabular-nums">
                {preview.next.map((iso, i) => (
                  <li key={iso} className="flex justify-between gap-2">
                    <span className={i ? 'text-muted-foreground' : 'font-medium'}>{formatSlot(iso)}</span>
                    {i === 0 && <span className="text-muted-foreground">{formatRelative(iso)}</span>}
                  </li>
                ))}
              </ol>
              {!armed && (
                <p className="mt-2 text-[11px] text-muted-foreground">When it would run, once armed.</p>
              )}
            </>
          )}
        </Card>

        <Card
          title="Last run"
          action={
            <Link to="/workflows/$workflowId/runs" params={{ workflowId }} className={cardLink}>
              All runs
            </Link>
          }
        >
          {workflow.last_run_id && workflow.last_run_at ? (
            <Link
              to="/workflows/$workflowId/runs/$runId"
              params={{ workflowId, runId: workflow.last_run_id }}
              className="-m-2 block rounded-lg p-2 transition-colors hover:bg-muted/50"
            >
              <p className={cn('flex items-center gap-1.5 text-sm font-medium', STATE_META[state].tone)}>
                <StateIcon state={state} />
                {STATE_META[state].label}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDateTime(workflow.last_run_at)} · {state === 'running' ? 'for ' : 'took '}
                {formatDuration(secondsBetween(workflow.last_run_at, workflow.last_run_finished_at))}
              </p>
              {workflow.last_run_error && (
                <p className="mt-1 line-clamp-2 text-xs text-down">{workflow.last_run_error}</p>
              )}
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground">Never run.</p>
          )}
          {workflow.fail_streak > 1 && (
            <Badge variant="destructive" className="mt-2">
              {workflow.fail_streak} failed in a row
            </Badge>
          )}
        </Card>

        <Card title="Health">
          {health ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Runs kept" value={String(health.total)} />
                <Stat label="Failed" value={String(health.failed)} tone={health.failed ? 'bad' : undefined} />
                <Stat
                  label="Avg duration"
                  value={health.avg_seconds == null ? '—' : formatDuration(health.avg_seconds)}
                />
                <Stat
                  label="Worst node"
                  value={worst ? `${worst.name} ×${worst.failures}` : '—'}
                  tone={worst ? 'bad' : undefined}
                />
              </div>
              {/* Oldest to newest, a bar per run: a red streak is visible before a number is read. */}
              {health.runs.length > 0 && (
                <div className="mt-3 flex h-5 items-end gap-0.5">
                  {[...health.runs].reverse().map((r) => (
                    <Link
                      key={r.id}
                      to="/workflows/$workflowId/runs/$runId"
                      params={{ workflowId, runId: r.id }}
                      title={`${formatDateTime(r.created_at)} · ${r.status}${
                        r.seconds != null ? ` · ${formatDuration(r.seconds)}` : ''
                      }${r.error ? `\n${r.error}` : ''}`}
                      className={cn(
                        'h-4 w-1.5 origin-bottom rounded-sm transition-transform hover:scale-y-125',
                        r.status === 'failed'
                          ? 'bg-down'
                          : r.status === 'running'
                            ? 'animate-pulse bg-primary'
                            : 'bg-up',
                      )}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <Spinner className="size-4" />
          )}
        </Card>

        <Card
          title="Notifications"
          action={
            <Link to="/workflows/$workflowId/notifications" params={{ workflowId }} className={cardLink}>
              Inbox{workflow.unread ? ` (${workflow.unread})` : ''}
            </Link>
          }
        >
          <p className="text-xs text-muted-foreground">
            Tells you about {about}
            {rules.muted && ' · muted'}
            {rules.quiet_start && ` · quiet ${rules.quiet_start}–${rules.quiet_end}`}
            {rules.telegram && ' · Telegram'}
          </p>
          {notes.length ? (
            <ul className="mt-2 space-y-0.5">
              {notes.slice(0, 5).map((note) => (
                <li key={note.id}>
                  <Link
                    to="/workflows/$workflowId/notifications"
                    params={{ workflowId }}
                    search={{ open: note.id }}
                    className="flex items-center gap-2 rounded-md px-1 py-1 text-xs transition-colors hover:bg-muted/50"
                  >
                    <span
                      className={cn('size-1.5 shrink-0 rounded-full', !note.acknowledged_at && 'bg-primary')}
                    />
                    <span className="line-clamp-1 flex-1">{note.message}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {note.triggered_at && timeAgoShort(note.triggered_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Nothing yet.</p>
          )}
        </Card>

        <Card
          title="Collected data"
          action={
            <Link to="/workflows/$workflowId/data" params={{ workflowId }} className={cardLink}>
              Open
            </Link>
          }
        >
          {series?.series.length ? (
            <ul className="space-y-0.5">
              {series.series.map((name) => (
                <li key={name}>
                  <Link
                    to="/workflows/$workflowId/data"
                    params={{ workflowId }}
                    search={{ series: name }}
                    className="flex items-center gap-2 rounded-md px-1 py-1 text-xs transition-colors hover:bg-muted/50"
                  >
                    <DatabaseIcon className="size-3.5 text-muted-foreground" />
                    {name}
                    {name === series.selected && (
                      <span className="ml-auto text-muted-foreground">{series.rows.length} rows</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nothing collected. A <strong>Collect data</strong> node builds a series here, run by run.
            </p>
          )}
        </Card>

        <Card title="Chain">
          {upstream && (
            <p className="text-xs">
              Runs after{' '}
              <Link to="/workflows/$workflowId" params={{ workflowId: upstream.id }} className={cardLink}>
                {upstream.name}
              </Link>{' '}
              {trigger.on === 'failure' ? 'fails' : trigger.on === 'any' ? 'finishes' : 'succeeds'}.
            </p>
          )}
          {downstream.length > 0 && (
            <p className={cn('text-xs', upstream && 'mt-2')}>
              Starts{' '}
              {downstream.map((w, i) => (
                <span key={w.id}>
                  {i > 0 && ', '}
                  <Link to="/workflows/$workflowId" params={{ workflowId: w.id }} className={cardLink}>
                    {w.name}
                  </Link>
                </span>
              ))}
              .
            </p>
          )}
          {!upstream && !downstream.length && (
            <p className="text-xs text-muted-foreground">
              Not chained. Give another workflow the trigger <em>After another workflow</em> to run it after
              this one.
            </p>
          )}
        </Card>

        <Card title="Details" className="md:col-span-2 xl:col-span-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
            {workflow.description && (
              <div className="col-span-full">
                <dt className="text-muted-foreground">Description</dt>
                <dd className="mt-0.5 whitespace-pre-line">{workflow.description}</dd>
              </div>
            )}
            <div>
              <dt className="text-muted-foreground">Nodes</dt>
              <dd className="mt-0.5">{workflow.graph?.nodes?.length ?? 0}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Keeps data from</dt>
              <dd className="mt-0.5">the last {workflow.retain_runs} runs</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last triggered</dt>
              <dd className="mt-0.5">
                {workflow.last_triggered_at ? formatDateTime(workflow.last_triggered_at) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="mt-0.5">{formatDateTime(workflow.created_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Updated</dt>
              <dd className="mt-0.5">{formatDateTime(workflow.updated_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">ID</dt>
              <dd className="mt-0.5 flex items-center gap-1">
                <code className="truncate">{workflow.id.slice(0, 8)}…</code>
                <button
                  type="button"
                  aria-label="Copy workflow id"
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() =>
                    navigator.clipboard.writeText(workflow.id).then(
                      () => toast.success('Workflow id copied'),
                      () => toast.error('Could not copy'),
                    )
                  }
                >
                  <CopyIcon className="size-3" />
                </button>
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  )
}
