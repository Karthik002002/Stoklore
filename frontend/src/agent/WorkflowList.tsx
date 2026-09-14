import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  BellIcon,
  ClockIcon,
  HandIcon,
  NewspaperIcon,
  PlayIcon,
  PlusIcon,
  PowerIcon,
  ChartNoAxesCombinedIcon,
  AlertTriangleIcon,
  Trash2Icon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  createFromTemplate,
  deleteWorkflow,
  getWorkflowTemplates,
  getWorkflows,
  runWorkflow,
  saveWorkflow,
} from '@/services/api'
import type { Workflow } from '@/services/api'
import { askToNotify, canNotify } from './useRunNotifications'

// Managing workflows: what exists, what's armed, and what each one last did.
//
// The arm button is the whole safety model. A workflow runs with nobody watching, so "enabled" is the
// standing permission - and it's on the row rather than buried in the editor, because turning one
// OFF is the thing you want to do in a hurry.
const TRIGGER_ICON = { schedule: ClockIcon, manual: HandIcon, event_scan: NewspaperIcon }

const triggerLabel = (w: Workflow) =>
  w.trigger.kind === 'schedule'
    ? `Daily at ${w.trigger.time ?? '09:15'} IST`
    : w.trigger.kind === 'event_scan'
      ? 'After the daily event scan'
      : 'Manual only'

export default function WorkflowList({
  onOpen,
  onData,
}: {
  onOpen: (id: string | null) => void
  onData: (id: string, name: string) => void
}) {
  const queryClient = useQueryClient()
  const { data: workflows = [], isLoading } = useQuery({
    queryKey: ['workflows'],
    queryFn: getWorkflows,
  })
  const { data: templates = [] } = useQuery({
    queryKey: ['workflowTemplates'],
    queryFn: getWorkflowTemplates,
  })

  // Cloned disarmed on purpose - a template is a starting point, and arming something you haven't
  // read yet is exactly the surprise this feature must not spring.
  const clone = useMutation({
    mutationFn: (templateId: string) => createFromTemplate(templateId),
    onSuccess: (w) => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      toast.success(`${w.name} added — read it, then arm it`)
      onOpen(w.id)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['workflows'] })

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
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  })

  const runNow = useMutation({
    mutationFn: (w: Workflow) => runWorkflow(w.id),
    onSuccess: (_r, w) => {
      toast.success(`${w.name} started — it runs in the background`)
      queryClient.invalidateQueries({ queryKey: ['agentRunsRunning'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: (w: Workflow) => deleteWorkflow(w.id),
    onSuccess: refresh,
  })

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-medium">Workflows</h2>
          <p className="text-xs text-muted-foreground">
            The same tools the chat uses, wired by hand and run without you. Chat waits for you; these don't.
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
          <Button size="sm" onClick={() => onOpen(null)}>
            <PlusIcon className="size-4" />
            New workflow
          </Button>
        </div>
      </div>

      {/* The on-ramp. The distance from an empty canvas to something useful is where a node
          editor usually dies, so the first workflow should be one you edit, not one you invent. */}
      {!isLoading && templates.length > 0 && (
        <div className="mb-4">
          <p className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Start from one of these
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={clone.isPending}
                onClick={() => clone.mutate(t.id)}
                className="rounded-xl border border-dashed bg-card p-3 text-left hover:border-primary hover:bg-muted/50"
              >
                <p className="text-sm font-medium">{t.name}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{t.description}</p>
                <p className="mt-1 text-[11px] text-primary">{t.nodes} nodes · clone &amp; edit</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {isLoading ? null : workflows.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Nothing wired yet. Clone one above, or build a trigger, some tool nodes and somewhere to file what
          it found.
        </p>
      ) : (
        <div className="space-y-2">
          {workflows.map((w) => {
            const Icon = TRIGGER_ICON[w.trigger.kind] ?? HandIcon
            return (
              <div key={w.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(w.id)}>
                  <p className="flex items-center gap-2 font-medium">
                    {w.name}
                    <Badge variant="secondary">{w.graph?.nodes?.length ?? 0} nodes</Badge>
                    {w.enabled && w.trigger.kind !== 'manual' && <Badge>armed</Badge>}
                    {/* A streak is the thing you'd otherwise only notice by the absence of
                        alerts, which is exactly how a broken workflow hides. */}
                    {w.fail_streak > 0 && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangleIcon className="size-3" />
                        {w.fail_streak} failed in a row
                      </Badge>
                    )}
                  </p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon className="size-3" />
                    {triggerLabel(w)}
                    {w.last_run_date && ` · last ran ${w.last_run_date}`}
                  </p>
                </button>
                <Button size="sm" variant="ghost" onClick={() => onData(w.id, w.name)}>
                  <ChartNoAxesCombinedIcon className="size-3.5" />
                  Data
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={runNow.isPending}
                  onClick={() => runNow.mutate(w)}
                >
                  <PlayIcon className="size-3.5" />
                  Run now
                </Button>
                {/* Only meaningful for a triggered workflow - a manual one has nothing to arm.
                    A button rather than a switch because this project has no switch component and
                    one toggle does not justify adding one. */}
                <Button
                  size="sm"
                  variant={w.enabled ? 'default' : 'outline'}
                  disabled={w.trigger.kind === 'manual' || toggle.isPending}
                  onClick={() => toggle.mutate(w)}
                  aria-label={`${w.enabled ? 'Disarm' : 'Arm'} ${w.name}`}
                >
                  <PowerIcon className="size-3.5" />
                  {w.enabled ? 'Armed' : 'Off'}
                </Button>
                <button type="button" aria-label={`Delete ${w.name}`} onClick={() => remove.mutate(w)}>
                  <Trash2Icon className="size-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
