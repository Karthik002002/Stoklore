import { Link, Outlet, useLocation, useParams } from '@tanstack/react-router'
import { ArrowLeftIcon, PlayIcon, PowerIcon } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { usePageTitle } from '@/lib/usePageTitle'
import {
  STATE_META,
  TRIGGER_ICON,
  formatRelative,
  formatSlot,
  isArmed,
  runState,
  useWorkflow,
  useWorkflowActions,
} from './status'
import StateIcon from './StateIcon'

// /workflows is its own section now, not a tab of the agent: workflows grew triggers, a run history,
// data and an inbox, and each of those is a screen. The shell is the card they all sit in; the
// layout is one workflow - who it is and what it's doing, then a tab per screen. Every tab is a
// route, so a reload or a notification click lands on the tab it was about.

export function WorkflowsShell() {
  usePageTitle('Workflows')
  return (
    <div className="h-[calc(100vh-5rem)] overflow-hidden rounded-xl border bg-card">
      <Outlet />
    </div>
  )
}

const TABS = [
  { key: 'overview', label: 'Overview', to: '/workflows/$workflowId' },
  { key: 'editor', label: 'Editor', to: '/workflows/$workflowId/editor' },
  { key: 'runs', label: 'Runs', to: '/workflows/$workflowId/runs' },
  { key: 'data', label: 'Data', to: '/workflows/$workflowId/data' },
  { key: 'notifications', label: 'Notifications', to: '/workflows/$workflowId/notifications' },
] as const

export default function WorkflowLayout() {
  const { workflowId } = useParams({ from: '/workflows/$workflowId' })
  // /workflows/<id>/<section>/... - the overview has no segment of its own.
  const section = useLocation({ select: (l) => l.pathname.split('/')[3] || 'overview' })
  const { workflow, isLoading } = useWorkflow(workflowId)
  const { runNow, toggle, openRun } = useWorkflowActions()

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    )
  }
  if (!workflow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>This workflow doesn't exist — it may have been deleted.</p>
        <Link to="/workflows" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
          <ArrowLeftIcon className="size-4" />
          All workflows
        </Link>
      </div>
    )
  }

  const state = runState(workflow)
  const TriggerIcon = TRIGGER_ICON[workflow.trigger.kind]
  const running = state === 'running'
  const starting = runNow.isPending && runNow.variables?.id === workflow.id
  const arming = toggle.isPending && toggle.variables?.id === workflow.id

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b px-3 pt-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            to="/workflows"
            className={buttonVariants({ size: 'icon-sm', variant: 'ghost' })}
            aria-label="All workflows"
            title="All workflows"
          >
            <ArrowLeftIcon />
          </Link>
          <h2 className="max-w-[40ch] truncate font-medium">{workflow.name}</h2>
          {workflow.last_run_id ? (
            <Link
              to="/workflows/$workflowId/runs/$runId"
              params={{ workflowId, runId: workflow.last_run_id }}
              className={cn('flex items-center gap-1 text-xs hover:underline', STATE_META[state].tone)}
              title="Open the latest run"
            >
              <StateIcon state={state} />
              {STATE_META[state].label}
            </Link>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <StateIcon state="never" />
              Never run
            </span>
          )}
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <TriggerIcon className="size-3.5" />
            {workflow.trigger_label}
          </span>
          {isArmed(workflow) && workflow.next_run_at && (
            <span className="text-xs text-muted-foreground" title={formatSlot(workflow.next_run_at)}>
              next {formatRelative(workflow.next_run_at)}
            </span>
          )}
          {/* The editor has its own Save & run, which runs what's on the canvas - two Run buttons
              there would run two different versions. */}
          {section !== 'editor' && (
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={running || starting}
                onClick={() =>
                  runNow.mutate(workflow, {
                    // Already looking at runs: follow the new one rather than toast about it.
                    onSuccess: ({ run_id }) => section === 'runs' && openRun(workflow.id, run_id),
                  })
                }
                title={running ? 'Already running — one run at a time' : undefined}
              >
                {running || starting ? <Spinner className="size-3.5" /> : <PlayIcon className="size-3.5" />}
                {running ? 'Running' : 'Run now'}
              </Button>
              <Button
                size="sm"
                variant={workflow.enabled ? 'default' : 'outline'}
                disabled={workflow.trigger.kind === 'manual' || arming}
                onClick={() => toggle.mutate(workflow)}
                title={
                  workflow.trigger.kind === 'manual' ? 'Manual workflows have nothing to arm' : undefined
                }
              >
                {arming ? <Spinner className="size-3.5" /> : <PowerIcon className="size-3.5" />}
                {workflow.enabled ? 'Armed' : 'Off'}
              </Button>
            </div>
          )}
        </div>
        <nav className="-mb-px mt-1 flex gap-1 overflow-x-auto" aria-label="Workflow sections">
          {TABS.map((tab) => (
            <Link
              key={tab.key}
              to={tab.to}
              params={{ workflowId }}
              activeOptions={{ exact: tab.key === 'overview' }}
              className="flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground [&.active]:border-primary [&.active]:text-foreground"
            >
              {tab.label}
              {tab.key === 'notifications' && !!workflow.unread && (
                <span className="rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground tabular-nums">
                  {workflow.unread}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
