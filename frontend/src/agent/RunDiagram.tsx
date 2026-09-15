import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  getBezierPath,
  useNodesState,
  useStore,
} from '@xyflow/react'
import type { Edge, MiniMapNodeProps, Node, NodeProps, ReactFlowInstance } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  AlertTriangleIcon,
  CheckIcon,
  CopyIcon,
  MessageSquareIcon,
  SkipForwardIcon,
  WrenchIcon,
  XIcon,
  ZapIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAppliedTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { getRunWorkflow, getSessionWorkflow } from '@/services/api'
import type { WorkflowNode } from '@/services/api'

// What the agent actually DID, as a flow diagram: a trigger, a node per tool call, an answer.
//
// The graph is built on the server (app/services/workflow.py) and rendered verbatim here -
// positions included. Laying out in the browser would mean the shape a user sees and the shape
// anything else reads are two different computations of the same thing, and only one of them has
// a self-check.
//
// Tools that share a round are drawn as parallel branches, because that is what they were: one
// model turn asked for all of them at once.
//
// Clicking a node opens its details in a drawer - the full error, what it was called with and what
// came back. Which node is open is the caller's (a URL param), so a failure can be linked to.

const KIND_ICON = { trigger: ZapIcon, tool: WrenchIcon, reply: MessageSquareIcon }
const KIND_LABEL = { trigger: 'Trigger', tool: 'Step', reply: 'Outcome' }

const STATUS_RING: Record<string, string> = {
  done: 'border-up/60',
  running: 'border-primary',
  error: 'border-down',
  skipped: 'border-dashed border-muted-foreground/40 opacity-70',
}

// Hex rather than theme variables: the minimap paints these into SVG.
const MINIMAP_COLOR: Record<string, string> = {
  done: '#22c55e',
  running: '#3b82f6',
  error: '#ef4444',
  skipped: '#71717a',
}

const FLOW_STYLE = { '--xy-background-color': 'transparent' } as CSSProperties

type NodeData = WorkflowNode['data']

/** A step a condition switched off. The engine records it as a finished call whose result says so,
 *  so the server calls it done - it never ran, and reading it as a green tick would be a lie. */
const statusOf = (d: NodeData) =>
  d.status === 'done' && typeof d.result === 'object' && d.result !== null && 'skipped' in d.result
    ? 'skipped'
    : d.status

function TaskNode({ data, selected }: NodeProps<Node<NodeData>>) {
  const Icon = KIND_ICON[data.kind] ?? WrenchIcon
  const status = statusOf(data)
  const detail =
    data.kind === 'tool'
      ? Object.entries(data.args ?? {})
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(' · ')
      : data.detail
  return (
    <div
      className={cn(
        'w-48 cursor-pointer rounded-xl border-2 bg-card px-3 py-2 shadow-sm transition-shadow hover:shadow-md',
        STATUS_RING[status] ?? 'border-border',
        selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-xs font-medium">{data.label}</span>
        {status === 'done' && <CheckIcon className="ml-auto size-3.5 shrink-0 text-up" />}
        {status === 'running' && <Spinner className="ml-auto size-3.5 shrink-0" />}
        {status === 'error' && <AlertTriangleIcon className="ml-auto size-3.5 shrink-0 text-down" />}
        {status === 'skipped' && (
          <SkipForwardIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
        )}
      </div>
      {detail && <p className="mt-1 truncate text-[11px] text-muted-foreground">{detail}</p>}
      {data.error && <p className="mt-1 truncate text-[11px] text-down">{data.error}</p>}
      {/* Both handles on every node: the server decides the wiring, so a node never needs to know
          whether it happens to be first or last. */}
      <Handle type="target" position={Position.Left} className="!size-1.5 !bg-muted-foreground" />
      <Handle type="source" position={Position.Right} className="!size-1.5 !bg-muted-foreground" />
    </div>
  )
}

const NODE_TYPES = { task: TaskNode }

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i])

/** React Flow's minimap draws node rectangles only, never the wires between them - so a run reads
 *  as a row of unrelated dashes. This is its node, plus that node's outgoing edges drawn under it.
 *  The minimap's SVG is in flow coordinates, so the same bezier the canvas draws fits as-is;
 *  `non-scaling-stroke` keeps the line a pixel wide however far the minimap is zoomed out. */
function MiniMapTask({
  id,
  x,
  y,
  width,
  height,
  borderRadius,
  color,
  className,
  shapeRendering,
  selected,
}: MiniMapNodeProps) {
  // Path and colour as plain strings, so the store's equality check is a cheap list compare.
  const wires = useStore(
    (s) =>
      s.edges
        .filter((e) => e.source === id)
        .flatMap((e) => {
          const source = s.nodeLookup.get(e.source)
          const target = s.nodeLookup.get(e.target)
          if (!source?.measured.height || !target?.measured.height) return []
          const [d] = getBezierPath({
            sourceX: source.internals.positionAbsolute.x + (source.measured.width ?? 0),
            sourceY: source.internals.positionAbsolute.y + source.measured.height / 2,
            sourcePosition: Position.Right,
            targetX: target.internals.positionAbsolute.x,
            targetY: target.internals.positionAbsolute.y + target.measured.height / 2,
            targetPosition: Position.Left,
          })
          return [
            `${d}|${(e as { status?: string }).status === 'error' ? MINIMAP_COLOR.error : MINIMAP_COLOR.skipped}`,
          ]
        }),
    sameList,
  )
  return (
    <g>
      {wires.map((wire) => {
        const [d, stroke] = wire.split('|')
        return (
          <path
            key={d}
            d={d}
            fill="none"
            stroke={stroke}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
      <rect
        className={cn('react-flow__minimap-node', selected && 'selected', className)}
        x={x}
        y={y}
        rx={borderRadius}
        ry={borderRadius}
        width={width}
        height={height}
        style={{ fill: color }}
        shapeRendering={shapeRendering}
      />
    </g>
  )
}

/** The diagram of ONE run - a chat turn or a workflow execution, which are the same rows and so
 *  the same picture. Pass a runId for a specific one, or a sessionId for that chat's latest. */
export default function RunDiagram({
  sessionId,
  runId,
  empty,
  selectedId,
  onSelect,
}: {
  sessionId?: string | null
  runId?: string | null
  empty?: string
  selectedId?: string | null
  onSelect?: (nodeId: string | null) => void
}) {
  const theme = useAppliedTheme()
  const { data, isLoading } = useQuery({
    queryKey: ['agentWorkflow', runId ?? sessionId],
    queryFn: () => (runId ? getRunWorkflow(runId) : getSessionWorkflow(sessionId as string)),
    enabled: !!(runId || sessionId),
    // A run in flight grows nodes as it goes, so the diagram follows it; a finished one settles.
    refetchInterval: (q) => (q.state.data?.run?.status === 'running' ? 1000 : false),
  })

  // Controlled through onNodesChange, not a plain memo: React Flow records each node's measured size
  // through it, and the minimap skips any node without one - a memo'd list left it an empty frame.
  // A refetch or a selection change carries over the sizes already measured.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  useEffect(() => {
    setNodes((prev) => {
      const measured = new Map(prev.map((n) => [n.id, n.measured]))
      return (data?.nodes ?? []).map((n) => ({
        ...n,
        measured: measured.get(n.id),
        selected: n.id === selectedId,
      })) as unknown as Node[]
    })
  }, [data, selectedId, setNodes])
  const edges = useMemo<Edge[]>(
    () =>
      (data?.edges ?? []).map((e) => ({
        ...e,
        style: { stroke: e.status === 'error' ? 'var(--color-down)' : undefined },
      })) as unknown as Edge[],
    [data],
  )

  // The failing step first: the outcome node repeats its error, but the step is where it happened.
  const failed = useMemo(
    () =>
      (data?.nodes ?? [])
        .filter((n) => n.data.status === 'error')
        .sort((a, b) => Number(a.data.kind === 'reply') - Number(b.data.kind === 'reply')),
    [data],
  )
  const open = data?.nodes.find((n) => n.id === selectedId)

  // Arriving on a link to one node puts that node in view, rather than leaving it off-screen
  // behind a drawer that is describing it.
  const focusOnLoad = (instance: ReactFlowInstance) => {
    if (!selectedId) return
    requestAnimationFrame(() =>
      instance.fitView({ nodes: [{ id: selectedId }], maxZoom: 1.2, padding: 1.5, duration: 300 }),
    )
  }

  if (!runId && !sessionId) {
    return <Empty>{empty ?? 'Pick a chat on the left to see what it did.'}</Empty>
  }
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    )
  }
  if (!data?.nodes?.length) {
    return <Empty>{empty ?? "This chat hasn't run the agent yet — send it something first."}</Empty>
  }

  return (
    <div className="relative h-full overflow-hidden">
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onInit={focusOnLoad}
        onNodeClick={(_e, n) => onSelect?.(n.id === selectedId ? null : n.id)}
        onPaneClick={() => selectedId && onSelect?.(null)}
        colorMode={theme}
        style={FLOW_STYLE}
        fitView
        // Read-only: this is a record of a run, not a pipeline to rewire. Panning and zooming stay,
        // because a long run is wider than the pane.
        nodesConnectable={false}
        nodesDraggable={false}
        edgesFocusable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => MINIMAP_COLOR[statusOf(n.data as NodeData)] ?? MINIMAP_COLOR.skipped}
          nodeBorderRadius={6}
          nodeComponent={MiniMapTask}
          // Out from under the drawer while one is open.
          style={open ? { right: 'min(30rem, 100%)' } : undefined}
        />
        {failed.length > 0 && !open && (
          <Panel position="top-center">
            <button
              type="button"
              onClick={() => onSelect?.(failed[0].id)}
              className="flex items-center gap-2 rounded-lg border border-down/40 bg-card px-3 py-1.5 text-xs shadow-sm transition-colors hover:bg-muted"
            >
              <AlertTriangleIcon className="size-3.5 text-down" />
              {failed.length === 1 ? '1 step failed' : `${failed.length} steps failed`}
              <span className="font-mono font-medium">{failed[0].data.label}</span>
              <span className="text-primary">Inspect →</span>
            </button>
          </Panel>
        )}
      </ReactFlow>
      {open && <NodeDrawer node={open} onClose={() => onSelect?.(null)} />}
    </div>
  )
}

const json = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))

function NodeDrawer({ node, onClose }: { node: WorkflowNode; onClose: () => void }) {
  const d = node.data
  const status = statusOf(d)
  const Icon = KIND_ICON[d.kind] ?? WrenchIcon
  const args = Object.entries(d.args ?? {})
  const itemErrors = Array.isArray(d.result)
    ? d.result.filter((r) => typeof r === 'object' && r !== null && 'error' in r).length
    : 0
  const bodyRef = useRef<HTMLDivElement>(null)

  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Switching nodes starts the new one at its top, not wherever the last one was scrolled to.
  // Braced: Chromium's scrollTo now returns a Promise, and an effect that returns one crashes
  // React's cleanup ("destroy is not a function").
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
  }, [node.id])

  return (
    <aside
      aria-label={`Details for ${d.label}`}
      className="absolute inset-y-0 right-0 z-10 flex w-[30rem] max-w-full flex-col border-l bg-card shadow-2xl duration-200 animate-in fade-in-0 slide-in-from-right-8"
    >
      <header className="flex items-start gap-2 border-b px-4 py-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm font-medium" title={d.label}>
            {d.label}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {KIND_LABEL[d.kind] ?? d.kind}
            {d.kind === 'tool' && d.items != null && ` · ${d.items} item${d.items === 1 ? '' : 's'} out`}
          </p>
        </div>
        <StatusPill status={status} />
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onClose}
          aria-label="Close details"
          title="Close (Esc)"
        >
          <XIcon />
        </Button>
      </header>

      <div ref={bodyRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {d.error && (
          <Block title="Error" copy={d.error} tone="bad">
            <pre className="font-mono text-xs break-words whitespace-pre-wrap">{d.error}</pre>
          </Block>
        )}
        {status === 'skipped' && (
          <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
            Skipped — a condition upstream didn't hold, so this step never ran. That is a quiet run, not a
            failure.
          </p>
        )}
        {status === 'running' && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" /> Still running — this updates as it goes.
          </p>
        )}
        {itemErrors > 0 && (
          <p className="rounded-lg border border-down/30 bg-down/5 px-3 py-2 text-xs text-down">
            {itemErrors} of {(d.result as unknown[]).length} items failed. Each failure is that item's entry
            under Returned.
          </p>
        )}
        {d.detail && (
          <Block
            title={d.kind === 'trigger' ? 'Prompt' : status === 'error' ? 'What the run reported' : 'Answer'}
            copy={d.detail}
            tone={status === 'error' && !d.error ? 'bad' : undefined}
          >
            <pre className="font-sans text-xs break-words whitespace-pre-wrap">{d.detail}</pre>
          </Block>
        )}
        {args.length > 0 && (
          <Block title="Called with" copy={json(d.args)}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
              {args.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className={cn('break-all', v == null && 'text-down')}>
                    {v == null ? 'null' : json(v)}
                  </dd>
                </div>
              ))}
            </dl>
          </Block>
        )}
        {d.kind === 'tool' && status !== 'skipped' && d.result != null && (
          <Block title="Returned" copy={json(d.result)}>
            <pre className="max-h-[28rem] overflow-auto font-mono text-[11px] leading-relaxed">
              {json(d.result)}
            </pre>
          </Block>
        )}
      </div>
    </aside>
  )
}

function StatusPill({ status }: { status: string }) {
  const meta: Record<string, [string, string]> = {
    done: ['Done', 'bg-up/10 text-up'],
    running: ['Running', 'bg-primary/10 text-primary'],
    error: ['Failed', 'bg-down/10 text-down'],
    skipped: ['Skipped', 'bg-muted text-muted-foreground'],
  }
  const [label, cls] = meta[status] ?? [status, 'bg-muted text-muted-foreground']
  return <span className={cn('mt-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium', cls)}>{label}</span>
}

function Block({
  title,
  copy,
  tone,
  children,
}: {
  title: string
  copy: string
  tone?: 'bad'
  children: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[11px] font-medium text-muted-foreground">{title}</h3>
        <button
          type="button"
          onClick={() =>
            navigator.clipboard.writeText(copy).then(
              () => setCopied(true),
              () => toast.error('Could not copy to the clipboard'),
            )
          }
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={`Copy ${title.toLowerCase()}`}
        >
          {copied ? <CheckIcon className="size-3 text-up" /> : <CopyIcon className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div
        className={cn(
          'rounded-lg border bg-muted/30 px-3 py-2',
          tone === 'bad' && 'border-down/40 bg-down/5 text-down',
        )}
      >
        {children}
      </div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}
