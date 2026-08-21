import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Field, SelectField, TextAreaField, TextField } from '@/components/form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDate, inr } from '@/lib/format'
import { balanceAdjustmentSchema, tradeAccountSchema } from '@/lib/schemas'
import { accountBalance, positionSizeCap, tradesForAccount } from '@/lib/tradeAccounts'
import { accountHasCosts, roundTripCost } from '@/lib/tradeCosts'
import {
  createBalanceAdjustment,
  createTradeAccount,
  deleteBalanceAdjustment,
  deleteTradeAccount,
  getBalanceAdjustments,
  getManualTrades,
  getTradeAccounts,
  updateTradeAccount,
} from '@/services/api'

const BLANK = {
  name: '',
  strategy: '',
  strategy_explanation: '',
  opening_balance: '',
  max_position_size: '',
  max_position_size_type: 'currency',
  max_position_count: '',
  slippage_value: '',
  slippage_type: 'per_share',
  brokerage_flat: '',
  brokerage_pct: '',
  other_charges_pct: '',
  vol_spike_multiple: '2',
  vol_spike_lookback: '10',
}

const ADJUSTMENT_TYPE_OPTIONS = [
  { value: 'add', label: 'Deposit' },
  { value: 'subtract', label: 'Withdrawal' },
]

const formFrom = (a) => ({
  name: a.name,
  strategy: a.strategy ?? '',
  strategy_explanation: a.strategy_explanation ?? '',
  opening_balance: String(a.opening_balance ?? ''),
  max_position_size: a.max_position_size != null ? String(a.max_position_size) : '',
  max_position_size_type: a.max_position_size_type ?? 'currency',
  max_position_count: a.max_position_count != null ? String(a.max_position_count) : '',
  slippage_value: a.slippage_value ? String(a.slippage_value) : '',
  slippage_type: a.slippage_type ?? 'per_share',
  brokerage_flat: a.brokerage_flat ? String(a.brokerage_flat) : '',
  brokerage_pct: a.brokerage_pct ? String(a.brokerage_pct) : '',
  other_charges_pct: a.other_charges_pct ? String(a.other_charges_pct) : '',
  vol_spike_multiple: String(a.vol_spike_multiple ?? 2),
  vol_spike_lookback: String(a.vol_spike_lookback ?? 10),
})

const SLIPPAGE_TYPE_OPTIONS = [
  { value: 'per_share', label: '₹ / share' },
  { value: 'bps', label: 'bps' },
]

// What the preview prices. A round trip on a mid-sized position is the number that makes a rate
// card real - "0.1% of turnover" means nothing until it's shown as rupees off a trade.
const PREVIEW_PRICE = 500
const PREVIEW_QTY = 100

const SIZE_TYPE_OPTIONS = [
  { value: 'currency', label: '₹' },
  { value: 'percentage', label: '% of balance' },
]

// Trading costs. Every field is charged PER SIDE, so the preview underneath prices a full round
// trip - that is the number the trade actually pays, and quoting a one-way rate is how a cost model
// ends up half as expensive as reality.
//
// `other charges` is one combined percentage on purpose: STT, exchange transaction charges, SEBI
// turnover fees, stamp duty and GST differ by segment and move with every budget, so a single rate
// you can keep current beats six that go stale.
function CostFields({ form }) {
  const values = form.watch()
  const preview = roundTripCost(
    {
      slippage_value: values.slippage_value,
      slippage_type: values.slippage_type,
      brokerage_flat: values.brokerage_flat,
      brokerage_pct: values.brokerage_pct,
      other_charges_pct: values.other_charges_pct,
    },
    PREVIEW_PRICE,
    PREVIEW_QTY,
  )

  return (
    <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.04] p-3">
      <p className="text-sm font-medium text-amber-600 dark:text-amber-400">Trading costs</p>
      <p className="text-xs text-muted-foreground">
        Charged on both sides of every trade filed under this account. Net P&amp;L is recomputed from these
        settings each time — change a rate and your whole history re-prices.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Slippage" error={form.formState.errors.slippage_value} hint="Per side.">
          <div className="flex gap-2">
            <Input type="number" step="0.01" min="0" placeholder="0" {...form.register('slippage_value')} />
            <Controller
              control={form.control}
              name="slippage_type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SLIPPAGE_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </Field>
        <TextField
          form={form}
          name="brokerage_flat"
          label="Brokerage per order (₹)"
          type="number"
          step="0.01"
          min="0"
          placeholder="0"
          hint="The flat ₹20-a-side kind."
        />
        <TextField
          form={form}
          name="brokerage_pct"
          label="Brokerage (% of turnover)"
          type="number"
          step="0.001"
          min="0"
          placeholder="0"
          hint="Stacks with the flat fee, as capped plans bill."
        />
        <TextField
          form={form}
          name="other_charges_pct"
          label="Other charges (% of turnover)"
          type="number"
          step="0.001"
          min="0"
          placeholder="0"
          hint="STT, exchange, SEBI, stamp duty, GST — combined."
        />
      </div>

      <p className="border-t border-amber-500/30 pt-2 text-xs text-muted-foreground">
        A round trip of {PREVIEW_QTY} shares at {inr(PREVIEW_PRICE)} costs{' '}
        <span className="font-semibold text-amber-600 tabular-nums dark:text-amber-400">
          {inr(preview.total)}
        </span>{' '}
        — {inr(preview.slippage)} slippage · {inr(preview.brokerage)} brokerage · {inr(preview.charges)}{' '}
        charges.
      </p>
    </div>
  )
}

// Volume-spike scan. What counts as "unusual volume" is a property of the strategy, not the
// symbol - a breakout account cares about 2x on the run-up, a mean-reversion one may not care at
// all. Read once when a trade is logged and copied onto that trade's snapshot, so changing these
// affects future trades only and never rewrites what past ones recorded.
function VolumeSpikeFields({ form }) {
  const multiple = Number(form.watch('vol_spike_multiple')) || 2
  const lookback = Number(form.watch('vol_spike_lookback')) || 10

  return (
    <div className="space-y-2 rounded-lg border border-sky-500/40 bg-sky-500/[0.04] p-3">
      <p className="text-sm font-medium text-sky-600 dark:text-sky-400">Volume spike</p>
      <p className="text-xs text-muted-foreground">
        Captured once per trade, from the bars before entry. Changing these re-scans nothing — trades already
        logged keep the reading (and the threshold) they were saved with.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <TextField
          form={form}
          name="vol_spike_multiple"
          label="Spike is (× avg volume)"
          type="number"
          step="0.1"
          min="1"
          placeholder="2"
          hint="Against the bar's own 20-bar average."
        />
        <TextField
          form={form}
          name="vol_spike_lookback"
          label="Bars scanned before entry"
          type="number"
          step="1"
          min="1"
          placeholder="10"
          hint="How far back the run-up is looked at."
        />
      </div>

      <p className="border-t border-sky-500/30 pt-2 text-xs text-muted-foreground">
        A trade is flagged when any of the {lookback} bars before entry traded at least{' '}
        <span className="font-semibold text-sky-600 tabular-nums dark:text-sky-400">{multiple}×</span> its
        20-bar average volume.
      </p>
    </div>
  )
}

function AccountForm({ account, onDone, kind }) {
  const queryClient = useQueryClient()
  const form = useForm({
    resolver: zodResolver(tradeAccountSchema),
    defaultValues: account ? formFrom(account) : BLANK,
  })

  useEffect(() => form.reset(account ? formFrom(account) : BLANK), [account, form])

  const save = useMutation({
    // `kind` is only sent on create - an account never changes kind afterwards, and letting an
    // edit flip a journal account into a paper one (or back) would reassign every trade filed
    // under it to a different mode.
    mutationFn: (payload) =>
      account ? updateTradeAccount(account.id, payload) : createTradeAccount(payload, kind),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tradeAccounts', kind] })
      queryClient.invalidateQueries({ queryKey: ['paperAccounts'] })
      toast.success(account ? 'Account updated' : 'Account created')
      onDone()
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <form
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
      className="space-y-3 rounded-xl border bg-card p-3"
    >
      <div className="grid grid-cols-2 gap-2">
        <TextField form={form} name="name" label="Account name" placeholder="e.g. Swing account" />
        <TextField
          form={form}
          name="opening_balance"
          label="Opening balance (wallet)"
          type="number"
          step="0.01"
        />
      </div>

      <TextField
        form={form}
        name="strategy"
        label="Strategy"
        placeholder="e.g. EMA pullback continuation"
        hint="One strategy per account - a mixed account can't be judged as a system."
      />

      <TextAreaField
        form={form}
        name="strategy_explanation"
        label="Strategy explanation"
        rows={3}
        placeholder="Entry trigger, invalidation, what makes this setup valid…"
      />

      <div className="grid grid-cols-2 gap-2">
        <Field
          label="Max position size"
          error={form.formState.errors.max_position_size}
          hint="Warns on the trade form when exceeded; never blocks the trade."
        >
          <div className="flex gap-2">
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="No cap"
              {...form.register('max_position_size')}
            />
            <Controller
              control={form.control}
              name="max_position_size_type"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SIZE_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </Field>
        <TextField
          form={form}
          name="max_position_count"
          label="Max open positions"
          type="number"
          min="0"
          placeholder="No cap"
          hint="How many trades may be open on this account at once."
        />
      </div>

      <CostFields form={form} />

      {/* Journal only: a paper close writes its manual_trades row from the engine and captures no
          entry-context snapshot at all, so a spike threshold on a paper account would configure
          nothing. Costs above DO apply to both. */}
      {kind !== 'paper' && <VolumeSpikeFields form={form} />}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {account ? 'Save changes' : 'Create account'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

// Deposits and withdrawals write to the same balance_adjustments table the Overview tab's wallet
// dialog uses - tagged with account_id so each account's wallet stands on its own.
function Transactions({ accountId, adjustments }) {
  const queryClient = useQueryClient()
  const form = useForm({
    resolver: zodResolver(balanceAdjustmentSchema),
    defaultValues: { amount: '', type: 'add', date: new Date().toISOString().slice(0, 10), reason: '' },
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['balanceAdjustments'] })

  const create = useMutation({
    mutationFn: (values) =>
      createBalanceAdjustment({
        amount: values.amount,
        type: values.type,
        reason: values.reason,
        adjusted_at: values.date ? new Date(values.date).toISOString() : null,
        account_id: accountId,
      }),
    onSuccess: (_data, values) => {
      invalidate()
      // Keep the type and date - recording several deposits in a row shouldn't mean re-picking
      // both each time.
      form.reset({ ...form.getValues(), amount: '', reason: '' })
      toast.success(values.type === 'add' ? 'Deposit recorded' : 'Withdrawal recorded')
    },
    onError: (e) => toast.error(e.message),
  })

  const remove = useMutation({ mutationFn: deleteBalanceAdjustment, onSuccess: invalidate })

  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-xs font-medium">Transactions</p>
      <form
        onSubmit={form.handleSubmit((values) => create.mutate(values))}
        className="flex flex-wrap items-start gap-2"
      >
        <SelectField form={form} name="type" options={ADJUSTMENT_TYPE_OPTIONS} className="w-32" />
        <TextField
          form={form}
          name="amount"
          type="number"
          step="0.01"
          min="0"
          placeholder="Amount ₹"
          className="w-28"
        />
        <TextField form={form} name="date" type="date" className="w-36" />
        <TextField form={form} name="reason" placeholder="Reason (optional)" className="w-44" />
        <Button type="submit" size="sm" disabled={create.isPending}>
          Add
        </Button>
      </form>
      {adjustments.length > 0 && (
        <div className="max-h-36 space-y-1 overflow-y-auto">
          {adjustments.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-xs">
              <span>
                <span className={a.type === 'add' ? 'text-up' : 'text-down'}>
                  {a.type === 'add' ? '+' : '−'}
                  {inr(a.amount)}
                </span>{' '}
                <span className="text-muted-foreground">
                  {a.reason || '—'} · {formatDate(a.adjusted_at)}
                </span>
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Delete transaction"
                onClick={() => remove.mutate(a.id)}
              >
                <Trash2Icon className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AccountCard({ account, trades, adjustments, onEdit, kind }) {
  const queryClient = useQueryClient()
  const mine = tradesForAccount(trades, account.id)
  const myAdjustments = adjustments.filter((a) => a.account_id === account.id)
  const balance = accountBalance(account, mine, myAdjustments)
  const cap = positionSizeCap(account, balance)

  const remove = useMutation({
    mutationFn: () => deleteTradeAccount(account.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tradeAccounts', kind] })
      queryClient.invalidateQueries({ queryKey: ['paperAccounts'] })
      queryClient.invalidateQueries({ queryKey: ['manualTrades'] })
      toast.success('Account deleted - its trades were kept, now unassigned')
    },
    // The backend refuses (409) while open paper positions still reference the account, since
    // those would cascade away with it. Surfacing that message is the whole point of not
    // swallowing the error here.
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="space-y-3 rounded-xl border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{account.name}</p>
          {account.strategy && <p className="text-xs text-muted-foreground">{account.strategy}</p>}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="outline" onClick={onEdit}>
            Edit
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Delete ${account.name}`}
            onClick={() => remove.mutate()}
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      </div>

      {account.strategy_explanation && (
        <p className="text-xs whitespace-pre-wrap text-muted-foreground">{account.strategy_explanation}</p>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div>
          <p className="text-muted-foreground">Balance</p>
          <p className="font-medium tabular-nums">{inr(balance)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Opening</p>
          <p className="font-medium tabular-nums">{inr(account.opening_balance)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Max position</p>
          <p className="font-medium tabular-nums">
            {account.max_position_size == null
              ? '—'
              : account.max_position_size_type === 'percentage'
                ? `${account.max_position_size}%${cap != null ? ` (${inr(cap)})` : ''}`
                : inr(account.max_position_size)}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Max open / trades</p>
          <p className="font-medium tabular-nums">
            {account.max_position_count ?? '—'} / {mine.length}
          </p>
        </div>
        <div className="col-span-2">
          <p className="text-muted-foreground">Cost per round trip</p>
          <p className="font-medium tabular-nums">
            {accountHasCosts(account)
              ? `${inr(roundTripCost(account, PREVIEW_PRICE, PREVIEW_QTY).total)} on ${PREVIEW_QTY} × ${inr(PREVIEW_PRICE)}`
              : 'None set — P&L is gross'}
          </p>
        </div>
      </div>

      <Transactions accountId={account.id} adjustments={myAdjustments} />
    </div>
  )
}

// Both Settings tabs - "Trade accounts" and "Paper accounts" - render this same component with a
// different `kind`. The two account types are identical in every way that matters here (a name, a
// strategy, a wallet, deposits/withdrawals, position caps); only which trades count against them
// differs, and that's already keyed on account_id. A parallel component would have been the same
// 380 lines with one string changed.
const COPY = {
  journal: {
    blurb:
      'Each account holds one strategy and its own wallet. Trades logged under an account snapshot ' +
      'its balance at that moment, so account-return% never shifts when you deposit later.',
    empty: 'No accounts yet — create one to group your trades by strategy.',
  },
  paper: {
    blurb:
      'Each paper account is a separate simulated wallet for live-price practice, kept entirely ' +
      'apart from your hand-logged journal accounts. Deposits and withdrawals work the same way.',
    empty: 'No paper accounts yet — create one to start paper trading.',
  },
}

export default function TradeAccountsTab({ kind = 'journal' }) {
  const [editing, setEditing] = useState(null) // account object, 'new', or null
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['tradeAccounts', kind],
    queryFn: () => getTradeAccounts(kind),
  })
  const { data: trades = [] } = useQuery({ queryKey: ['manualTrades'], queryFn: getManualTrades })
  const { data: adjustments = [] } = useQuery({
    queryKey: ['balanceAdjustments'],
    queryFn: getBalanceAdjustments,
  })

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  const copy = COPY[kind] ?? COPY.journal

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{copy.blurb}</p>
        {editing !== 'new' && (
          <Button size="sm" className="shrink-0" onClick={() => setEditing('new')}>
            <PlusIcon className="size-4" />
            New account
          </Button>
        )}
      </div>

      {editing === 'new' && <AccountForm kind={kind} onDone={() => setEditing(null)} />}

      {accounts.length === 0 && editing !== 'new' && (
        <p className="py-8 text-center text-sm text-muted-foreground">{copy.empty}</p>
      )}

      {accounts.map((account) =>
        editing?.id === account.id ? (
          <AccountForm key={account.id} account={account} kind={kind} onDone={() => setEditing(null)} />
        ) : (
          <AccountCard
            key={account.id}
            account={account}
            kind={kind}
            trades={trades}
            adjustments={adjustments}
            onEdit={() => setEditing(account)}
          />
        ),
      )}
    </div>
  )
}
