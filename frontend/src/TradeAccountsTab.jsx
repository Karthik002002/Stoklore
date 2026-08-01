import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDate, inr } from '@/lib/format'
import { accountBalance, positionSizeCap, tradesForAccount } from '@/lib/tradeAccounts'
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
}

const numeric = (v) => (v === '' || v == null ? null : Number(v))

const formFrom = (a) => ({
  name: a.name,
  strategy: a.strategy ?? '',
  strategy_explanation: a.strategy_explanation ?? '',
  opening_balance: String(a.opening_balance ?? ''),
  max_position_size: a.max_position_size != null ? String(a.max_position_size) : '',
  max_position_size_type: a.max_position_size_type ?? 'currency',
  max_position_count: a.max_position_count != null ? String(a.max_position_count) : '',
})

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function AccountForm({ account, onDone }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(() => (account ? formFrom(account) : BLANK))
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }))

  useEffect(() => setForm(account ? formFrom(account) : BLANK), [account])

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        strategy: form.strategy.trim() || null,
        strategy_explanation: form.strategy_explanation.trim() || null,
        opening_balance: Number(form.opening_balance || 0),
        max_position_size: numeric(form.max_position_size),
        max_position_size_type: form.max_position_size_type,
        max_position_count: numeric(form.max_position_count),
      }
      return account ? updateTradeAccount(account.id, payload) : createTradeAccount(payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tradeAccounts'] })
      toast.success(account ? 'Account updated' : 'Account created')
      onDone()
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="space-y-3 rounded-xl border bg-card p-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Account name">
          <Input
            value={form.name}
            onChange={(e) => set('name')(e.target.value)}
            placeholder="e.g. Swing account"
          />
        </Field>
        <Field label="Opening balance (wallet)">
          <Input
            type="number"
            step="0.01"
            value={form.opening_balance}
            onChange={(e) => set('opening_balance')(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Strategy" hint="One strategy per account - a mixed account can't be judged as a system.">
        <Input
          value={form.strategy}
          onChange={(e) => set('strategy')(e.target.value)}
          placeholder="e.g. EMA pullback continuation"
        />
      </Field>

      <Field label="Strategy explanation">
        <textarea
          value={form.strategy_explanation}
          onChange={(e) => set('strategy_explanation')(e.target.value)}
          rows={3}
          placeholder="Entry trigger, invalidation, what makes this setup valid…"
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field
          label="Max position size"
          hint="Warns on the trade form when exceeded; never blocks the trade."
        >
          <div className="flex gap-2">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={form.max_position_size}
              onChange={(e) => set('max_position_size')(e.target.value)}
              placeholder="No cap"
            />
            <Select value={form.max_position_size_type} onValueChange={set('max_position_size_type')}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="currency">₹</SelectItem>
                <SelectItem value="percentage">% of balance</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Field>
        <Field label="Max open positions" hint="How many trades may be open on this account at once.">
          <Input
            type="number"
            min="0"
            value={form.max_position_count}
            onChange={(e) => set('max_position_count')(e.target.value)}
            placeholder="No cap"
          />
        </Field>
      </div>

      <div className="flex gap-2">
        <Button size="sm" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
          {account ? 'Save changes' : 'Create account'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

// Deposits and withdrawals write to the same balance_adjustments table the Overview tab's wallet
// dialog uses - tagged with account_id so each account's wallet stands on its own.
function Transactions({ accountId, adjustments }) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [type, setType] = useState('add')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['balanceAdjustments'] })

  const create = useMutation({
    mutationFn: () =>
      createBalanceAdjustment({
        amount: Number(amount),
        type,
        reason: reason.trim() || null,
        adjusted_at: date ? new Date(date).toISOString() : null,
        account_id: accountId,
      }),
    onSuccess: () => {
      invalidate()
      setAmount('')
      setReason('')
      toast.success(type === 'add' ? 'Deposit recorded' : 'Withdrawal recorded')
    },
    onError: (e) => toast.error(e.message),
  })

  const remove = useMutation({ mutationFn: deleteBalanceAdjustment, onSuccess: invalidate })

  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-xs font-medium">Transactions</p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={type} onValueChange={setType}>
          <SelectTrigger size="sm" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="add">Deposit</SelectItem>
            <SelectItem value="subtract">Withdrawal</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="number"
          step="0.01"
          min="0"
          placeholder="Amount ₹"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-28"
        />
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-36" />
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="w-44"
        />
        <Button
          size="sm"
          disabled={!amount || Number(amount) <= 0 || create.isPending}
          onClick={() => create.mutate()}
        >
          Add
        </Button>
      </div>
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

function AccountCard({ account, trades, adjustments, onEdit }) {
  const queryClient = useQueryClient()
  const mine = tradesForAccount(trades, account.id)
  const myAdjustments = adjustments.filter((a) => a.account_id === account.id)
  const balance = accountBalance(account, mine, myAdjustments)
  const cap = positionSizeCap(account, balance)

  const remove = useMutation({
    mutationFn: () => deleteTradeAccount(account.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tradeAccounts'] })
      queryClient.invalidateQueries({ queryKey: ['manualTrades'] })
      toast.success('Account deleted - its trades were kept, now unassigned')
    },
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
      </div>

      <Transactions accountId={account.id} adjustments={myAdjustments} />
    </div>
  )
}

export default function TradeAccountsTab() {
  const [editing, setEditing] = useState(null) // account object, 'new', or null
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['tradeAccounts'],
    queryFn: getTradeAccounts,
  })
  const { data: trades = [] } = useQuery({ queryKey: ['manualTrades'], queryFn: getManualTrades })
  const { data: adjustments = [] } = useQuery({
    queryKey: ['balanceAdjustments'],
    queryFn: getBalanceAdjustments,
  })

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Each account holds one strategy and its own wallet. Trades logged under an account snapshot its
          balance at that moment, so account-return% never shifts when you deposit later.
        </p>
        {editing !== 'new' && (
          <Button size="sm" className="shrink-0" onClick={() => setEditing('new')}>
            <PlusIcon className="size-4" />
            New account
          </Button>
        )}
      </div>

      {editing === 'new' && <AccountForm onDone={() => setEditing(null)} />}

      {accounts.length === 0 && editing !== 'new' && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No accounts yet — create one to group your trades by strategy.
        </p>
      )}

      {accounts.map((account) =>
        editing?.id === account.id ? (
          <AccountForm key={account.id} account={account} onDone={() => setEditing(null)} />
        ) : (
          <AccountCard
            key={account.id}
            account={account}
            trades={trades}
            adjustments={adjustments}
            onEdit={() => setEditing(account)}
          />
        ),
      )}
    </div>
  )
}
