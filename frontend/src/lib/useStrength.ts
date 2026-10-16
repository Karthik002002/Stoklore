import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getStrengthStatus, getStrengthStocks } from '@/services/api'
import type { StrengthStock } from '@/services/api'

/** The market-wide strength table (RS, trend template, VCP), once the bhavcopy history is in. Its
 *  status is polled while the first-run backfill is still filling. */
export function useStrength() {
  const status = useQuery({
    queryKey: ['strengthStatus'],
    queryFn: getStrengthStatus,
    refetchInterval: (q) => (q.state.data?.sync.running || !q.state.data?.ready ? 5_000 : 300_000),
  })
  // While the first backfill runs, the table is re-rated every 10 days collected - fresh enough to
  // watch it fill in, without re-rating the market on every file.
  const days = status.data?.days ?? 0
  const usable = !!status.data?.partial_ready
  const table = useQuery({
    queryKey: ['strengthStocks', status.data?.ready ? status.data.last : Math.floor(days / 10)],
    queryFn: getStrengthStocks,
    enabled: usable,
    placeholderData: (prev) => prev,
    staleTime: 3_600_000,
  })
  const bySymbol = useMemo(
    () => new Map<string, StrengthStock>((table.data?.stocks ?? []).map((s) => [s.symbol, s])),
    [table.data],
  )
  return { status: status.data, table, bySymbol }
}
