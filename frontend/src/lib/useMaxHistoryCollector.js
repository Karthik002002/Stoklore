import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { collectMaxHistory, getMaxHistory, getMaxHistoryStatus, getPriceSources } from '@/services/api'

// Shared "collect max history" wiring - StockDetail, AutoBacktestDetail, and Bar Replay all
// gate a feature on price_history_max existing for a symbol, and all three used to duplicate
// the exact same query/mutation/effect logic with only their button markup differing. Backend
// source failures are surfaced via `status.error` (see price_sources/) rather than silently
// logged, so a banned/broken endpoint is visible in the UI instead of just not working.
export function useMaxHistoryCollector(symbol) {
  const queryClient = useQueryClient()
  const wasRunning = useRef(false)

  const { data: sourcesData } = useQuery({ queryKey: ['priceSources'], queryFn: getPriceSources })
  const sources = sourcesData?.sources ?? []
  const [source, setSource] = useState('')
  useEffect(() => {
    if (!source && sourcesData?.default) setSource(sourcesData.default)
  }, [source, sourcesData])

  const { data: maxHistory } = useQuery({
    queryKey: ['maxHistory', symbol],
    queryFn: () => getMaxHistory(symbol),
    enabled: !!symbol,
  })
  const { data: status } = useQuery({
    queryKey: ['maxHistoryStatus', symbol],
    queryFn: () => getMaxHistoryStatus(symbol),
    enabled: !!symbol,
    refetchInterval: (query) => (query.state.data?.running ? 1500 : false),
  })

  useEffect(() => {
    if (wasRunning.current && !status?.running) {
      queryClient.invalidateQueries({ queryKey: ['maxHistory', symbol] })
      if (status?.error) toast.error(`Collect max data failed: ${status.error}`)
    }
    wasRunning.current = !!status?.running
  }, [status?.running, status?.error, symbol, queryClient])

  const collect = useMutation({
    mutationFn: () => collectMaxHistory(symbol, source || sourcesData?.default),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['maxHistoryStatus', symbol] }),
    onError: (e) => toast.error(e.message),
  })

  return {
    maxHistory,
    hasMaxData: (maxHistory?.length ?? 0) > 0,
    status,
    sources,
    source,
    setSource,
    collect,
  }
}
