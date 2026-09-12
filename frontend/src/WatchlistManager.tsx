import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Background,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import type { Connection, Edge, Node, NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { BookmarkIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { inr } from '@/lib/format'
import { useShortcut, useShortcutLabel } from '@/lib/shortcuts'
import { useTheme } from '@/lib/theme'
import { addStock, getStocks, getWatchlist, getWatchlistNames } from '@/services/api'
import type { TrackedStock } from '@/services/api'

// The stock -> watchlist mapping as a canvas: symbols down the left, lists down the right, one
// edge per membership. Drag from a symbol to a list to file it; select an edge and press Delete to
// unfile it. A stock can sit in any number of lists, which is exactly what a graph draws well and
// a checkbox menu buried in a row hides.
//
// Opened by Mod+B from ANY page (mounted once in App, opened by a window event - the same trick
// Profile uses, since a modal reached from the command palette can't take a callback threaded down
// through App's tree).
const OPEN_EVENT = 'watchlists:open'

export function openWatchlists() {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT))
}

// Node ids are prefixed so one look at a connection says which end is which - `onConnect` gets
// nothing but two ids, and a symbol could otherwise share a name with a list.
const stockId = (symbol: string) => `s:${symbol}`
const listId = (name: string) => `l:${name}`
const edgeId = (symbol: string, name: string) => `${stockId(symbol)}->${listId(name)}`

type StockNodeData = { symbol: string; stock?: TrackedStock }
type ListNodeData = { name: string; count: number }

const pctClass = (v: number | null | undefined) =>
  v == null ? 'text-muted-foreground' : v > 0 ? 'text-green-500' : v < 0 ? 'text-red-500' : ''

function StockNode({ data }: NodeProps<Node<StockNodeData>>) {
  const { symbol, stock } = data
  return (
    <div className="w-44 rounded-xl border bg-card px-3 py-2 shadow-sm">
      <p className="font-mono text-sm font-medium">{symbol}</p>
      {stock ? (
        <p className="text-xs text-muted-foreground">
          {inr(stock.price)}{' '}
          <span className={pctClass(stock.changePercent)}>
            {stock.changePercent == null ? '' : `${stock.changePercent.toFixed(2)}%`}
          </span>
        </p>
      ) : (
        // Every symbol on a watchlist gets a node, tracked or not - the two sets genuinely differ
        // (a list can hold a symbol that was never scraped), and hiding those was hiding the
        // mapping this canvas exists to show.
        <p className="text-xs text-muted-foreground">Not tracked</p>
      )}
      <Handle type="source" position={Position.Right} className="!size-2 !bg-primary" />
    </div>
  )
}

function ListNode({ data }: NodeProps<Node<ListNodeData>>) {
  return (
    <div className="w-44 rounded-xl border bg-primary/5 px-3 py-2 shadow-sm">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <BookmarkIcon className="size-3.5 text-primary" />
        {data.name}
      </p>
      <p className="text-xs text-muted-foreground">
        {data.count} stock{data.count === 1 ? '' : 's'}
      </p>
      <Handle type="target" position={Position.Left} className="!size-2 !bg-primary" />
    </div>
  )
}

const NODE_TYPES = { stock: StockNode, list: ListNode }
const ROW = 96

export default function WatchlistManager() {
  const [open, setOpen] = useState(false)
  const [newStock, setNewStock] = useState('')
  const [newList, setNewList] = useState('')
  const queryClient = useQueryClient()
  const { theme } = useTheme()

  useShortcut('global.watchlists', () => setOpen((o) => !o))
  const shortcut = useShortcutLabel('global.watchlists')

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [])

  // The same three query keys the Stocks page reads, so opening this costs no request and editing
  // here updates that page underneath. Only fetched while the canvas is open.
  const { data: stocks = [], isLoading } = useQuery({
    queryKey: ['stocks'],
    queryFn: getStocks,
    enabled: open,
  })
  const { data: watchlist = [] } = useQuery({
    queryKey: ['watchlist'],
    queryFn: getWatchlist,
    enabled: open,
  })
  const { data: lists = [] } = useQuery({
    queryKey: ['watchlists'],
    queryFn: getWatchlistNames,
    enabled: open,
  })

  const refresh = useCallback(
    () =>
      ['stocks', 'watchlist', 'watchlists'].forEach((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    [queryClient],
  )

  // Every symbol worth a node: tracked ones, plus any symbol a list already holds.
  const symbols = useMemo(() => {
    const byName = new Map<string, TrackedStock | undefined>()
    for (const w of watchlist) if (!byName.has(w.symbol)) byName.set(w.symbol, undefined)
    for (const s of stocks) byName.set(s.symbol, s)
    return [...byName].sort(([a], [b]) => (a < b ? -1 : 1))
  }, [stocks, watchlist])

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  // Rebuilt from server data on every change, but each node keeps whatever position it already
  // has - otherwise filing one stock would throw away every node the user had dragged.
  useEffect(() => {
    setNodes((prev) => {
      const at = new Map(prev.map((n) => [n.id, n.position]))
      const counts = new Map<string, number>()
      for (const w of watchlist) counts.set(w.list_name, (counts.get(w.list_name) ?? 0) + 1)
      return [
        ...symbols.map(([symbol, stock], i) => ({
          id: stockId(symbol),
          type: 'stock',
          position: at.get(stockId(symbol)) ?? { x: 0, y: i * ROW },
          data: { symbol, stock },
          deletable: false,
        })),
        ...lists.map((name, i) => ({
          id: listId(name),
          type: 'list',
          position: at.get(listId(name)) ?? { x: 420, y: i * ROW },
          data: { name, count: counts.get(name) ?? 0 },
          deletable: false,
        })),
      ]
    })
    setEdges(
      watchlist.map((w) => ({
        id: edgeId(w.symbol, w.list_name),
        source: stockId(w.symbol),
        target: listId(w.list_name),
        animated: true,
      })),
    )
  }, [symbols, lists, watchlist, setNodes, setEdges])

  const map = useMutation({
    mutationFn: ({ symbol, name }: { symbol: string; name: string }) =>
      fetch(`/api/watchlist/${symbol}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ list_name: name }),
      }),
    onSuccess: (_r, { symbol, name }) => {
      toast.success(`${symbol} added to ${name}`)
      refresh()
    },
  })

  const unmap = useMutation({
    mutationFn: ({ symbol, name }: { symbol: string; name: string }) =>
      fetch(`/api/watchlist/${symbol}?list_name=${encodeURIComponent(name)}`, { method: 'DELETE' }),
    onSuccess: (_r, { symbol, name }) => {
      toast.success(`${symbol} removed from ${name}`)
      refresh()
    },
  })

  // POST /api/stocks scrapes the symbol live, so an unknown ticker fails here rather than landing
  // on the canvas as an empty node - the same path the Stocks page's add box uses.
  const add = useMutation({
    mutationFn: () => addStock(newStock.trim().toUpperCase()),
    onSuccess: ({ symbol }) => {
      toast.success(`${symbol} added`)
      setNewStock('')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const createList = useMutation({
    mutationFn: () =>
      fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newList.trim() }),
      }),
    onSuccess: () => {
      setNewList('')
      refresh()
    },
  })

  // Handles already make the wrong direction impossible to draw; this is the guard for a
  // programmatic or replayed connection.
  const onConnect = (c: Connection) => {
    if (!c.source?.startsWith('s:') || !c.target?.startsWith('l:')) return
    map.mutate({ symbol: c.source.slice(2), name: c.target.slice(2) })
  }

  const onEdgesDelete = (removed: Edge[]) => {
    for (const e of removed) unmap.mutate({ symbol: e.source.slice(2), name: e.target.slice(2) })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[85vh] max-h-[85vh] w-[90vw] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2">
            <BookmarkIcon className="size-4" />
            Watchlists
            <span className="text-sm font-normal text-muted-foreground">
              — drag a stock onto a list to map it, select an edge and press Delete to unmap
            </span>
            <span className="ml-auto text-xs font-normal text-muted-foreground">{shortcut}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="size-5" />
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onEdgesDelete={onEdgesDelete}
              deleteKeyCode={['Backspace', 'Delete']}
              colorMode={theme === 'dark' ? 'dark' : 'light'}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
              <Panel position="top-left" className="flex gap-2">
                <form
                  className="flex gap-1"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (newStock.trim()) add.mutate()
                  }}
                >
                  <Input
                    value={newStock}
                    onChange={(e) => setNewStock(e.target.value)}
                    placeholder="Add stock…"
                    className="h-8 w-36 bg-background font-mono text-xs uppercase placeholder:normal-case"
                  />
                  <Button type="submit" size="icon-sm" className="size-8" disabled={add.isPending}>
                    {add.isPending ? <Spinner className="size-3.5" /> : <PlusIcon className="size-3.5" />}
                  </Button>
                </form>
                <form
                  className="flex gap-1"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (newList.trim()) createList.mutate()
                  }}
                >
                  <Input
                    value={newList}
                    onChange={(e) => setNewList(e.target.value)}
                    placeholder="New watchlist…"
                    className="h-8 w-36 bg-background text-xs"
                  />
                  <Button type="submit" size="icon-sm" variant="outline" className="size-8">
                    <PlusIcon className="size-3.5" />
                  </Button>
                </form>
              </Panel>
            </ReactFlow>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
