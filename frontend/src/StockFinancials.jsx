import { useQuery } from '@tanstack/react-query'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Spinner } from '@/components/ui/spinner'
import { compact } from '@/lib/format'
import { getStockFinancials } from '@/services/api'

function Cell({ value }) {
  if (value == null) return <span className="text-muted-foreground">—</span>
  const sign = value < 0 ? 'text-down' : ''
  return <span className={sign}>₹{compact(value)}</span>
}

export default function StockFinancials({ symbol }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['stockFinancials', symbol],
    queryFn: () => getStockFinancials(symbol),
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border bg-card py-16 text-muted-foreground">
        <Spinner className="size-4" /> Loading financials…
      </div>
    )
  }

  if (error || !data) {
    return (
      <p className="rounded-xl border bg-card py-16 text-center text-sm text-muted-foreground">
        No quarterly financials available for this stock.
      </p>
    )
  }

  return (
    <Table containerClassName="max-h-[500px] rounded-xl border bg-card">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="sticky top-0 left-0 z-20 bg-card">Breakdown</TableHead>
          {data.periods.map((p) => (
            <TableHead
              key={p}
              className={`sticky top-0 z-10 bg-card text-right whitespace-nowrap ${p === 'TTM' ? 'font-semibold' : ''}`}
            >
              {p}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>

      <TableBody>
        {data.rows.map((row) => (
          <TableRow key={row.label}>
            <TableCell className="sticky left-0 z-[1] bg-card whitespace-nowrap font-medium">{row.label}</TableCell>
            {row.values.map((v, i) => (
              <TableCell key={i} className="text-right tabular-nums whitespace-nowrap">
                <Cell value={v} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
