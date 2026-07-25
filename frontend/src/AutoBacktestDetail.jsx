import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  DatabaseIcon,
  PlayIcon,
  PlusIcon,
  SaveIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { BacktestResultView, PlotsResultView } from '@/components/BacktestResult'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { usePageTitle } from '@/lib/usePageTitle'
import { runPineScriptOnRows } from '@/lib/runPineScript'
import {
  addStock,
  collectMaxHistory,
  getAutoBacktestScript,
  getMaxHistory,
  getMaxHistoryStatus,
  searchStocks,
  updateAutoBacktestScript,
} from '@/services/api'

// Searchable symbol dropdown (existing tracked stocks) with a fallback "Add <SYMBOL>" option
// that validates the symbol exists (via the same live-scrape POST /api/stocks used elsewhere)
// before it can be selected.
function SymbolSelect({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const queryClient = useQueryClient()

  const { data: matches = [] } = useQuery({
    queryKey: ['stockSearch', query],
    queryFn: () => searchStocks(query),
  })

  const add = useMutation({
    mutationFn: () => addStock(query.trim().toUpperCase()),
    onSuccess: ({ symbol }) => {
      toast.success(`${symbol} added`)
      queryClient.invalidateQueries({ queryKey: ['stockSearch'] })
      onChange(symbol)
      setOpen(false)
      setQuery('')
    },
    onError: (e) => toast.error(e.message),
  })

  const normalizedQuery = query.trim().toUpperCase()
  const exactMatch = matches.some((m) => m.symbol === normalizedQuery)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" className="w-40 justify-between font-normal" />}>
        <span className={cn(!value && 'text-muted-foreground')}>{value || 'Select symbol'}</span>
        <ChevronsUpDownIcon className="size-3.5 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search symbol…"
            className="uppercase placeholder:normal-case"
          />
          <CommandList>
            {matches.length === 0 && !normalizedQuery && <CommandEmpty>No stocks tracked yet.</CommandEmpty>}
            {matches.map((m) => (
              <CommandItem
                key={m.symbol}
                value={m.symbol}
                onSelect={() => {
                  onChange(m.symbol)
                  setOpen(false)
                  setQuery('')
                }}
              >
                {m.symbol === value && <CheckIcon className="size-4" />}
                {m.symbol}
              </CommandItem>
            ))}
            {normalizedQuery && !exactMatch && (
              <CommandItem
                value={`__add__${normalizedQuery}`}
                disabled={add.isPending}
                onSelect={() => add.mutate()}
              >
                {add.isPending ? <Spinner className="size-4" /> : <PlusIcon className="size-4" />}
                Add "{normalizedQuery}"
              </CommandItem>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

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
          <SymbolSelect value={symbol} onChange={setSymbol} />
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
