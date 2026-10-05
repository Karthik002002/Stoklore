import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { UseFormReturn } from 'react-hook-form'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheetIcon, PlusIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { F, Seg, TicketFooter } from '@/components/OrderTicketParts'
import { cn } from '@/lib/utils'
import SymbolCombobox from '@/components/SymbolCombobox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Controller } from 'react-hook-form'
import { downloadXlsx } from '@/lib/exportFile'
import { tradeSheet } from '@/lib/tradeExport'
import { fmt, formatDateTime, inr } from '@/lib/format'
import { tradePnl, tradeReturnPct } from '@/lib/manualTrades'
import { accountFor, accountHasCosts, accountsById, tradeCosts, tradeNetPnl } from '@/lib/tradeCosts'
import { paperOrderSchema } from '@/lib/schemas'
import { accountBalance, tradesForAccount } from '@/lib/tradeAccounts'
import { riskReward } from '@/features/bar-replay/orderEngine'
import type { z } from 'zod'
import type { Trade } from '@/lib/types'
import {
  createPaperOrder,
  getBalanceAdjustments,
  getManualTrades,
  getPaperPositions,
  getStockDetail,
  getTradeAccounts,
} from '@/services/api'

// The inputs hold whatever was typed (the schema's preprocess step turns '' into null and strings
// into numbers), so the form is driven by the schema's INPUT type and submits its OUTPUT type.
type OrderInput = z.input<typeof paperOrderSchema>
type OrderValues = z.output<typeof paperOrderSchema>
type OrderForm = UseFormReturn<OrderInput, unknown, OrderValues>
/** Which of the two ladders a LegRows block edits. */
type LegField = 'stopLosses' | 'targets'

/** A field's validation message, small and red under it. */
const ErrorText = ({ error }: { error?: { message?: string } | { root?: { message?: string } } }) => {
  const message =
    (error as { message?: string })?.message ?? (error as { root?: { message?: string } })?.root?.message
  return message ? <p className="text-[11px] text-down">{message}</p> : null
}

// One rung of a laddered exit. The point of the ladder is partial exits - "half at target 1, the
// rest at target 2" - so every rung carries its own quantity rather than a percentage; percentages
// of a position that itself shrinks as rungs fill get confusing fast. Each rung shows how far it
// sits from the entry, signed the way the trade sees it.
function LegRows({
  form,
  name,
  label,
  empty,
  entry,
  tone,
}: {
  form: OrderForm
  name: LegField
  label: string
  /** What the section says while it has no rungs. */
  empty: string
  entry: number | null
  tone: 'up' | 'down'
}) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name })
  const quantity = Number(form.watch('quantity')) || 0
  const legs = form.watch(name) ?? []
  const covered = legs.reduce((s: number, l) => s + (Number(l.qty) || 0), 0)
  // A new rung starts with whatever is still uncovered, so a single stop is one click and a price.
  const add = () =>
    append({ id: crypto.randomUUID(), price: '', qty: quantity > covered ? String(quantity - covered) : '' })

  return (
    <div
      className={cn(
        'rounded-lg border',
        fields.length > 0 && (tone === 'down' ? 'border-down/30' : 'border-up/30'),
      )}
    >
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span className={cn('size-1.5 rounded-full', tone === 'down' ? 'bg-down' : 'bg-up')} />
        <span className="text-xs font-medium">{label}</span>
        {fields.length > 0 ? (
          <span
            className={cn(
              'text-[11px] tabular-nums',
              covered > quantity ? 'text-down' : 'text-muted-foreground',
            )}
          >
            {covered}/{quantity || '—'} covered
          </span>
        ) : (
          <span className="truncate text-[11px] text-muted-foreground">{empty}</span>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto h-6 gap-1 px-1.5 text-xs"
          onClick={add}
        >
          <PlusIcon className="size-3" />
          {fields.length ? 'Level' : 'Add'}
        </Button>
      </div>
      {fields.length > 0 && (
        <div className="space-y-1.5 border-t px-2.5 pt-2 pb-2.5">
          {fields.map((field, i) => {
            const price = Number(legs[i]?.price) || null
            const pct = price && entry ? ((price - entry) / entry) * 100 : null
            return (
              <div key={field.id} className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="Price"
                    className="h-8 pr-14 tabular-nums"
                    {...form.register(`${name}.${i}.price`)}
                  />
                  {pct != null && (
                    <span
                      className={cn(
                        'pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] tabular-nums',
                        tone === 'down' ? 'text-down' : 'text-up',
                      )}
                    >
                      {pct >= 0 ? '+' : ''}
                      {fmt(pct, 1)}%
                    </span>
                  )}
                </div>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="Qty"
                  className="h-8 w-16 tabular-nums"
                  {...form.register(`${name}.${i}.qty`)}
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Remove level"
                  onClick={() => remove(i)}
                >
                  <XIcon className="size-3.5" />
                </Button>
              </div>
            )
          })}
          <ErrorText error={form.formState.errors[name] as never} />
        </div>
      )}
    </div>
  )
}

// What the ticket costs and what it risks, before it's placed. Everything here is derived from
// fields already on the form plus the account's own wallet - no new inputs, because the point is to
// answer "should I send this" without opening another screen.
//
// Entry is the limit price on a limit order and the live price on a market one. Both may be
// unknown (no symbol picked yet, or no quote for it), and every figure degrades to null rather
// than guessing - a made-up entry would make every percentage on the ticket wrong.
function useOrderFigures(form: OrderForm, accountId: number | null) {
  const [symbol, quantity, direction, orderType, limitPrice, stopLosses, targets] = form.watch([
    'symbol',
    'quantity',
    'direction',
    'orderType',
    'limitPrice',
    'stopLosses',
    'targets',
  ])

  const { data: detail } = useQuery({
    queryKey: ['stockDetail', symbol],
    queryFn: () => getStockDetail(symbol),
    enabled: !!symbol,
    staleTime: 60_000,
  })
  const { data: accounts = [] } = useQuery({
    queryKey: ['tradeAccounts', 'paper'],
    queryFn: () => getTradeAccounts('paper'),
  })
  const { data: positions = [] } = useQuery({
    queryKey: ['paperPositions', accountId],
    queryFn: () => getPaperPositions(accountId),
    enabled: accountId != null,
  })
  const { data: allTrades = [] } = useQuery({ queryKey: ['manualTrades'], queryFn: getManualTrades })
  const { data: adjustments = [] } = useQuery({
    queryKey: ['balanceAdjustments'],
    queryFn: getBalanceAdjustments,
  })

  const account = accounts.find((a) => a.id === accountId) ?? null
  const qty = Number(quantity) || 0
  const ltp = detail?.quote?.currentPrice ?? null
  const entry = orderType === 'limit' ? Number(limitPrice) || null : ltp
  const value = entry && qty ? entry * qty : null

  // Cash available = the wallet, less what is already committed to open positions. Committed
  // capital is at entry cost, not market value: that's the cash that actually left.
  const balance = accountBalance(
    account,
    tradesForAccount(allTrades, accountId),
    adjustments.filter((a) => a.account_id === accountId),
  )
  const committed = positions.reduce((s, p) => s + p.entry_price * p.quantity, 0)
  const available = balance == null ? null : Math.round((balance - committed) * 100) / 100
  const utilisation = available && value ? (value / available) * 100 : null

  // riskReward works in numbers; the form holds whatever was typed until it validates.
  const legAmounts = (legs: OrderInput['stopLosses'] | undefined) =>
    (legs ?? [])
      .map((l) => ({ id: l.id, price: Number(l.price), qty: Number(l.qty) || 0 }))
      .filter((l) => l.price)
  const level = (legs: OrderInput['stopLosses'] | undefined) =>
    (legs ?? []).map((l) => Number(l.price)).filter((p) => p > 0)[0] ?? null
  const stop = level(stopLosses)
  const target = level(targets)
  const rr = entry
    ? riskReward({
        direction,
        entryPrice: entry,
        stopLosses: legAmounts(stopLosses),
        targets: legAmounts(targets),
      }).rr
    : null
  const risk = stop && entry && qty ? Math.abs(entry - stop) * qty : null
  const reward = target && entry && qty ? Math.abs(target - entry) * qty : null

  const warnings: string[] = []
  if (available != null && value != null && value > available)
    warnings.push(`Costs ${inr(value)} - more than the ${inr(available)} cash available.`)
  const riskOfWallet = risk && balance ? (risk / balance) * 100 : null

  return {
    account,
    ltp,
    entry,
    qty,
    value,
    balance,
    available,
    utilisation,
    risk,
    reward,
    rr,
    riskOfWallet,
    warnings,
  }
}

/** The paper order ticket - same layout as the live Dhan one (live/LiveOrderTicket.tsx), built from
 *  the same parts. `symbol` fixes the ticker (the chart modal: the order is for the stock on
 *  screen); without it the ticker is picked here. Remount it (key) when the account changes. */
export function OrderPanel({
  accountId,
  symbol,
  className,
}: {
  accountId: number | null
  symbol?: string
  className?: string
}) {
  const queryClient = useQueryClient()
  const form = useForm<OrderInput, unknown, OrderValues>({
    resolver: zodResolver(paperOrderSchema),
    defaultValues: {
      accountId: accountId ?? undefined,
      symbol: symbol ?? '',
      direction: 'long',
      orderType: 'market',
      quantity: '',
      limitPrice: '',
      stopLosses: [],
      targets: [],
      notes: '',
    },
  })
  const [orderType, direction, typedSymbol, limitPrice] = form.watch([
    'orderType',
    'direction',
    'symbol',
    'limitPrice',
  ])
  const f = useOrderFigures(form, accountId)
  const errors = form.formState.errors
  const buy = direction === 'long'
  const shown = symbol ?? typedSymbol
  const maxQty = f.available && f.entry ? Math.floor(f.available / f.entry) : null

  const place = useMutation({
    mutationFn: (v: OrderValues) =>
      createPaperOrder({
        account_id: v.accountId,
        symbol: v.symbol,
        direction: v.direction,
        order_type: v.orderType,
        quantity: v.quantity,
        limit_price: v.orderType === 'limit' ? v.limitPrice : null,
        stop_losses: v.stopLosses,
        targets: v.targets,
        notes: v.notes,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['paperPositions'] })
      toast.success(
        data.status === 'pending'
          ? `Limit order resting at ${inr(data.entry_price)}`
          : `Filled at ${inr(data.entry_price)}`,
      )
      form.reset({
        ...form.getValues(),
        symbol: symbol ?? '',
        quantity: '',
        stopLosses: [],
        targets: [],
        notes: '',
      })
    },
    onError: (e) => toast.error(e.message),
  })

  const limitPct =
    orderType === 'limit' && Number(limitPrice) && f.ltp ? ((Number(limitPrice) - f.ltp) / f.ltp) * 100 : null

  return (
    <form
      onSubmit={form.handleSubmit((v) => place.mutate(v))}
      className={cn('flex flex-col gap-3', className ?? 'rounded-xl border bg-card p-4')}
    >
      {/* header: what, at what price, against which wallet */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{symbol ?? 'Paper order'}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {f.ltp != null && <>LTP {inr(f.ltp)} · </>}
            cash {f.available == null ? '—' : inr(f.available)}
          </p>
        </div>
        <span className="flex max-w-36 shrink-0 items-center gap-1.5 truncate rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-600 dark:text-sky-400">
          <span className="size-1.5 shrink-0 rounded-full bg-sky-500" />
          <span className="truncate">Paper · {f.account?.name ?? 'account'}</span>
        </span>
      </div>

      {!symbol && (
        <F label="Symbol">
          <Controller
            control={form.control}
            name="symbol"
            render={({ field }) => (
              // Validates against the live symbol list, and offers an "Add SYMBOL" fallback that
              // verifies the ticker actually exists before it can be picked.
              <SymbolCombobox value={field.value} onChange={field.onChange} className="w-full" />
            )}
          />
          <ErrorText error={errors.symbol} />
        </F>
      )}

      <Controller
        control={form.control}
        name="direction"
        render={({ field }) => (
          <Seg
            size="lg"
            value={field.value}
            onChange={field.onChange}
            options={[
              { value: 'long', label: 'Buy' },
              { value: 'short', label: 'Sell' },
            ]}
            tone={(v) => (v === 'long' ? 'bg-up text-white shadow-sm' : 'bg-down text-white shadow-sm')}
          />
        )}
      />

      <div className="grid grid-cols-2 gap-2">
        <F label="Order type">
          <Controller
            control={form.control}
            name="orderType"
            render={({ field }) => (
              <Seg
                value={field.value}
                onChange={field.onChange}
                options={[
                  { value: 'market', label: 'Market', hint: 'Fills now at the live price' },
                  {
                    value: 'limit',
                    label: 'Limit',
                    hint: 'Rests until the live price reaches it, then fills',
                  },
                ]}
              />
            )}
          />
        </F>
        <F
          label="Quantity"
          aside={
            maxQty != null &&
            maxQty > 0 && (
              <button
                type="button"
                className="text-[11px] text-primary hover:underline"
                title="As many as the account's cash pays for at this price"
                onClick={(e) => {
                  e.preventDefault()
                  form.setValue('quantity', String(maxQty), { shouldValidate: true })
                }}
              >
                max {maxQty}
              </button>
            )
          }
        >
          <Input
            type="number"
            min="0"
            inputMode="numeric"
            placeholder="0"
            className="h-7 tabular-nums"
            {...form.register('quantity')}
          />
          <ErrorText error={errors.quantity} />
        </F>
      </div>

      {orderType === 'limit' && (
        <F
          label="Limit price"
          aside={
            limitPct != null && (
              <span className="tabular-nums">
                {limitPct >= 0 ? '+' : ''}
                {fmt(limitPct, 2)}% vs LTP
              </span>
            )
          }
        >
          <Input
            type="number"
            step="0.01"
            inputMode="decimal"
            placeholder="₹"
            className="h-8 tabular-nums"
            {...form.register('limitPrice')}
          />
          <ErrorText error={errors.limitPrice} />
        </F>
      )}

      <LegRows
        form={form}
        name="stopLosses"
        label="Stop-loss"
        empty="none - unprotected"
        entry={f.entry}
        tone="down"
      />
      <LegRows
        form={form}
        name="targets"
        label="Targets"
        empty="add 2+ to scale out"
        entry={f.entry}
        tone="up"
      />

      <F label="Notes">
        <Input placeholder="Why this trade?" className="h-8" {...form.register('notes')} />
      </F>

      <TicketFooter
        quantity={f.qty}
        price={f.entry}
        priceNote={orderType === 'market' ? 'LTP' : 'limit'}
        value={f.value}
        pct={f.utilisation}
        pctLabel="of cash"
        risk={f.risk}
        reward={f.reward}
        rr={f.rr}
        riskNote={f.riskOfWallet == null ? undefined : `${fmt(f.riskOfWallet, 2)}% of wallet`}
        warnings={f.warnings}
      >
        <Button
          type="submit"
          className={cn(
            'h-10 w-full text-sm font-semibold text-white',
            buy ? 'bg-up hover:bg-up/90' : 'bg-down hover:bg-down/90',
          )}
          disabled={place.isPending}
        >
          {place.isPending && <Spinner className="size-4" />}
          {buy ? 'Buy' : 'Sell'}
          {f.qty > 0 ? ` ${f.qty}` : ''}
          {shown ? ` ${shown}` : ''} · {orderType === 'limit' ? 'place limit' : 'paper'}
        </Button>
      </TicketFooter>
    </form>
  )
}

// Closed paper trades are ordinary journal rows tagged 'paper', so this reads the same
// manual_trades list the Backtesting tab does rather than a paper-specific history endpoint.
const EXIT_REASONS = ['Hit SL', 'Hit Target', 'Manual Close']
const exitReason = (t: Trade) => (t.tags ?? []).find((tag) => EXIT_REASONS.includes(tag)) ?? '—'

function HistoryLog({ trades, accountId }: { trades: Trade[]; accountId: number | null }) {
  const navigate = useNavigate()
  // Paper accounts carry the same cost settings as journal ones, so a paper P&L and a journal P&L
  // are finally comparable numbers rather than one gross and one net.
  const { data: accounts = [] } = useQuery({
    queryKey: ['tradeAccounts', 'paper'],
    queryFn: () => getTradeAccounts('paper'),
  })
  const byId = useMemo(() => accountsById(accounts), [accounts])
  const anyCosts = useMemo(() => accounts.some(accountHasCosts), [accounts])
  const accountName = accounts.find((a) => a.id === trades[0]?.account_id)?.name ?? 'paper'
  if (trades.length === 0) {
    return (
      <p className="rounded-xl border bg-card py-12 text-center text-sm text-muted-foreground">
        No closed paper trades yet.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() => downloadXlsx(tradeSheet(trades, accounts), `paper-trades-${accountName}`)}
        >
          <FileSpreadsheetIcon className="size-4" /> Excel
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Closed</TableHead>
              <TableHead>Ticker</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Entry</TableHead>
              <TableHead className="text-right">Exit</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Realized</TableHead>
              {anyCosts && (
                <TableHead
                  className="text-right"
                  title="Realized P&L minus this paper account's slippage, brokerage and charges on both sides."
                >
                  Net
                </TableHead>
              )}
              <TableHead className="text-right">Return</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.map((t) => {
              const pnl = tradePnl(t)
              const ret = tradeReturnPct(t)
              const costs = tradeCosts(t, accountFor(t, byId))
              const net = tradeNetPnl(t, accountFor(t, byId))
              return (
                // Same drill-in as the holdings table above it: the row is the link, and the
                // trade it opens is the one thing every cell on it describes.
                <TableRow
                  key={t.id}
                  className="cursor-pointer"
                  onClick={() =>
                    navigate({
                      to: '/paper/trade/$tradeId',
                      params: { tradeId: String(t.id) },
                      search: { account: accountId ?? undefined },
                    })
                  }
                >
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(t.exited_at ?? t.traded_at)}
                  </TableCell>
                  <TableCell className="font-medium">{t.symbol}</TableCell>
                  <TableCell className="capitalize">{t.direction}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(t.entry_price)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(t.exit_price)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{exitReason(t)}</Badge>
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${(pnl ?? 0) >= 0 ? 'text-up' : 'text-down'}`}
                  >
                    {inr(pnl)}
                  </TableCell>
                  {anyCosts && (
                    <TableCell
                      className={`text-right tabular-nums ${net == null ? '' : net >= 0 ? 'text-up' : 'text-down'}`}
                      title={costs ? `Costs ${inr(costs.total)}` : undefined}
                    >
                      {net == null ? '—' : inr(net)}
                    </TableCell>
                  )}
                  <TableCell
                    className={`text-right tabular-nums ${(ret ?? 0) >= 0 ? 'text-up' : 'text-down'}`}
                  >
                    {ret == null ? '—' : `${ret}%`}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export default function PaperTrades({ accountId, trades }: { accountId: number | null; trades: Trade[] }) {
  const closed = trades.filter((t) => t.exit_price != null)
  return (
    <div className="grid gap-4 lg:grid-cols-[24rem_1fr]">
      <OrderPanel accountId={accountId} />
      <div className="space-y-2">
        <p className="text-sm font-medium">Trade history</p>
        <HistoryLog trades={closed} accountId={accountId} />
      </div>
    </div>
  )
}
