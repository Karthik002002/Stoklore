import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { FieldError, UseFormReturn } from 'react-hook-form'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheetIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Field, SelectField, TextField } from '@/components/form'
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

const DIRECTION_OPTIONS = [
  { value: 'long', label: 'Buy (Long)' },
  { value: 'short', label: 'Sell (Short)' },
]
const ORDER_TYPE_OPTIONS = [
  { value: 'market', label: 'Market' },
  { value: 'limit', label: 'Limit' },
]

// The inputs hold whatever was typed (the schema's preprocess step turns '' into null and strings
// into numbers), so the form is driven by the schema's INPUT type and submits its OUTPUT type.
type OrderInput = z.input<typeof paperOrderSchema>
type OrderValues = z.output<typeof paperOrderSchema>
type OrderForm = UseFormReturn<OrderInput, unknown, OrderValues>
/** Which of the two ladders a LegRows block edits. */
type LegField = 'stopLosses' | 'targets'

// One rung of a laddered exit. The point of the ladder is partial exits - "half at target 1, the
// rest at target 2" - so every rung carries its own quantity rather than a percentage; percentages
// of a position that itself shrinks as rungs fill get confusing fast.
function LegRows({
  form,
  name,
  label,
  hint,
}: {
  form: OrderForm
  name: LegField
  label: string
  hint?: string
}) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name })
  const error = form.formState.errors[name]
  const quantity = Number(form.watch('quantity')) || 0
  const covered = (form.watch(name) ?? []).reduce((s: number, l) => s + (Number(l.qty) || 0), 0)

  return (
    <Field label={label} error={(error?.root ?? error) as FieldError | undefined} hint={hint}>
      <div className="space-y-1.5">
        {fields.map((field, i) => (
          <div key={field.id} className="flex items-center gap-2">
            <Input
              type="number"
              step="0.01"
              placeholder="Price"
              className="h-8"
              {...form.register(`${name}.${i}.price`)}
            />
            <Input
              type="number"
              placeholder="Qty"
              className="h-8 w-24"
              {...form.register(`${name}.${i}.qty`)}
            />
            <Button size="icon-sm" variant="ghost" aria-label="Remove level" onClick={() => remove(i)}>
              <XIcon className="size-3.5" />
            </Button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => append({ id: crypto.randomUUID(), price: '', qty: '' })}
          >
            Add level
          </Button>
          {fields.length > 0 && (
            <span
              className={`text-xs tabular-nums ${covered > quantity ? 'text-down' : 'text-muted-foreground'}`}
            >
              {covered} / {quantity || '—'} covered
            </span>
          )}
        </div>
      </div>
    </Field>
  )
}

// What the ticket costs and what it risks, before it's placed. Everything here is derived from
// fields already on the form plus the account's own wallet - no new inputs, because the point is to
// answer "should I send this" without opening another screen.
//
// Entry is the limit price on a limit order and the live price on a market one. Both may be
// unknown (no symbol picked yet, or no quote for it), and every figure below degrades to a dash
// rather than guessing - a made-up entry would make every percentage on this panel wrong.
function OrderReadout({ form, accountId }: { form: OrderForm; accountId: number | null }) {
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
  const entry = orderType === 'limit' ? Number(limitPrice) || null : (detail?.quote?.currentPrice ?? null)
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
  const away = (price: number | null) => (entry && price ? ((price - entry) / entry) * 100 : null)
  // Signed against the direction, so a stop always reads negative and a target positive on both
  // sides of the market rather than flipping sign on a short.
  const directional = (pct: number | null) => (pct == null ? null : direction === 'short' ? -pct : pct)
  const rr = entry
    ? riskReward({
        direction,
        entryPrice: entry,
        stopLosses: legAmounts(stopLosses),
        targets: legAmounts(targets),
      }).rr
    : null

  const pct = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${fmt(v, 2)}%`)
  const risk = stop && entry && qty ? Math.abs(entry - stop) * qty : null
  const reward = target && entry && qty ? Math.abs(target - entry) * qty : null

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border bg-muted/20 p-3 text-xs sm:grid-cols-3">
      <Readout
        label="Position value"
        value={value == null ? '—' : inr(value)}
        sub={entry ? `at ${inr(entry)}${orderType === 'limit' ? ' limit' : ''}` : 'pick a symbol'}
      />
      <Readout
        label="Cash utilisation"
        value={utilisation == null ? '—' : `${fmt(utilisation, 1)}%`}
        sub={available == null ? 'no account wallet' : `${inr(available)} available`}
        tone={(utilisation ?? 0) > 100 ? 'down' : undefined}
      />
      <Readout label="Risk : reward" value={rr == null ? '—' : `${fmt(rr, 2)}R`} />
      <Readout
        label="Stop loss"
        value={stop == null ? '—' : inr(stop)}
        sub={
          stop == null ? 'none set' : `${pct(directional(away(stop)))}${risk ? ` · ${inr(risk)} risk` : ''}`
        }
        tone={stop == null ? undefined : 'down'}
      />
      <Readout
        label="Target"
        value={target == null ? '—' : inr(target)}
        sub={
          target == null
            ? 'none set'
            : `${pct(directional(away(target)))}${reward ? ` · ${inr(reward)} reward` : ''}`
        }
        tone={target == null ? undefined : 'up'}
      />
      <Readout
        label="Risk of wallet"
        value={risk && balance ? `${fmt((risk / balance) * 100, 2)}%` : '—'}
        sub={balance == null ? undefined : `wallet ${inr(balance)}`}
      />
    </div>
  )
}

function Readout({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'up' | 'down'
}) {
  return (
    <div>
      <p className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p
        className={`font-semibold tabular-nums ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : ''}`}
      >
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  )
}

function OrderPanel({ accountId }: { accountId: number | null }) {
  const queryClient = useQueryClient()
  const form = useForm<OrderInput, unknown, OrderValues>({
    resolver: zodResolver(paperOrderSchema),
    defaultValues: {
      accountId: accountId ?? undefined,
      symbol: '',
      direction: 'long',
      orderType: 'market',
      quantity: '',
      limitPrice: '',
      stopLosses: [],
      targets: [],
      notes: '',
    },
  })
  const orderType = form.watch('orderType')

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
      form.reset({ ...form.getValues(), symbol: '', quantity: '', stopLosses: [], targets: [], notes: '' })
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <form
      onSubmit={form.handleSubmit((v) => place.mutate(v))}
      className="space-y-3 rounded-xl border bg-card p-4"
    >
      <p className="text-sm font-medium">Place a paper order</p>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Ticker" error={form.formState.errors.symbol}>
          <Controller
            control={form.control}
            name="symbol"
            render={({ field }) => (
              // Validates against the live symbol list, and offers an "Add SYMBOL" fallback that
              // verifies the ticker actually exists before it can be picked.
              <SymbolCombobox value={field.value} onChange={field.onChange} className="w-full" />
            )}
          />
        </Field>
        <TextField form={form} name="quantity" label="Quantity" type="number" min="0" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SelectField form={form} name="direction" label="Direction" options={DIRECTION_OPTIONS} />
        <SelectField form={form} name="orderType" label="Order type" options={ORDER_TYPE_OPTIONS} />
      </div>

      {orderType === 'limit' && (
        <TextField
          form={form}
          name="limitPrice"
          label="Limit price"
          type="number"
          step="0.01"
          hint="Rests until the live price reaches it, then fills."
        />
      )}

      <LegRows
        form={form}
        name="stopLosses"
        label="Stop loss"
        hint="Below entry for a long, above for a short."
      />
      <LegRows
        form={form}
        name="targets"
        label="Targets (multi-exit)"
        hint="Add two levels to scale out — e.g. 50 shares at target 1, 50 at target 2."
      />

      <OrderReadout form={form} accountId={accountId} />

      <TextField form={form} name="notes" label="Notes" placeholder="Why this trade?" />

      <Button type="submit" className="w-full" disabled={place.isPending}>
        {place.isPending && <Spinner className="size-4" />}
        Place order
      </Button>
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
