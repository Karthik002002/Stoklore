import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { drillPanel } from '@/services/api'
import type { DashboardPanel } from '@/services/api'
import { formatSlot } from '@/workflows/status'
import { Empty, RowsTable } from './panels'
import { panelRequest } from './shared'
import type { DrillPoint, PanelContext } from './shared'

// The rows behind whatever was clicked - a point, bar, slice, cell or stat - read with the panel's own
// filters, grouping and bucketing, so it is exactly what made that mark. Each row links on to where it
// came from: the run that collected it, the stock it's about, the notification it is.

function RowLinks({ row, workflowId }: { row: Record<string, unknown>; workflowId?: string }) {
  const wid = typeof row.workflow_id === 'string' ? row.workflow_id : workflowId
  const run = typeof row.run_id === 'string' ? row.run_id : undefined
  const symbol = typeof row.symbol === 'string' && /^[A-Z0-9&-]+$/.test(row.symbol) ? row.symbol : undefined
  const link = 'text-sky-500 hover:underline'
  return (
    <span className="flex gap-2" onClick={(e) => e.stopPropagation()}>
      {wid && run && (
        <Link
          to="/workflows/$workflowId/runs/$runId"
          params={{ workflowId: wid, runId: run }}
          className={link}
        >
          Run
        </Link>
      )}
      {symbol && (
        <Link to="/stock/$exchange/$symbol" params={{ exchange: 'NSE', symbol }} className={link}>
          {symbol}
        </Link>
      )}
      {wid && row.notification_id != null && (
        <Link
          to="/workflows/$workflowId/notifications"
          params={{ workflowId: wid }}
          search={{ open: Number(row.notification_id) }}
          className={link}
        >
          Notification
        </Link>
      )}
    </span>
  )
}

export default function DrillDrawer({
  panel,
  ctx,
  point,
  row,
  onClose,
}: {
  panel: DashboardPanel
  ctx: PanelContext
  /** A clicked mark - fetches its rows. */
  point?: DrillPoint
  /** A table row that was clicked - shown as it is. */
  row?: Record<string, unknown>
  onClose: () => void
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['drill', ctx.dashboardId, panel.id, point, panel.query, ctx.variables, ctx.from, ctx.to],
    queryFn: () => drillPanel({ ...panelRequest(panel, ctx), point: point ?? {} }),
    enabled: !row,
  })

  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const workflowId = panel.query.params?.workflow_id
  const what = row
    ? 'One row'
    : [point?.group, point?.bucket && formatSlot(point.bucket)].filter(Boolean).join(' · ') ||
      'Every row behind this panel'

  return (
    <aside
      aria-label={`Data behind ${panel.title}`}
      className="absolute inset-y-0 right-0 z-30 flex w-[42rem] max-w-full flex-col border-l bg-card shadow-2xl duration-200 animate-in fade-in-0 slide-in-from-right-8"
    >
      <header className="flex items-start gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{panel.title}</p>
          <p className="text-[11px] text-muted-foreground">
            {what}
            {data && !row && ` · ${data.total} row${data.total === 1 ? '' : 's'}`}
          </p>
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <XIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {row ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 p-4 text-xs">
            {Object.entries(row).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="break-all">
                  {v != null && typeof v === 'object' ? (
                    <pre className="font-mono text-[11px] whitespace-pre-wrap">
                      {JSON.stringify(v, null, 2)}
                    </pre>
                  ) : (
                    String(v ?? '—')
                  )}
                </dd>
              </div>
            ))}
            <dt className="text-muted-foreground">Open</dt>
            <dd>
              <RowLinks row={row} workflowId={workflowId} />
            </dd>
          </dl>
        ) : isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-5" />
          </div>
        ) : error ? (
          <Empty tone="bad">{(error as Error).message}</Empty>
        ) : !data?.rows.length ? (
          <Empty>No rows behind this — the range or a variable may have changed.</Empty>
        ) : (
          <RowsTable
            rows={data.rows}
            columns={data.columns.map((c) => c.name)}
            extra={(r) => <RowLinks row={r} workflowId={workflowId} />}
          />
        )}
      </div>
    </aside>
  )
}
