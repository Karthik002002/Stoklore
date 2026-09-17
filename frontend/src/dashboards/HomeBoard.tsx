import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type { Layout } from 'react-grid-layout'
import { ExternalLinkIcon, LayoutGridIcon, PencilIcon, PinOffIcon, RefreshCwIcon } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { DASHBOARD_ALL, getDashboard } from '@/services/api'
import type { Dashboard, DashboardPanel, HomePin } from '@/services/api'
import { BoardGrid, PanelFrame } from './DashboardPage'
import DrillDrawer from './DrillDrawer'
import { useHomeBoard } from './useHomeBoard'
import { ALL_TIME } from './shared'
import type { DrillPoint, PanelContext } from './shared'

// "My board" on the home page: dashboards and single panels pinned from any dashboard, on one grid you
// arrange. Pins are references - a pinned panel shows its dashboard's saved panel with that dashboard's
// default variables and time range, so editing it (which opens the dashboard) changes it here too.

/** A dashboard's own defaults - home has no URL state per board to override them with. */
const contextOf = (d: Dashboard): PanelContext => ({
  dashboardId: d.id,
  variables: Object.fromEntries(d.variables.map((v) => [v.name, v.default ?? DASHBOARD_ALL])),
  from: d.settings.from === ALL_TIME ? null : d.settings.from,
  to: d.settings.from === ALL_TIME ? null : d.settings.to,
  refresh: d.settings.refresh,
})

type Drill = { panel: DashboardPanel; ctx: PanelContext; point?: DrillPoint; row?: Record<string, unknown> }

function Gone({ edit, what, onUnpin }: { edit: boolean; what: string; onUnpin: () => void }) {
  return (
    <section
      className={cn(
        'flex h-full flex-col items-center justify-center gap-2 rounded-xl border bg-card p-3 text-center text-xs text-muted-foreground',
        edit && 'panel-drag cursor-move border-dashed',
      )}
    >
      <p>{what}</p>
      <Button size="sm" variant="outline" className="panel-action" onClick={onUnpin}>
        <PinOffIcon className="size-3.5" />
        Unpin
      </Button>
    </section>
  )
}

function DashboardTile({
  dashboard,
  edit,
  onUnpin,
  onDrill,
}: {
  dashboard: Dashboard
  edit: boolean
  onUnpin: () => void
  onDrill: (drill: Drill) => void
}) {
  const navigate = useNavigate()
  const ctx = contextOf(dashboard)
  return (
    <section
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-xl border bg-card',
        edit && 'border-dashed',
      )}
    >
      <header
        className={cn(
          'flex h-8 shrink-0 items-center gap-1.5 border-b px-2',
          edit && 'panel-drag cursor-move',
        )}
      >
        <LayoutGridIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <Link
          to="/dashboards/$dashboardId"
          params={{ dashboardId: dashboard.id }}
          className="panel-action truncate text-xs font-medium hover:underline"
        >
          {dashboard.name}
        </Link>
        <div className="ml-auto flex items-center gap-0.5">
          <Link
            to="/dashboards/$dashboardId"
            params={{ dashboardId: dashboard.id }}
            search={{ edit: true }}
            className={cn(buttonVariants({ size: 'icon-xs', variant: 'ghost' }), 'panel-action')}
            aria-label="Edit dashboard"
            title="Edit dashboard"
          >
            <PencilIcon />
          </Link>
          <Button
            size="icon-xs"
            variant="ghost"
            className="panel-action"
            aria-label="Unpin from home"
            title="Unpin from home"
            onClick={onUnpin}
          >
            <PinOffIcon />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        {dashboard.panels.length ? (
          <BoardGrid panels={dashboard.panels} edit={false}>
            {dashboard.panels.map((panel) => (
              <div key={panel.id}>
                <PanelFrame
                  panel={panel}
                  ctx={ctx}
                  edit={false}
                  onFullscreen={() =>
                    navigate({
                      to: '/dashboards/$dashboardId',
                      params: { dashboardId: dashboard.id },
                      search: { view: panel.id },
                    })
                  }
                  onDrill={(point) => onDrill({ panel, ctx, point })}
                  onOpenRow={(row) => onDrill({ panel, ctx, row })}
                />
              </div>
            ))}
          </BoardGrid>
        ) : (
          <p className="p-3 text-xs text-muted-foreground">This dashboard has no panels yet.</p>
        )}
      </div>
    </section>
  )
}

export default function HomeBoard() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { items, isLoading, setItems } = useHomeBoard()
  const [edit, setEdit] = useState(false)
  const [drill, setDrill] = useState<Drill | null>(null)

  // Each pinned dashboard once, however many of its panels are pinned - and under the same key the
  // dashboard page uses, so opening one from here is instant.
  const ids = [...new Set(items.map((i) => i.dashboard_id))]
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['dashboard', id],
      queryFn: () => getDashboard(id),
      retry: false,
    })),
  })
  const byId = new Map(ids.map((id, n) => [id, results[n]]))

  const unpin = (pin: HomePin) => setItems(items.filter((i) => i.id !== pin.id))

  const onLayoutChange = (next: Layout) => {
    if (!edit) return
    const at = new Map(next.map((l) => [l.i, l]))
    let changed = false
    const moved = items.map((pin) => {
      const l = at.get(pin.id)
      if (
        !l ||
        (l.x === pin.layout.x && l.y === pin.layout.y && l.w === pin.layout.w && l.h === pin.layout.h)
      )
        return pin
      changed = true
      return { ...pin, layout: { x: l.x, y: l.y, w: l.w, h: l.h } }
    })
    if (changed) setItems(moved)
  }

  const tile = (pin: HomePin) => {
    const result = byId.get(pin.dashboard_id)
    if (!result || result.isLoading) {
      return (
        <div className="flex h-full items-center justify-center rounded-xl border bg-card">
          <Spinner className="size-4" />
        </div>
      )
    }
    const dashboard = result.data
    if (!dashboard) {
      return (
        <Gone edit={edit} what="The dashboard this was pinned from was deleted." onUnpin={() => unpin(pin)} />
      )
    }
    if (!pin.panel_id) {
      return <DashboardTile dashboard={dashboard} edit={edit} onUnpin={() => unpin(pin)} onDrill={setDrill} />
    }
    const panel = dashboard.panels.find((p) => p.id === pin.panel_id)
    if (!panel) {
      return (
        <Gone
          edit={edit}
          what={`This panel was removed from ${dashboard.name}.`}
          onUnpin={() => unpin(pin)}
        />
      )
    }
    const ctx = contextOf(dashboard)
    const open = (search: { edit?: boolean; panel?: string; view?: string }) =>
      navigate({ to: '/dashboards/$dashboardId', params: { dashboardId: dashboard.id }, search })
    return (
      <PanelFrame
        panel={{ ...panel, title: `${panel.title} · ${dashboard.name}` }}
        ctx={ctx}
        edit={edit}
        onEdit={() => open({ edit: true, panel: panel.id })}
        onRemove={() => unpin(pin)}
        removeLabel="Unpin from home"
        onFullscreen={() => open({ view: panel.id })}
        onDrill={(point) => setDrill({ panel, ctx, point })}
        onOpenRow={(row) => setDrill({ panel, ctx, row })}
        pinned
        onPin={edit ? undefined : () => unpin(pin)}
      />
    )
  }

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-7rem)] items-center justify-center rounded-xl border bg-card">
        <Spinner className="size-5" />
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-xl border bg-card">
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <p className="text-sm font-medium">My board</p>
        <p className="text-xs text-muted-foreground">
          {items.length ? `${items.length} pinned` : 'Nothing pinned yet'}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/dashboards" className={buttonVariants({ size: 'sm', variant: 'ghost' })}>
            <ExternalLinkIcon className="size-3.5" />
            Dashboards
          </Link>
          {!!items.length && (
            <>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Refresh now"
                title="Refresh now"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['panel'] })}
              >
                <RefreshCwIcon />
              </Button>
              <Button size="sm" variant={edit ? 'default' : 'outline'} onClick={() => setEdit((e) => !e)}>
                {edit ? (
                  'Done'
                ) : (
                  <>
                    <PencilIcon className="size-3.5" />
                    Arrange
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {!items.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted-foreground">
            <p className="max-w-[52ch]">
              Pin what you want to see first. On any dashboard, the pin button in its header pins the whole
              dashboard, and the pin on a panel (hover it) pins just that panel.
            </p>
            <Link to="/dashboards" className={buttonVariants({ size: 'sm' })}>
              <LayoutGridIcon className="size-3.5" />
              Open dashboards
            </Link>
          </div>
        ) : (
          <BoardGrid panels={items} edit={edit} onLayoutChange={onLayoutChange}>
            {items.map((pin) => (
              <div key={pin.id}>{tile(pin)}</div>
            ))}
          </BoardGrid>
        )}
        {drill && (
          <DrillDrawer
            panel={drill.panel}
            ctx={drill.ctx}
            point={drill.point}
            row={drill.row}
            onClose={() => setDrill(null)}
          />
        )}
      </div>
    </div>
  )
}
