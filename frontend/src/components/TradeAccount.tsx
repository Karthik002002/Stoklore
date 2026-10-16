// Which account a chart trades on - a paper account, or Dhan once its credentials are in - and the
// order ticket for it. Shared by the chart modal and the /chart page, so both pick the same account
// (one remembered choice) and show the same ticket.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import LiveOrderTicket from '@/live/LiveOrderTicket'
import { OrderPanel } from '@/paper/PaperTrades'
import { getLiveStatus, getPaperAccounts } from '@/services/api'

// Kept under the chart modal's keys, so a choice made before this was shared still holds.
const ACCOUNT_KEY = 'chartModal.account'
const LIVE_KEY = 'chartModal.live' // 1 when the last pick was the Dhan account
const read = (key: string) => {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}
const write = (key: string, v: number) => {
  try {
    localStorage.setItem(key, String(v))
  } catch {
    // private window: the choice lasts this session
  }
}

/** The account a chart trades on: the paper account last traded from (else the first), or Dhan when
 *  that was picked and its credentials are still there. `pick` takes a paper id or 'live'. */
export function useTradeAccount(enabled = true) {
  const { data: accounts = [] } = useQuery({
    queryKey: ['paperAccounts'],
    queryFn: getPaperAccounts,
    enabled,
  })
  const { data: liveStatus } = useQuery({ queryKey: ['liveStatus'], queryFn: getLiveStatus, enabled })
  const [picked, setPicked] = useState<number | null>(() => read(ACCOUNT_KEY))
  const [livePicked, setLivePicked] = useState(() => read(LIVE_KEY) === 1)
  const account = accounts.find((a) => a.id === picked)?.id ?? accounts[0]?.id ?? null
  const live = livePicked && !!liveStatus?.configured
  const pick = (value: string) => {
    const toLive = value === 'live'
    setLivePicked(toLive)
    write(LIVE_KEY, toLive ? 1 : 0)
    if (toLive) return
    setPicked(Number(value))
    write(ACCOUNT_KEY, Number(value))
  }
  return { accounts, account, live, liveConfigured: !!liveStatus?.configured, pick }
}

export type TradeAccount = ReturnType<typeof useTradeAccount>

/** The account dropdown: every paper account, and "Dhan · live" once Dhan is configured. */
export function AccountSelect({ trade, className }: { trade: TradeAccount; className?: string }) {
  const { accounts, account, live, liveConfigured, pick } = trade
  if (!accounts.length && !liveConfigured) return null
  return (
    <Select value={live ? 'live' : String(account)} onValueChange={(v) => pick(v as string)}>
      <SelectTrigger
        size="sm"
        className={cn('w-44', live && 'border-down/60 text-down', className)}
        title={
          live
            ? 'Dhan: orders from the ticket are real'
            : 'Paper account: its positions show on the chart, orders go to it'
        }
      >
        <SelectValue>
          {(v: string) =>
            v === 'live' ? 'Dhan · live' : (accounts.find((a) => String(a.id) === v)?.name ?? v)
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={String(a.id)}>
            {a.name}
          </SelectItem>
        ))}
        {liveConfigured && (
          // Red text rather than a leading dot: a dot pushes this one label off the left edge the
          // paper accounts line up on.
          <SelectItem value="live" className="text-down">
            Dhan · live
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  )
}

/** The order ticket for the picked account: the live Dhan one, or the paper one. */
export function TradeTicket({
  trade,
  symbol,
  onNavigate,
  className = 'min-h-full bg-background p-4',
}: {
  trade: TradeAccount
  symbol: string
  /** Called when a link in here navigates away - the modal closes itself on it. */
  onNavigate?: () => void
  className?: string
}) {
  if (trade.live) return <LiveOrderTicket key={symbol} symbol={symbol} className={className} />
  if (trade.account == null)
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No paper account yet -{' '}
        <Link to="/paper" className="underline" onClick={onNavigate}>
          create one
        </Link>{' '}
        to trade from the chart.
      </p>
    )
  return (
    <OrderPanel
      key={`${symbol}-${trade.account}`}
      accountId={trade.account}
      symbol={symbol}
      className={className}
    />
  )
}
