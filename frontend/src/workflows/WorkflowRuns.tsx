import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime, formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { getWorkflowHealth } from '@/services/api'
import { POLL_MS, STATE_META, secondsBetween } from './status'
import StateIcon from './StateIcon'
import type { RunState } from './status'

// Every run this workflow has kept, newest first, filterable by outcome (`?status=failed`). A row
// opens the run's diagram. Read off the health endpoint, which already carries each run's duration.

const FILTERS = [
  { key: undefined, label: 'All' },
  { key: 'failed', label: 'Failed' },
  { key: 'done', label: 'Succeeded' },
  { key: 'running', label: 'Running' },
] as const

const stateOf = (status: 'running' | 'done' | 'failed'): RunState =>
  status === 'done' ? 'succeeded' : status

export default function WorkflowRuns() {
  const navigate = useNavigate()
  const { workflowId } = useParams({ from: '/workflows/$workflowId' })
  const { status } = useSearch({ from: '/workflows/$workflowId/runs' })
  const { data: health, isLoading } = useQuery({
    queryKey: ['workflowHealth', workflowId],
    queryFn: () => getWorkflowHealth(workflowId),
    refetchInterval: POLL_MS,
  })

  const runs = health?.runs ?? []
  const shown = status ? runs.filter((r) => r.status === status) : runs

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-4 py-2">
        {FILTERS.map((f) => {
          const count = f.key ? runs.filter((r) => r.status === f.key).length : runs.length
          return (
            <Link
              key={f.label}
              to="/workflows/$workflowId/runs"
              params={{ workflowId }}
              search={{ status: f.key }}
              replace
              className={cn(
                'rounded-md px-2.5 py-1 text-xs transition-colors hover:bg-muted',
                status === f.key && 'bg-muted font-medium',
              )}
            >
              {f.label} <span className="text-muted-foreground tabular-nums">{count}</span>
            </Link>
          )
        })}
        <span className="ml-auto text-[11px] text-muted-foreground">
          The last {runs.length} runs are kept
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-5" />
          </div>
        ) : shown.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {runs.length ? 'No runs match this filter.' : 'Never run. Press Run now, or arm it.'}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Outcome</TableHead>
                <TableHead className="w-48">Started</TableHead>
                <TableHead className="w-28">Duration</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => {
                const state = stateOf(r.status)
                return (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() =>
                      navigate({
                        to: '/workflows/$workflowId/runs/$runId',
                        params: { workflowId, runId: r.id },
                      })
                    }
                  >
                    <TableCell>
                      <Link
                        to="/workflows/$workflowId/runs/$runId"
                        params={{ workflowId, runId: r.id }}
                        className={cn(
                          'flex items-center gap-1.5 text-xs font-medium',
                          STATE_META[state].tone,
                        )}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <StateIcon state={state} />
                        {STATE_META[state].label}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">{formatDateTime(r.created_at)}</TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {formatDuration(r.seconds ?? secondsBetween(r.created_at, r.finished_at))}
                    </TableCell>
                    <TableCell className="max-w-0 truncate text-xs text-down" title={r.error ?? undefined}>
                      {r.error}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
