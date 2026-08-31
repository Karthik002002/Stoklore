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
import { StockBadges, StockSubline } from '@/components/StockMeta'
import { REPLAY_TIMEFRAMES } from '@/lib/replay'
import { searchStocksMaster } from '@/services/api'

// Centred quick-switchers for the two things you change most often mid-session, on the same
// Command primitive the global Cmd+K palette uses (CommandPalette.jsx) - so they look and key-
// navigate identically. Opened by hotkey from BarReplay: "/" for symbol, "t" for timeframe.
//
// One component with a `mode` rather than two files: both are "type, arrow, Enter" over a list,
// and only the row source and the commit differ. `mode === null` is closed.

// Main board / SME / both. A replay session is usually one or the other - SME names behave nothing
// like main-board ones - so the filter is worth a click here rather than typing around it.
const BOARDS: { value: string | undefined; label: string }[] = [
  { value: undefined, label: 'All' },
  { value: 'MAIN', label: 'Main board' },
  { value: 'SME', label: 'SME' },
]

function SymbolBody({ onSelect }: { onSelect: (symbol: string) => void }) {
  const [query, setQuery] = useState('')
  const [board, setBoard] = useState<string | undefined>(undefined)
  // Same source as SymbolCombobox: the full NSE listed-equity master (both boards), so any valid
  // ticker is reachable whether or not it has ever been scraped.
  const { data } = useQuery({
    queryKey: ['stockSearch', query, board],
    queryFn: () => searchStocksMaster(query, board),
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
      <div className="flex items-center gap-1 border-b px-2 pb-2 text-[11px]">
        {BOARDS.map((b) => (
          <button
            key={b.label}
            type="button"
            onClick={() => setBoard(b.value)}
            className={`rounded px-1.5 py-0.5 ${
              board === b.value ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60'
            }`}
          >
            {b.label}
          </button>
        ))}
        <span className="ml-auto text-muted-foreground">
          {data
            ? `${(data.total ?? 0).toLocaleString()} listed · ${(data.sme ?? 0).toLocaleString()} SME`
            : ''}
        </span>
      </div>
      <CommandList>
        {matches.length === 0 && <CommandEmpty>No matches.</CommandEmpty>}
        {matches.map((m) => (
          <CommandItem key={m.symbol} value={m.symbol} onSelect={() => onSelect(m.symbol)}>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-1.5">
                <span className="font-medium">{m.symbol}</span>
                <span className="truncate text-xs text-muted-foreground">{m.name}</span>
              </span>
              <StockSubline stock={m} />
            </div>
            <StockBadges stock={m} showExchange className="ml-auto" />
          </CommandItem>
        ))}
      </CommandList>
    </>
  )
}

function TimeframeBody({ current, onSelect }: { current: string; onSelect: (timeframe: string) => void }) {
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

export default function ReplayCommandDialog({
  mode,
  onOpenChange,
  timeframe,
  onSymbol,
  onTimeframe,
}: {
  /** Which picker is open, or null for closed. */
  mode: 'symbol' | 'timeframe' | null
  onOpenChange: (open: boolean) => void
  timeframe: string
  onSymbol: (symbol: string) => void
  onTimeframe: (timeframe: string) => void
}) {
  const pick = (commit: (value: string) => void) => (value: string) => {
    commit(value)
    onOpenChange(false)
  }

  return (
    <CommandDialog
      open={mode != null}
      onOpenChange={onOpenChange}
      title={mode === 'timeframe' ? 'Switch timeframe' : 'Search symbol'}
      description={
        mode === 'timeframe' ? 'Pick a replay timeframe' : 'Search the NSE listed-equity master (main + SME)'
      }
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
