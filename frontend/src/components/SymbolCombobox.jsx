import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { addStock, searchStocks } from '@/services/api'

// Searchable symbol dropdown (existing tracked stocks) with a fallback "Add <SYMBOL>" option
// that validates the symbol exists (via the same live-scrape POST /api/stocks used elsewhere)
// before it can be selected. Shared by Auto backtesting's run view and the manual trade journal.
export default function SymbolCombobox({ value, onChange, className }) {
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
      <PopoverTrigger
        render={<Button variant="outline" className={cn('w-40 justify-between font-normal', className)} />}
      >
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
