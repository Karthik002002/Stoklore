import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { ArrowLeftIcon, DatabaseIcon, PlayIcon, SaveIcon } from 'lucide-react'
import { toast } from 'sonner'
import { BacktestResultView, PlotsResultView } from '@/components/BacktestResult'
import SymbolCombobox from '@/components/SymbolCombobox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { usePageTitle } from '@/lib/usePageTitle'
import { runPineScriptOnRows } from '@/lib/runPineScript'
import {
  collectMaxHistory,
  getAutoBacktestScript,
  getMaxHistory,
  getMaxHistoryStatus,
  updateAutoBacktestScript,
} from '@/services/api'

export default function AutoBacktestDetail() {
  const { scriptId } = useParams({ from: '/backtest/auto/$scriptId' })
  const queryClient = useQueryClient()
  const { data: saved } = useQuery({
    queryKey: ['autoBacktestScript', scriptId],
    queryFn: () => getAutoBacktestScript(scriptId),
  })

  const [name, setName] = useState('')
  const [script, setScript] = useState('')
  const [symbol, setSymbol] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (saved) {
      setName(saved.name)
      setScript(saved.script)
    }
  }, [saved])

  usePageTitle(saved ? saved.name : 'Auto backtest')

  const save = useMutation({
    mutationFn: () => updateAutoBacktestScript(scriptId, { name: name.trim(), script }),
    onSuccess: () => {
      toast.success('Script saved')
      queryClient.invalidateQueries({ queryKey: ['autoBacktestScript', scriptId] })
      queryClient.invalidateQueries({ queryKey: ['autoBacktestScripts'] })
    },
    onError: (e) => toast.error(e.message),
  })

  // Backtests need the full collected history (price_history_max), not the default 1y window -
  // same "collect once, then run" gate as StockDetail's MaxHistorySection.
  const wasRunning = useRef(false)
  const { data: maxHistory } = useQuery({
    queryKey: ['maxHistory', symbol],
    queryFn: () => getMaxHistory(symbol),
    enabled: !!symbol,
  })
  const { data: maxStatus } = useQuery({
    queryKey: ['maxHistoryStatus', symbol],
    queryFn: () => getMaxHistoryStatus(symbol),
    enabled: !!symbol,
    refetchInterval: (query) => (query.state.data?.running ? 1500 : false),
  })

  useEffect(() => {
    if (wasRunning.current && !maxStatus?.running) {
      queryClient.invalidateQueries({ queryKey: ['maxHistory', symbol] })
    }
    wasRunning.current = !!maxStatus?.running
  }, [maxStatus?.running, symbol, queryClient])

  const collect = useMutation({
    mutationFn: () => collectMaxHistory(symbol),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['maxHistoryStatus', symbol] }),
    onError: (e) => toast.error(e.message),
  })

  const hasMaxData = (maxHistory?.length ?? 0) > 0

  const execute = useMutation({
    mutationFn: () => runPineScriptOnRows(script, maxHistory ?? []),
    onSuccess: (r) => {
      setResult(r)
      setError(null)
    },
    onError: (e) => {
      setResult(null)
      setError(e.message)
    },
  })

  if (!saved) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
        <Spinner className="size-4" /> Loading…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          to="/backtesting"
          search={{ tab: 'auto' }}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" /> Back to backtesting
        </Link>
      </div>

      <div className="space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Script name" />
        <Textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={20}
          className="font-mono text-xs"
          spellCheck={false}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!name.trim() || !script.trim() || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? <Spinner className="size-4" /> : <SaveIcon className="size-4" />}
          Save
        </Button>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Run</h2>
        <div className="flex items-center gap-2">
          <SymbolCombobox value={symbol} onChange={setSymbol} />
          <Button
            size="sm"
            variant="outline"
            disabled={!symbol || maxStatus?.running || hasMaxData}
            onClick={() => collect.mutate()}
          >
            {maxStatus?.running ? <Spinner className="size-4" /> : <DatabaseIcon className="size-4" />}
            Collect max data
          </Button>
          <Button
            size="sm"
            disabled={!symbol || !hasMaxData || !script.trim() || execute.isPending}
            onClick={() => execute.mutate()}
          >
            {execute.isPending ? <Spinner className="size-4" /> : <PlayIcon className="size-4" />}
            Execute
          </Button>
        </div>
        {symbol && !hasMaxData && (
          <p className="text-sm text-muted-foreground">
            {maxStatus?.running
              ? 'Collecting full history from NSE listing… this can take a moment.'
              : 'Collect max data for this symbol to run the script.'}
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {result &&
          (result.trades ? <BacktestResultView result={result} /> : <PlotsResultView plots={result.plots} />)}
      </div>
    </div>
  )
}
