import { Fragment, useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Group } from '@visx/group'
import { Pie } from '@visx/shape'
import { format } from 'date-fns'
import { BellIcon, CircleCheckIcon, CircleXIcon } from 'lucide-react'
import SeriesChart from '@/components/charts/SeriesChart'
import { chartTime, seriesColor } from '@/components/charts/colors'
import { Spinner } from '@/components/ui/spinner'
import { formatDuration, timeAgoShort } from '@/lib/format'
import { cn } from '@/lib/utils'
import { queryPanel } from '@/services/api'
import type {
  DashboardPanel,
  ShapedAggregate,
  ShapedHeatmap,
  ShapedRows,
  ShapedSeries,
  ShapedStat,
} from '@/services/api'
import { formatSlot } from '@/workflows/status'
import { formatValue, missingParam, panelRequest, withShape } from './shared'
import type { DrillPoint, PanelContext } from './shared'

// What each panel type draws from its query's shape. Every mark that stands for data is clickable
// and hands back a DrillPoint - the group and time bucket it belongs to - which opens the rows behind
// it. Tables open a row; the health strip and notifications link straight to the run or notification.

type Props = {
  panel: DashboardPanel
  ctx: PanelContext
  onDrill: (point: DrillPoint) => void
  onOpenRow: (row: Record<string, unknown>) => void
}

export function Empty({ children, tone }: { children: React.ReactNode; tone?: 'bad' }) {
  return (
    <div
      className={cn(
        'flex h-full items-center justify-center p-2 text-center text-xs',
        tone === 'bad' ? 'text-down' : 'text-muted-foreground',
      )}
    >
      {children}
    </div>
  )
}

export function PanelBody({ panel, ctx, onDrill, onOpenRow }: Props) {
  const missing = missingParam(panel)
  const { data, error, isLoading } = useQuery({
    queryKey: ['panel', ctx.dashboardId, panel.id, withShape(panel), ctx.variables, ctx.from, ctx.to],
    queryFn: () => queryPanel<unknown>(panelRequest(panel, ctx)),
    refetchInterval: ctx.refresh ? ctx.refresh * 1000 : false,
    placeholderData: keepPreviousData,
    retry: false,
    enabled: !missing,
  })

  if (missing) return <Empty>{missing}</Empty>
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-4" />
      </div>
    )
  }
  if (error) return <Empty tone="bad">{(error as Error).message}</Empty>
  if (!data) return <Empty>No data</Empty>

  switch (panel.type) {
    case 'timeseries':
      return <TimeSeriesViz data={data as ShapedSeries} panel={panel} onDrill={onDrill} />
    case 'stat':
      return <StatViz data={data as ShapedStat} panel={panel} onDrill={onDrill} />
    case 'table':
      return <TableViz data={data as ShapedRows} onOpenRow={onOpenRow} />
    case 'bar':
      return <BarViz data={data as ShapedAggregate} panel={panel} onDrill={onDrill} />
    case 'pie':
      return <PieViz data={data as ShapedAggregate} panel={panel} onDrill={onDrill} />
    case 'heatmap':
      return <HeatmapViz data={data as ShapedHeatmap} panel={panel} onDrill={onDrill} />
    case 'health':
      return <HealthViz data={data as ShapedRows} />
    case 'notifications':
      return <NotificationsViz data={data as ShapedRows} />
  }
}

function TimeSeriesViz({
  data,
  panel,
  onDrill,
}: {
  data: ShapedSeries
  panel: DashboardPanel
  onDrill: Props['onDrill']
}) {
  const { datasets, isoAt } = useMemo(() => {
    const iso = new Map<string, string>()
    const sets = data.series.map((s, i) => {
      const seen = new Set<number>()
      const points = s.points
        .map((p) => ({ time: chartTime(p.time), value: p.value, iso: p.time }))
        .sort((a, b) => a.time - b.time)
        // lightweight-charts refuses two points at one second; buckets that close are one point.
        .filter((p) => !seen.has(p.time) && seen.add(p.time))
      for (const p of points) iso.set(`${s.key}|${p.time}`, p.iso)
      return { key: s.key, color: seriesColor(i), points: points.map(({ time, value }) => ({ time, value })) }
    })
    return { datasets: sets, isoAt: iso }
  }, [data])

  if (!datasets.length) return <Empty>No data in this range</Empty>
  return (
    <SeriesChart
      fill
      datasets={datasets}
      format={(v) => formatValue(v, panel.options)}
      onPointClick={(key, time) =>
        onDrill({ group: panel.query.group_by ? key : undefined, bucket: isoAt.get(`${key}|${time}`) })
      }
    />
  )
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const [lo, hi] = [Math.min(...values), Math.max(...values)]
  const span = hi - lo || 1
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - lo) / span) * 26}`)
    .join(' ')
  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className="h-8 w-full text-sky-500"
      aria-hidden="true"
    >
      <polygon points={`0,30 ${points} 100,30`} fill="currentColor" opacity="0.12" />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function StatViz({
  data,
  panel,
  onDrill,
}: {
  data: ShapedStat
  panel: DashboardPanel
  onDrill: Props['onDrill']
}) {
  if (data.value == null) return <Empty>No data in this range</Empty>
  // Up is good unless the panel says a rise is bad - more failures, longer durations.
  const good =
    data.change == null || data.change === 0 ? null : data.change > 0 !== (panel.options.tone === 'bad')
  return (
    <button
      type="button"
      onClick={() => onDrill({ bucket: data.at ?? undefined })}
      className="flex h-full w-full flex-col justify-between rounded-md text-left transition-colors hover:bg-muted/30"
      title="See the rows behind this number"
    >
      <div className="min-w-0">
        <p className="truncate text-3xl font-semibold tabular-nums">
          {formatValue(data.value, panel.options)}
        </p>
        {data.change != null && (
          <p
            className={cn(
              'text-xs tabular-nums',
              good === null ? 'text-muted-foreground' : good ? 'text-up' : 'text-down',
            )}
          >
            {data.change > 0 ? '▲' : data.change < 0 ? '▼' : '•'}{' '}
            {formatValue(Math.abs(data.change), panel.options)}{' '}
            <span className="text-muted-foreground">vs {formatValue(data.previous, panel.options)}</span>
          </p>
        )}
        {data.at && <p className="text-[11px] text-muted-foreground">{formatSlot(data.at)}</p>}
      </div>
      <Sparkline values={data.spark.map((p) => p.value)} />
    </button>
  )
}

const cell = (value: unknown) => {
  if (value == null) return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number')
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return formatSlot(value)
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

export function RowsTable({
  rows,
  columns,
  onOpenRow,
  extra,
}: {
  rows: Record<string, unknown>[]
  columns: string[]
  onOpenRow?: (row: Record<string, unknown>) => void
  extra?: (row: Record<string, unknown>) => React.ReactNode
}) {
  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 z-10 bg-card">
        <tr>
          {extra && <th className="border-b px-2 py-1" />}
          {columns.map((c) => (
            <th
              key={c}
              className="border-b px-2 py-1 text-left font-medium whitespace-nowrap text-muted-foreground"
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            // biome-ignore lint/suspicious/noArrayIndexKey: rows carry no id of their own
            key={i}
            onClick={onOpenRow ? () => onOpenRow(row) : undefined}
            className={cn(onOpenRow && 'cursor-pointer', 'hover:bg-muted/40')}
          >
            {extra && <td className="border-b px-2 py-1 whitespace-nowrap">{extra(row)}</td>}
            {columns.map((c) => (
              <td
                key={c}
                className={cn(
                  'max-w-72 truncate border-b px-2 py-1 whitespace-nowrap',
                  typeof row[c] === 'number' && 'text-right tabular-nums',
                  typeof row[c] === 'number' && (row[c] as number) < 0 && 'text-down',
                )}
                title={typeof row[c] === 'string' ? (row[c] as string) : undefined}
              >
                {cell(row[c])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TableViz({ data, onOpenRow }: { data: ShapedRows; onOpenRow: Props['onOpenRow'] }) {
  if (!data.rows.length) return <Empty>No rows in this range</Empty>
  return (
    <div className="h-full overflow-auto">
      <RowsTable rows={data.rows} columns={data.columns.map((c) => c.name)} onOpenRow={onOpenRow} />
      {data.total > data.rows.length && (
        <p className="px-2 py-1 text-[11px] text-muted-foreground">
          Showing {data.rows.length} of {data.total} — raise the limit in the panel to see more.
        </p>
      )}
    </div>
  )
}

function BarViz({
  data,
  panel,
  onDrill,
}: {
  data: ShapedAggregate
  panel: DashboardPanel
  onDrill: Props['onDrill']
}) {
  if (!data.items.length) return <Empty>No data in this range</Empty>
  const max = Math.max(...data.items.map((i) => Math.abs(i.value))) || 1
  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto">
      {data.items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onDrill({ group: panel.query.group_by ? item.key : undefined })}
          className="grid grid-cols-[minmax(3.5rem,32%)_1fr_auto] items-center gap-2 rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-muted/50"
          title={`${item.key}: ${formatValue(item.value, panel.options)} (${item.count} rows)`}
        >
          <span className="truncate">{item.key}</span>
          <span className="h-3 overflow-hidden rounded-sm bg-muted/60">
            <span
              className={cn(
                'block h-full rounded-sm transition-[width] duration-300',
                item.value < 0 ? 'bg-down' : 'bg-sky-500',
              )}
              style={{ width: `${(Math.abs(item.value) / max) * 100}%` }}
            />
          </span>
          <span className="text-muted-foreground tabular-nums">{formatValue(item.value, panel.options)}</span>
        </button>
      ))}
    </div>
  )
}

function PieViz({
  data,
  panel,
  onDrill,
}: {
  data: ShapedAggregate
  panel: DashboardPanel
  onDrill: Props['onDrill']
}) {
  const items = data.items.filter((i) => i.value > 0)
  if (!items.length) return <Empty>No data in this range</Empty>
  const total = items.reduce((sum, i) => sum + i.value, 0)
  const drill = (key: string) => onDrill({ group: panel.query.group_by ? key : undefined })
  return (
    <div className="flex h-full min-h-0 items-center gap-3">
      <svg
        viewBox="0 0 100 100"
        className="aspect-square h-full max-h-full shrink-0"
        role="img"
        aria-label={panel.title}
      >
        <Group top={50} left={50}>
          <Pie data={items} pieValue={(d) => d.value} outerRadius={48} innerRadius={28} padAngle={0.012}>
            {(pie) =>
              pie.arcs.map((arc, i) => (
                // biome-ignore lint/a11y/useKeyWithClickEvents: the legend beside it is the keyboard path
                <path
                  key={arc.data.key}
                  d={pie.path(arc) ?? ''}
                  fill={seriesColor(i)}
                  className="cursor-pointer transition-opacity hover:opacity-75"
                  onClick={() => drill(arc.data.key)}
                >
                  <title>{`${arc.data.key}: ${formatValue(arc.data.value, panel.options)}`}</title>
                </path>
              ))
            }
          </Pie>
        </Group>
      </svg>
      <ul className="max-h-full min-w-0 flex-1 space-y-0.5 overflow-y-auto text-xs">
        {items.map((item, i) => (
          <li key={item.key}>
            <button
              type="button"
              onClick={() => drill(item.key)}
              className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-muted/50"
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: seriesColor(i) }} />
              <span className="truncate">{item.key}</span>
              <span className="ml-auto text-muted-foreground tabular-nums">
                {Math.round((item.value / total) * 100)}%
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

const heat = (value: number, maxAbs: number, diverging: boolean) => {
  const strength = 0.15 + 0.85 * Math.min(1, Math.abs(value) / maxAbs)
  if (!diverging) return `rgba(14, 165, 233, ${strength})`
  return value >= 0 ? `rgba(34, 197, 94, ${strength})` : `rgba(239, 68, 68, ${strength})`
}

function HeatmapViz({
  data,
  panel,
  onDrill,
}: {
  data: ShapedHeatmap
  panel: DashboardPanel
  onDrill: Props['onDrill']
}) {
  if (!data.cells.length) return <Empty>No data in this range</Empty>
  const values = new Map(data.cells.map((c) => [`${c.y}|${c.x}`, c.value]))
  const maxAbs = Math.max(...data.cells.map((c) => Math.abs(c.value))) || 1
  // Red/green only when the values actually go both ways; one-sided counts get one hue.
  const diverging = data.cells.some((c) => c.value < 0)
  return (
    <div className="h-full overflow-auto">
      <div
        className="grid gap-px text-[10px]"
        style={{
          gridTemplateColumns: `minmax(3.5rem, max-content) repeat(${data.x.length}, minmax(1.4rem, 1fr))`,
        }}
      >
        <span />
        {data.x.map((x) => (
          <span key={x} className="truncate text-center text-muted-foreground" title={formatSlot(x)}>
            {format(new Date(x), 'd MMM')}
          </span>
        ))}
        {data.y.map((y) => (
          <Fragment key={y}>
            <span className="truncate pr-1 text-muted-foreground" title={y}>
              {y}
            </span>
            {data.x.map((x) => {
              const value = values.get(`${y}|${x}`)
              return (
                <button
                  key={x}
                  type="button"
                  disabled={value == null}
                  onClick={() => onDrill({ group: panel.query.group_by ? y : undefined, bucket: x })}
                  title={`${y} · ${formatSlot(x)} · ${formatValue(value, panel.options)}`}
                  className="h-5 rounded-sm transition-transform enabled:hover:scale-110 disabled:cursor-default"
                  style={{
                    background: value == null ? 'var(--color-muted)' : heat(value, maxAbs, diverging),
                  }}
                />
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function HealthViz({ data }: { data: ShapedRows }) {
  if (!data.rows.length) return <Empty>No runs in this range</Empty>
  const runs = [...data.rows].reverse()
  return (
    <div className="flex h-full items-center">
      <div className="flex h-8 w-full items-end gap-0.5 overflow-x-auto">
        {runs.map((r) => {
          const status = String(r.status)
          const title = `${r.workflow ?? ''} · ${formatSlot(String(r.created_at))} · ${status}${
            r.seconds != null ? ` · ${formatDuration(Number(r.seconds))}` : ''
          }${r.error ? `\n${r.error}` : ''}`
          const tone =
            status === 'failed' ? 'bg-down' : status === 'running' ? 'animate-pulse bg-sky-500' : 'bg-up'
          const cls = cn(
            'h-full w-2 shrink-0 origin-bottom rounded-sm transition-transform hover:scale-y-110',
            tone,
          )
          return r.workflow_id && r.run_id ? (
            <Link
              key={String(r.run_id)}
              to="/workflows/$workflowId/runs/$runId"
              params={{ workflowId: String(r.workflow_id), runId: String(r.run_id) }}
              title={title}
              className={cls}
            />
          ) : (
            <span key={String(r.run_id)} title={title} className={cls} />
          )
        })}
      </div>
    </div>
  )
}

const EVENT = {
  failure: { icon: CircleXIcon, tone: 'text-down' },
  success: { icon: CircleCheckIcon, tone: 'text-up' },
  output: { icon: BellIcon, tone: 'text-sky-500' },
} as const

function NotificationsViz({ data }: { data: ShapedRows }) {
  if (!data.rows.length) return <Empty>Nothing filed in this range</Empty>
  return (
    <ul className="h-full space-y-0.5 overflow-y-auto">
      {data.rows.map((n) => {
        const meta = EVENT[(n.event as keyof typeof EVENT) ?? 'output'] ?? EVENT.output
        const body = (
          <>
            <meta.icon className={cn('mt-0.5 size-3.5 shrink-0', meta.tone)} />
            <span className="min-w-0 flex-1">
              <span
                className={cn('line-clamp-2 text-xs whitespace-pre-line', n.unread === true && 'font-medium')}
              >
                {String(n.message ?? '')}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {String(n.workflow ?? '')} · {timeAgoShort(String(n.triggered_at))} ago
              </span>
            </span>
          </>
        )
        const cls = 'flex items-start gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/50'
        return (
          <li key={String(n.notification_id)}>
            {n.workflow_id ? (
              <Link
                to="/workflows/$workflowId/notifications"
                params={{ workflowId: String(n.workflow_id) }}
                search={{ open: Number(n.notification_id) }}
                className={cls}
              >
                {body}
              </Link>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
