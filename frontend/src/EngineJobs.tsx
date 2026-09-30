// The algo engine's background queue (app/services/engine_jobs.py), as the /engine Jobs tab: every
// job with its live progress, priority and outcome, cancel/retry/remove, and how many run at once.
// "Run in background" on the Backtests and Auto-tune forms queues through useQueueJob().
import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { RotateCcwIcon, SquareIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  cancelEngineJob,
  deleteEngineJob,
  getEngineJobs,
  getEngineJobsConfig,
  queueEngineJob,
  retryEngineJob,
  setEngineJobPriority,
  setEngineJobsConfig,
} from '@/services/api'
import type { EngineJob, EngineJobKind, EngineJobStatus } from '@/services/api'
import { Panel } from './engineUi'

const STATUS: Record<EngineJobStatus, 'success' | 'default' | 'secondary' | 'destructive' | 'outline'> = {
  queued: 'outline',
  running: 'default',
  done: 'success',
  failed: 'destructive',
  cancelled: 'secondary',
  interrupted: 'destructive',
}
const live = (j: EngineJob) => j.status === 'queued' || j.status === 'running'

/** Queues a run with the exact request "Run now" would send. */
export function useQueueJob() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: ({ kind, request }: { kind: EngineJobKind; request: Parameters<typeof queueEngineJob>[1] }) =>
      queueEngineJob(kind, request),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ['engineJobs'] })
      toast.success(`Queued as job #${job.id}`, {
        action: { label: 'View jobs', onClick: () => navigate({ to: '/engine', search: { tab: 'jobs' } }) },
      })
    },
    onError: (e) => toast.error(e.message),
  })
}

function took(a: string | null, b: string | null) {
  if (!a) return ''
  const s = Math.round(((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 1000)
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function what(j: EngineJob) {
  const r = j.request
  const syms = r.symbols.length > 3 ? `${r.symbols.length} stocks` : r.symbols.join(', ')
  const mode = 'mode' in r && j.kind === 'sweep' ? ` ${r.mode}` : ''
  return `${j.label ? `${j.label} · ` : ''}${r.strategy}${mode} · ${syms} · ${r.interval ?? '5m'}`
}

/** Where a finished job's output opens. */
function Output({ job }: { job: EngineJob }) {
  const r = job.result
  if (!r) return null
  const n = r.ids?.length ?? 0
  if (job.kind === 'backtest' && n)
    return n === 1 ? (
      <Link to="/engine/runs/$runId" params={{ runId: r.ids![0] }} className="text-primary hover:underline">
        Open run
      </Link>
    ) : (
      <Link to="/engine" search={{ tab: 'backtest', batch: r.batch, run: r.ids![0] }} className="text-primary hover:underline">
        {n} runs
      </Link>
    )
  if (job.kind === 'sweep' && r.sweep)
    return (
      <Link to="/engine" search={{ tab: 'backtest', sweep: r.sweep }} className="text-primary hover:underline">
        Open sweep
      </Link>
    )
  if (job.kind === 'autotune' && n)
    return (
      <Link
        to="/engine/autotune/$runId"
        params={{ runId: r.batch ?? r.ids![0] }}
        search={{}}
        className="text-primary hover:underline"
      >
        {n === 1 ? 'Open run' : `Open run · ${n} stocks`}
      </Link>
    )
  return null
}

export function JobsPanel() {
  const queryClient = useQueryClient()
  const { data: jobs = [], error } = useQuery({
    queryKey: ['engineJobs'],
    queryFn: getEngineJobs,
    // quick while something is queued or running, lazy otherwise
    refetchInterval: (q) => (q.state.data?.some(live) ? 2000 : 15_000),
  })
  const { data: config } = useQuery({ queryKey: ['engineJobsConfig'], queryFn: getEngineJobsConfig })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['engineJobs'] })
  const workers = useMutation({
    mutationFn: setEngineJobsConfig,
    onSuccess: (c) => queryClient.setQueryData(['engineJobsConfig'], c),
    onError: (e) => toast.error(e.message),
  })
  const act = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'cancel' | 'retry' | 'delete' }) =>
      action === 'cancel' ? cancelEngineJob(id) : action === 'retry' ? retryEngineJob(id) : deleteEngineJob(id),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  })
  const priority = useMutation({
    mutationFn: ({ id, p }: { id: number; p: number }) => setEngineJobPriority(id, p),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  })

  // a job that just finished made runs somewhere: refresh the lists they show up in
  const finished = useRef<Set<number> | null>(null)
  useEffect(() => {
    const now = new Set(jobs.filter((j) => j.status === 'done').map((j) => j.id))
    if (finished.current && [...now].some((id) => !finished.current!.has(id)))
      for (const key of ['engineRuns', 'engineSweeps', 'engineAutotunes'])
        queryClient.invalidateQueries({ queryKey: [key] })
    finished.current = now
  }, [jobs, queryClient])

  const counts = jobs.reduce<Record<string, number>>((c, j) => ({ ...c, [j.status]: (c[j.status] ?? 0) + 1 }), {})
  return (
    <Panel
      title={`Background jobs${counts.running ? ` · ${counts.running} running` : ''}${counts.queued ? ` · ${counts.queued} queued` : ''}`}
      actions={
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Run at once
          <Select
            value={String(config?.workers ?? 1)}
            onValueChange={(v) => workers.mutate(Number(v))}
          >
            <SelectTrigger size="sm" className="w-16">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: config?.max ?? 8 }, (_, i) => (
                <SelectItem key={i} value={String(i + 1)}>
                  {i + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      }
    >
      {error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : !jobs.length ? (
        <p className="text-sm text-muted-foreground">
          Nothing queued yet. <em>Run in background</em> on the Backtests or Auto-tune form puts a run here: it
          keeps going while you work elsewhere, and a queued job survives a server restart.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>#</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right" title="Higher runs first, then oldest first">
                  Priority
                </TableHead>
                <TableHead>Queued</TableHead>
                <TableHead className="text-right">Took</TableHead>
                <TableHead>Output</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((j) => {
                const pct = j.progress?.total ? (100 * j.progress.done) / j.progress.total : null
                const errs = j.result?.errors?.length ?? 0
                return (
                  <TableRow key={j.id}>
                    <TableCell className="tabular-nums text-muted-foreground">{j.id}</TableCell>
                    <TableCell className="capitalize">{j.kind}</TableCell>
                    <TableCell className="max-w-72 truncate" title={what(j)}>
                      {what(j)}
                    </TableCell>
                    <TableCell className="min-w-36">
                      <div className="flex items-center gap-2">
                        <Badge variant={STATUS[j.status]}>{j.cancel && j.status === 'running' ? 'cancelling' : j.status}</Badge>
                        {j.progress && j.status === 'running' && (
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {j.progress.done}/{j.progress.total}
                          </span>
                        )}
                      </div>
                      {pct !== null && j.status === 'running' && (
                        <div className="mt-1 h-1 w-full overflow-hidden rounded bg-muted">
                          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                      {(j.error || errs > 0) && (
                        <p
                          className={cn('mt-1 max-w-64 truncate text-xs', j.error ? 'text-destructive' : 'text-muted-foreground')}
                          title={j.error ?? j.result?.errors?.map((e) => `${e.symbol}: ${e.error}`).join('\n')}
                        >
                          {j.error ?? `${errs} stock${errs === 1 ? '' : 's'} failed`}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {j.status === 'queued' ? (
                        <Input
                          key={j.priority}
                          defaultValue={j.priority}
                          inputMode="numeric"
                          className="ml-auto h-7 w-16 text-right"
                          onBlur={(e) => {
                            const p = Math.round(Number(e.target.value))
                            if (Number.isFinite(p) && p !== j.priority) priority.mutate({ id: j.id, p })
                          }}
                        />
                      ) : (
                        <span className="tabular-nums text-muted-foreground">{j.priority}</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(j.created_at)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{took(j.started_at, j.finished_at)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      <Output job={j} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {live(j) ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={j.cancel}
                          onClick={() => act.mutate({ id: j.id, action: 'cancel' })}
                          title={j.status === 'running' ? 'Stops before the next stock; a backtest or sweep just finishes' : undefined}
                        >
                          <SquareIcon /> Cancel
                        </Button>
                      ) : (
                        <>
                          <Button size="icon-sm" variant="ghost" aria-label="Retry" title="Queue the same request again" onClick={() => act.mutate({ id: j.id, action: 'retry' })}>
                            <RotateCcwIcon />
                          </Button>
                          <Button size="icon-sm" variant="ghost" aria-label="Remove" title="Remove the job - the runs it made stay" onClick={() => act.mutate({ id: j.id, action: 'delete' })}>
                            <Trash2Icon />
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  )
}
