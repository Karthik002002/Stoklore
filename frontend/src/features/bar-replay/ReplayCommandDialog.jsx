import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { REPLAY_TIMEFRAMES } from '@/lib/replay'
import { searchStocksMaster } from '@/services/api'

// Centred quick-switchers for the two things you change most often mid-session, on the same
// Command primitive the global Cmd+K palette uses (CommandPalette.jsx) - so they look and key-
// navigate identically. Opened by hotkey from BarReplay: "/" for symbol, "t" for timeframe.
//
// One component with a `mode` rather than two files: both are "type, arrow, Enter" over a list,
// and only the row source and the commit differ. `mode === null` is closed.

function SymbolBody({ onSelect }) {
  const [query, setQuery] = useState('')
  // Same source as SymbolCombobox: the full NSE listed-equity master, so any valid ticker is
  // reachable whether or not it has ever been scraped.
  const { data } = useQuery({
    queryKey: ['stockSearch', query],
    queryFn: () => searchStocksMaster(query),
  })
  const matches = data?.stocks ?? []

  return (
    <>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search symbol…"
        className="uppercase placeholder:normal-case"
      />
      <CommandList>
        {matches.length === 0 && <CommandEmpty>No matches.</CommandEmpty>}
        {matches.map((m) => (
          <CommandItem key={m.symbol} value={m.symbol} onSelect={() => onSelect(m.symbol)}>
            <span className="font-medium">{m.symbol}</span>
            <span className="truncate text-xs text-muted-foreground">{m.name}</span>
          </CommandItem>
        ))}
      </CommandList>
    </>
  )
}

function TimeframeBody({ current, onSelect }) {
  return (
    <>
      <CommandInput placeholder="Switch timeframe…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        {REPLAY_TIMEFRAMES.filter((t) => t.available).map((t) => (
          <CommandItem key={t.value} value={t.label} onSelect={() => onSelect(t.value)}>
            <span className="font-medium">{t.label}</span>
            {t.value === current && <span className="ml-auto text-xs text-muted-foreground">current</span>}
          </CommandItem>
        ))}
      </CommandList>
    </>
  )
}

export default function ReplayCommandDialog({ mode, onOpenChange, timeframe, onSymbol, onTimeframe }) {
  const pick = (commit) => (value) => {
    commit(value)
    onOpenChange(false)
  }

  return (
    <CommandDialog
      open={mode != null}
      onOpenChange={onOpenChange}
      title={mode === 'timeframe' ? 'Switch timeframe' : 'Search symbol'}
      description={mode === 'timeframe' ? 'Pick a replay timeframe' : 'Search the NSE listed-equity master'}
    >
      {/* CommandDialog is only the centred shell - the Command root is the caller's, same as in
          CommandPalette.jsx. shouldFilter is off for symbols because the server already ranked
          them and re-filtering client-side would drop rows that matched on company name rather
          than ticker; timeframes are a fixed local list, so there cmdk does the filtering. */}
      <Command shouldFilter={mode === 'timeframe'}>
        {mode === 'symbol' && <SymbolBody onSelect={pick(onSymbol)} />}
        {mode === 'timeframe' && <TimeframeBody current={timeframe} onSelect={pick(onTimeframe)} />}
      </Command>
    </CommandDialog>
  )
}
