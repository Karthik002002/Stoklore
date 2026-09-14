import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeftIcon } from 'lucide-react'
import DataTable from '@/components/DataTable'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { getWorkflowHealth, getWorkflowSeries } from '@/services/api'

// What a workflow has gathered, and whether it's still working.
//
// Two questions, one screen, because they're the same question asked twice: "is this automation
// earning its keep". The series answers what it found; health answers whether it has been finding
// anything at all - which a feed that has simply gone quiet cannot tell you.

const fmtTime = (v: unknown) =>
  typeof v === 'string' || typeof v === 'number' ? new Date(v).toLocaleString('en-IN') : '—'

/** A plain SVG line chart. No charting library: this plots one numeric column against time, the
 *  scale is two divisions, and a dependency for that would cost more than it saves. */
function Sparkline({ points }: { points: { x: number; y: number }[] }) {
  const { d, lo, hi } = useMemo(() => {
    if (points.length < 2) return { d: '', lo: 0, hi: 0 }
    const ys = points.map((p) => p.y)
    const xs = points.map((p) => p.x)
    const [lo, hi] = [Math.min(...ys), Math.max(...ys)]
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
    // A flat series has no range to divide by - draw it down the middle rather than at NaN.
    const spanY = hi - lo || 1
    const spanX = x1 - x0 || 1
    const d = points
      .map((p, i) => {
        const x = ((p.x - x0) / spanX) * 100
        const y = 100 - ((p.y - lo) / spanY) * 100
        return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`
      })
      .join(' ')
    return { d, lo, hi }
  }, [points])

  if (!d) {
    return (
      <p className="py-10 text-center text-xs text-muted-foreground">
        Two runs are needed before there's a line to draw.
      </p>
    )
  }
  return (
    <div className="relative h-40">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
        role="img"
        aria-label="Collected values over time"
      >
        <path
          d={d}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="0.8"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="absolute top-0 left-0 text-[10px] text-muted-foreground">{hi.toFixed(2)}</span>
      <span className="absolute bottom-0 left-0 text-[10px] text-muted-foreground">{lo.toFixed(2)}</span>
    </div>
  )
}

export default function WorkflowData({ id, name, onBack }: { id: string; name: string; onBack: () => void }) {
  const [series, setSeries] = useState<string | undefined>()
  const [column, setColumn] = useState<string | undefined>()

  const { data, isLoading } = useQuery({
    queryKey: ['workflowSeries', id, series],
    queryFn: () => getWorkflowSeries(id, series),
  })
  const { data: health } = useQuery({
    queryKey: ['workflowHealth', id],
    queryFn: () => getWorkflowHealth(id),
  })

  const plotted = column ?? data?.numeric[0]
  const points = useMemo(() => {
    if (!plotted || !data) return []
    return data.rows
      .map((r) => ({ x: new Date(String(r.collected_at)).getTime(), y: Number(r[plotted]) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .sort((a, b) => a.x - b.x)
  }, [data, plotted])

  // Columns are whatever the series actually holds - a collected row's shape is the wired tool's
  // shape, so they're derived from the data rather than declared.
  const columns = useMemo(() => {
    const cell = (value: unknown) =>
      typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '—')
    return [
      {
        id: 'collected_at',
        header: 'Collected',
        accessorKey: 'collected_at',
        cell: (c: { getValue: () => unknown }) => fmtTime(c.getValue()),
      },
      ...(data?.columns ?? []).map((key) => ({
        id: key,
        header: key,
        accessorKey: key,
        cell: (c: { getValue: () => unknown }) => cell(c.getValue()),
      })),
    ] as never
  }, [data?.columns])

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-3 flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeftIcon className="size-4" />
          All workflows
        </Button>
        <h2 className="font-medium">{name}</h2>
      </div>

      {health && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Runs kept" value={String(health.total)} />
          <Stat label="Failed" value={String(health.failed)} tone={health.failed ? 'bad' : undefined} />
          <Stat label="Avg duration" value={health.avg_seconds == null ? '—' : `${health.avg_seconds}s`} />
          <Stat
            label="Worst node"
            value={
              health.failing_nodes[0]
                ? `${health.failing_nodes[0].name} ×${health.failing_nodes[0].failures}`
                : '—'
            }
            tone={health.failing_nodes.length ? 'bad' : undefined}
          />
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-5" />
        </div>
      ) : !data?.series.length ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nothing collected yet. Add a <code>collect</code> node and run it — each run appends its rows here,
          keeping the last N.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select value={data.selected ?? undefined} onValueChange={(v) => setSeries(v as string)}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Series" />
              </SelectTrigger>
              <SelectContent>
                {data.series.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {data.numeric.length > 0 && (
              <Select value={plotted} onValueChange={(v) => setColumn(v as string)}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Plot column" />
                </SelectTrigger>
                <SelectContent>
                  {data.numeric.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <span className="text-xs text-muted-foreground">{data.rows.length} rows</span>
          </div>

          {data.numeric.length > 0 && (
            <div className="mb-4 rounded-xl border bg-card p-3">
              <Sparkline points={points} />
            </div>
          )}

          <DataTable columns={columns} data={data.rows as never} sortable emptyMessage="No rows yet." />
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`truncate text-sm font-medium ${tone === 'bad' ? 'text-down' : ''}`}>{value}</p>
    </div>
  )
}
