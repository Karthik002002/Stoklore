import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { StockBadges } from '@/components/StockMeta'
import { cn } from '@/lib/utils'
import { searchStocksMaster } from '@/services/api'

// Searchable single-select symbol dropdown backed by the full NSE listed-equity master
// (stocks_master table via /api/stocks-master) - covers every listed symbol on both the main board
// and SME/EMERGE, regardless of whether it has been scraped yet, so no "Add <SYMBOL>" fallback is
// needed (any valid NSE ticker is already searchable). Shared by Auto backtesting's run view and
// the manual trade journal.
export default function SymbolCombobox({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (symbol: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const { data } = useQuery({
    queryKey: ['stockSearch', query],
    queryFn: () => searchStocksMaster(query),
  })
  const matches = data?.stocks ?? []

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" className={cn('w-40 justify-between font-normal', className)} />}
      >
        <span className={cn(!value && 'text-muted-foreground')}>{value || 'Select symbol'}</span>
        <ChevronsUpDownIcon className="size-3.5 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search symbol…"
            className="uppercase placeholder:normal-case"
          />
          <CommandList>
            {matches.length === 0 && <CommandEmpty>No matches.</CommandEmpty>}
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
                {m.symbol === value && <CheckIcon className="size-4 shrink-0" />}
                <span className="font-medium">{m.symbol}</span>
                <span className="truncate text-xs text-muted-foreground">{m.name}</span>
                <StockBadges stock={m} showLot className="ml-auto" />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
