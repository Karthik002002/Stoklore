import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  AlertTriangleIcon,
  BellIcon,
  ChartNoAxesCombinedIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  ClockIcon,
  HandIcon,
  LayoutGridIcon,
  NewspaperIcon,
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
import { deleteWorkflow, getWorkflows, runWorkflow, saveWorkflow } from '@/services/api'
import type { Workflow } from '@/services/api'
import type { WorkflowStatusFilter } from '@/router'
import TemplateGallery from './TemplateGallery'
import { askToNotify, canNotify } from './useRunNotifications'

// Managing workflows: what exists, what's armed, and what each one is doing right now.
//
// The arm button is the whole safety model. A workflow runs with nobody watching, so "enabled" is the
// standing permission - and it's on the row rather than buried in the editor, because turning one
// OFF is the thing you want to do in a hurry.
//
// The list is polled every 5s: a scheduled run starts on the server with nobody clicking anything,
// so the only way to see it go from running to failed is to keep asking.
const POLL_MS = 5000

const TRIGGER_ICON = { schedule: ClockIcon, manual: HandIcon, event_scan: NewspaperIcon }

const triggerLabel = (w: Workflow) =>
  w.trigger.kind === 'schedule'
    ? `Daily at ${w.trigger.time ?? '09:15'} IST`
    : w.trigger.kind === 'event_scan'
      ? 'After the daily event scan'
      : 'Manual only'

type RunState = 'running' | 'succeeded' | 'failed' | 'never'

const runState = (w: Workflow): RunState =>
  w.last_run_status === 'running'
    ? 'running'
    : w.last_run_status === 'failed'
      ? 'failed'
      : w.last_run_status === 'done'
        ? 'succeeded'
        : 'never'

const isArmed = (w: Workflow) => w.enabled && w.trigger.kind !== 'manual'

const matches = (w: Workflow, filter?: WorkflowStatusFilter) =>
  !filter || (filter === 'armed' ? isArmed(w) : runState(w) === filter)

const STATE_META: Record<RunState, { label: string; tone: string }> = {
  running: { label: 'Running', tone: 'text-primary' },
  succeeded: { label: 'Succeeded', tone: 'text-up' },
  failed: { label: 'Failed', tone: 'text-down' },
  never: { label: 'Never run', tone: 'text-muted-foreground' },
}

function StateIcon({ state, className }: { state: RunState; className?: string }) {
  const cls = cn('size-3.5 shrink-0', STATE_META[state].tone, className)
  if (state === 'running') return <Spinner className={cls} />
  if (state === 'succeeded') return <CircleCheckIcon className={cls} />
  if (state === 'failed') return <CircleXIcon className={cls} />
  return <CircleDashedIcon className={cls} />
}

const seconds = (from: string, to?: string | null) =>
  ((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 1000

const ago = (at: string) => (seconds(at) < 60 ? 'just now' : `${timeAgoShort(at)} ago`)

// Stable, for the same reason useRunNotifications keeps one: it is an effect dependency, and a
// `= []` default would be a new array on every render.
const NO_WORKFLOWS: Workflow[] = []

export default function WorkflowList() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { status: filter } = useSearch({ from: '/agent/workflows' })
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Workflow | null>(null)

  const {
    data: workflows = NO_WORKFLOWS,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['workflows'],
    queryFn: getWorkflows,
    refetchInterval: POLL_MS,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['workflows'] })
  const openRun = (workflowId: string, runId: string) =>
    navigate({ to: '/agent/workflows/$workflowId/runs/$runId', params: { workflowId, runId } })

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

  const toggle = useMutation({
    mutationFn: (w: Workflow) =>
      saveWorkflow(w.id, {
        name: w.name,
        description: w.description,
        graph: w.graph,
        trigger: w.trigger,
        enabled: !w.enabled,
        retain_runs: w.retain_runs,
      }),
    onSuccess: (saved) => {
      toast.success(
        saved.enabled
          ? `${saved.name} armed — ${triggerLabel(saved).toLowerCase()}`
          : `${saved.name} disarmed`,
      )
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const runNow = useMutation({
    mutationFn: (w: Workflow) => runWorkflow(w.id),
    onSuccess: ({ run_id }, w) => {
      // Shown as running straight away rather than on the next poll: the server row is written the
      // moment the thread starts, so this is what the poll is about to say anyway.
      queryClient.setQueryData<Workflow[]>(['workflows'], (list) =>
        list?.map((x) =>
          x.id === w.id
            ? {
                ...x,
                last_run_id: run_id,
                last_run_status: 'running',
                last_run_at: new Date().toISOString(),
                last_run_finished_at: null,
                last_run_error: null,
              }
            : x,
        ),
      )
      queryClient.invalidateQueries({ queryKey: ['agentRunsRunning'] })
      toast.success(`${w.name} started`, {
        description: 'It keeps running if you leave this page.',
        action: { label: 'Watch', onClick: () => openRun(w.id, run_id) },
      })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: (w: Workflow) => deleteWorkflow(w.id),
    onSuccess: (_r, w) => {
      toast.success(`${w.name} deleted`)
      setConfirmDelete(null)
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

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
    navigate({
      to: '/agent/workflows',
      search: { status: next === filter ? undefined : next },
      replace: true,
    })

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Workflows</h2>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            The same tools the chat uses, wired by hand and run without you.
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
                    ? toast.success('You will be told when a run finishes')
                    : toast.message('No notifications — results still land in the alerts feed'),
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
          <Link to="/agent/workflows/new" className={buttonVariants({ size: 'sm' })}>
            <PlusIcon className="size-4" />
            New workflow
          </Link>
        </div>
      </div>

      <TemplateGallery
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        onCreated={(id) => navigate({ to: '/agent/workflows/$workflowId', params: { workflowId: id } })}
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
          <p>Couldn't load workflows: {error.message}</p>
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
            const Icon = TRIGGER_ICON[w.trigger.kind] ?? HandIcon
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
                  to="/agent/workflows/$workflowId"
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
                    <Icon className="size-3" />
                    {triggerLabel(w)}
                  </p>
                  {state === 'failed' && w.last_run_error && (
                    <p className="mt-0.5 truncate text-xs text-down" title={w.last_run_error}>
                      {w.last_run_error}
                    </p>
                  )}
                </Link>

                <LastRun workflow={w} state={state} />

                <Link
                  to="/agent/workflows/$workflowId/data"
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
                {/* Only meaningful for a triggered workflow - a manual one has nothing to arm.
                    A button rather than a switch because this project has no switch component and
                    one toggle does not justify adding one. */}
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
              The graph and its schedule go. Runs it already made stay in the history and the alerts feed.
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={() => confirmDelete && remove.mutate(confirmDelete)}
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
  const took = seconds(w.last_run_at, w.last_run_finished_at)
  return (
    <Link
      to="/agent/workflows/$workflowId/runs/$runId"
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
