import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { DataTableColumns } from '@/components/DataTable'
import DataTable from '@/components/DataTable'
import { Spinner } from '@/components/ui/spinner'
import { compact, fmt } from '@/lib/format'
import type { Financials } from '@/services/api'
import { getStockFinancials } from '@/services/api'

type FinancialRow = Financials['rows'][number]

function Cell({ value, prevValue }: { value: number | null; prevValue?: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>
  const sign = value < 0 ? 'text-down' : ''

  let change = null
  if (prevValue != null && prevValue !== 0) {
    const pct = ((value - prevValue) / Math.abs(prevValue)) * 100
    const up = pct >= 0
    change = (
      <span className={`ml-1.5 inline-flex items-center gap-0.5 text-[10px] ${up ? 'text-up' : 'text-down'}`}>
        {up ? '+' : ''}
        {fmt(pct)}%
      </span>
    )
  }

  return (
    <>
      <span className={sign}>₹{compact(value)}</span>
      {change}
    </>
  )
}

export default function StockFinancials({ symbol }: { symbol: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['stockFinancials', symbol],
    queryFn: () => getStockFinancials(symbol),
    retry: false,
  })

  // One column per period, plus the sticky label column. The quarter-on-quarter comparison is the
  // column's own business: it needs the index, which is what pivoted data (rows of values, columns
  // of periods) doesn't carry on the row.
  const columns = useMemo<DataTableColumns<FinancialRow>>(() => {
    if (!data) return []
    return [
      {
        id: 'label',
        header: 'Breakdown',
        size: 200,
        cell: ({ row }) => row.original.label,
        meta: { className: 'sticky left-0 z-[1] bg-card font-medium', headClassName: 'left-0 z-20' },
      },
      ...data.periods.map((period, i): DataTableColumns<FinancialRow>[number] => ({
        id: `${period}-${i}`,
        header: period,
        size: 108,
        cell: ({ row }) => (
          <Cell
            value={row.original.values[i]}
            // TTM is a trailing twelve months total sitting next to a quarter - comparing the two
            // would report a 300% jump every time.
            prevValue={i > 0 && period !== 'TTM' ? row.original.values[i - 1] : null}
          />
        ),
        meta: {
          className: 'text-right',
          headClassName: `text-right ${period === 'TTM' ? 'font-semibold' : ''}`,
        },
      })),
    ]
  }, [data])

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
    <DataTable
      columns={columns}
      data={data.rows}
      getRowId={(row) => row.label}
      resizable
      containerClassName="max-h-[500px] rounded-xl border bg-card"
    />
  )
}
