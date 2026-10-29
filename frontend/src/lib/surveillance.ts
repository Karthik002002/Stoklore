import { useQuery } from '@tanstack/react-query'
import { useBarReplayStore } from '@/features/bar-replay/store'
import type { SurveillanceEntry } from '@/services/api'
import { getSurveillance } from '@/services/api'

const NAMES = { GSM: 'GSM', LTASM: 'LT-ASM', STASM: 'ST-ASM' } as const

/** Today's NSE ASM/GSM entries for one symbol ([] when it's on no list). The lists change once a day. */
export function useSurveillance(symbol: string | null | undefined): SurveillanceEntry[] {
  const { data } = useQuery({ queryKey: ['surveillance'], queryFn: getSurveillance, staleTime: 3_600_000 })
  return (symbol && data?.stocks[symbol]) || []
}

export const surveillanceLabel = (entries: SurveillanceEntry[]) =>
  entries.map((e) => `${NAMES[e.kind]} ${e.stage ?? ''}`.trim()).join(' · ')

/** 9:15-9:30 IST on a weekday, from the wall clock - the open's widest spreads and gaps. */
export function inOpeningWindow(now = new Date()) {
  const ist = new Date(now.getTime() + (now.getTimezoneOffset() + 330) * 60_000)
  const mins = ist.getHours() * 60 + ist.getMinutes()
  return ist.getDay() >= 1 && ist.getDay() <= 5 && mins >= 9 * 60 + 15 && mins < 9 * 60 + 30
}

/** The ticket's market cautions for a symbol: under surveillance, and the opening 15 minutes (unless
 *  switched off in Settings › Preferences). Shown with the ticket's own warnings, never blocking. */
export function useTicketCautions(symbol: string | null | undefined): string[] {
  const entries = useSurveillance(symbol)
  const openWarning = useBarReplayStore((s) => s.settings.openWarning !== false)
  const out: string[] = []
  if (entries.length)
    out.push(
      `${symbol} is under NSE surveillance (${surveillanceLabel(entries)}) - higher margins, a tighter band or trade-for-trade can make it hard to exit.`,
    )
  if (openWarning && inOpeningWindow())
    out.push(
      "First 15 minutes of the session - spreads and gaps are at their widest; fills can land well off the chart's price.",
    )
  return out
}
