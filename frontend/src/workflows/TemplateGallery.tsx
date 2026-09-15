import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  HandIcon,
  NewspaperIcon,
  SparklesIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { createFromScreen, createFromTemplate, getWorkflowTemplates } from '@/services/api'
import type { WorkflowTemplate } from '@/services/api'

// Every starter workflow, nine at a time, plus "make one from a screener.in screen".
//
// A modal rather than a strip on the list page: sixteen cards is a catalogue, and a catalogue pushed
// the thing you came for - your own workflows - below the fold. Nine per page is a 3x3 grid that
// fits without scrolling on a laptop screen, which is the whole reason for paging it.
//
// Both ways in clone DISARMED. A template, or somebody else's screen query, is a starting point -
// arming something you haven't read is exactly the surprise an unattended job must not spring.
const PAGE_SIZE = 9
const ALL = 'All'

const TRIGGER_ICON = { schedule: ClockIcon, manual: HandIcon, event_scan: NewspaperIcon }

const triggerText = (t: WorkflowTemplate) =>
  t.trigger.kind === 'schedule'
    ? `Daily ${t.trigger.time ?? ''} IST`
    : t.trigger.kind === 'event_scan'
      ? 'After the event scan'
      : 'Manual'

export default function TemplateGallery({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the new workflow's id, so the caller can open it straight in the editor. */
  onCreated: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const [category, setCategory] = useState(ALL)
  const [page, setPage] = useState(0)
  const [screenUrl, setScreenUrl] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['workflowTemplates'],
    queryFn: getWorkflowTemplates,
    enabled: open,
  })

  const shown = useMemo(
    () => (data?.templates ?? []).filter((t) => category === ALL || t.category === category),
    [data, category],
  )
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  // Clamped, not reset: switching to a smaller category while on page 2 should land on its last
  // page rather than an empty grid.
  const at = Math.min(page, pages - 1)
  const visible = shown.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE)

  const created = (id: string, message: string) => {
    queryClient.invalidateQueries({ queryKey: ['workflows'] })
    toast.success(message)
    onOpenChange(false)
    onCreated(id)
  }

  const clone = useMutation({
    mutationFn: (templateId: string) => createFromTemplate(templateId),
    onSuccess: (w) => created(w.id, `${w.name} added disarmed — read it, then arm it`),
    onError: (e: Error) => toast.error(e.message),
  })

  // The screen is fetched server-side before anything is saved, so a URL that isn't a screen - or a
  // screen that went private - fails here, while you're looking, not in tomorrow evening's run.
  const fromScreen = useMutation({
    mutationFn: () => createFromScreen({ url: screenUrl.trim() }),
    onSuccess: ({ workflow, preview }) => {
      setScreenUrl('')
      created(
        workflow.id,
        `${workflow.name}: ${preview.total} compan${preview.total === 1 ? 'y' : 'ies'} match today — added disarmed`,
      )
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[92vw] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle>Workflow templates</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <form
            className="rounded-xl border border-dashed bg-muted/30 p-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (screenUrl.trim()) fromScreen.mutate()
            }}
          >
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <SparklesIcon className="size-4 text-primary" />
              Generate from a screener.in screen
            </p>
            <p className="mb-2 text-[11px] text-muted-foreground">
              Paste any public screen. It runs daily, keeps what it matched, and only files a summary when
              something matches.
            </p>
            <div className="flex gap-2">
              <Input
                value={screenUrl}
                onChange={(e) => setScreenUrl(e.target.value)}
                placeholder="https://www.screener.in/screens/86/quarterly-growers/"
                className="h-9 font-mono text-xs"
              />
              <Button
                type="submit"
                size="sm"
                className="h-9"
                disabled={!screenUrl.trim() || fromScreen.isPending}
              >
                {fromScreen.isPending ? <Spinner className="size-3.5" /> : null}
                {fromScreen.isPending ? 'Reading screen…' : 'Generate'}
              </Button>
            </div>
          </form>

          <div className="flex flex-wrap gap-1.5">
            {[ALL, ...(data?.categories ?? [])].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setCategory(c)
                  setPage(0)
                }}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  category === c ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'
                }`}
              >
                {c}
                <span className="ml-1 opacity-60">
                  {c === ALL
                    ? (data?.templates.length ?? 0)
                    : (data?.templates ?? []).filter((t) => t.category === c).length}
                </span>
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="flex justify-center py-16">
              <Spinner className="size-5" />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {visible.map((t) => {
                const Icon = (TRIGGER_ICON as Record<string, typeof HandIcon>)[t.trigger.kind] ?? HandIcon
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={clone.isPending}
                    onClick={() => clone.mutate(t.id)}
                    className="flex h-full flex-col rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-muted/40 disabled:opacity-60"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{t.name}</p>
                      <Badge variant="secondary" className="shrink-0">
                        {t.category}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-3 flex-1 text-[11px] text-muted-foreground">
                      {t.description}
                    </p>
                    <p className="mt-2 flex items-center gap-1 text-[11px] text-primary">
                      <Icon className="size-3" />
                      {triggerText(t)} · {t.nodes} nodes
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between border-t px-5 py-2.5">
            <Button size="sm" variant="ghost" disabled={at === 0} onClick={() => setPage(at - 1)}>
              <ChevronLeftIcon className="size-4" />
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {at + 1} of {pages}
            </span>
            <Button size="sm" variant="ghost" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>
              Next
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
