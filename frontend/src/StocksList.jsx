import { useEffect, useState } from 'react'
import { TrendingUpIcon, TrendingDownIcon } from 'lucide-react'
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

export default function StocksList({ onSelect }) {
  const [stocks, setStocks] = useState(null)

  useEffect(() => {
    fetch('/api/stocks').then((r) => r.json()).then(setStocks)
  }, [])

  if (!stocks) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Spinner className="size-4" /> Fetching live prices…
      </div>
    )
  }

  if (stocks.length === 0) {
    return (
      <p className="py-24 text-center text-muted-foreground">
        No stocks tracked yet — run a scan or ask the chat about an NSE ticker.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Symbol</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Change</TableHead>
            <TableHead className="text-right">Reports</TableHead>
            <TableHead className="text-right">Last updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stocks.map((s) => (
            <TableRow key={s.symbol} className="cursor-pointer" onClick={() => onSelect(s.symbol)}>
              <TableCell className="font-semibold">{s.symbol}</TableCell>
              <TableCell className="text-right tabular-nums">{inr(s.price)}</TableCell>
              <TableCell className="text-right tabular-nums"><Change value={s.changePercent} /></TableCell>
              <TableCell className="text-right text-muted-foreground">{s.report_count}</TableCell>
              <TableCell className="text-right text-muted-foreground">
                {new Date(s.last_scraped).toLocaleDateString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
