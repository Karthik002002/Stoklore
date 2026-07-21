import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { getStockChart } from '@/services/api'
import PriceChart from './PriceChart'

const RANGES = [
  ['1d', '1D'],
  ['5d', '5D'],
  ['1mo', '1M'],
  ['6mo', '6M'],
  ['ytd', 'YTD'],
  ['1y', '1Y'],
  ['5y', '5Y'],
  ['max', 'All'],
]

export default function StockChart({ symbol }) {
  const [range, setRange] = useState('1mo')

  const { data, isLoading } = useQuery({
    queryKey: ['stockChart', symbol, range],
    queryFn: () => getStockChart(symbol, range),
  })

  return (
    <PriceChart
      data={data}
      isLoading={isLoading}
      leftControls={RANGES.map(([key, label]) => (
        <Button
          key={key}
          variant={range === key ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => setRange(key)}
        >
          {label}
        </Button>
      ))}
    />
  )
}
