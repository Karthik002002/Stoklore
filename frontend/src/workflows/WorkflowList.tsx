import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  AlertTriangleIcon,
  BellIcon,
  ChartNoAxesCombinedIcon,
  LayoutGridIcon,
  PlayIcon,
  PlusIcon,
  PowerIcon,
  Trash2Icon,
  WorkflowIcon,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { formatDateTime, formatDuration, timeAgoShort } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Workflow } from '@/services/api'
import type { WorkflowStatusFilter } from '@/router'
import { askToNotify, canNotify } from '@/agent/useRunNotifications'
import TemplateGallery from './TemplateGallery'
import {
  POLL_MS,
  STATE_META,
  TRIGGER_ICON,
  formatRelative,
  formatSlot,
  isArmed,
  runState,
  secondsBetween,
  useWorkflowActions,
  useWorkflows,
} from './status'
import StateIcon from './StateIcon'
import type { RunState } from './status'

// Managing workflows: what exists, what's armed, and what each one is doing right now.
//
// The arm button is the whole safety model. A workflow runs with nobody watching, so "enabled" is the
// standing permission - and it's on the row rather than buried in the editor, because turning one
// OFF is the thing you want to do in a hurry.

const matches = (w: Workflow, filter?: WorkflowStatusFilter) =>
  !filter || (filter === 'armed' ? isArmed(w) : runState(w) === filter)

const ago = (at: string) => (secondsBetween(at) < 60 ? 'just now' : `${timeAgoShort(at)} ago`)

export default function WorkflowList() {
  const navigate = useNavigate()
  const { status: filter } = useSearch({ from: '/workflows/' })
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Workflow | null>(null)
  const { workflows, isLoading, isError, error, refetch, isFetching } = useWorkflows()
  const { runNow, toggle, remove, openRun } = useWorkflowActions()

  // A run that finished between two polls says so, with a way straight to it. The first poll only
  // records what is already running - otherwise every run in flight on page load would "finish".
  const previous = useRef<Map<string, Workflow['last_run_status']> | null>(null)
  useEffect(() => {
    if (isLoading) return
    const before = previous.current
    previous.current = new Map(workflows.map((w) => [w.id, w.last_run_status]))
    if (!before) return
    for (const w of workflows) {
      if (before.get(w.id) !== 'running' || w.last_run_status === 'running' || !w.last_run_id) continue
      const action = { label: 'View run', onClick: () => openRun(w.id, w.last_run_id as string) }
      if (w.last_run_status === 'failed') {
        toast.error(`${w.name} failed`, { description: w.last_run_error ?? undefined, action })
      } else {
        toast.success(`${w.name} finished`, { action })
      }
    }
    // openRun is a fresh closure each render and only ever reads its arguments.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflows, isLoading])

  const counts = {
    all: workflows.length,
    running: workflows.filter((w) => runState(w) === 'running').length,
    succeeded: workflows.filter((w) => runState(w) === 'succeeded').length,
    failed: workflows.filter((w) => runState(w) === 'failed').length,
    never: workflows.filter((w) => runState(w) === 'never').length,
    armed: workflows.filter(isArmed).length,
  }
  const visible = workflows.filter((w) => matches(w, filter))

  const setFilter = (next?: WorkflowStatusFilter) =>
    navigate({ to: '/workflows', search: { status: next === filter ? undefined : next }, replace: true })

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Workflows</h2>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            The agent's tools, wired by hand and run without you.
            <span
              className="inline-flex items-center gap-1"
              title={`Statuses refresh every ${POLL_MS / 1000}s`}
            >
              <span className={cn('size-1.5 rounded-full bg-up', isFetching && 'animate-pulse')} />
              live
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Permission has to be asked from a click, so it's a button rather than something that
              happens on load - asking unprompted is how a site gets permanently blocked. */}
          {canNotify() && Notification.permission === 'default' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                askToNotify().then((p) =>
                  p === 'granted'
                    ? toast.success('You will be told when a workflow has something for you')
                    : toast.message('No desktop notifications — they still land in each inbox'),
                )
              }
            >
              <BellIcon className="size-4" />
              Notify me
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setGalleryOpen(true)}>
            <LayoutGridIcon className="size-4" />
            Templates
          </Button>
          <Link to="/workflows/new" className={buttonVariants({ size: 'sm' })}>
            <PlusIcon className="size-4" />
            New workflow
          </Link>
        </div>
      </div>

      <TemplateGallery
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        onCreated={(id) => navigate({ to: '/workflows/$workflowId/editor', params: { workflowId: id } })}
      />

      {/* Counts double as filters: "3 failed" is the question, clicking it is the answer. */}
      {workflows.length > 0 && (
        <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          <CountTile label="All" count={counts.all} active={!filter} onClick={() => setFilter(undefined)}>
            <WorkflowIcon className="size-3.5 text-muted-foreground" />
          </CountTile>
          {(['running', 'succeeded', 'failed', 'never'] as const).map((s) => (
            <CountTile
              key={s}
              label={STATE_META[s].label}
              count={counts[s]}
              active={filter === s}
              tone={s === 'failed' && counts.failed ? 'bad' : undefined}
              onClick={() => setFilter(s)}
            >
              <StateIcon state={s} className={s === 'running' && !counts.running ? 'animate-none' : ''} />
            </CountTile>
          ))}
          <CountTile
            label="Armed"
            count={counts.armed}
            active={filter === 'armed'}
            onClick={() => setFilter('armed')}
          >
            <PowerIcon className="size-3.5 text-primary" />
          </CountTile>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[4.25rem] animate-pulse rounded-xl border bg-muted/30" />
          ))}
        </div>
      ) : isError ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          <p>Couldn't load workflows: {error?.message}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : workflows.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Nothing wired yet. Browse the templates, generate one from a screener.in screen, or build a trigger,
          some tool nodes and somewhere to file what it found.
        </p>
      ) : visible.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          <p>No workflows match “{filter === 'armed' ? 'Armed' : STATE_META[filter as RunState].label}”.</p>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setFilter(undefined)}>
            Show all
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((w) => {
            const Icon = TRIGGER_ICON[w.trigger.kind]
            const state = runState(w)
            const running = state === 'running'
            const starting = runNow.isPending && runNow.variables?.id === w.id
            const arming = toggle.isPending && toggle.variables?.id === w.id
            return (
              <div
                key={w.id}
                className={cn(
                  'flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-foreground/20 hover:bg-muted/20',
                  state === 'failed' && 'border-down/30',
                )}
              >
                <Link
                  to="/workflows/$workflowId"
                  params={{ workflowId: w.id }}
                  className="min-w-0 flex-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {w.name}
                    <Badge variant="secondary">{w.graph?.nodes?.length ?? 0} nodes</Badge>
                    {isArmed(w) && <Badge>armed</Badge>}
                    {/* A streak is the thing you'd otherwise only notice by the absence of
                        alerts, which is exactly how a broken workflow hides. */}
                    {w.fail_streak > 1 && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangleIcon className="size-3" />
                        {w.fail_streak} failed in a row
                      </Badge>
                    )}
                  </p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon className="size-3 shrink-0" />
                    {w.trigger_label}
                    {isArmed(w) && w.next_run_at && (
                      <span title={formatSlot(w.next_run_at)}>· next {formatRelative(w.next_run_at)}</span>
                    )}
                  </p>
                  {state === 'failed' && w.last_run_error && (
                    <p className="mt-0.5 truncate text-xs text-down" title={w.last_run_error}>
                      {w.last_run_error}
                    </p>
                  )}
                </Link>

                <LastRun workflow={w} state={state} />

                <Link
                  to="/workflows/$workflowId/notifications"
                  params={{ workflowId: w.id }}
                  className={cn(
                    buttonVariants({ size: 'icon-sm', variant: 'ghost' }),
                    'relative',
                    !w.unread && 'text-muted-foreground',
                  )}
                  aria-label={`${w.unread ?? 0} unread notifications for ${w.name}`}
                  title="Notifications"
                >
                  <BellIcon className="size-3.5" />
                  {!!w.unread && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 font-medium text-primary-foreground tabular-nums">
                      {w.unread}
                    </span>
                  )}
                </Link>
                <Link
                  to="/workflows/$workflowId/data"
                  params={{ workflowId: w.id }}
                  className={buttonVariants({ size: 'sm', variant: 'ghost' })}
                >
                  <ChartNoAxesCombinedIcon className="size-3.5" />
                  Data
                </Link>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-24"
                  disabled={running || starting}
                  onClick={() => runNow.mutate(w)}
                  title={running ? 'Already running — one run at a time' : undefined}
                >
                  {running || starting ? <Spinner className="size-3.5" /> : <PlayIcon className="size-3.5" />}
                  {running ? 'Running' : 'Run now'}
                </Button>
                {/* Only meaningful for a triggered workflow - a manual one has nothing to arm. */}
                <Button
                  size="sm"
                  variant={w.enabled ? 'default' : 'outline'}
                  className="w-20"
                  disabled={w.trigger.kind === 'manual' || arming}
                  onClick={() => toggle.mutate(w)}
                  aria-label={`${w.enabled ? 'Disarm' : 'Arm'} ${w.name}`}
                  title={w.trigger.kind === 'manual' ? 'Manual workflows have nothing to arm' : undefined}
                >
                  {arming ? <Spinner className="size-3.5" /> : <PowerIcon className="size-3.5" />}
                  {w.enabled ? 'Armed' : 'Off'}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete ${w.name}`}
                  onClick={() => setConfirmDelete(w)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            )
          })}
        </div>
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The graph, its trigger and its collected data go. Runs it already made stay in the history and
              the alerts feed. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={() =>
                confirmDelete && remove.mutate(confirmDelete, { onSuccess: () => setConfirmDelete(null) })
              }
            >
              {remove.isPending && <Spinner className="size-3.5" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CountTile({
  label,
  count,
  active,
  tone,
  onClick,
  children,
}: {
  label: string
  count: number
  active: boolean
  tone?: 'bad'
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-xl border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        active && 'border-primary/60 bg-primary/5',
        tone === 'bad' && !active && 'border-down/40',
      )}
    >
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {children}
        {label}
      </p>
      <p className={cn('text-lg font-semibold tabular-nums', tone === 'bad' && 'text-down')}>{count}</p>
    </button>
  )
}

/** What the newest run did, linking to its diagram. Fixed width so the action buttons line up down
 *  the list whatever each row says. */
function LastRun({ workflow: w, state }: { workflow: Workflow; state: RunState }) {
  if (state === 'never' || !w.last_run_id || !w.last_run_at) {
    return (
      <span className="flex w-40 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <StateIcon state="never" />
        Never run
      </span>
    )
  }
  const took = secondsBetween(w.last_run_at, w.last_run_finished_at)
  return (
    <Link
      to="/workflows/$workflowId/runs/$runId"
      params={{ workflowId: w.id, runId: w.last_run_id }}
      title={`Started ${formatDateTime(w.last_run_at)}${w.last_run_error ? `\n${w.last_run_error}` : ''}`}
      className="flex w-40 shrink-0 flex-col rounded-lg px-2 py-1 text-xs transition-colors hover:bg-muted"
    >
      <span className={cn('flex items-center gap-1.5 font-medium', STATE_META[state].tone)}>
        <StateIcon state={state} />
        {STATE_META[state].label}
      </span>
      <span className="text-muted-foreground">
        {state === 'running'
          ? `for ${formatDuration(took)}`
          : `${ago(w.last_run_at)} · ${formatDuration(took)}`}
      </span>
    </Link>
  )
}
