import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Toggle, ToggleGroup } from '@/design-system'
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

export default function StockChart({ symbol, title }: { symbol: string; title?: React.ReactNode }) {
  const [range, setRange] = useState('1mo')

  const { data, isLoading } = useQuery({
    queryKey: ['stockChart', symbol, range],
    queryFn: () => getStockChart(symbol, range),
  })

  return (
    <PriceChart
      data={data}
      isLoading={isLoading}
      title={title}
      leftControls={
        <ToggleGroup
          size="sm"
          value={[range]}
          onValueChange={(v) => v[0] && setRange(v[0] as string)}
          aria-label="Range"
        >
          {RANGES.map(([key, label]) => (
            <Toggle key={key} value={key}>
              {label}
            </Toggle>
          ))}
        </ToggleGroup>
      }
    />
  )
}
