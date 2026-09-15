import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon, RotateCcwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { formatDateTime, formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { getRunWorkflow, getWorkflow, getWorkflowRuns, runWorkflow } from '@/services/api'
import RunDiagram from './RunDiagram'

// One workflow run: /agent/workflows/$workflowId/runs/$runId, with `?node=` the step open in the
// details drawer. Its own page so a failure is a link - to the run, and to the step that broke.

const STATUS = {
  running: ['Running', 'bg-primary/10 text-primary'],
  done: ['Succeeded', 'bg-up/10 text-up'],
  failed: ['Failed', 'bg-down/10 text-down'],
} as const

export default function WorkflowRun() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { workflowId, runId } = useParams({ from: '/agent/workflows/$workflowId/runs/$runId' })
  const { node } = useSearch({ from: '/agent/workflows/$workflowId/runs/$runId' })

  const { data: workflow } = useQuery({
    queryKey: ['workflow', workflowId],
    queryFn: () => getWorkflow(workflowId),
  })
  // Same key as RunDiagram's, so this shares its request and its live polling.
  const { data: graph } = useQuery({
    queryKey: ['agentWorkflow', runId],
    queryFn: () => getRunWorkflow(runId),
  })
  const { data: runs = [] } = useQuery({
    queryKey: ['workflowRuns', workflowId],
    queryFn: () => getWorkflowRuns(workflowId),
    refetchInterval: 5000,
  })

  const run = graph?.run
  const index = runs.findIndex((r) => r.id === runId)
  const newer = index > 0 ? runs[index - 1] : undefined
  const older = index >= 0 ? runs[index + 1] : undefined

  const goToRun = (id: string, replace = false) =>
    navigate({
      to: '/agent/workflows/$workflowId/runs/$runId',
      params: { workflowId, runId: id },
      replace,
    })

  const rerun = useMutation({
    mutationFn: () => runWorkflow(workflowId),
    onSuccess: ({ run_id }) => {
      queryClient.invalidateQueries({ queryKey: ['workflowRuns', workflowId] })
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      goToRun(run_id)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const [label, tone] = run ? STATUS[run.status] : ['', '']
  const took =
    run?.finished_at != null
      ? formatDuration((new Date(run.finished_at).getTime() - new Date(run.created_at).getTime()) / 1000)
      : null

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <Link
          to="/agent/workflows/$workflowId"
          params={{ workflowId }}
          className={buttonVariants({ size: 'sm', variant: 'ghost' })}
        >
          <ArrowLeftIcon className="size-4" />
          <span className="max-w-56 truncate">{workflow?.name ?? 'Editor'}</span>
        </Link>
        {run && (
          <>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', tone)}>
              {run.status === 'running' && <Spinner className="mr-1 inline size-3" />}
              {label}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(run.created_at)}
              {took && ` · took ${took}`}
            </span>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          {runs.length > 1 && index >= 0 && (
            <span className="mr-1 text-[11px] text-muted-foreground tabular-nums">
              Run {runs.length - index} of {runs.length}
            </span>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={!older}
            onClick={() => older && goToRun(older.id, true)}
            aria-label="Older run"
            title="Older run"
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={!newer}
            onClick={() => newer && goToRun(newer.id, true)}
            aria-label="Newer run"
            title="Newer run"
          >
            <ChevronRightIcon />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={rerun.isPending || run?.status === 'running'}
            onClick={() => rerun.mutate()}
          >
            {rerun.isPending ? <Spinner className="size-3.5" /> : <RotateCcwIcon className="size-3.5" />}
            Run again
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <RunDiagram
          runId={runId}
          selectedId={node}
          onSelect={(id) =>
            navigate({
              to: '/agent/workflows/$workflowId/runs/$runId',
              params: { workflowId, runId },
              search: { node: id ?? undefined },
              replace: true,
            })
          }
          empty="This run hasn't reported a node yet."
        />
      </div>
    </div>
  )
}
