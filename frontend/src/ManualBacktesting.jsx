import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { ClapperboardIcon, DownloadIcon, ImagesIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import BulkTradesDialog from './BulkTradesDialog'
import ImageLightbox from '@/components/ImageLightbox'
import SymbolCombobox from '@/components/SymbolCombobox'
import TagInput from '@/components/TagInput'
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
  NSE_SESSIONS,
  RESULT_META,
  riskStatus,
  sessionFor,
  tradePnl,
  tradeRR,
  tradeReturnPct,
} from '@/lib/manualTrades'
import {
  createManualTrade,
  deleteManualTrade,
  getManualBacktestSettings,
  getManualTrades,
  updateManualTrade,
  uploadManualTradeImage,
} from '@/services/api'
import ManualGoals from './ManualGoals'
import ManualOverview from './ManualOverview'
import ManualStatistics from './ManualStatistics'

function emptyForm() {
  return {
    tradedAt: '',
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
  }
}

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
  }
}

const numeric = (v) => (v === '' || v == null ? null : Number(v))

function TradeFormDialog({ open, onOpenChange, trade, onSaved }) {
  const [form, setForm] = useState(emptyForm)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const { data: backtestSettings } = useQuery({
    queryKey: ['manualBacktestSettings'],
    queryFn: getManualBacktestSettings,
  })

  useEffect(() => {
    if (open) setForm(trade ? formFromTrade(trade) : emptyForm())
  }, [open, trade])

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }))

  const computedResult = autoResult({
    direction: form.direction,
    quantity: numeric(form.quantity),
    entry_price: numeric(form.entryPrice),
    exit_price: form.isOpen ? null : numeric(form.exitPrice),
  })
  const effectiveResult = form.resultManual ? form.result : computedResult

  const valid =
    form.symbol.trim() &&
    numeric(form.quantity) > 0 &&
    numeric(form.entryPrice) > 0 &&
    (form.isOpen || numeric(form.exitPrice) != null)

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        symbol: form.symbol.trim().toUpperCase(),
        direction: form.direction,
        setup: form.setup.trim() || null,
        quantity: numeric(form.quantity),
        entry_price: numeric(form.entryPrice),
        exit_price: form.isOpen ? null : numeric(form.exitPrice),
        stop_loss: numeric(form.stopLoss),
        target: numeric(form.target),
        ideal_risk_amount: numeric(form.idealRiskAmount),
        is_open: form.isOpen,
        result: form.isOpen ? null : effectiveResult,
        emotion: form.emotion || null,
        tags: form.tags,
        notes: trade?.notes ?? null,
        traded_at: form.tradedAt ? new Date(form.tradedAt).toISOString() : null,
      }
      let id
      if (trade) {
        await updateManualTrade(trade.id, payload)
        id = trade.id
      } else {
        id = (await createManualTrade(payload)).id
      }
      if (form.imageFile) await uploadManualTradeImage(id, form.imageFile)
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
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Date</label>
                <Input
                  type="datetime-local"
                  value={form.tradedAt}
                  onChange={(e) => set('tradedAt')(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Symbol</label>
                <SymbolCombobox value={form.symbol} onChange={set('symbol')} className="w-full" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Direction</label>
                <Select value={form.direction} onValueChange={set('direction')}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="long">Buy (Long)</SelectItem>
                    <SelectItem value="short">Sell (Short)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Quantity</label>
                <Input
                  type="number"
                  min="0"
                  value={form.quantity}
                  onChange={(e) => set('quantity')(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Setup</label>
                <Input
                  list="setup-suggestions"
                  value={form.setup}
                  onChange={(e) => set('setup')(e.target.value)}
                  placeholder="e.g. Breakout"
                />
                <datalist id="setup-suggestions">
                  {(backtestSettings?.setups ?? []).map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Ideal risk ₹</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.idealRiskAmount}
                  onChange={(e) => set('idealRiskAmount')(e.target.value)}
                  placeholder="Planned risk for this setup"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Entry ₹</label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.entryPrice}
                  onChange={(e) => set('entryPrice')(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Exit ₹{form.isOpen ? ' (open)' : ''}</label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.exitPrice}
                  disabled={form.isOpen}
                  onChange={(e) => set('exitPrice')(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Stop loss ₹</label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.stopLoss}
                  onChange={(e) => set('stopLoss')(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Target ₹</label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.target}
                  onChange={(e) => set('target')(e.target.value)}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isOpen}
                onChange={(e) => setForm((f) => ({ ...f, isOpen: e.target.checked }))}
              />
              Trade still open (exit not required)
            </label>

            {!form.isOpen && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Result</label>
                <Select
                  value={effectiveResult ?? ''}
                  onValueChange={(v) => setForm((f) => ({ ...f, result: v, resultManual: true }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="profit">Profit</SelectItem>
                    <SelectItem value="loss">Loss</SelectItem>
                    <SelectItem value="neutral">Neutral</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Emotion</label>
              <Select value={form.emotion} onValueChange={set('emotion')}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="How did it feel?" />
                </SelectTrigger>
                <SelectContent>
                  {EMOTIONS.map((e) => (
                    <SelectItem key={e} value={e}>
                      {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Tags (setup, mistakes, anything)</label>
              <TagInput value={form.tags} onChange={set('tags')} />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Trade screenshot</label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => set('imageFile')(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:text-foreground"
              />
              {trade?.image_url && !form.imageFile && (
                <img
                  src={trade.image_url}
                  alt="Trade"
                  className="mt-2 max-h-32 cursor-pointer rounded-lg border"
                  onClick={() => setLightboxOpen(true)}
                />
              )}
            </div>

            <Button className="w-full" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Spinner className="size-4" />}
              {trade ? 'Save changes' : 'Add trade'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ImageLightbox src={trade?.image_url} open={lightboxOpen} onOpenChange={setLightboxOpen} />
    </>
  )
}

function TradesTable({ trades, onEdit, onDelete, selected, onToggleSelect, onToggleSelectAll }) {
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
              <TableRow key={t.id} className="cursor-pointer" onClick={() => onEdit(t)}>
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

export default function ManualBacktesting() {
  const { view } = useSearch({ from: '/backtesting' })
  const navigate = useNavigate({ from: '/backtesting' })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTrade, setEditingTrade] = useState(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [selected, setSelected] = useState(() => new Set())
  const queryClient = useQueryClient()

  const { data: trades = [] } = useQuery({ queryKey: ['manualTrades'], queryFn: getManualTrades })
  const { data: backtestSettings } = useQuery({
    queryKey: ['manualBacktestSettings'],
    queryFn: getManualBacktestSettings,
  })

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
      <Tabs value={view} onValueChange={(next) => navigate({ search: { view: next } })}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTab value="overview">Overview</TabsTab>
            <TabsTab value="trades">Trades</TabsTab>
            <TabsTab value="statistics">Statistics</TabsTab>
            <TabsTab value="goals">Goals</TabsTab>
            <TabsIndicator />
          </TabsList>
          <div className="flex items-center gap-2">
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
          <ManualOverview trades={trades} />
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
            onEdit={openEdit}
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

      <TradeFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        trade={editingTrade}
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
