import { SurveillanceBadge as DsSurveillanceBadge } from '@/design-system'
import { surveillanceLabel, useSurveillance } from '@/lib/surveillance'

/** "ST-ASM Stage II" beside a stock: NSE has it under surveillance - higher margins, a tighter price
 *  band or trade-for-trade, so an exit can get hard. A fact to know, not a verdict. The look is the
 *  design system's SurveillanceBadge; this wrapper only looks the stock up. */
export default function SurveillanceBadge({ symbol, className }: { symbol: string; className?: string }) {
  const entries = useSurveillance(symbol)
  if (!entries.length) return null
  return (
    <DsSurveillanceBadge
      label={surveillanceLabel(entries)}
      details={entries.map((e) => e.desc).join('\n')}
      className={className}
    />
  )
}
