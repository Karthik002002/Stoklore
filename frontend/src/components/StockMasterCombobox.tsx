import { useState } from 'react'
import type * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { StockBadges } from '@/components/StockMeta'
import { cn } from '@/lib/utils'
import { searchStocksMaster } from '@/services/api'

// Multi-select searchable dropdown backed by the full NSE listed-equity master (stocks_master
// table, main board + SME) - unlike SymbolCombobox (previously-scraped symbols, single value, closes on pick), this
// stays open across picks so several symbols can be added in one search session, showing a check
// against each already-selected one; it closes only via the trigger or an outside click.
//
// Also accepts a comma/newline-separated paste into the search box (e.g. a ticker list copied
// straight out of a spreadsheet column) - added in bulk instead of being treated as one giant
// search string. Pasted symbols aren't validated against stocks_master here - an unknown/misspelt
// one just shows up as a per-symbol error in the bulk collector's results afterward, same as any
// other failure there.
export default function StockMasterCombobox({
  selected,
  onSelect,
  className,
}: {
  /** Symbols already picked - used to skip duplicates on a bulk paste. */
  selected: string[]
  onSelect: (symbol: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const { data } = useQuery({
    queryKey: ['stocksMaster', query],
    queryFn: () => searchStocksMaster(query),
  })
  const matches = data?.stocks ?? []

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!text.includes(',') && !text.includes('\n')) return // a single symbol - paste normally
    e.preventDefault()
    const symbols = [
      ...new Set(
        text
          .split(/[,\n]+/)
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      ),
    ]
    const added = symbols.filter((s) => !selected.includes(s))
    added.forEach(onSelect)
    setQuery('')
    if (added.length) toast.success(`Added ${added.length} symbol${added.length === 1 ? '' : 's'}`)
  }

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
            onPaste={handlePaste}
            placeholder="Search, or paste a comma-separated list…"
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
                <StockBadges stock={m} className="ml-auto" />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
