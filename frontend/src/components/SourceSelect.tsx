import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Labels for known price_sources plugins (backend) - falls back to the raw key for any source
// added later without a frontend change (see price_sources/__init__.py's SOURCES registry).
const SOURCE_LABELS: Record<string, string> = { yfinance: 'Yahoo Finance', moneycontrol: 'Moneycontrol' }

// Picks which price_sources plugin "Collect max data" uses. Renders nothing when there's only
// one source (or none loaded yet) - no point showing a selector with a single, forced choice.
export default function SourceSelect({
  sources,
  value,
  onChange,
  className,
}: {
  sources: string[]
  value: string
  onChange: (source: string) => void
  className?: string
}) {
  if (sources.length <= 1) return null
  return (
    // Base UI's Select hands back `unknown` (a value can be any type); every source here is a
    // string, so the cast is at the one place that knows that.
    <Select value={value} onValueChange={(v) => onChange(v as string)}>
      <SelectTrigger size="sm" className={className}>
        <SelectValue>{(v: string) => SOURCE_LABELS[v] ?? v}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {sources.map((s) => (
          <SelectItem key={s} value={s}>
            {SOURCE_LABELS[s] ?? s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
