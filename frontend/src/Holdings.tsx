import { useEffect, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCwIcon, WalletIcon } from 'lucide-react'
import { toast } from 'sonner'
import AllocationDonut from '@/components/AllocationDonut'
import {
  Button,
  Change,
  EmptyState,
  Panel,
  PanelHeader,
  PanelTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Stat,
  StatStrip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsIndicator,
  TabsList,
  TabsTab,
} from '@/design-system'
import LiveOrderTicket from '@/live/LiveOrderTicket'
import { LiveOrdersTable, LivePositionsTable, LiveStateBar } from '@/live/LiveTrading'
import type { HoldingsView } from '@/router'
import type { Broker } from '@/BrokerLogo'
import { BrokerLogo, brokerLabel } from '@/BrokerLogo'
import { inr } from '@/lib/format'
import { usePageTitle } from '@/lib/usePageTitle'
import { getHoldings, setActiveBroker } from '@/services/api'

// The active broker lives in the URL (?broker=dhan) - shareable/bookmarkable, and survives a
// refresh without a round trip to read it back from settings first. Still persisted server-side
// via setActiveBroker so it's remembered as the default next time /holdings is opened with no
// query param at all (see router.jsx's validateSearch).
function BrokerSelect({ broker, onChange }: { broker: Broker; onChange: (next: Broker) => void }) {
  const save = useMutation({ mutationFn: setActiveBroker, onError: (e) => toast.error(e.message) })

  const select = (next: Broker) => {
    onChange(next)
    save.mutate(next)
  }

  return (
    <Select value={broker} onValueChange={(v) => select(v as Broker)}>
      <SelectTrigger className="w-36">
        <SelectValue>
          {(value) => (
            <span className="inline-flex items-center gap-1.5">
              <BrokerLogo broker={value} /> {brokerLabel(value)}
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-44" alignItemWithTrigger={false}>
        <SelectItem value="dhan">
          <BrokerLogo broker="dhan" /> Dhan
        </SelectItem>
        <SelectItem value="kite">
          <BrokerLogo broker="kite" /> Kite
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

export default function Holdings() {
  usePageTitle('Holdings')
  const { broker, kiteLogin, view: viewParam } = useSearch({ from: '/holdings' })
  // Positions / Orders / Trade are Dhan's live account - Kite only ever shows holdings here.
  const view: HoldingsView = broker === 'dhan' ? (viewParam ?? 'holdings') : 'holdings'
  const setView = (next: string) =>
    navigate({
      search: (prev) => ({ ...prev, view: next === 'holdings' ? undefined : (next as HoldingsView) }),
      replace: true,
    })
  const navigate = useNavigate({ from: '/holdings' })
  const queryClient = useQueryClient()
  const [reloading, setReloading] = useState(false)

  const setBroker = (next: Broker) => navigate({ search: { broker: next }, replace: true })

  // Lands here after the Kite login redirect (api.py's /api/kite/callback) - surface whether it
  // worked, then drop kiteLogin from the URL so refreshing the page doesn't re-show the toast.
  useEffect(() => {
    if (!kiteLogin) return
    if (kiteLogin === 'success') {
      toast.success('Connected to Kite')
      queryClient.invalidateQueries({ queryKey: ['brokerConfig'] })
      queryClient.invalidateQueries({ queryKey: ['holdings'] })
    } else {
      toast.error('Kite login failed - check your API key/secret in Settings > Kite')
    }
    navigate({ search: { broker }, replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kiteLogin])

  const { data, error, refetch } = useQuery({
    queryKey: ['holdings', broker],
    queryFn: () => getHoldings(broker, false),
    retry: false,
  })

  const reload = async () => {
    setReloading(true)
    try {
      await getHoldings(broker, true)
      await refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not reload holdings')
    } finally {
      setReloading(false)
    }
  }

  const holdings = data?.holdings ?? []
  const investedValue = holdings.reduce((sum, h) => sum + (h.avg_price ?? 0) * (h.qty ?? 0), 0)
  const currentValue = holdings.reduce((sum, h) => sum + (h.ltp ?? h.avg_price ?? 0) * (h.qty ?? 0), 0)
  const pnl = currentValue - investedValue
  const pnlPct = investedValue > 0 ? (pnl / investedValue) * 100 : null
  const winners = holdings.filter((h) => (h.ltp ?? h.avg_price ?? 0) >= (h.avg_price ?? 0)).length

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        {broker === 'dhan' ? (
          <Tabs value={view} onValueChange={setView}>
            <TabsList>
              <TabsTab value="holdings">Holdings</TabsTab>
              <TabsTab value="positions">Positions</TabsTab>
              <TabsTab value="orders">Orders</TabsTab>
              <TabsTab value="trade">Trade</TabsTab>
              <TabsIndicator />
            </TabsList>
          </Tabs>
        ) : (
          <h2 className="text-label font-semibold text-muted-foreground">Holdings</h2>
        )}
        <div className="flex items-center gap-2">
          <BrokerSelect broker={broker} onChange={setBroker} />
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Reload holdings"
            onClick={reload}
            disabled={reloading}
          >
            <RefreshCwIcon className={`size-4 ${reloading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {view !== 'holdings' && (
        <div className="space-y-2">
          <LiveStateBar />
          {view === 'positions' && <LivePositionsTable />}
          {view === 'orders' && <LiveOrdersTable />}
          {view === 'trade' && (
            <div className="grid gap-2 lg:grid-cols-[22rem_1fr]">
              <LiveOrderTicket className="h-fit rounded-md border border-border bg-card p-3" />
              <div className="min-w-0 space-y-2">
                <Panel>
                  <PanelHeader>
                    <PanelTitle>Working orders</PanelTitle>
                  </PanelHeader>
                  <LiveOrdersTable openOnly />
                </Panel>
                <Panel>
                  <PanelHeader>
                    <PanelTitle>Open positions</PanelTitle>
                  </PanelHeader>
                  <LivePositionsTable />
                </Panel>
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'holdings' && error && (
        <EmptyState
          bordered
          icon={WalletIcon}
          title="Can't load holdings"
          description={error.message}
          className="py-16"
        >
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate({ to: '/settings', search: { tab: 'broker', broker } })}
          >
            Configure broker
          </Button>
        </EmptyState>
      )}

      {view === 'holdings' && !error && !data && (
        <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
          <Spinner className="size-4" /> Syncing holdings…
        </div>
      )}

      {view === 'holdings' && !error && data && (
        <>
          <StatStrip bordered>
            <Stat label="Available balance" value={inr(data.available_balance)} />
            <Stat label="Invested value" value={inr(investedValue)} />
            <Stat label="Current value" value={inr(currentValue)} />
            <Stat
              label="P&L"
              value={inr(pnl)}
              tone={pnl >= 0 ? 'up' : 'down'}
              delta={<Change value={pnlPct} />}
            />
            <Stat
              label="Positions"
              value={holdings.length}
              delta={
                holdings.length > 0 && (
                  <>
                    <span className="text-up">{winners} up</span> ·{' '}
                    <span className="text-down">{holdings.length - winners} down</span>
                  </>
                )
              }
            />
          </StatStrip>

          {holdings.length === 0 && (
            <EmptyState
              bordered
              icon={WalletIcon}
              title="No holdings"
              description="Nothing held with this broker yet."
            />
          )}

          {holdings.length > 0 && (
            <AllocationDonut
              title="Exposure by symbol"
              slices={holdings.map((h) => ({
                label: h.symbol,
                value: (h.ltp ?? h.avg_price ?? 0) * (h.qty ?? 0),
              }))}
            />
          )}

          {holdings.length > 0 && (
            <Panel>
              <PanelHeader>
                <PanelTitle hint={`${holdings.length} stocks · click a row for its page`}>
                  Holdings
                </PanelTitle>
              </PanelHeader>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Symbol</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Entry price</TableHead>
                    <TableHead className="text-right">Current price</TableHead>
                    <TableHead className="text-right">Invested</TableHead>
                    <TableHead className="text-right">Current value</TableHead>
                    <TableHead className="text-right">P&L</TableHead>
                    <TableHead className="text-right">P&L %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holdings.map((h) => {
                    const invested = (h.avg_price ?? 0) * (h.qty ?? 0)
                    const current = (h.ltp ?? h.avg_price ?? 0) * (h.qty ?? 0)
                    const rowPnl = current - invested
                    const rowPnlPct =
                      h.avg_price && h.ltp != null ? ((h.ltp - h.avg_price) / h.avg_price) * 100 : null
                    return (
                      <TableRow
                        key={h.isin ?? h.symbol}
                        className="cursor-pointer"
                        onClick={() =>
                          navigate({
                            to: '/stock/$exchange/$symbol',
                            params: { exchange: 'NSE', symbol: h.symbol },
                          })
                        }
                      >
                        <TableCell className="font-semibold">{h.symbol}</TableCell>
                        <TableCell className="text-right tabular-nums">{h.qty}</TableCell>
                        <TableCell className="text-right tabular-nums">{inr(h.avg_price)}</TableCell>
                        <TableCell className="text-right tabular-nums">{inr(h.ltp)}</TableCell>
                        <TableCell className="text-right tabular-nums">{inr(invested)}</TableCell>
                        <TableCell className="text-right tabular-nums">{inr(current)}</TableCell>
                        <TableCell className={`text-right ${rowPnl >= 0 ? 'text-up' : 'text-down'}`}>
                          {inr(rowPnl)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Change value={rowPnlPct} variant="pill" />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Panel>
          )}
        </>
      )}
    </div>
  )
}
