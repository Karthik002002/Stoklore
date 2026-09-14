import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Background,
  Controls,
  Handle,
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
  DatabaseIcon,
  FilterIcon,
  PlayIcon,
  SaveIcon,
  SendIcon,
  WrenchIcon,
  ZapIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { getWorkflow, getWorkflowCatalogue, getWorkflowRuns, runWorkflow, saveWorkflow } from '@/services/api'
import type { WorkflowGraphNode, WorkflowTrigger } from '@/services/api'
import RunDiagram from './RunDiagram'

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

const KIND_ICON = {
  trigger: ZapIcon,
  tool: WrenchIcon,
  agent: BotIcon,
  condition: FilterIcon,
  collect: DatabaseIcon,
  output: SendIcon,
}
const KIND_TINT: Record<string, string> = {
  trigger: 'border-primary/50 bg-primary/5',
  tool: 'border-border bg-card',
  agent: 'border-up/40 bg-up/5',
  condition: 'border-amber-500/50 bg-amber-500/5',
  collect: 'border-sky-500/50 bg-sky-500/5',
  output: 'border-down/40 bg-down/5',
}

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
      className={`w-44 rounded-xl border-2 px-3 py-2 shadow-sm ${KIND_TINT[data.kind]} ${
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

export default function WorkflowEditor({ id, onBack }: { id: string | null; onBack: () => void }) {
  const queryClient = useQueryClient()
  const [workflowId] = useState(() => id ?? crypto.randomUUID())
  const [name, setName] = useState('New workflow')
  const [trigger, setTrigger] = useState<WorkflowTrigger>({ kind: 'manual', time: '09:15' })
  const [enabled, setEnabled] = useState(false)
  const [retain, setRetain] = useState(30)
  const [selected, setSelected] = useState<string | null>(null)
  const [showRun, setShowRun] = useState<string | null>(null)

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const { data: catalogue } = useQuery({ queryKey: ['workflowCatalogue'], queryFn: getWorkflowCatalogue })
  const { data: existing } = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => getWorkflow(id as string),
    enabled: !!id,
  })
  const { data: runs = [] } = useQuery({
    queryKey: ['workflowRuns', workflowId],
    queryFn: () => getWorkflowRuns(workflowId),
    enabled: !!id,
    refetchInterval: 3000,
  })

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
        data: { ...n.data, kind: n.kind },
      })) as Node[],
    )
    setEdges((existing.graph?.edges ?? []) as Edge[])
  }, [existing, setNodes, setEdges])

  const patch = useCallback(
    (nodeId: string, next: Partial<NodeData>) =>
      setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...next } } : n))),
    [setNodes],
  )

  const add = (kind: string, extra: Partial<NodeData> = {}) => {
    const nodeId = newId()
    setNodes((prev) => [
      ...prev,
      {
        id: nodeId,
        type: 'editor',
        // Stacked down-right from the last node so a new one never lands on top of another.
        position: { x: 80 + prev.length * 40, y: 60 + prev.length * 70 },
        data: { kind, label: extra.tool ?? kind, ...extra },
      } as Node,
    ])
    setSelected(nodeId)
  }

  const save = useMutation({
    mutationFn: () =>
      saveWorkflow(workflowId, {
        name,
        description: null,
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
    onSuccess: () => {
      toast.success('Workflow saved')
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const run = useMutation({
    mutationFn: () => runWorkflow(workflowId),
    onSuccess: ({ run_id }) => {
      setShowRun(run_id)
      toast.success('Running — it keeps going if you leave')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const node = nodes.find((n) => n.id === selected)
  const data = node?.data as NodeData | undefined

  if (showRun) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <Button size="sm" variant="ghost" onClick={() => setShowRun(null)}>
            <ArrowLeftIcon className="size-4" />
            Back to the editor
          </Button>
          <span className="text-xs text-muted-foreground">What this run did</span>
        </div>
        <div className="min-h-0 flex-1">
          <RunDiagram runId={showRun} empty="This run hasn't reported a node yet." />
        </div>
      </div>
    )
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[13rem_1fr_16rem]">
      <aside className="min-h-0 space-y-3 overflow-y-auto border-r bg-muted/20 p-2">
        <Button size="sm" variant="ghost" className="w-full justify-start" onClick={onBack}>
          <ArrowLeftIcon className="size-4" />
          All workflows
        </Button>

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
          onPaneClick={() => setSelected(null)}
          deleteKeyCode={['Backspace', 'Delete']}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
          <Panel position="top-left" className="flex items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 w-52 bg-background"
            />
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              <SaveIcon className="size-3.5" />
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>
              <PlayIcon className="size-3.5" />
              Run now
            </Button>
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
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setShowRun(r.id)}
                    className="w-full rounded-lg px-2 py-1 text-left text-[11px] hover:bg-muted"
                  >
                    <span
                      className={
                        r.status === 'failed'
                          ? 'text-down'
                          : r.status === 'running'
                            ? 'text-primary'
                            : 'text-up'
                      }
                    >
                      ●
                    </span>{' '}
                    {new Date(r.created_at).toLocaleString('en-IN')}
                  </button>
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
