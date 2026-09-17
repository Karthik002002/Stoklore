import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useIsFetching, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useBlocker, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import GridLayout, { useContainerWidth } from 'react-grid-layout'
import type { Layout, LayoutItem } from 'react-grid-layout'
import {
  ArrowLeftIcon,
  CopyIcon,
  Maximize2Icon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  TableIcon,
  Trash2Icon,
  VariableIcon,
  XIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { usePageTitle } from '@/lib/usePageTitle'
import { DASHBOARD_ALL, getDashboard, getDashboardValues, saveDashboard } from '@/services/api'
import type { Dashboard, DashboardPanel, DashboardVariable } from '@/services/api'
import type { DashboardSearch } from '@/router'
import DrillDrawer from './DrillDrawer'
import PanelEditor from './PanelEditor'
import { PanelBody } from './panels'
import { ALL_TIME, PANEL_META, REFRESH_OPTIONS, TIME_RANGES, newPanelId } from './shared'
import type { DrillPoint, PanelContext } from './shared'
import VariablesDialog from './VariablesDialog'

// One dashboard: a grid of panels you arrange yourself.
//
// **View mode** reads - hover a panel for full screen and "view the data", click any mark to see the
// rows behind it. **Edit mode** is where the grid moves: drag a panel by its header, resize from its
// corner, add, duplicate, delete, edit. Edits are a draft until Save, and leaving with unsaved ones
// asks first - the same contract as the workflow editor.
//
// The view lives in the URL (see router.tsx): time range, refresh, variable values, edit mode, the
// panel being edited or shown full screen, and what was drilled into.

type Draft = Pick<Dashboard, 'name' | 'description' | 'panels' | 'variables' | 'settings'>
const draftOf = (d: Dashboard): Draft => ({
  name: d.name,
  description: d.description,
  panels: d.panels,
  variables: d.variables,
  settings: d.settings,
})

const COLS = 12
// Stable, so the layout memo below holds while the board is still loading.
const NO_PANELS: DashboardPanel[] = []
const ROW_HEIGHT = 36

function PanelAction({
  label,
  onClick,
  children,
  tone,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  tone?: 'bad'
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'panel-action flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-3.5',
        tone === 'bad' && 'hover:text-down',
      )}
    >
      {children}
    </button>
  )
}

function PanelFrame({
  panel,
  ctx,
  edit,
  onEdit,
  onDuplicate,
  onRemove,
  onFullscreen,
  onDrill,
  onOpenRow,
}: {
  panel: DashboardPanel
  ctx: PanelContext
  edit: boolean
  onEdit: () => void
  onDuplicate: () => void
  onRemove: () => void
  onFullscreen: () => void
  onDrill: (point: DrillPoint) => void
  onOpenRow: (row: Record<string, unknown>) => void
}) {
  const fetching = useIsFetching({ queryKey: ['panel', ctx.dashboardId, panel.id] }) > 0
  const Icon = PANEL_META[panel.type].icon
  return (
    <section
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-xl border bg-card',
        edit && 'border-dashed',
      )}
    >
      <header
        className={cn(
          'flex h-8 shrink-0 items-center gap-1.5 border-b px-2',
          edit && 'panel-drag cursor-move',
        )}
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <p className="truncate text-xs font-medium" title={panel.title}>
          {panel.title || 'Untitled panel'}
        </p>
        {fetching && <Spinner className="size-3 shrink-0 text-muted-foreground" />}
        <div
          className={cn(
            'ml-auto flex items-center transition-opacity',
            edit ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
          )}
        >
          <PanelAction label="View the data" onClick={() => onDrill({})}>
            <TableIcon />
          </PanelAction>
          <PanelAction label="Full screen" onClick={onFullscreen}>
            <Maximize2Icon />
          </PanelAction>
          {edit && (
            <>
              <PanelAction label="Edit panel" onClick={onEdit}>
                <PencilIcon />
              </PanelAction>
              <PanelAction label="Duplicate panel" onClick={onDuplicate}>
                <CopyIcon />
              </PanelAction>
              <PanelAction label="Delete panel" onClick={onRemove} tone="bad">
                <Trash2Icon />
              </PanelAction>
            </>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 p-2">
        <PanelBody panel={panel} ctx={ctx} onDrill={onDrill} onOpenRow={onOpenRow} />
      </div>
    </section>
  )
}

function VariablePicker({
  variable,
  value,
  ctx,
  onChange,
}: {
  variable: DashboardVariable
  value: string
  ctx: PanelContext
  onChange: (value: string) => void
}) {
  const { data: values = [] } = useQuery({
    queryKey: ['dashboardValues', ctx.dashboardId, variable, ctx.from, ctx.to],
    queryFn: () =>
      getDashboardValues({
        query: variable.query,
        field: variable.field,
        variables: {},
        time_from: ctx.from,
        time_to: ctx.to,
      }),
    enabled: !!variable.field,
  })
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">{variable.label || variable.name}</span>
      <Select value={value} onValueChange={(v) => onChange(String(v))}>
        <SelectTrigger className="h-8 w-32" aria-label={variable.label || variable.name}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value={DASHBOARD_ALL}>All</SelectItem>
          {values.map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

export default function DashboardPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { dashboardId } = useParams({ from: '/dashboards/$dashboardId' })
  const search = useSearch({ from: '/dashboards/$dashboardId' })

  const {
    data: saved,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['dashboard', dashboardId],
    queryFn: () => getDashboard(dashboardId),
    retry: false,
  })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [variablesOpen, setVariablesOpen] = useState(false)
  const [openRow, setOpenRow] = useState<{ panel: string; row: Record<string, unknown> } | null>(null)

  // Reset from the server only when its content changes - a refetch that returns the same board must
  // not throw away edits in progress.
  const savedKey = saved ? JSON.stringify(draftOf(saved)) : ''
  useEffect(() => {
    if (saved) setDraft(draftOf(saved))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey])

  const dirty = !!draft && !!saved && JSON.stringify(draft) !== savedKey
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  usePageTitle(draft?.name ?? 'Dashboard')

  const setSearch = (next: Partial<DashboardSearch>) =>
    navigate({
      to: '/dashboards/$dashboardId',
      params: { dashboardId },
      search: (prev) => ({ ...prev, ...next }),
      replace: true,
    })

  const edit = !!search.edit
  const from = search.from ?? draft?.settings.from ?? 'now-7d'
  const to = search.to ?? draft?.settings.to ?? 'now'
  const refresh = search.refresh ?? draft?.settings.refresh ?? 0
  const variableValues = useMemo(
    () =>
      Object.fromEntries(
        (draft?.variables ?? []).map((v) => [v.name, search.vars?.[v.name] ?? v.default ?? DASHBOARD_ALL]),
      ),
    [draft?.variables, search.vars],
  )
  const ctx: PanelContext = {
    dashboardId,
    variables: variableValues,
    from: from === ALL_TIME ? null : from,
    to: from === ALL_TIME ? null : to,
    refresh,
  }

  const save = useMutation({
    mutationFn: () => saveDashboard(dashboardId, draft as Draft),
    onSuccess: (next) => {
      queryClient.setQueryData(['dashboard', dashboardId], next)
      queryClient.invalidateQueries({ queryKey: ['dashboards'] })
      toast.success('Dashboard saved', { id: 'dashboard-save' })
    },
    onError: (e: Error) => toast.error(e.message, { id: 'dashboard-save' }),
  })

  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => dirtyRef.current && current.pathname !== next.pathname,
    enableBeforeUnload: () => dirtyRef.current,
    withResolver: true,
  })

  const { width, containerRef, mounted } = useContainerWidth()

  const panels = draft?.panels ?? NO_PANELS
  const layout = useMemo<LayoutItem[]>(
    () => panels.map((p) => ({ i: p.id, ...p.layout, minW: 2, minH: 3 })),
    [panels],
  )
  const bottom = Math.max(0, ...panels.map((p) => p.layout.y + p.layout.h))

  const update = (next: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...next } : d))
  const updatePanel = (panel: DashboardPanel) =>
    setDraft((d) => (d ? { ...d, panels: d.panels.map((p) => (p.id === panel.id ? panel : p)) } : d))

  const onLayoutChange = (next: Layout) => {
    if (!edit || !draft) return
    const at = new Map(next.map((l) => [l.i, l]))
    let changed = false
    const moved = draft.panels.map((p) => {
      const l = at.get(p.id)
      if (!l || (l.x === p.layout.x && l.y === p.layout.y && l.w === p.layout.w && l.h === p.layout.h))
        return p
      changed = true
      return { ...p, layout: { x: l.x, y: l.y, w: l.w, h: l.h } }
    })
    if (changed) update({ panels: moved })
  }

  const addPanel = () => {
    const id = newPanelId()
    update({
      panels: [
        ...panels,
        {
          id,
          type: 'timeseries',
          title: 'New panel',
          query: { source: 'workflow_series', params: {} },
          options: {},
          layout: { x: 0, y: bottom, w: 6, h: 8 },
        },
      ],
    })
    setSearch({ edit: true, panel: id })
  }

  const duplicate = (panel: DashboardPanel) => {
    const id = newPanelId()
    update({
      panels: [
        ...panels,
        { ...panel, id, title: `${panel.title} (copy)`, layout: { ...panel.layout, y: bottom } },
      ],
    })
  }

  const remove = (panel: DashboardPanel) => {
    update({ panels: panels.filter((p) => p.id !== panel.id) })
    if (search.panel === panel.id) setSearch({ panel: undefined })
    toast.message(`Removed “${panel.title}” — Discard to bring it back`)
  }

  const changeRange = (value: string) => {
    setSearch({ from: value, to: value === ALL_TIME ? undefined : 'now' })
    // In edit mode the range you pick becomes the board's default; viewing only changes the URL.
    if (edit && draft) update({ settings: { ...draft.settings, from: value, to: 'now' } })
  }
  const changeRefresh = (value: number) => {
    setSearch({ refresh: value || undefined })
    if (edit && draft) update({ settings: { ...draft.settings, refresh: value } })
  }

  const fullscreen = panels.find((p) => p.id === search.view)
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSearch({ view: undefined })
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen?.id])

  if (isLoading || (saved && !draft)) {
    return (
      <div className="flex h-[calc(100vh-5rem)] items-center justify-center rounded-xl border bg-card">
        <Spinner className="size-5" />
      </div>
    )
  }
  if (isError || !draft) {
    return (
      <div className="flex h-[calc(100vh-5rem)] flex-col items-center justify-center gap-3 rounded-xl border bg-card text-sm text-muted-foreground">
        <p>This dashboard doesn't exist — it may have been deleted.</p>
        <Link to="/dashboards" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
          <ArrowLeftIcon className="size-4" />
          All dashboards
        </Link>
      </div>
    )
  }

  const editing = panels.find((p) => p.id === search.panel)
  const drillPanel = panels.find((p) => p.id === search.drill?.panel)
  const rowPanel = panels.find((p) => p.id === openRow?.panel)

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col overflow-hidden rounded-xl border bg-card">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <Link
          to="/dashboards"
          className={buttonVariants({ size: 'icon-sm', variant: 'ghost' })}
          aria-label="All dashboards"
          title="All dashboards"
        >
          <ArrowLeftIcon />
        </Link>
        {edit ? (
          <Input
            id="dashboard-name"
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
            className="h-8 w-56"
            aria-label="Dashboard name"
          />
        ) : (
          <h2 className="max-w-[36ch] truncate font-medium">{draft.name}</h2>
        )}
        {dirty && <span className="size-2 shrink-0 rounded-full bg-amber-500" title="Unsaved changes" />}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {draft.variables.map((variable) => (
            <VariablePicker
              key={variable.name}
              variable={variable}
              value={variableValues[variable.name]}
              ctx={ctx}
              onChange={(value) => setSearch({ vars: { ...(search.vars ?? {}), [variable.name]: value } })}
            />
          ))}
          <Select value={from} onValueChange={(v) => changeRange(String(v))}>
            <SelectTrigger className="h-8 w-36" aria-label="Time range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(refresh)} onValueChange={(v) => changeRefresh(Number(v))}>
            <SelectTrigger className="h-8 w-32" aria-label="Auto-refresh">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REFRESH_OPTIONS.map((r) => (
                <SelectItem key={r.value} value={String(r.value)}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh now"
            title="Refresh now"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['panel', dashboardId] })}
          >
            <RefreshCwIcon />
          </Button>
          {edit ? (
            <>
              <Button size="sm" variant="outline" onClick={addPanel}>
                <PlusIcon className="size-3.5" />
                Add panel
              </Button>
              <Button size="sm" variant="outline" onClick={() => setVariablesOpen(true)}>
                <VariableIcon className="size-3.5" />
                Variables
              </Button>
              {dirty && saved && (
                <Button size="sm" variant="ghost" onClick={() => setDraft(draftOf(saved))}>
                  Discard
                </Button>
              )}
              <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
                {save.isPending ? <Spinner className="size-3.5" /> : <SaveIcon className="size-3.5" />}
                {dirty ? 'Save' : 'Saved'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSearch({ edit: undefined, panel: undefined })}
              >
                Done
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setSearch({ edit: true })}>
              <PencilIcon className="size-3.5" />
              Edit
            </Button>
          )}
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full overflow-y-auto p-1">
          {!panels.length ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
              <p>No panels yet. Add one to chart a workflow's data, its runs or its notifications.</p>
              <Button size="sm" onClick={addPanel}>
                <PlusIcon className="size-3.5" />
                Add panel
              </Button>
            </div>
          ) : (
            mounted && (
              <GridLayout
                width={width}
                layout={layout}
                gridConfig={{ cols: COLS, rowHeight: ROW_HEIGHT, margin: [8, 8] }}
                dragConfig={{ enabled: edit, handle: '.panel-drag', cancel: '.panel-action' }}
                resizeConfig={{ enabled: edit, handles: ['se'] }}
                onLayoutChange={onLayoutChange}
              >
                {panels.map((panel) => (
                  <div key={panel.id}>
                    <PanelFrame
                      panel={panel}
                      ctx={ctx}
                      edit={edit}
                      onEdit={() => setSearch({ panel: panel.id })}
                      onDuplicate={() => duplicate(panel)}
                      onRemove={() => remove(panel)}
                      onFullscreen={() => setSearch({ view: panel.id })}
                      onDrill={(point) => setSearch({ drill: { panel: panel.id, ...point } })}
                      onOpenRow={(row) => setOpenRow({ panel: panel.id, row })}
                    />
                  </div>
                ))}
              </GridLayout>
            )
          )}
        </div>

        {fullscreen && (
          <div className="absolute inset-0 z-20 flex flex-col bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <p className="flex-1 truncate text-sm font-medium">{fullscreen.title}</p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSearch({ drill: { panel: fullscreen.id } })}
              >
                <TableIcon className="size-3.5" />
                View the data
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Close full screen"
                title="Close (Esc)"
                onClick={() => setSearch({ view: undefined })}
              >
                <XIcon />
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <PanelBody
                panel={fullscreen}
                ctx={ctx}
                onDrill={(point) => setSearch({ drill: { panel: fullscreen.id, ...point } })}
                onOpenRow={(row) => setOpenRow({ panel: fullscreen.id, row })}
              />
            </div>
          </div>
        )}

        {edit && editing && (
          <PanelEditor
            panel={editing}
            ctx={ctx}
            variableNames={draft.variables.map((v) => v.name)}
            onChange={updatePanel}
            onClose={() => setSearch({ panel: undefined })}
          />
        )}
        {drillPanel && search.drill && (
          <DrillDrawer
            panel={drillPanel}
            ctx={ctx}
            point={{ group: search.drill.group, bucket: search.drill.bucket }}
            onClose={() => setSearch({ drill: undefined })}
          />
        )}
        {rowPanel && openRow && (
          <DrillDrawer panel={rowPanel} ctx={ctx} row={openRow.row} onClose={() => setOpenRow(null)} />
        )}
      </div>

      <VariablesDialog
        open={variablesOpen}
        onOpenChange={setVariablesOpen}
        variables={draft.variables}
        onChange={(variables) => update({ variables })}
      />

      <AlertDialog open={blocker.status === 'blocked'} onOpenChange={(open) => !open && blocker.reset?.()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave with unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Edits to {draft.name} since the last save will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Keep editing</AlertDialogCancel>
            <Button variant="outline" onClick={() => blocker.proceed?.()}>
              Discard
            </Button>
            <Button
              disabled={save.isPending}
              onClick={() => save.mutateAsync().then(() => blocker.proceed?.())}
            >
              {save.isPending && <Spinner className="size-3.5" />}
              Save & leave
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
