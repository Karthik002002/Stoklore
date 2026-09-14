import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Background, Controls, Handle, MiniMap, Position, ReactFlow } from '@xyflow/react'
import type { Edge, Node, NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AlertTriangleIcon, CheckIcon, MessageSquareIcon, WrenchIcon, ZapIcon } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
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

const KIND_ICON = { trigger: ZapIcon, tool: WrenchIcon, reply: MessageSquareIcon }

const STATUS_RING: Record<string, string> = {
  done: 'border-up/60',
  running: 'border-primary',
  error: 'border-down',
}

function TaskNode({ data }: NodeProps<Node<WorkflowNode['data']>>) {
  const Icon = KIND_ICON[data.kind] ?? WrenchIcon
  const detail =
    data.kind === 'tool'
      ? Object.entries(data.args ?? {})
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(' · ')
      : data.detail
  return (
    <div
      className={`w-48 rounded-xl border-2 bg-card px-3 py-2 shadow-sm ${STATUS_RING[data.status] ?? 'border-border'}`}
      // The whole value of a node is what the tool was called with and what came back, so the
      // full thing is on hover rather than only in an inspector nobody opens.
      title={detail || data.label}
    >
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-xs font-medium">{data.label}</span>
        {data.status === 'done' && <CheckIcon className="ml-auto size-3.5 shrink-0 text-up" />}
        {data.status === 'running' && <Spinner className="ml-auto size-3.5 shrink-0" />}
        {data.status === 'error' && <AlertTriangleIcon className="ml-auto size-3.5 shrink-0 text-down" />}
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

/** The diagram of ONE run - a chat turn or a workflow execution, which are the same rows and so
 *  the same picture. Pass a runId for a specific one, or a sessionId for that chat's latest. */
export default function RunDiagram({
  sessionId,
  runId,
  empty,
}: {
  sessionId?: string | null
  runId?: string | null
  empty?: string
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['agentWorkflow', runId ?? sessionId],
    queryFn: () => (runId ? getRunWorkflow(runId) : getSessionWorkflow(sessionId as string)),
    enabled: !!(runId || sessionId),
    // A run in flight grows nodes as it goes, so the diagram follows it; a finished one settles.
    refetchInterval: (q) => (q.state.data?.run?.status === 'running' ? 1000 : false),
  })

  const nodes = useMemo<Node[]>(() => (data?.nodes ?? []) as unknown as Node[], [data])
  const edges = useMemo<Edge[]>(
    () =>
      (data?.edges ?? []).map((e) => ({
        ...e,
        style: { stroke: e.status === 'error' ? 'var(--color-down)' : undefined },
      })) as unknown as Edge[],
    [data],
  )

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
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
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
      <MiniMap pannable zoomable className="!bg-muted" />
    </ReactFlow>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}
