import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { Connection, Edge, Node, NodeProps, ReactFlowInstance } from '@xyflow/react'
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
import type { TrackedStock, WatchlistEntry } from '@/services/api'

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
const memberId = (name: string, symbol: string) => `m:${name}/${symbol}`
const edgeId = (symbol: string, name: string) => `${memberId(name, symbol)}->${listId(name)}`

// Stable empty arrays for the query defaults below. `= []` in a destructuring default builds a NEW
// array on every render whenever `data` is undefined - and these queries are `enabled: open`, so
// that is every render while the dialog is shut. A fresh identity busts the useMemo that depends on
// it, which re-runs the effect, which setStates, which renders again: "Maximum update depth
// exceeded", with nothing on screen to hint at where it came from.
const NO_STOCKS: TrackedStock[] = []
const NO_MEMBERSHIPS: WatchlistEntry[] = []
const NO_LISTS: string[] = []

type StockNodeData = { symbol: string; stock?: TrackedStock; list?: string }
type ListNodeData = { name: string; count: number }

const pctClass = (v: number | null | undefined) =>
  v == null ? 'text-muted-foreground' : v > 0 ? 'text-green-500' : v < 0 ? 'text-red-500' : ''

function StockNode({ data, selected }: NodeProps<Node<StockNodeData>>) {
  const { symbol, stock } = data
  return (
    <div
      className={`w-44 rounded-lg border bg-card px-3 py-1.5 shadow-sm ${selected ? 'ring-2 ring-primary' : ''}`}
    >
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
      <Handle type="source" position={Position.Left} className="!size-2 !bg-primary" />
    </div>
  )
}

function ListNode({ data, selected }: NodeProps<Node<ListNodeData>>) {
  return (
    <div
      className={`w-48 rounded-xl border bg-primary/5 px-3 py-2 shadow-sm ${selected ? 'ring-2 ring-primary' : ''}`}
    >
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <BookmarkIcon className="size-3.5 text-primary" />
        {data.name}
      </p>
      <p className="text-xs text-muted-foreground">
        {data.count} stock{data.count === 1 ? '' : 's'}
      </p>
      {/* Near the left edge, so the edges down to its stocks read as a tree. */}
      <Handle type="target" position={Position.Bottom} style={{ left: 14 }} className="!size-2 !bg-primary" />
    </div>
  )
}

function LabelNode({ data }: NodeProps<Node<{ text: string }>>) {
  return (
    <p className="w-44 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{data.text}</p>
  )
}

const NODE_TYPES = { stock: StockNode, list: ListNode, label: LabelNode }

// Each watchlist is a column: the list on top, the stocks in it underneath, indented like a tree.
// Stocks in no list get a column of their own at the side.
const COL = 240
const INDENT = 28
const FIRST = 84
const ROW = 64

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
  const { data: stocks = NO_STOCKS, isLoading } = useQuery({
    queryKey: ['stocks'],
    queryFn: getStocks,
    enabled: open,
  })
  const { data: watchlist = NO_MEMBERSHIPS } = useQuery({
    queryKey: ['watchlist'],
    queryFn: getWatchlist,
    enabled: open,
  })
  const { data: lists = NO_LISTS } = useQuery({
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
  const flow = useRef<ReactFlowInstance<Node, Edge> | null>(null)
  // A node to bring into view once it exists: set by adding a stock or a list, cleared on arrival.
  const [focus, setFocus] = useState<string | null>(null)

  // Laid out from the data every time it changes - a list's stocks always sit under it, whatever
  // was just filed or removed. Selection survives the rebuild.
  useEffect(() => {
    setNodes((prev) => {
      const selected = new Set(prev.filter((n) => n.selected).map((n) => n.id))
      const bySymbol = new Map(symbols)
      const members = new Map<string, string[]>(lists.map((name) => [name, []]))
      for (const w of watchlist) {
        if (!members.has(w.list_name)) members.set(w.list_name, [])
        members.get(w.list_name)?.push(w.symbol)
      }
      const filed = new Set(watchlist.map((w) => w.symbol))
      const loose = symbols.map(([symbol]) => symbol).filter((symbol) => !filed.has(symbol))

      const out: Node[] = []
      ;[...members].forEach(([name, held], i) => {
        const x = i * COL
        out.push({
          id: listId(name),
          type: 'list',
          position: { x, y: 0 },
          data: { name, count: held.length },
          deletable: false,
          selected: selected.has(listId(name)),
        })
        held.sort().forEach((symbol, j) => {
          const id = memberId(name, symbol)
          out.push({
            id,
            type: 'stock',
            position: { x: x + INDENT, y: FIRST + j * ROW },
            data: { symbol, stock: bySymbol.get(symbol), list: name },
            selected: selected.has(id),
          })
        })
      })
      if (loose.length) {
        const x = members.size * COL + (members.size ? 40 : 0)
        out.push({
          id: 'label:loose',
          type: 'label',
          position: { x, y: 16 },
          data: { text: 'Not in any list' },
          deletable: false,
          selectable: false,
          draggable: false,
        })
        loose.forEach((symbol, j) => {
          out.push({
            id: stockId(symbol),
            type: 'stock',
            position: { x, y: FIRST + j * ROW },
            data: { symbol, stock: bySymbol.get(symbol) },
            // Nothing to remove it from - deleting a stock itself lives on the Stocks page.
            deletable: false,
            selected: selected.has(stockId(symbol)),
          })
        })
      }
      return out
    })
    setEdges(
      watchlist.map((w) => ({
        id: edgeId(w.symbol, w.list_name),
        source: memberId(w.list_name, w.symbol),
        target: listId(w.list_name),
        type: 'smoothstep',
        data: { symbol: w.symbol, list: w.list_name },
      })),
    )
  }, [symbols, lists, watchlist, setNodes, setEdges])

  // Pan to what was just added and select it - it may have landed below the fold, and "added"
  // should be something you can see, not only a toast.
  useEffect(() => {
    const node = focus ? nodes.find((n) => n.id === focus) : undefined
    if (!node || !flow.current) return
    flow.current.setCenter(node.position.x + 88, node.position.y + 28, {
      zoom: Math.max(flow.current.getZoom(), 0.9),
      duration: 400,
    })
    setNodes((all) => all.map((n) => ({ ...n, selected: n.id === focus })))
    setFocus(null)
  }, [focus, nodes, setNodes])

  // fetch() resolves on a 4xx/5xx; a failed save must not toast as a success.
  const ok = async (res: Response) => {
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new Error(body?.detail ?? `Request failed (${res.status})`)
    }
    return res
  }

  // Memberships change in the cache first, so the edge and the list's count move the moment you
  // let go; the refetch after only confirms it (or puts it back, if the save failed).
  const map = useMutation({
    mutationFn: ({ symbol, name }: { symbol: string; name: string }) =>
      fetch(`/api/watchlist/${symbol}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ list_name: name }),
      }).then(ok),
    onMutate: ({ symbol, name }) =>
      queryClient.setQueryData<WatchlistEntry[]>(['watchlist'], (prev = []) =>
        prev.some((w) => w.symbol === symbol && w.list_name === name)
          ? prev
          : [...prev, { symbol, list_name: name }],
      ),
    onSuccess: (_r, { symbol, name }) => toast.success(`${symbol} added to ${name}`),
    onError: (e: Error) => toast.error(e.message),
    onSettled: refresh,
  })

  const unmap = useMutation({
    mutationFn: ({ symbol, name }: { symbol: string; name: string }) =>
      fetch(`/api/watchlist/${symbol}?list_name=${encodeURIComponent(name)}`, { method: 'DELETE' }).then(ok),
    onMutate: ({ symbol, name }) =>
      queryClient.setQueryData<WatchlistEntry[]>(['watchlist'], (prev = []) =>
        prev.filter((w) => !(w.symbol === symbol && w.list_name === name)),
      ),
    onSuccess: (_r, { symbol, name }) => toast.success(`${symbol} removed from ${name}`),
    onError: (e: Error) => toast.error(e.message),
    onSettled: refresh,
  })

  // POST /api/stocks scrapes the symbol live, so an unknown ticker fails here rather than landing
  // on the canvas as an empty node - the same path the Stocks page's add box uses.
  const add = useMutation({
    mutationFn: () => addStock(newStock.trim().toUpperCase()),
    onSuccess: ({ symbol }) => {
      const existed = stocks.some((s) => s.symbol === symbol)
      // On the canvas now, not after /api/stocks has live-priced it - that refetch can take seconds
      // for a symbol with a cold price cache. It fills the price in when it lands.
      if (!existed) {
        queryClient.setQueryData<TrackedStock[]>(['stocks'], (prev = []) =>
          prev.some((s) => s.symbol === symbol)
            ? prev
            : [
                ...prev,
                {
                  symbol,
                  report_count: 1,
                  last_scraped: new Date().toISOString(),
                  price: null,
                  changePercent: null,
                },
              ],
        )
      }
      toast.success(existed ? `${symbol} is already tracked` : `${symbol} added`)
      setFocus(
        watchlist.find((w) => w.symbol === symbol)
          ? memberId(watchlist.find((w) => w.symbol === symbol)?.list_name ?? '', symbol)
          : stockId(symbol),
      )
      setNewStock('')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const createList = useMutation({
    mutationFn: (name: string) =>
      fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }).then(ok),
    onSuccess: (_r, name) => {
      queryClient.setQueryData<string[]>(['watchlists'], (prev = []) =>
        prev.includes(name) ? prev : [...prev, name],
      )
      toast.success(`${name} created — drag a stock onto it`)
      setFocus(listId(name))
      setNewList('')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Dragging from any stock node - under a list or in the side column - onto a list files it there.
  const onConnect = (c: Connection) => {
    const from = nodes.find((n) => n.id === c.source)
    if (from?.type !== 'stock' || !c.target?.startsWith('l:')) return
    map.mutate({ symbol: (from.data as StockNodeData).symbol, name: c.target.slice(2) })
  }

  // Deleting a stock under a list (or its edge) removes it from that list only. Both arrive together
  // when a node goes - its edge is deleted with it - so memberships are de-duplicated.
  const onDelete = ({ nodes: gone, edges: cut }: { nodes: Node[]; edges: Edge[] }) => {
    const pairs = new Map<string, { symbol: string; name: string }>()
    for (const n of gone) {
      const d = n.data as StockNodeData
      if (n.type === 'stock' && d.list) pairs.set(`${d.list}/${d.symbol}`, { symbol: d.symbol, name: d.list })
    }
    for (const e of cut) {
      const d = e.data as { symbol: string; list: string } | undefined
      if (d) pairs.set(`${d.list}/${d.symbol}`, { symbol: d.symbol, name: d.list })
    }
    for (const pair of pairs.values()) unmap.mutate(pair)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[85vh] max-h-[85vh] w-[90vw] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2">
            <BookmarkIcon className="size-4" />
            Watchlists
            <span className="text-sm font-normal text-muted-foreground">
              — drag a stock onto a list to add it; select a stock under a list and press Delete to remove it
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
              onDelete={onDelete}
              onInit={(instance) => {
                flow.current = instance
              }}
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
                    if (newList.trim()) createList.mutate(newList.trim())
                  }}
                >
                  <Input
                    value={newList}
                    onChange={(e) => setNewList(e.target.value)}
                    placeholder="New watchlist…"
                    className="h-8 w-36 bg-background text-xs"
                  />
                  <Button
                    type="submit"
                    size="icon-sm"
                    variant="outline"
                    className="size-8"
                    disabled={createList.isPending}
                  >
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
