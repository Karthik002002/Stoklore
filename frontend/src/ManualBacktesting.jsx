import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { ClapperboardIcon, DownloadIcon, ImagesIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import BulkTradesDialog from './BulkTradesDialog'
import { Field, SelectField, TagField, TextField } from '@/components/form'
import ImageLightbox from '@/components/ImageLightbox'
import SymbolCombobox from '@/components/SymbolCombobox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { formatDate, inr } from '@/lib/format'
import {
  autoResult,
  EMOTIONS,
  expectedR,
  NEUTRAL_PNL_BAND,
  NSE_SESSIONS,
  RESULT_META,
  riskStatus,
  sessionFor,
  tradePnl,
  tradeRR,
  tradeReturnPct,
} from '@/lib/manualTrades'
import { tradeSchema } from '@/lib/schemas'
import { accountBalance, capWarnings, tradesForAccount } from '@/lib/tradeAccounts'
import {
  createManualTrade,
  deleteManualTrade,
  getBalanceAdjustments,
  getManualBacktestSettings,
  getManualTrades,
  getTradeAccounts,
  updateManualTrade,
  uploadManualTradeImage,
} from '@/services/api'
import ManualGoals from './ManualGoals'
import ManualOverview from './ManualOverview'
import ManualStatistics from './ManualStatistics'
import TradeDetailDialog from './TradeDetailDialog'

function emptyForm(accountId = null) {
  return {
    tradedAt: '',
    exitedAt: '',
    symbol: '',
    direction: 'long',
    setup: '',
    quantity: '',
    entryPrice: '',
    exitPrice: '',
    stopLoss: '',
    target: '',
    idealRiskAmount: '',
    isOpen: false,
    result: null,
    resultManual: false,
    emotion: '',
    tags: [],
    imageFile: null,
    accountId,
  }
}

// "no account" needs a real value in a Select - empty string renders as the placeholder instead of
// a selectable option, so this stands in for null on the way in and out.
const NO_ACCOUNT = 'none'

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time - Date's own ISO getter is UTC, so this
// is built from the local getters instead.
function toDatetimeLocal(iso) {
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formFromTrade(t) {
  return {
    tradedAt: toDatetimeLocal(t.traded_at),
    exitedAt: t.exited_at ? toDatetimeLocal(t.exited_at) : '',
    symbol: t.symbol,
    direction: t.direction,
    setup: t.setup ?? '',
    quantity: String(t.quantity),
    entryPrice: String(t.entry_price),
    exitPrice: t.exit_price != null ? String(t.exit_price) : '',
    stopLoss: t.stop_loss != null ? String(t.stop_loss) : '',
    target: t.target != null ? String(t.target) : '',
    idealRiskAmount: t.ideal_risk_amount != null ? String(t.ideal_risk_amount) : '',
    isOpen: t.is_open,
    result: t.result,
    resultManual: true, // reopening a saved trade shouldn't silently recompute over its stored result
    emotion: t.emotion ?? '',
    tags: t.tags ?? [],
    imageFile: null,
    accountId: t.account_id ?? null,
  }
}

const numeric = (v) => (v === '' || v == null ? null : Number(v))

const DIRECTION_OPTIONS = [
  { value: 'long', label: 'Buy (Long)' },
  { value: 'short', label: 'Sell (Short)' },
]
const RESULT_OPTIONS = [
  { value: 'profit', label: 'Profit' },
  { value: 'loss', label: 'Loss' },
  { value: 'neutral', label: 'Neutral' },
]
const EMOTION_OPTIONS = EMOTIONS.map((e) => ({ value: e, label: e }))

function TradeFormDialog({ open, onOpenChange, trade, onSaved, defaultAccountId, trades }) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const { data: backtestSettings } = useQuery({
    queryKey: ['manualBacktestSettings'],
    queryFn: getManualBacktestSettings,
  })
  const { data: accounts = [] } = useQuery({ queryKey: ['tradeAccounts'], queryFn: getTradeAccounts })
  const { data: adjustments = [] } = useQuery({
    queryKey: ['balanceAdjustments'],
    queryFn: getBalanceAdjustments,
  })

  const form = useForm({ resolver: zodResolver(tradeSchema), defaultValues: emptyForm() })

  useEffect(() => {
    if (open) form.reset(trade ? formFromTrade(trade) : emptyForm(defaultAccountId ?? null))
  }, [open, trade, defaultAccountId, form])

  // Live values the rest of the dialog reacts to (cap warnings, the auto-computed result, whether
  // the exit field is disabled). watch() re-renders on change the same way the old useState did.
  const [accountId, quantity, entryPrice, exitPrice, direction, isOpen, resultManual, result] = form.watch([
    'accountId',
    'quantity',
    'entryPrice',
    'exitPrice',
    'direction',
    'isOpen',
    'resultManual',
    'result',
  ])

  const account = accounts.find((a) => a.id === accountId) ?? null
  // Advisory caps: what this position would cost against what the account allows, and how many
  // positions are already open on it (excluding this one when editing).
  const warnings = capWarnings(account, {
    positionValue: (numeric(quantity) ?? 0) * (numeric(entryPrice) ?? 0),
    openCount: tradesForAccount(trades, accountId).filter((t) => t.is_open && t.id !== trade?.id).length,
    balance: accountBalance(
      account,
      tradesForAccount(trades, accountId),
      adjustments.filter((a) => a.account_id === accountId),
    ),
  })

  // Unlike the Bar Replay close dialog (where the exit price is fixed before the dialog opens),
  // entry/exit/quantity are all live here - so an auto-computed result would keep overwriting a
  // hand-picked one. `resultManual` latches once the user chooses, and stops the recompute.
  const computedResult = autoResult({
    direction,
    quantity: numeric(quantity),
    entry_price: numeric(entryPrice),
    exit_price: isOpen ? null : numeric(exitPrice),
  })
  const effectiveResult = resultManual ? result : computedResult

  const accountOptions = [
    { value: NO_ACCOUNT, label: 'No account' },
    ...accounts.map((a) => ({
      value: String(a.id),
      label: `${a.name}${a.strategy ? ` · ${a.strategy}` : ''}`,
    })),
  ]

  const save = useMutation({
    mutationFn: async (values) => {
      const payload = {
        symbol: values.symbol,
        direction: values.direction,
        setup: values.setup,
        quantity: values.quantity,
        entry_price: values.entryPrice,
        exit_price: values.isOpen ? null : values.exitPrice,
        stop_loss: values.stopLoss,
        target: values.target,
        ideal_risk_amount: values.idealRiskAmount,
        is_open: values.isOpen,
        result: values.isOpen ? null : values.resultManual ? values.result : computedResult,
        emotion: values.emotion || null,
        tags: values.tags,
        notes: trade?.notes ?? null,
        traded_at: values.tradedAt ? new Date(values.tradedAt).toISOString() : null,
        // Only meaningful on a closed trade; sending it for an open one would let the backend
        // measure an excursion over a position that hasn't finished.
        exited_at: !values.isOpen && values.exitedAt ? new Date(values.exitedAt).toISOString() : null,
        account_id: values.accountId,
      }
      let id
      if (trade) {
        await updateManualTrade(trade.id, payload)
        id = trade.id
      } else {
        id = (await createManualTrade(payload)).id
      }
      if (values.imageFile) await uploadManualTradeImage(id, values.imageFile)
    },
    onSuccess: () => {
      toast.success(trade ? 'Trade updated' : 'Trade added')
      onSaved()
      onOpenChange(false)
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{trade ? 'Edit trade' : 'Add trade'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit((values) => save.mutate(values))} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <TextField form={form} name="tradedAt" label="Opened" type="datetime-local" />
              <Field label="Symbol" error={form.formState.errors.symbol}>
                <Controller
                  control={form.control}
                  name="symbol"
                  render={({ field }) => (
                    <SymbolCombobox value={field.value} onChange={field.onChange} className="w-full" />
                  )}
                />
              </Field>
            </div>

            <SelectField
              form={form}
              name="accountId"
              label="Account"
              options={accountOptions}
              nullValue={NO_ACCOUNT}
              parse={Number}
            />

            {warnings.map((w) => (
              <p key={w} className="rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-600">
                {w}
              </p>
            ))}

            <div className="grid grid-cols-2 gap-2">
              <SelectField form={form} name="direction" label="Direction" options={DIRECTION_OPTIONS} />
              <TextField form={form} name="quantity" label="Quantity" type="number" min="0" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <TextField
                  form={form}
                  name="setup"
                  label="Setup"
                  list="setup-suggestions"
                  placeholder="e.g. Breakout"
                />
                <datalist id="setup-suggestions">
                  {(backtestSettings?.setups ?? []).map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <TextField
                form={form}
                name="idealRiskAmount"
                label="Ideal risk ₹"
                type="number"
                step="0.01"
                min="0"
                placeholder="Planned risk for this setup"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <TextField form={form} name="entryPrice" label="Entry ₹" type="number" step="0.01" />
              <TextField
                form={form}
                name="exitPrice"
                label={`Exit ₹${isOpen ? ' (open)' : ''}`}
                type="number"
                step="0.01"
                disabled={isOpen}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <TextField form={form} name="stopLoss" label="Stop loss ₹" type="number" step="0.01" />
              <TextField form={form} name="target" label="Target ₹" type="number" step="0.01" />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...form.register('isOpen')} />
              Trade still open (exit not required)
            </label>

            {!isOpen && (
              <TextField
                form={form}
                name="exitedAt"
                label="Closed"
                type="datetime-local"
                hint="Optional — unlocks MAE/MFE (how far the trade ran either way) in its detail view."
              />
            )}

            {!isOpen && (
              <SelectField
                form={form}
                name="result"
                label="Result"
                options={RESULT_OPTIONS}
                placeholder="—"
                // Shows the auto-computed result until the user picks one, then latches to theirs.
                value={effectiveResult}
                onSelect={() => form.setValue('resultManual', true)}
                hint={
                  resultManual
                    ? 'Set by hand — no longer follows the P&L.'
                    : `From P&L (±${inr(NEUTRAL_PNL_BAND)} of flat counts as neutral).`
                }
              />
            )}

            <SelectField
              form={form}
              name="emotion"
              label="Emotion"
              options={EMOTION_OPTIONS}
              placeholder="How did it feel?"
            />

            <TagField form={form} name="tags" label="Tags (setup, mistakes, anything)" />

            <Field label="Trade screenshot">
              <Controller
                control={form.control}
                name="imageFile"
                render={({ field }) => (
                  <>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={(e) => field.onChange(e.target.files?.[0] ?? null)}
                      className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:text-foreground"
                    />
                    {trade?.image_url && !field.value && (
                      <img
                        src={trade.image_url}
                        alt="Trade"
                        className="mt-2 max-h-32 cursor-pointer rounded-lg border"
                        onClick={() => setLightboxOpen(true)}
                      />
                    )}
                  </>
                )}
              />
            </Field>

            <Button type="submit" className="w-full" disabled={save.isPending}>
              {save.isPending && <Spinner className="size-4" />}
              {trade ? 'Save changes' : 'Add trade'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <ImageLightbox src={trade?.image_url} open={lightboxOpen} onOpenChange={setLightboxOpen} />
    </>
  )
}

// Row click opens the read-only detail view, not the edit form. Editing is one click further in
// (a button inside that modal) because reviewing a trade is the common action and editing one is
// the rare one - the old behaviour meant every glance at a trade opened a form full of live
// inputs over the top of it.
function TradesTable({ trades, onOpen, onDelete, selected, onToggleSelect, onToggleSelectAll }) {
  const [lightboxSrc, setLightboxSrc] = useState(null)
  if (trades.length === 0) {
    return <p className="text-sm text-muted-foreground">No trades match - add one above or clear filters.</p>
  }
  const allSelected = trades.length > 0 && trades.every((t) => selected.has(t.id))
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-8">
              <input
                type="checkbox"
                aria-label="Select all trades"
                checked={allSelected}
                onChange={() => onToggleSelectAll(trades)}
              />
            </TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Symbol</TableHead>
            <TableHead>Setup</TableHead>
            <TableHead>Direction</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Entry ₹</TableHead>
            <TableHead className="text-right">Exit ₹</TableHead>
            <TableHead className="text-right">Stop Loss ₹</TableHead>
            <TableHead className="text-right">Target ₹</TableHead>
            <TableHead className="text-right">P&L ₹</TableHead>
            <TableHead className="text-right">R:R</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>Emotion</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead className="text-right">Return %</TableHead>
            <TableHead>Image</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((t) => {
            const pnl = tradePnl(t)
            const rr = tradeRR(t)
            const returnPct = tradeReturnPct(t)
            const resultMeta = t.result ? RESULT_META[t.result] : null
            return (
              <TableRow key={t.id} className="cursor-pointer" onClick={() => onOpen(t)}>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${t.symbol} trade`}
                    checked={selected.has(t.id)}
                    onChange={() => onToggleSelect(t.id)}
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(t.traded_at)}</TableCell>
                <TableCell className="font-medium">{t.symbol}</TableCell>
                <TableCell className="text-muted-foreground">{t.setup || '—'}</TableCell>
                <TableCell className="capitalize">{t.direction}</TableCell>
                <TableCell className="text-right tabular-nums">{t.quantity}</TableCell>
                <TableCell className="text-right tabular-nums">{inr(t.entry_price)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {t.exit_price != null ? inr(t.exit_price) : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {t.stop_loss != null ? inr(t.stop_loss) : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {t.target != null ? inr(t.target) : '—'}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${pnl == null ? '' : pnl >= 0 ? 'text-up' : 'text-down'}`}
                >
                  {pnl == null ? '—' : inr(pnl)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{rr ?? '—'}</TableCell>
                <TableCell>
                  {t.is_open ? (
                    <Badge variant="outline">Open</Badge>
                  ) : resultMeta ? (
                    <Badge variant={resultMeta.badgeVariant}>{resultMeta.label}</Badge>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{t.emotion || '—'}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(t.tags ?? []).map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="max-w-40 truncate text-muted-foreground">{t.notes || '—'}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {returnPct == null ? '—' : `${returnPct}%`}
                </TableCell>
                <TableCell onClick={(e) => t.image_url && e.stopPropagation()}>
                  {t.image_url ? (
                    <img
                      src={t.image_url}
                      alt=""
                      className="size-8 cursor-pointer rounded object-cover"
                      onClick={() => setLightboxSrc(t.image_url)}
                    />
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${t.symbol} trade`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(t.id)
                    }}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <ImageLightbox
        src={lightboxSrc}
        open={!!lightboxSrc}
        onOpenChange={(open) => !open && setLightboxSrc(null)}
      />
    </div>
  )
}

const RISK_STATUS_LABEL = { good: 'Good risk', over: 'Over-risked', under: 'Under-risked' }
const EMPTY_FILTERS = { setup: '', session: '', riskStatus: '', minR: '', maxR: '' }

function applyFilters(trades, filters, tolerancePct) {
  const { setup, session, riskStatus: riskFilter, minR, maxR } = filters
  if (!setup && !session && !riskFilter && !minR && !maxR) return trades
  return trades.filter((t) => {
    if (setup && t.setup !== setup) return false
    if (session && sessionFor(t) !== session) return false
    if (riskFilter && riskStatus(t, tolerancePct) !== riskFilter) return false
    const r = expectedR(t)
    if (minR && (r == null || r < Number(minR))) return false
    if (maxR && (r == null || r > Number(maxR))) return false
    return true
  })
}

function FilterBar({ trades, filters, onChange }) {
  const setups = useMemo(() => [...new Set(trades.map((t) => t.setup).filter(Boolean))].sort(), [trades])
  const active = Object.values(filters).some(Boolean)
  const set = (key) => (value) => onChange({ ...filters, [key]: value })

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2">
      <Select value={filters.setup || 'all'} onValueChange={(v) => set('setup')(v === 'all' ? '' : v)}>
        <SelectTrigger size="sm" className="w-36">
          <SelectValue placeholder="Setup" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All setups</SelectItem>
          {setups.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filters.session || 'all'} onValueChange={(v) => set('session')(v === 'all' ? '' : v)}>
        <SelectTrigger size="sm" className="w-32">
          <SelectValue placeholder="Session" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sessions</SelectItem>
          {NSE_SESSIONS.map((s) => (
            <SelectItem key={s.name} value={s.name}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filters.riskStatus || 'all'}
        onValueChange={(v) => set('riskStatus')(v === 'all' ? '' : v)}
      >
        <SelectTrigger size="sm" className="w-36">
          <SelectValue placeholder="Risk discipline" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any risk sizing</SelectItem>
          {Object.entries(RISK_STATUS_LABEL).map(([key, label]) => (
            <SelectItem key={key} value={key}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="number"
        step="0.1"
        placeholder="Min R"
        value={filters.minR}
        onChange={(e) => set('minR')(e.target.value)}
        className="w-20"
      />
      <Input
        type="number"
        step="0.1"
        placeholder="Max R"
        value={filters.maxR}
        onChange={(e) => set('maxR')(e.target.value)}
        className="w-20"
      />
      {active && (
        <Button size="sm" variant="ghost" onClick={() => onChange(EMPTY_FILTERS)}>
          <XIcon className="size-3.5" />
          Clear
        </Button>
      )}
    </div>
  )
}

// Every field this needs to send back is already on the trade object the list endpoint returns
// (matches ManualTradeRequest one-to-one) - a PUT replaces the whole row, so unlike a real PATCH
// every field has to be resent, not just the ones being bulk-changed.
function toUpdatePayload(t) {
  return {
    symbol: t.symbol,
    direction: t.direction,
    setup: t.setup,
    quantity: t.quantity,
    entry_price: t.entry_price,
    exit_price: t.exit_price,
    stop_loss: t.stop_loss,
    target: t.target,
    ideal_risk_amount: t.ideal_risk_amount,
    is_open: t.is_open,
    result: t.result,
    emotion: t.emotion,
    tags: t.tags,
    notes: t.notes,
    traded_at: t.traded_at,
    account_id: t.account_id,
  }
}

function BulkEditDialog({ open, onOpenChange, trades, onSaved }) {
  const [setup, setSetup] = useState('')
  const [addTag, setAddTag] = useState('')

  useEffect(() => {
    if (open) {
      setSetup('')
      setAddTag('')
    }
  }, [open])

  const apply = useMutation({
    mutationFn: () =>
      Promise.all(
        trades.map((t) =>
          updateManualTrade(t.id, {
            ...toUpdatePayload(t),
            setup: setup.trim() ? setup.trim() : t.setup,
            tags: addTag.trim() && !t.tags.includes(addTag.trim()) ? [...t.tags, addTag.trim()] : t.tags,
          }),
        ),
      ),
    onSuccess: () => {
      toast.success(`Updated ${trades.length} trade${trades.length === 1 ? '' : 's'}`)
      onSaved()
      onOpenChange(false)
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Bulk edit {trades.length} trades</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Set setup (leave blank to skip)</label>
            <Input value={setup} onChange={(e) => setSetup(e.target.value)} placeholder="e.g. Breakout" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Add tag (leave blank to skip)</label>
            <Input value={addTag} onChange={(e) => setAddTag(e.target.value)} placeholder="e.g. reviewed" />
          </div>
          <Button
            className="w-full"
            disabled={(!setup.trim() && !addTag.trim()) || apply.isPending}
            onClick={() => apply.mutate()}
          >
            {apply.isPending && <Spinner className="size-4" />}
            Apply to {trades.length} trade{trades.length === 1 ? '' : 's'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// The selected account lives in the URL (?account=3), so a per-strategy view is shareable and
// survives a reload - same pattern as Holdings' broker picker. No selection = every account at once.
function AccountSelect({ accounts, account, onChange }) {
  return (
    <Select
      value={account == null ? ALL_ACCOUNTS : String(account)}
      onValueChange={(v) => onChange(v === ALL_ACCOUNTS ? undefined : Number(v))}
    >
      <SelectTrigger size="sm" className="w-52">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_ACCOUNTS}>All accounts</SelectItem>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={String(a.id)}>
            {a.name}
            {a.strategy ? ` · ${a.strategy}` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const ALL_ACCOUNTS = 'all'

export default function ManualBacktesting() {
  const { view, account } = useSearch({ from: '/backtesting' })
  const navigate = useNavigate({ from: '/backtesting' })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTrade, setEditingTrade] = useState(null)
  // The trade whose detail view is open. Separate from `editingTrade` rather than one shared
  // "selected trade" - opening the editor from inside the detail modal has to close one and open
  // the other, and a single piece of state can't express that transition.
  const [detailTrade, setDetailTrade] = useState(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [selected, setSelected] = useState(() => new Set())
  const queryClient = useQueryClient()

  const { data: allTrades = [] } = useQuery({ queryKey: ['manualTrades'], queryFn: getManualTrades })
  const { data: accounts = [] } = useQuery({ queryKey: ['tradeAccounts'], queryFn: getTradeAccounts })
  const { data: backtestSettings } = useQuery({
    queryKey: ['manualBacktestSettings'],
    queryFn: getManualBacktestSettings,
  })

  // Filtered in the client rather than by a per-account fetch: the list is small, the whole set is
  // already cached for the trade form's cap checks, and "All accounts" then costs nothing.
  const trades = useMemo(() => tradesForAccount(allTrades, account), [allTrades, account])
  const filteredTrades = useMemo(
    () => applyFilters(trades, filters, backtestSettings?.risk_deviation_tolerance_pct ?? 10),
    [trades, filters, backtestSettings],
  )
  const selectedTrades = useMemo(() => trades.filter((t) => selected.has(t.id)), [trades, selected])

  const remove = useMutation({
    mutationFn: deleteManualTrade,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['manualTrades'] }),
    onError: (e) => toast.error(e.message),
  })

  const openAdd = () => {
    setEditingTrade(null)
    setDialogOpen(true)
  }
  const openEdit = (trade) => {
    setDetailTrade(null)
    setEditingTrade(trade)
    setDialogOpen(true)
  }

  const toggleSelect = (id) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleSelectAll = (visibleTrades) =>
    setSelected((prev) => {
      const allSelected = visibleTrades.every((t) => prev.has(t.id))
      const next = new Set(prev)
      visibleTrades.forEach((t) => (allSelected ? next.delete(t.id) : next.add(t.id)))
      return next
    })

  return (
    <div className="space-y-4">
      <Tabs value={view} onValueChange={(next) => navigate({ search: (prev) => ({ ...prev, view: next }) })}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTab value="overview">Overview</TabsTab>
            <TabsTab value="trades">Trades</TabsTab>
            <TabsTab value="statistics">Statistics</TabsTab>
            <TabsTab value="goals">Goals</TabsTab>
            <TabsIndicator />
          </TabsList>
          <div className="flex items-center gap-2">
            <AccountSelect
              accounts={accounts}
              account={account}
              onChange={(next) => navigate({ search: (prev) => ({ ...prev, account: next }) })}
            />
            <Button size="sm" variant="outline" render={<a href="/api/manual-trades/export?format=csv" />}>
              <DownloadIcon className="size-4" />
              Export CSV
            </Button>
            <Button size="sm" variant="outline" render={<Link to="/backtest/replay" />}>
              <ClapperboardIcon className="size-4" />
              Bar Replay
            </Button>
            <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
              <ImagesIcon className="size-4" />
              Bulk Trades
            </Button>
            <Button size="sm" onClick={openAdd}>
              <PlusIcon className="size-4" />
              Add Trade
            </Button>
          </div>
        </div>
        <TabsPanel value="overview">
          <ManualOverview trades={trades} accountId={account} />
        </TabsPanel>
        <TabsPanel value="trades" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FilterBar trades={trades} filters={filters} onChange={setFilters} />
            {selected.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{selected.size} selected</span>
                <Button size="sm" variant="outline" onClick={() => setBulkEditOpen(true)}>
                  Bulk edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
            )}
          </div>
          <TradesTable
            trades={filteredTrades}
            onOpen={setDetailTrade}
            onDelete={(id) => remove.mutate(id)}
            selected={selected}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
          />
        </TabsPanel>
        <TabsPanel value="statistics">
          <ManualStatistics trades={trades} />
        </TabsPanel>
        <TabsPanel value="goals">
          <ManualGoals trades={trades} />
        </TabsPanel>
      </Tabs>

      <TradeDetailDialog
        open={!!detailTrade}
        onOpenChange={(next) => !next && setDetailTrade(null)}
        // Re-read from the live list so the modal reflects an edit made from inside it, rather
        // than the snapshot captured when the row was clicked.
        trade={detailTrade ? (allTrades.find((t) => t.id === detailTrade.id) ?? detailTrade) : null}
        onEdit={openEdit}
      />

      <TradeFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        trade={editingTrade}
        defaultAccountId={account}
        trades={allTrades}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['manualTrades'] })}
      />
      <BulkTradesDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['manualTrades'] })}
      />
      <BulkEditDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        trades={selectedTrades}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['manualTrades'] })
          setSelected(new Set())
        }}
      />
    </div>
  )
}
