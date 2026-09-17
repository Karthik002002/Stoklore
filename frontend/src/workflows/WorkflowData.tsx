import { useMemo } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import type { UTCTimestamp } from 'lightweight-charts'
import DataTable from '@/components/DataTable'
import SeriesChart from '@/components/charts/SeriesChart'
import { seriesColor } from '@/components/charts/colors'
import type { Dataset } from '@/components/charts/colors'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { LayoutGridIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createDashboardFromWorkflow, getWorkflowSeries } from '@/services/api'

// What a workflow has gathered: its collected series as a chart and a table. Whether it is still
// working - runs, failures, durations - is on the Overview tab.
//
// Route: /workflows/$workflowId/data - the series, plotted column and split are all in the
// URL, so a reload shows the same chart.

const fmtTime = (v: unknown) =>
  typeof v === 'string' || typeof v === 'number' ? new Date(v).toLocaleString('en-IN') : '—'

/** A split column has to name groups, not be one: 2..MAX_GROUPS distinct plain values. */
const MAX_GROUPS = 60
const NONE = 'none'

export default function WorkflowData() {
  const navigate = useNavigate()
  const { workflowId: id } = useParams({ from: '/workflows/$workflowId/data' })
  const { series, column, by } = useSearch({ from: '/workflows/$workflowId/data' })

  const setSearch = (next: { series?: string; column?: string; by?: string }) =>
    navigate({
      to: '/workflows/$workflowId/data',
      params: { workflowId: id },
      search: (prev) => ({ ...prev, ...next }),
      replace: true,
    })

  const { data, isLoading } = useQuery({
    queryKey: ['workflowSeries', id, series],
    queryFn: () => getWorkflowSeries(id, series),
  })

  // A stale ?column= from another series falls back to the first plottable one.
  const plotted = column && data?.numeric.includes(column) ? column : data?.numeric[0]

  // Columns that name groups - a symbol, a sector - and so can split the chart into datasets.
  const splitColumns = useMemo(() => {
    if (!data) return []
    return data.columns.filter((key) => {
      if (data.numeric.includes(key)) return false
      const values = new Set<string>()
      for (const row of data.rows) {
        const v = row[key]
        if (v !== null && typeof v === 'object') return false
        values.add(String(v ?? '—'))
        if (values.size > MAX_GROUPS) return false
      }
      return values.size >= 2
    })
  }, [data])

  const split =
    by === NONE
      ? undefined
      : by && splitColumns.includes(by)
        ? by
        : splitColumns.includes('symbol')
          ? 'symbol'
          : splitColumns[0]

  const datasets = useMemo<Dataset[]>(() => {
    if (!plotted || !data) return []
    const groups = new Map<string, Map<number, number>>()
    for (const row of data.rows) {
      const ms = new Date(String(row.collected_at)).getTime()
      const raw = row[plotted]
      const value = Number(raw)
      if (!Number.isFinite(ms) || raw === null || raw === '' || !Number.isFinite(value)) continue
      // lightweight-charts labels its axis in UTC; shifting by the local offset makes it read as
      // wall-clock time here, as PriceChart does for IST bars.
      const time = Math.floor(ms / 1000) - new Date(ms).getTimezoneOffset() * 60
      const key = split ? String(row[split] ?? '—') : plotted
      if (!groups.has(key)) groups.set(key, new Map())
      groups.get(key)?.set(time, value)
    }
    // Alphabetical, so a symbol keeps its colour from one run to the next.
    return [...groups.keys()].sort().map((key, i) => ({
      key,
      color: seriesColor(i),
      points: [...(groups.get(key) ?? [])]
        .sort((a, b) => a[0] - b[0])
        .map(([time, value]) => ({ time: time as UTCTimestamp, value })),
    }))
  }, [data, plotted, split])

  const runCount = useMemo(() => new Set(data?.rows.map((r) => r.run_id)).size, [data])

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
            <Select
              value={data.selected ?? undefined}
              onValueChange={(v) => setSearch({ series: v as string, column: undefined, by: undefined })}
            >
              <SelectTrigger className="w-44" aria-label="Series">
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
              <Select value={plotted} onValueChange={(v) => setSearch({ column: v as string })}>
                <SelectTrigger className="w-44" aria-label="Plotted column">
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
            {splitColumns.length > 0 && (
              <Select value={split ?? NONE} onValueChange={(v) => setSearch({ by: v as string })}>
                <SelectTrigger className="w-44" aria-label="Split lines by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>One line</SelectItem>
                  {splitColumns.map((c) => (
                    <SelectItem key={c} value={c}>
                      A line per {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <span className="text-xs text-muted-foreground">
              {data.rows.length} rows · {runCount} run{runCount === 1 ? '' : 's'}
            </span>
            <BuildDashboard workflowId={id} />
          </div>

          {data.numeric.length > 0 && (
            <div className="mb-4 rounded-xl border bg-card p-3">
              {datasets.length ? (
                <>
                  <SeriesChart datasets={datasets} />
                  {runCount === 1 && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      One run so far, so each line is a single point — every run adds the next one.
                    </p>
                  )}
                </>
              ) : (
                <p className="py-10 text-center text-xs text-muted-foreground">
                  No numeric values in {plotted}.
                </p>
              )}
            </div>
          )}

          <DataTable columns={columns} data={data.rows as never} sortable emptyMessage="No rows yet." />
        </>
      )}
    </div>
  )
}

/** One click from a workflow's data to a dashboard of it: a stat and a line per number, a top-10, a
 *  table, a heatmap and its health, with a dropdown for the field that names things. */
function BuildDashboard({ workflowId }: { workflowId: string }) {
  const navigate = useNavigate()
  const build = useMutation({
    mutationFn: () => createDashboardFromWorkflow(workflowId),
    onSuccess: (dashboard) => {
      toast.success(`${dashboard.name} created`)
      navigate({ to: '/dashboards/$dashboardId', params: { dashboardId: dashboard.id } })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Button
      size="sm"
      variant="outline"
      className="ml-auto"
      onClick={() => build.mutate()}
      disabled={build.isPending}
    >
      <LayoutGridIcon className="size-3.5" />
      Build a dashboard
    </Button>
  )
}
