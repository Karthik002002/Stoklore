import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { RefreshCwIcon, SettingsIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { usePageTitle } from '@/lib/usePageTitle'
import { timeAgo } from '@/lib/format'
import {
  getManualTrades,
  getPaperAccounts,
  getPaperPositions,
  getPaperStatus,
  pollPaperEngine,
} from '@/services/api'
import PaperHoldings from './PaperHoldings'
import PaperOverview from './PaperOverview'
import PaperTrades from './PaperTrades'

// How often the browser re-reads positions. The backend engine polls yfinance on its own schedule
// (paper.POLL_SECONDS) and is what actually triggers exits - this interval only controls how
// quickly the screen catches up, so it can be brisk without adding upstream load.
const REFRESH_MS = 10_000

// Whether the engine's last sweep is recent enough to call the prices live. Compared against the
// backend's own poll interval rather than a hardcoded number, so changing one doesn't silently
// desync the other.
function feedState(status) {
  if (!status) return { label: 'Connecting…', tone: 'muted' }
  if (!status.market_open) return { label: 'Market closed', tone: 'muted' }
  if (!status.last_poll) return { label: 'Waiting for first poll', tone: 'muted' }
  const age = (Date.now() - new Date(status.last_poll).getTime()) / 1000
  return age < status.poll_seconds * 3
    ? { label: 'Live', tone: 'live' }
    : { label: `Stale (${timeAgo(status.last_poll)})`, tone: 'stale' }
}

export default function PaperTrading() {
  usePageTitle('Paper Trading')
  const queryClient = useQueryClient()
  const { view, account } = useSearch({ from: '/paper' })
  const navigate = useNavigate({ from: '/paper' })

  const { data: accounts = [] } = useQuery({ queryKey: ['paperAccounts'], queryFn: getPaperAccounts })
  // No account selected yet - fall back to the first, so a fresh page isn't blank.
  const accountId = account ?? accounts[0]?.id ?? null
  const selected = accounts.find((a) => a.id === accountId) ?? null

  const { data: positions = [], isFetching } = useQuery({
    queryKey: ['paperPositions', accountId],
    queryFn: () => getPaperPositions(accountId),
    enabled: accountId != null,
    refetchInterval: REFRESH_MS,
  })

  const { data: status } = useQuery({
    queryKey: ['paperStatus'],
    queryFn: getPaperStatus,
    refetchInterval: REFRESH_MS,
  })

  // Closed paper trades are journal rows tagged 'paper' - scoped to this account so two paper
  // accounts don't pool into one performance picture.
  const { data: allTrades = [] } = useQuery({ queryKey: ['manualTrades'], queryFn: getManualTrades })
  const trades = allTrades.filter((t) => t.account_id === accountId && (t.tags ?? []).includes('paper'))

  // Creating an account with a name, a strategy and position caps belongs in one place, and that
  // place already exists - Settings > Paper accounts, which also edits and deletes them. This page
  // only links there rather than growing a second, thinner account form.
  const manageAccounts = () => navigate({ search: (prev) => ({ ...prev, settings: 'paper-accounts' }) })

  const poll = useMutation({
    mutationFn: pollPaperEngine,
    onSuccess: ({ triggered }) => {
      queryClient.invalidateQueries({ queryKey: ['paperPositions'] })
      queryClient.invalidateQueries({ queryKey: ['manualTrades'] })
      queryClient.invalidateQueries({ queryKey: ['paperStatus'] })
      if (triggered.length) toast.success(`${triggered.length} exit(s) triggered`)
    },
    onError: (e) => toast.error(e.message),
  })

  const feed = feedState(status)

  if (accounts.length === 0) {
    return (
      <div className="py-24 text-center">
        <p className="text-sm text-muted-foreground">
          No paper account yet. One holds its own simulated wallet, kept entirely separate from the journal's
          accounts.
        </p>
        <Button className="mt-4" onClick={manageAccounts}>
          <SettingsIcon className="size-4" /> Create a paper account
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Paper Trading</h1>
          <Badge
            variant="secondary"
            className={
              feed.tone === 'live'
                ? 'bg-success/15 text-up'
                : feed.tone === 'stale'
                  ? 'bg-amber-500/15 text-amber-600'
                  : 'text-muted-foreground'
            }
          >
            <span
              className={`mr-1.5 inline-block size-1.5 rounded-full ${
                feed.tone === 'live' ? 'animate-pulse bg-up' : 'bg-muted-foreground'
              }`}
            />
            {feed.label}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={String(accountId)}
            onValueChange={(v) => navigate({ search: (prev) => ({ ...prev, account: Number(v) }) })}
          >
            <SelectTrigger size="sm" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={poll.isPending} onClick={() => poll.mutate()}>
            {poll.isPending ? <Spinner className="size-4" /> : <RefreshCwIcon className="size-4" />}
            Refresh prices
          </Button>
          <Button size="sm" variant="ghost" aria-label="Manage paper accounts" onClick={manageAccounts}>
            <SettingsIcon className="size-4" />
          </Button>
        </div>
      </div>

      <Tabs value={view} onValueChange={(next) => navigate({ search: (prev) => ({ ...prev, view: next }) })}>
        <TabsList>
          <TabsTab value="overview">Overview</TabsTab>
          <TabsTab value="holdings">
            Holdings
            {positions.length > 0 && (
              <Badge variant="secondary" className="ml-1.5">
                {positions.length}
              </Badge>
            )}
          </TabsTab>
          <TabsTab value="trades">Trades</TabsTab>
          <TabsIndicator />
        </TabsList>

        <TabsPanel value="overview">
          <PaperOverview account={selected} trades={trades} positions={positions} />
        </TabsPanel>
        <TabsPanel value="holdings">
          <PaperHoldings positions={positions} isFetching={isFetching} />
        </TabsPanel>
        <TabsPanel value="trades">
          <PaperTrades accountId={accountId} trades={trades} />
        </TabsPanel>
      </Tabs>
    </div>
  )
}
