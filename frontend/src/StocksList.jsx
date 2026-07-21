import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { PlusIcon, TrendingUpIcon, TrendingDownIcon, BookmarkIcon, CheckIcon, RadarIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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

export default function StocksList() {
  const [stocks, setStocks] = useState(null)
  const [watchlist, setWatchlist] = useState([])
  const [tab, setTab] = useState('All')
  const navigate = useNavigate()

  const load = () => {
    fetch('/api/stocks')
      .then((r) => r.json())
      .then(setStocks)
    fetch('/api/watchlist')
      .then((r) => r.json())
      .then(setWatchlist)
  }

  useEffect(load, [])

  const listOf = Object.fromEntries(watchlist.map((w) => [w.symbol, w.list_name]))
  const lists = [...new Set(watchlist.map((w) => w.list_name))].sort()
  const tabs = ['All', ...lists]
  const visible = tab === 'All' ? stocks : stocks?.filter((s) => listOf[s.symbol] === tab)

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

      {lists.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tabs.map((name) => (
            <Button
              key={name}
              variant={tab === name ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setTab(name)}
            >
              {name}
            </Button>
          ))}
        </div>
      )}

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
