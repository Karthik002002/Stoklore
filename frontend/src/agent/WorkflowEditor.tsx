import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useBlocker, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import type { Connection, Edge, Node, NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { toast } from 'sonner'
import {
  ArrowLeftIcon,
  BotIcon,
  ChartNoAxesCombinedIcon,
  CheckIcon,
  DatabaseIcon,
  FilterIcon,
  PlayIcon,
  SaveIcon,
  SendIcon,
  WrenchIcon,
  ZapIcon,
} from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { formatDuration, timeAgoShort } from '@/lib/format'
import { useShortcut, useShortcutLabel } from '@/lib/shortcuts'
import { useAppliedTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { getWorkflow, getWorkflowCatalogue, getWorkflowRuns, runWorkflow, saveWorkflow } from '@/services/api'
import type { Workflow, WorkflowGraphNode, WorkflowTrigger } from '@/services/api'
import { MiniMapTask } from './RunDiagram'

// The builder: palette on the left, canvas in the middle, the selected node's settings on the
// right. Same three-pane shape as React Flow's own workflow-editor template.
//
// Nodes are wired by dragging between handles; an edge means "this node may read that one's
// output". Actually READING it is a `{{ nodeId.path }}` template in an argument - the edge grants
// the reference, the template spends it. Two steps rather than one because a node usually needs
// one field of a parent's result, not the whole thing, and a visual field-mapper for arbitrary
// JSON is a bigger idea than this page needs.
//
// `for_each` is the fan-out: point it at a list and the node runs once per item with `{{ item }}`
// in scope. That is what puts "8 items" on a wire.
//
// Routes: /agent/workflows/new and /agent/workflows/$workflowId, with `?node=` the node open in the
// inspector. A new workflow moves to its own URL on first save.

const KIND_ICON = {
  trigger: ZapIcon,
  tool: WrenchIcon,
  agent: BotIcon,
  condition: FilterIcon,
  collect: DatabaseIcon,
  output: SendIcon,
}
// The same hues as KIND_TINT, as hex - the minimap paints into SVG, where theme classes don't reach.
const KIND_MINIMAP: Record<string, string> = {
  trigger: '#d4d4d8',
  tool: '#71717a',
  agent: '#22c55e',
  condition: '#f59e0b',
  collect: '#0ea5e9',
  output: '#ef4444',
}
const KIND_TINT: Record<string, string> = {
  trigger: 'border-primary/50 bg-primary/5',
  tool: 'border-border bg-card',
  agent: 'border-up/40 bg-up/5',
  condition: 'border-amber-500/50 bg-amber-500/5',
  collect: 'border-sky-500/50 bg-sky-500/5',
  output: 'border-down/40 bg-down/5',
}

// The canvas takes the card it sits in rather than React Flow's own light/dark ground.
const FLOW_STYLE = { '--xy-background-color': 'transparent' } as CSSProperties

type NodeData = WorkflowGraphNode['data'] & { kind: string }

function EditorNode({ data, selected }: NodeProps<Node<NodeData>>) {
  const Icon = KIND_ICON[data.kind as keyof typeof KIND_ICON] ?? WrenchIcon
  const subtitle =
    data.tool ||
    (data.kind === 'agent'
      ? data.prompt
      : data.kind === 'condition'
        ? `${data.left ?? ''} ${data.op ?? 'gt'} ${data.right ?? ''}`
        : data.kind === 'collect'
          ? `→ ${data.series ?? 'data'}`
          : data.message) ||
    data.kind
  return (
    <div
      className={`w-44 rounded-xl border-2 px-3 py-2 shadow-sm transition-shadow hover:shadow-md ${KIND_TINT[data.kind]} ${
        selected ? 'ring-2 ring-primary' : ''
      }`}
    >
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{data.label || data.kind}</span>
      </p>
      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{subtitle}</p>
      {data.for_each && <p className="mt-0.5 truncate text-[10px] text-primary">for each {data.for_each}</p>}
      {/* A trigger has no input and an output has no output, so the graph can only be wired one
          sensible way round. */}
      {data.kind !== 'trigger' && <Handle type="target" position={Position.Left} className="!size-2" />}
      {data.kind !== 'output' && <Handle type="source" position={Position.Right} className="!size-2" />}
    </div>
  )
}

const NODE_TYPES = { editor: EditorNode }
const newId = () => crypto.randomUUID().slice(0, 8)

type Draft = {
  name: string
  trigger: WorkflowTrigger
  enabled: boolean
  retain: number
  nodes: { id: string; position: unknown; data: unknown }[]
  edges: { id: string; source: string; target: string }[]
}

const EMPTY_DRAFT: Draft = {
  name: 'New workflow',
  trigger: { kind: 'manual', time: '09:15' },
  enabled: false,
  retain: 30,
  nodes: [],
  edges: [],
}

/** The fields a save writes, in one fixed shape - compared as JSON to tell whether the canvas has
 *  anything the server doesn't. React Flow's own bookkeeping (measured, selected, dragging) stays
 *  out of it, so clicking around never reads as an edit. */
const draftOf = (w: Workflow): Draft => ({
  name: w.name,
  trigger: w.trigger,
  enabled: w.enabled,
  retain: w.retain_runs ?? 30,
  nodes: (w.graph?.nodes ?? []).map((n) => ({
    id: n.id,
    position: n.position,
    data: { ...n.data, kind: n.kind },
  })),
  edges: (w.graph?.edges ?? []).map((e) => ({ id: e.id, source: e.source, target: e.target })),
})

export default function WorkflowEditor() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const theme = useAppliedTheme()
  const { workflowId: routeId } = useParams({ strict: false }) as { workflowId?: string }
  const { node: selected } = useSearch({ strict: false }) as { node?: string }
  const [workflowId] = useState(() => routeId ?? crypto.randomUUID())
  const [name, setName] = useState(EMPTY_DRAFT.name)
  const [trigger, setTrigger] = useState<WorkflowTrigger>(EMPTY_DRAFT.trigger)
  const [enabled, setEnabled] = useState(false)
  const [retain, setRetain] = useState(30)

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const { data: catalogue } = useQuery({ queryKey: ['workflowCatalogue'], queryFn: getWorkflowCatalogue })
  const {
    data: existing,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['workflow', routeId],
    queryFn: () => getWorkflow(routeId as string),
    enabled: !!routeId,
    retry: false,
  })
  const { data: runs = [] } = useQuery({
    queryKey: ['workflowRuns', workflowId],
    queryFn: () => getWorkflowRuns(workflowId),
    enabled: !!routeId,
    refetchInterval: 5000,
  })

  const setSelected = useCallback(
    (nodeId: string | null) =>
      navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => ({ ...prev, node: nodeId ?? undefined }),
        replace: true,
      } as never),
    [navigate],
  )

  // Read inside the load effect without making selection a dependency of it - re-selecting must
  // not reload the graph from the server copy.
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  useEffect(() => {
    if (!existing) return
    setName(existing.name)
    setTrigger(existing.trigger)
    setEnabled(existing.enabled)
    setRetain(existing.retain_runs ?? 30)
    setNodes(
      (existing.graph?.nodes ?? []).map((n) => ({
        id: n.id,
        type: 'editor',
        position: n.position,
        selected: n.id === selectedRef.current,
        data: { ...n.data, kind: n.kind },
      })) as Node[],
    )
    setEdges((existing.graph?.edges ?? []) as Edge[])
  }, [existing, setNodes, setEdges])

  const baseline = useMemo(() => JSON.stringify(existing ? draftOf(existing) : EMPTY_DRAFT), [existing])
  const current = JSON.stringify({
    name,
    trigger,
    enabled,
    retain,
    nodes: nodes.map((n) => ({ id: n.id, position: n.position, data: n.data })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  } satisfies Draft)
  const dirty = current !== baseline
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  // Leaving with unsaved edits asks first. Only a change of page counts - `?node=` changes on every
  // click and must never prompt.
  const blocker = useBlocker({
    shouldBlockFn: ({ current: from, next }) => dirtyRef.current && from.pathname !== next.pathname,
    enableBeforeUnload: () => dirtyRef.current,
    withResolver: true,
  })

  const patch = useCallback(
    (nodeId: string, next: Partial<NodeData>) =>
      setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...next } } : n))),
    [setNodes],
  )

  const add = (kind: string, extra: Partial<NodeData> = {}) => {
    const nodeId = newId()
    setNodes((prev) => [
      ...prev.map((n) => (n.selected ? { ...n, selected: false } : n)),
      {
        id: nodeId,
        type: 'editor',
        // Stacked down-right from the last node so a new one never lands on top of another.
        position: { x: 80 + prev.length * 40, y: 60 + prev.length * 70 },
        selected: true,
        data: { kind, label: extra.tool ?? kind, ...extra },
      } as Node,
    ])
    setSelected(nodeId)
  }

  const save = useMutation({
    mutationFn: (_opts?: { leaving?: boolean }) =>
      saveWorkflow(workflowId, {
        name,
        description: existing?.description ?? null,
        graph: {
          nodes: nodes.map((n) => ({
            id: n.id,
            kind: (n.data as NodeData).kind,
            position: n.position,
            data: n.data,
          })) as never,
          edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
        },
        trigger,
        enabled,
        retain_runs: retain,
      }),
    onSuccess: (saved, opts) => {
      // The server's copy becomes the baseline straight away, so the unsaved marker clears without
      // waiting for a refetch.
      queryClient.setQueryData(['workflow', workflowId], saved)
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      toast.success('Workflow saved', { id: 'workflow-save' })
      if (!routeId && !opts?.leaving) {
        navigate({
          to: '/agent/workflows/$workflowId',
          params: { workflowId },
          search: { node: selected },
          replace: true,
          ignoreBlocker: true,
        })
      }
    },
    onError: (e: Error) => toast.error(e.message, { id: 'workflow-error' }),
  })

  // Run what is on screen, not what was last saved - running a stale copy of a graph you are
  // looking at is the surprise this must not spring.
  const run = useMutation({
    mutationFn: async () => {
      if (dirtyRef.current || !routeId) await save.mutateAsync({ leaving: true })
      return runWorkflow(workflowId)
    },
    onSuccess: async ({ run_id }) => {
      queryClient.invalidateQueries({ queryKey: ['workflowRuns', workflowId] })
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      if (!routeId) {
        await navigate({
          to: '/agent/workflows/$workflowId',
          params: { workflowId },
          replace: true,
          ignoreBlocker: true,
        })
      }
      navigate({
        to: '/agent/workflows/$workflowId/runs/$runId',
        params: { workflowId, runId: run_id },
        ignoreBlocker: true,
      })
    },
    onError: (e: Error) => toast.error(e.message, { id: 'workflow-error' }),
  })

  const saveShortcut = useShortcutLabel('workflow.save')
  useShortcut(
    'workflow.save',
    (event) => {
      event.preventDefault()
      if ((dirty || !routeId) && !save.isPending) save.mutate({})
    },
    { ignoreInputs: false },
  )

  const node = nodes.find((n) => n.id === selected)
  const data = node?.data as NodeData | undefined

  if (routeId && isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    )
  }
  if (routeId && isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>This workflow doesn't exist — it may have been deleted.</p>
        <Link to="/agent/workflows" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
          <ArrowLeftIcon className="size-4" />
          All workflows
        </Link>
      </div>
    )
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[13rem_1fr_16rem]">
      <aside className="min-h-0 space-y-3 overflow-y-auto border-r bg-muted/20 p-2">
        <Link
          to="/agent/workflows"
          className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), 'w-full justify-start')}
        >
          <ArrowLeftIcon className="size-4" />
          All workflows
        </Link>

        <Section title="Trigger">
          <Button size="sm" variant="outline" className="w-full" onClick={() => add('trigger')}>
            Add trigger
          </Button>
        </Section>

        <Section title="Think & file">
          <Button size="sm" variant="outline" className="w-full" onClick={() => add('agent')}>
            Agent step
          </Button>
          {/* The gate. Everything downstream is skipped unless this holds - which is how a
              workflow stays silent on the mornings nothing happened. */}
          <Button size="sm" variant="outline" className="w-full" onClick={() => add('condition')}>
            Only if…
          </Button>
          <Button size="sm" variant="outline" className="w-full" onClick={() => add('collect')}>
            Collect data
          </Button>
          <Button size="sm" variant="outline" className="w-full" onClick={() => add('output')}>
            File to alerts
          </Button>
        </Section>

        <Section title="Tools">
          {catalogue?.tools.map((t) => (
            <button
              key={t.name}
              type="button"
              title={t.description}
              onClick={() => add('tool', { tool: t.name, label: t.name, args: {} })}
              className="w-full truncate rounded-lg px-2 py-1 text-left font-mono text-[11px] hover:bg-muted"
            >
              {t.name}
            </button>
          ))}
        </Section>
      </aside>

      <div className="min-h-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={(c: Connection) => setEdges((eds) => addEdge({ ...c, animated: true }, eds))}
          onNodeClick={(_e, n) => setSelected(n.id)}
          onPaneClick={() => selected && setSelected(null)}
          onNodesDelete={(deleted) => deleted.some((n) => n.id === selected) && setSelected(null)}
          deleteKeyCode={['Backspace', 'Delete']}
          colorMode={theme}
          style={FLOW_STYLE}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => KIND_MINIMAP[(n.data as NodeData).kind] ?? KIND_MINIMAP.tool}
            nodeBorderRadius={6}
            nodeComponent={MiniMapTask}
          />
          <Panel position="top-left" className="flex items-center gap-2">
            <div className="relative">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Workflow name"
                className="h-8 w-52 bg-background pr-6"
              />
              {dirty && (
                <span
                  className="absolute top-1/2 right-2 size-2 -translate-y-1/2 rounded-full bg-amber-500"
                  title="Unsaved changes"
                />
              )}
            </div>
            <Button
              size="sm"
              onClick={() => save.mutate({})}
              disabled={save.isPending || (!dirty && !!routeId)}
              title={`Save (${saveShortcut})`}
            >
              {save.isPending ? (
                <Spinner className="size-3.5" />
              ) : dirty || !routeId ? (
                <SaveIcon className="size-3.5" />
              ) : (
                <CheckIcon className="size-3.5" />
              )}
              {dirty || !routeId ? 'Save' : 'Saved'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => run.mutate()}
              disabled={run.isPending}
              title={dirty ? 'Saves your changes, then runs' : undefined}
            >
              {run.isPending ? <Spinner className="size-3.5" /> : <PlayIcon className="size-3.5" />}
              {dirty ? 'Save & run' : 'Run now'}
            </Button>
            {routeId && (
              <Link
                to="/agent/workflows/$workflowId/data"
                params={{ workflowId: routeId }}
                className={buttonVariants({ size: 'sm', variant: 'ghost' })}
              >
                <ChartNoAxesCombinedIcon className="size-3.5" />
                Data
              </Link>
            )}
          </Panel>
        </ReactFlow>
      </div>

      <aside className="min-h-0 space-y-3 overflow-y-auto border-l bg-muted/20 p-3">
        {!node ? (
          <>
            <Section title="When it runs">
              <Select
                value={trigger.kind}
                onValueChange={(v) => setTrigger({ ...trigger, kind: v as WorkflowTrigger['kind'] })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual only</SelectItem>
                  <SelectItem value="schedule">Daily at a time</SelectItem>
                  <SelectItem value="event_scan">After the daily event scan</SelectItem>
                </SelectContent>
              </Select>
              {trigger.kind === 'schedule' && (
                <Input
                  type="time"
                  value={trigger.time ?? '09:15'}
                  onChange={(e) => setTrigger({ ...trigger, time: e.target.value })}
                  className="h-8"
                />
              )}
              {trigger.kind !== 'manual' && (
                <Button
                  size="sm"
                  variant={enabled ? 'default' : 'outline'}
                  className="w-full"
                  onClick={() => setEnabled((v) => !v)}
                >
                  {enabled ? 'Armed — will run on its own' : 'Off — arm it to run unattended'}
                </Button>
              )}
              <p className="text-[11px] text-muted-foreground">
                Saving stores the arm state too. A workflow runs with nobody watching, so this is the standing
                permission.
              </p>
            </Section>

            {!!runs.length && (
              <Section title="Recent runs">
                {runs.map((r) => (
                  <Link
                    key={r.id}
                    to="/agent/workflows/$workflowId/runs/$runId"
                    params={{ workflowId, runId: r.id }}
                    title={r.error ?? new Date(r.created_at).toLocaleString('en-IN')}
                    className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[11px] transition-colors hover:bg-muted"
                  >
                    {r.status === 'running' ? (
                      <Spinner className="size-3 text-primary" />
                    ) : (
                      <span
                        className={cn(
                          'size-2 shrink-0 rounded-full',
                          r.status === 'failed' ? 'bg-down' : 'bg-up',
                        )}
                      />
                    )}
                    <span className="flex-1 truncate">{new Date(r.created_at).toLocaleString('en-IN')}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {r.finished_at
                        ? formatDuration(
                            (new Date(r.finished_at).getTime() - new Date(r.created_at).getTime()) / 1000,
                          )
                        : `${timeAgoShort(r.created_at)}`}
                    </span>
                  </Link>
                ))}
              </Section>
            )}
            <p className="text-[11px] text-muted-foreground">
              Click a node to configure it. Drag between the dots to wire one into the next.
            </p>
          </>
        ) : (
          <>
            <Section title={`${data?.kind} node`}>
              <Field label="Label">
                <Input
                  value={data?.label ?? ''}
                  onChange={(e) => patch(node.id, { label: e.target.value })}
                  className="h-8"
                />
              </Field>

              {data?.kind === 'tool' && (
                <>
                  {catalogue?.tools
                    .find((t) => t.name === data.tool)
                    ?.parameters.map((param) => (
                      <Field key={param} label={param}>
                        <Input
                          value={data.args?.[param] ?? ''}
                          onChange={(e) =>
                            patch(node.id, { args: { ...(data.args ?? {}), [param]: e.target.value } })
                          }
                          placeholder="value, or {{ nodeId.field }}"
                          className="h-8 font-mono text-xs"
                        />
                      </Field>
                    ))}
                  <Field label="Run once per item of">
                    <Input
                      value={data.for_each ?? ''}
                      onChange={(e) => patch(node.id, { for_each: e.target.value })}
                      placeholder="{{ nodeId.list }} — leave blank for one run"
                      className="h-8 font-mono text-xs"
                    />
                  </Field>
                </>
              )}

              {data?.kind === 'agent' && (
                <Field label="Prompt">
                  <Textarea
                    value={data.prompt ?? ''}
                    onChange={(e) => patch(node.id, { prompt: e.target.value })}
                    placeholder="Summarise {{ nodeId }} in three bullets"
                    rows={6}
                    className="font-mono text-xs"
                  />
                </Field>
              )}

              {data?.kind === 'condition' && (
                <>
                  <Field label="Value to test">
                    <Input
                      value={data.left ?? ''}
                      onChange={(e) => patch(node.id, { left: e.target.value })}
                      placeholder="{{ nodeId.changePercent }}"
                      className="h-8 font-mono text-xs"
                    />
                  </Field>
                  <Field label="Comparison">
                    <Select
                      value={data.op ?? 'gt'}
                      onValueChange={(v) => patch(node.id, { op: v as string })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(catalogue?.operators ?? []).map((op) => (
                          <SelectItem key={op} value={op}>
                            {op}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  {data.op !== 'not_empty' && (
                    <Field label="Against">
                      <Input
                        value={data.right ?? ''}
                        onChange={(e) => patch(node.id, { right: e.target.value })}
                        placeholder="5"
                        className="h-8 font-mono text-xs"
                      />
                    </Field>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    When this doesn't hold, every node downstream is <strong>skipped</strong> — not failed.
                    The run finishes quietly and files nothing.
                  </p>
                </>
              )}

              {data?.kind === 'collect' && (
                <>
                  <Field label="Series name">
                    <Input
                      value={data.series ?? ''}
                      onChange={(e) => patch(node.id, { series: e.target.value })}
                      placeholder="prices"
                      className="h-8 font-mono text-xs"
                    />
                  </Field>
                  <Field label="Rows to append">
                    <Input
                      value={data.rows ?? ''}
                      onChange={(e) => patch(node.id, { rows: e.target.value })}
                      placeholder="{{ nodeId }}"
                      className="h-8 font-mono text-xs"
                    />
                  </Field>
                  <p className="text-[11px] text-muted-foreground">
                    A list appends as many rows; anything else as one. Shows up under <strong>Data</strong> on
                    the workflow list.
                  </p>
                </>
              )}

              {data?.kind === 'output' && (
                <Field label="Message to file">
                  <Textarea
                    value={data.message ?? ''}
                    onChange={(e) => patch(node.id, { message: e.target.value })}
                    placeholder="{{ nodeId }}"
                    rows={4}
                    className="font-mono text-xs"
                  />
                </Field>
              )}
            </Section>
            <p className="text-[11px] text-muted-foreground">
              <code>{'{{ nodeId.field }}'}</code> reads a node you're wired to. Inside a for-each,{' '}
              <code>{'{{ item }}'}</code> is the current one.
            </p>
          </>
        )}
      </aside>

      <AlertDialog open={blocker.status === 'blocked'} onOpenChange={(open) => !open && blocker.reset?.()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave with unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Edits to {name} since the last save will be lost. A scheduled run uses the saved version.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Keep editing</AlertDialogCancel>
            <Button variant="outline" onClick={() => blocker.proceed?.()}>
              Discard
            </Button>
            <Button
              disabled={save.isPending}
              onClick={() => save.mutateAsync({ leaving: true }).then(() => blocker.proceed?.())}
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="font-mono text-[11px] text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}
