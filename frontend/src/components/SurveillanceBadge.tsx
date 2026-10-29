import { ShieldAlertIcon } from 'lucide-react'
import { surveillanceLabel, useSurveillance } from '@/lib/surveillance'
import { cn } from '@/lib/utils'

/** "ST-ASM Stage II" beside a stock: NSE has it under surveillance - higher margins, a tighter price
 *  band or trade-for-trade, so an exit can get hard. A fact to know, not a verdict. */
export default function SurveillanceBadge({ symbol, className }: { symbol: string; className?: string }) {
  const entries = useSurveillance(symbol)
  if (!entries.length) return null
  return (
    <span
      title={`${entries.map((e) => e.desc).join('\n')}\n\nNSE surveillance: higher margins, a tighter price band or trade-for-trade settlement while it lasts.`}
      className={cn(
        'inline-flex items-center gap-1 rounded border border-down/50 bg-down/10 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-down',
        className,
      )}
    >
      <ShieldAlertIcon className="size-3" />
      {surveillanceLabel(entries)}
    </span>
  )
}
