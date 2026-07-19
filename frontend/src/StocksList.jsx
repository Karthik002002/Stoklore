import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { PlusIcon, TrendingUpIcon, TrendingDownIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { fmt, inr } from '@/lib/format'
import DeleteStockButton from './DeleteStockButton'

function Change({ value }) {
  if (value == null) return <span className="text-muted-foreground">—</span>
  const up = value >= 0
  const Icon = up ? TrendingUpIcon : TrendingDownIcon
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${up ? 'text-up' : 'text-down'}`}>
      <Icon className="size-3.5" />
      {up ? '+' : ''}{fmt(value)}%
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

export default function StocksList() {
  const [stocks, setStocks] = useState(null)
  const navigate = useNavigate()

  const load = () => {
    fetch('/api/stocks').then((r) => r.json()).then(setStocks)
  }

  useEffect(load, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Tracked stocks</h2>
        <AddStock onAdded={load} />
      </div>

      {!stocks && (
        <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
          <Spinner className="size-4" /> Fetching live prices…
        </div>
      )}

      {stocks?.length === 0 && (
        <p className="py-24 text-center text-muted-foreground">
          No stocks tracked yet — add one above, run a scan, or ask the chat about an NSE ticker.
        </p>
      )}

      {stocks?.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Symbol</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-right">Reports</TableHead>
                <TableHead className="text-right">Last updated</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {stocks.map((s) => (
                <TableRow
                  key={s.symbol}
                  className="cursor-pointer"
                  onClick={() => navigate({ to: '/stock/$symbol', params: { symbol: s.symbol } })}
                >
                  <TableCell className="font-semibold">{s.symbol}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(s.price)}</TableCell>
                  <TableCell className="text-right tabular-nums"><Change value={s.changePercent} /></TableCell>
                  <TableCell className="text-right text-muted-foreground">{s.report_count}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {new Date(s.last_scraped).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
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
