import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { format, formatDistanceToNowStrict } from 'date-fns'
import {
  BellRingIcon,
  CalendarDaysIcon,
  CalendarIcon,
  CandlestickChartIcon,
  ClockIcon,
  HandIcon,
  NewspaperIcon,
  ReceiptIcon,
  RepeatIcon,
  TimerIcon,
  WorkflowIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { deleteWorkflow, getWorkflows, runWorkflow, saveWorkflow } from '@/services/api'
import type { Workflow, WorkflowTriggerKind } from '@/services/api'

// What every workflow screen shares: how a run's state reads, which icon a trigger gets, the polled
// list each page reads its workflow from, and the actions (run, arm, delete) that appear on more
// than one screen - so the list row and a workflow's own header can never disagree.

/** A scheduled run starts on the server with nobody clicking anything, so status is polled. */
export const POLL_MS = 5000

export type RunState = 'running' | 'succeeded' | 'failed' | 'never'

export const runState = (w: Workflow): RunState =>
  w.last_run_status === 'running'
    ? 'running'
    : w.last_run_status === 'failed'
      ? 'failed'
      : w.last_run_status === 'done'
        ? 'succeeded'
        : 'never'

export const isArmed = (w: Workflow) => w.enabled && w.trigger.kind !== 'manual'

export const STATE_META: Record<RunState, { label: string; tone: string }> = {
  running: { label: 'Running', tone: 'text-primary' },
  succeeded: { label: 'Succeeded', tone: 'text-up' },
  failed: { label: 'Failed', tone: 'text-down' },
  never: { label: 'Never run', tone: 'text-muted-foreground' },
}

/** Triggers driven by the clock - they have a "next run"; the rest wait for something to happen. */
export const TIME_KINDS: readonly WorkflowTriggerKind[] = [
  'schedule',
  'interval',
  'weekly',
  'monthly',
  'cron',
  'market',
]

export const TRIGGER_ICON: Record<WorkflowTriggerKind, LucideIcon> = {
  manual: HandIcon,
  schedule: ClockIcon,
  interval: RepeatIcon,
  weekly: CalendarDaysIcon,
  monthly: CalendarIcon,
  cron: TimerIcon,
  market: CandlestickChartIcon,
  event_scan: NewspaperIcon,
  price_alert: BellRingIcon,
  order_event: ReceiptIcon,
  workflow_done: WorkflowIcon,
}

export const secondsBetween = (from: string, to?: string | null) =>
  ((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 1000

/** "Fri 18 Sep, 09:15" - in the browser's zone, which for this app is IST. */
export const formatSlot = (iso: string) => format(new Date(iso), 'EEE d MMM, HH:mm')

export const formatRelative = (iso: string) =>
  new Date(iso).getTime() - Date.now() < 60_000
    ? 'within a minute'
    : `in ${formatDistanceToNowStrict(new Date(iso))}`

const NO_WORKFLOWS: Workflow[] = []

/** The workflow list, polled. Every workflow page reads its workflow from here rather than from a
 *  GET of its own: status stays live on every tab, and the editor's separate copy is never
 *  refetched out from under an unsaved canvas. */
export function useWorkflows() {
  const query = useQuery({ queryKey: ['workflows'], queryFn: getWorkflows, refetchInterval: POLL_MS })
  return { ...query, workflows: query.data ?? NO_WORKFLOWS }
}

export function useWorkflow(workflowId: string) {
  const query = useWorkflows()
  return { ...query, workflow: query.workflows.find((w) => w.id === workflowId) }
}

export function useWorkflowActions() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const openRun = (workflowId: string, runId: string) =>
    navigate({ to: '/workflows/$workflowId/runs/$runId', params: { workflowId, runId } })

  const runNow = useMutation({
    mutationFn: (w: Workflow) => runWorkflow(w.id),
    onSuccess: ({ run_id }, w) => {
      // Shown as running straight away rather than on the next poll: the server writes the run row
      // the moment its thread starts, so this is what the poll is about to say anyway.
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
      queryClient.invalidateQueries({ queryKey: ['workflowRuns', w.id] })
      queryClient.invalidateQueries({ queryKey: ['workflowHealth', w.id] })
      toast.success(`${w.name} started`, {
        description: 'It keeps running if you leave this page.',
        action: { label: 'Watch', onClick: () => openRun(w.id, run_id) },
      })
    },
    onError: (e: Error) => toast.error(e.message),
  })

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
        saved.enabled ? `${saved.name} armed — ${saved.trigger_label ?? ''}` : `${saved.name} disarmed`,
      )
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: (w: Workflow) => deleteWorkflow(w.id),
    onSuccess: (_r, w) => {
      toast.success(`${w.name} deleted`)
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return { runNow, toggle, remove, openRun }
}
