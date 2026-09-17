import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { LayoutGridIcon, PlusIcon, WorkflowIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { timeAgoShort } from '@/lib/format'
import { usePageTitle } from '@/lib/usePageTitle'
import {
  createDashboard,
  createDashboardFromTemplate,
  createDashboardFromWorkflow,
  deleteDashboard,
  getDashboardTemplates,
  getDashboards,
  getWorkflows,
} from '@/services/api'
import type { Dashboard, DashboardSummary } from '@/services/api'

// Every dashboard, and the three ways to start one: blank, from a template, or built from a workflow's
// own data. A new dashboard opens straight into edit mode.

export default function DashboardList() {
  usePageTitle('Dashboards')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<DashboardSummary | null>(null)

  const { data: dashboards = [], isLoading } = useQuery({ queryKey: ['dashboards'], queryFn: getDashboards })
  const { data: templates = [] } = useQuery({
    queryKey: ['dashboardTemplates'],
    queryFn: getDashboardTemplates,
  })
  const { data: workflows = [] } = useQuery({ queryKey: ['workflows'], queryFn: getWorkflows })

  const open = (dashboard: Dashboard, edit: boolean) => {
    queryClient.invalidateQueries({ queryKey: ['dashboards'] })
    navigate({
      to: '/dashboards/$dashboardId',
      params: { dashboardId: dashboard.id },
      search: edit ? { edit: true } : {},
    })
  }

  const create = useMutation({
    mutationFn: (
      how: { kind: 'blank' } | { kind: 'template'; id: string } | { kind: 'workflow'; id: string },
    ) =>
      how.kind === 'template'
        ? createDashboardFromTemplate(how.id)
        : how.kind === 'workflow'
          ? createDashboardFromWorkflow(how.id)
          : createDashboard({
              name: 'Untitled dashboard',
              description: null,
              panels: [],
              variables: [],
              settings: { from: 'now-7d', to: 'now', refresh: 0 },
            }),
    onSuccess: (dashboard, how) => {
      toast.success(`${dashboard.name} created`)
      setCreating(false)
      open(dashboard, how.kind === 'blank')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: (d: DashboardSummary) => deleteDashboard(d.id),
    onSuccess: (_r, d) => {
      toast.success(`${d.name} deleted`)
      setConfirmDelete(null)
      queryClient.invalidateQueries({ queryKey: ['dashboards'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const starters = (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="space-y-2">
        <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Start from a template
        </h3>
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={create.isPending}
            onClick={() => create.mutate({ kind: 'template', id: t.id })}
            className="block w-full rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
          >
            <p className="text-sm font-medium">{t.name}</p>
            <p className="text-xs text-muted-foreground">{t.description}</p>
          </button>
        ))}
      </section>
      <section className="space-y-2">
        <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Build from a workflow
        </h3>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {workflows.map((w) => (
            <button
              key={w.id}
              type="button"
              disabled={create.isPending}
              onClick={() => create.mutate({ kind: 'workflow', id: w.id })}
              className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 disabled:opacity-60"
            >
              <WorkflowIcon className="size-3.5 text-muted-foreground" />
              <span className="truncate">{w.name}</span>
            </button>
          ))}
          {!workflows.length && <p className="text-xs text-muted-foreground">No workflows yet.</p>}
        </div>
        <p className="text-[11px] text-muted-foreground">
          A stat and a line per number it collects, a top 10, a table, a heatmap and its run health — with a
          dropdown for the field that names things.
        </p>
      </section>
    </div>
  )

  return (
    <div className="h-[calc(100vh-5rem)] overflow-y-auto rounded-xl border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Dashboards</h2>
          <p className="text-xs text-muted-foreground">
            Workflow data as charts, stats and tables — arranged how you want, drillable down to the rows.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <LayoutGridIcon className="size-4" />
            From a template or workflow
          </Button>
          <Button size="sm" onClick={() => create.mutate({ kind: 'blank' })} disabled={create.isPending}>
            {create.isPending ? <Spinner className="size-4" /> : <PlusIcon className="size-4" />}
            New dashboard
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border bg-muted/30" />
          ))}
        </div>
      ) : dashboards.length === 0 ? (
        <div className="mx-auto max-w-3xl space-y-4 py-8">
          <p className="text-center text-sm text-muted-foreground">
            No dashboards yet. The quickest start is one built from a workflow you already run.
          </p>
          {starters}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {dashboards.map((d) => (
            <div
              key={d.id}
              className="group relative rounded-xl border bg-card transition-colors hover:border-foreground/20 hover:bg-muted/20"
            >
              <Link to="/dashboards/$dashboardId" params={{ dashboardId: d.id }} className="block p-4">
                <p className="truncate pr-8 font-medium">{d.name}</p>
                {d.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{d.description}</p>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {d.panel_count} panel{d.panel_count === 1 ? '' : 's'} · updated {timeAgoShort(d.updated_at)}{' '}
                  ago
                </p>
              </Link>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete ${d.name}`}
                onClick={() => setConfirmDelete(d)}
                className="absolute top-2 right-2 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>New dashboard</DialogTitle>
            <DialogDescription>
              Start from a ready-made board, or one built from what a workflow collects.
            </DialogDescription>
          </DialogHeader>
          {starters}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its panels and layout go. The workflows and their data stay exactly as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={() => confirmDelete && remove.mutate(confirmDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
