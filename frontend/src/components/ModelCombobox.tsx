// A model picker you can type into - the list behind it runs to dozens of LiteLLM/Omniroute entries,
// too many to scroll. Grouped by provider (the part before "/"), the current one ticked.
import { useMemo, useState } from 'react'
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { ModelOption } from '@/services/api'

const providerOf = (m: ModelOption) => (m.id.includes('/') ? m.id.split('/')[0] : 'Local')

export default function ModelCombobox({
  models,
  value,
  onChange,
  className,
}: {
  models: ModelOption[]
  value: string | null
  onChange: (id: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const groups = useMemo(() => {
    const by = new Map<string, ModelOption[]>()
    for (const m of models) by.set(providerOf(m), [...(by.get(providerOf(m)) ?? []), m])
    // local models first: they're free and always there
    return [...by.entries()].sort(([a], [b]) => (a === 'Local' ? -1 : b === 'Local' ? 1 : a.localeCompare(b)))
  }, [models])
  const current = models.find((m) => m.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            role="combobox"
            aria-expanded={open}
            className={cn('max-w-72 justify-between gap-1 font-normal', className)}
          />
        }
      >
        <span className={cn('truncate', !current && 'text-muted-foreground')}>{current?.label ?? 'Model…'}</span>
        <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <Command>
          <CommandInput placeholder="Search models…" />
          <CommandList className="max-h-80">
            <CommandEmpty>No model matches.</CommandEmpty>
            {groups.map(([provider, list]) => (
              <CommandGroup key={provider} heading={provider}>
                {list.map((m) => (
                  // id and label both searchable: "mini" finds gpt-4.1-mini whichever one shows it
                  <CommandItem
                    key={m.id}
                    value={`${m.label} ${m.id}`}
                    onSelect={() => {
                      onChange(m.id)
                      setOpen(false)
                    }}
                  >
                    <CheckIcon className={cn('size-3.5 shrink-0', m.id !== value && 'opacity-0')} />
                    <span className="truncate" title={m.id}>
                      {m.label}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
