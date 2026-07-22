import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  PlusIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  BookmarkIcon,
  CheckIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  RadarIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fmt, inr } from '@/lib/format'
import DeleteStockButton from './DeleteStockButton'
import IndexCard from './IndexCard'

function Change({ value }) {
  if (value == null) return <span className="text-muted-foreground">—</span>
  const up = value >= 0
  const Icon = up ? TrendingUpIcon : TrendingDownIcon
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${up ? 'text-up' : 'text-down'}`}>
      <Icon className="size-3.5" />
      {up ? '+' : ''}
      {fmt(value)}%
    </span>
  )
}

function AddStock({ onAdded }) {
  const [symbol, setSymbol] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!symbol.trim() || loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/stocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: symbol.trim() }),
      })
      if (!res.ok) {
        const { detail } = await res.json().catch(() => ({}))
        throw new Error(detail || 'Failed to add stock')
      }
      const { symbol: added } = await res.json()
      toast.success(`${added} added`)
      setSymbol('')
      onAdded()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input
        value={symbol}
        onChange={(e) => setSymbol(e.target.value)}
        placeholder="Add NSE symbol, e.g. INFY"
        className="w-56 uppercase placeholder:normal-case"
        disabled={loading}
      />
      <Button type="submit" size="icon" disabled={loading} aria-label="Add stock">
        {loading ? <Spinner className="size-4" /> : <PlusIcon className="size-4" />}
      </Button>
    </form>
  )
}

function WatchlistButton({ symbol, lists, current, onChange }) {
  const save = async (listName) => {
    await fetch(`/api/watchlist/${symbol}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list_name: listName }),
    })
    toast.success(`${symbol} saved to ${listName}`)
    onChange()
  }

  const remove = async () => {
    await fetch(`/api/watchlist/${symbol}`, { method: 'DELETE' })
    toast.success(`${symbol} removed from watchlist`)
    onChange()
  }

  const createNew = () => {
    const name = window.prompt('New watchlist name (e.g. Banking, IT, Long term)')
    if (name?.trim()) save(name.trim())
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Save ${symbol} to watchlist`}
            className={current ? 'text-primary' : 'text-muted-foreground'}
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <BookmarkIcon className="size-4" fill={current ? 'currentColor' : 'none'} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
        {lists.map((name) => (
          <DropdownMenuItem key={name} onClick={() => save(name)}>
            {name}
            {current === name && <CheckIcon className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
        {lists.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={createNew}>
          <PlusIcon className="size-4" /> New watchlist…
        </DropdownMenuItem>
        {current && (
          <DropdownMenuItem variant="destructive" onClick={remove}>
            Remove from {current}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CreateWatchlistDialog({ onCreated }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim() || loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) {
        const { detail } = await res.json().catch(() => ({}))
        throw new Error(detail || 'Failed to create watchlist')
      }
      toast.success(`${name.trim()} created`)
      onCreated(name.trim())
      setName('')
      setOpen(false)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="New watchlist" />}>
        <PlusIcon className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New watchlist</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex gap-2">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Banking, IT, Long term"
          />
          <Button type="submit" disabled={loading}>
            {loading ? <Spinner className="size-4" /> : 'Create'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function WatchlistTabMenu({ name, stockCount, onRenamed, onDeleted }) {
  const [editOpen, setEditOpen] = useState(false)
  const [newName, setNewName] = useState(name)
  const [loading, setLoading] = useState(false)

  const openEdit = () => {
    setNewName(name)
    setEditOpen(true)
  }

  const rename = async (e) => {
    e.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed || trimmed === name || loading) return
    setLoading(true)
    try {
      const res = await fetch(`/api/watchlists/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_name: trimmed }),
      })
      if (!res.ok) {
        const { detail } = await res.json().catch(() => ({}))
        throw new Error(detail || 'Failed to rename watchlist')
      }
      toast.success(`Renamed to ${trimmed}`)
      onRenamed(trimmed)
      setEditOpen(false)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const remove = async () => {
    if (stockCount > 0 || loading) return
    setLoading(true)
    try {
      const res = await fetch(`/api/watchlists/${encodeURIComponent(name)}`, { method: 'DELETE' })
      if (!res.ok) {
        const { detail } = await res.json().catch(() => ({}))
        throw new Error(detail || 'Failed to delete watchlist')
      }
      toast.success(`${name} deleted`)
      onDeleted()
      setEditOpen(false)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`${name} options`} />}
        >
          <EllipsisVerticalIcon className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={openEdit}>
            <PencilIcon className="size-4" /> Edit
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit watchlist</DialogTitle>
          </DialogHeader>
          <form onSubmit={rename} className="flex gap-2">
            <Input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Button type="submit" disabled={loading || !newName.trim() || newName.trim() === name}>
              Save
            </Button>
          </form>
          <DialogFooter>
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <Button variant="destructive" disabled={stockCount > 0 || loading} onClick={remove}>
                  Delete
                </Button>
              </TooltipTrigger>
              {stockCount > 0 && (
                <TooltipContent>
                  Move or remove its {stockCount} stock{stockCount === 1 ? '' : 's'} to delete this watchlist
                </TooltipContent>
              )}
            </Tooltip>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default function StocksList() {
  const [stocks, setStocks] = useState(null)
  const [watchlist, setWatchlist] = useState([])
  const [listNames, setListNames] = useState([])
  const [tab, setTab] = useState('All')
  const [dragName, setDragName] = useState(null)
  const navigate = useNavigate()

  const load = () => {
    fetch('/api/stocks')
      .then((r) => r.json())
      .then(setStocks)
    fetch('/api/watchlist')
      .then((r) => r.json())
      .then(setWatchlist)
    fetch('/api/watchlists')
      .then((r) => r.json())
      .then(setListNames)
  }

  useEffect(load, [])

  const listOf = Object.fromEntries(watchlist.map((w) => [w.symbol, w.list_name]))
  const lists = listNames
  const stockCountOf = (name) => watchlist.filter((w) => w.list_name === name).length
  const visible = tab === 'All' ? stocks : stocks?.filter((s) => listOf[s.symbol] === tab)

  const dropOn = (targetName) => {
    if (!dragName || dragName === targetName) return
    const next = [...lists]
    next.splice(next.indexOf(dragName), 1)
    next.splice(next.indexOf(targetName), 0, dragName)
    setListNames(next)
    fetch('/api/watchlists/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: next }),
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Tracked stocks</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" render={<Link to="/events" />}>
            <RadarIcon className="size-4" /> Events
          </Button>
          <AddStock onAdded={load} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <IndexCard name="NIFTY" />
        <IndexCard name="SENSEX" />
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {lists.length > 0 && (
          <Button variant={tab === 'All' ? 'secondary' : 'ghost'} size="sm" onClick={() => setTab('All')}>
            All
          </Button>
        )}
        {lists.map((name) => (
          <div
            key={name}
            draggable
            onDragStart={() => setDragName(name)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              dropOn(name)
            }}
            onDragEnd={() => setDragName(null)}
            className={`flex cursor-grab items-center rounded-lg transition-opacity active:cursor-grabbing ${
              dragName === name ? 'opacity-40' : ''
            }`}
          >
            <Button variant={tab === name ? 'secondary' : 'ghost'} size="sm" onClick={() => setTab(name)}>
              {name}
            </Button>
            <WatchlistTabMenu
              name={name}
              stockCount={stockCountOf(name)}
              onRenamed={(newName) => {
                load()
                setTab(newName)
              }}
              onDeleted={() => {
                load()
                setTab('All')
              }}
            />
          </div>
        ))}
        <CreateWatchlistDialog
          onCreated={(name) => {
            load()
            setTab(name)
          }}
        />
      </div>

      {!stocks && (
        <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
          <Spinner className="size-4" /> Fetching live prices…
        </div>
      )}

      {visible?.length === 0 && (
        <p className="py-24 text-center text-muted-foreground">
          {tab === 'All'
            ? 'No stocks tracked yet — add one above, run a scan, or ask the chat about an NSE ticker.'
            : `Nothing in ${tab} yet — save a stock to it with the bookmark button.`}
        </p>
      )}

      {visible?.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Symbol</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-right">Reports</TableHead>
                <TableHead className="text-right">Last updated</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((s) => (
                <TableRow
                  key={s.symbol}
                  className="cursor-pointer"
                  onClick={() => navigate({ to: '/stock/$symbol', params: { symbol: s.symbol } })}
                >
                  <TableCell className="font-semibold">{s.symbol}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(s.price)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Change value={s.changePercent} />
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{s.report_count}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {new Date(s.last_scraped).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <WatchlistButton
                      symbol={s.symbol}
                      lists={lists}
                      current={listOf[s.symbol]}
                      onChange={load}
                    />
                    <DeleteStockButton
                      symbol={s.symbol}
                      onDeleted={load}
                      stopPropagation
                      className="text-muted-foreground"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
