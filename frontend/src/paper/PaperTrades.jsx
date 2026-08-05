import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Field, SelectField, TextField } from '@/components/form'
import SymbolCombobox from '@/components/SymbolCombobox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Controller } from 'react-hook-form'
import { formatDateTime, inr } from '@/lib/format'
import { tradePnl, tradeReturnPct } from '@/lib/manualTrades'
import { paperOrderSchema } from '@/lib/schemas'
import { createPaperOrder } from '@/services/api'

const DIRECTION_OPTIONS = [
  { value: 'long', label: 'Buy (Long)' },
  { value: 'short', label: 'Sell (Short)' },
]
const ORDER_TYPE_OPTIONS = [
  { value: 'market', label: 'Market' },
  { value: 'limit', label: 'Limit' },
]

// One rung of a laddered exit. The point of the ladder is partial exits - "half at target 1, the
// rest at target 2" - so every rung carries its own quantity rather than a percentage; percentages
// of a position that itself shrinks as rungs fill get confusing fast.
function LegRows({ form, name, label, hint }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name })
  const error = form.formState.errors[name]
  const quantity = Number(form.watch('quantity')) || 0
  const covered = (form.watch(name) ?? []).reduce((s, l) => s + (Number(l.qty) || 0), 0)

  return (
    <Field label={label} error={error?.root ?? error} hint={hint}>
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

function OrderPanel({ accountId }) {
  const queryClient = useQueryClient()
  const form = useForm({
    resolver: zodResolver(paperOrderSchema),
    defaultValues: {
      accountId,
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
    mutationFn: (v) =>
      createPaperOrder({
        account_id: accountId,
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
const exitReason = (t) => (t.tags ?? []).find((tag) => EXIT_REASONS.includes(tag)) ?? '—'

function HistoryLog({ trades }) {
  if (trades.length === 0) {
    return (
      <p className="rounded-xl border bg-card py-12 text-center text-sm text-muted-foreground">
        No closed paper trades yet.
      </p>
    )
  }
  return (
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
            <TableHead className="text-right">Return</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((t) => {
            const pnl = tradePnl(t)
            const ret = tradeReturnPct(t)
            return (
              <TableRow key={t.id}>
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
                <TableCell className={`text-right tabular-nums ${pnl >= 0 ? 'text-up' : 'text-down'}`}>
                  {inr(pnl)}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${ret >= 0 ? 'text-up' : 'text-down'}`}>
                  {ret == null ? '—' : `${ret}%`}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

export default function PaperTrades({ accountId, trades }) {
  const closed = trades.filter((t) => t.exit_price != null)
  return (
    <div className="grid gap-4 lg:grid-cols-[24rem_1fr]">
      <OrderPanel accountId={accountId} />
      <div className="space-y-2">
        <p className="text-sm font-medium">Trade history</p>
        <HistoryLog trades={closed} />
      </div>
    </div>
  )
}
