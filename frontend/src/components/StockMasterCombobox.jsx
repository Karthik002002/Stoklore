import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { searchStocksMaster } from '@/services/api'

// Multi-select searchable dropdown backed by the full NSE listed-equity master (stocks_master
// table) - unlike SymbolCombobox (previously-scraped symbols, single value, closes on pick), this
// stays open across picks so several symbols can be added in one search session, showing a check
// against each already-selected one; it closes only via the trigger or an outside click.
export default function StockMasterCombobox({ selected, onSelect, className }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const { data } = useQuery({
    queryKey: ['stocksMaster', query],
    queryFn: () => searchStocksMaster(query),
  })
  const matches = data?.stocks ?? []

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" className={cn('w-40 justify-between font-normal', className)} />}
      >
        <span className={cn(selected.length === 0 && 'text-muted-foreground')}>
          {selected.length > 0 ? `${selected.length} selected` : 'Select symbols'}
        </span>
        <ChevronsUpDownIcon className="size-3.5 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search symbol or company…"
            className="uppercase placeholder:normal-case"
          />
          <CommandList>
            {matches.length === 0 && <CommandEmpty>No matches.</CommandEmpty>}
            {matches.map((m) => (
              <CommandItem key={m.symbol} value={m.symbol} onSelect={() => onSelect(m.symbol)}>
                <CheckIcon className={cn('size-4', !selected.includes(m.symbol) && 'invisible')} />
                <span className="truncate">
                  {m.symbol} <span className="text-muted-foreground">— {m.name}</span>
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
