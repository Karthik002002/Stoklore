// /finance - personal net worth and money goals. Balances, not transactions: one value per item
// per month (the "Monthly update"), goals earmark shares of items, and the Focus tab lists what to
// fix first. All arithmetic is lib/goalMath.ts; the backend only stores (app/routers/finance.py).
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { toast } from 'sonner'
import { FileUpIcon, LinkIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import AllocationDonut from '@/components/AllocationDonut'
import SeriesChart from '@/components/charts/SeriesChart'
import { chartTime, seriesColor } from '@/components/charts/colors'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { formatDate, inr } from '@/lib/format'
import type {
  AssetClass,
  FinGoal,
  FinItem,
  FinKind,
  FinSettings,
  GoalCategory,
  GoalStatus,
  SavingsPlan,
} from '@/lib/goalMath'
import {
  KIND_DEFAULTS,
  avgCashflow,
  focus,
  goalProgress,
  isLiability,
  latestValues,
  netWorth,
  netWorthSeries,
  projectSavings,
  requiredMonthly,
  simulateSavings,
} from '@/lib/goalMath'
import { accountBalance, tradesForAccount } from '@/lib/tradeAccounts'
import { usePageTitle } from '@/lib/usePageTitle'
import { cn } from '@/lib/utils'
import type { CasImportResult, FinanceData, FinGoalInput, FinItemInput } from '@/services/api'
import {
  deleteFinCashflow,
  deleteFinGoal,
  deleteFinItem,
  getBalanceAdjustments,
  getFinance,
  getManualTrades,
  getTradeAccounts,
  importCas,
  linkTradeAccount,
  saveFinGoal,
  saveFinItem,
  saveFinSettings,
  saveMonthlyUpdate,
} from '@/services/api'

const today = () => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD, local
const num = (s: string) => (s.trim() === '' ? 0 : Number(s))

const ASSET_CLASSES: { value: AssetClass; label: string }[] = [
  { value: 'equity', label: 'Equity' },
  { value: 'debt', label: 'Debt' },
  { value: 'gold', label: 'Gold' },
  { value: 'cash', label: 'Cash' },
  { value: 'real_estate', label: 'Real estate' },
  { value: 'other', label: 'Other' },
]
const CATEGORIES: { value: GoalCategory; label: string }[] = [
  { value: 'emergency', label: 'Emergency fund' },
  { value: 'savings', label: 'Savings' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'lifestyle', label: 'Lifestyle' },
  { value: 'retirement', label: 'Retirement' },
  { value: 'other', label: 'Other' },
]
const STATUS_TONE: Record<GoalStatus, string> = {
  done: 'text-up',
  'on-track': 'text-up',
  'at-risk': 'text-amber-600 dark:text-amber-400',
  'off-track': 'text-down',
  overdue: 'text-down',
}

function useFinanceMutation<T>(fn: (arg: T) => Promise<unknown>, success: string, after?: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance'] })
      toast.success(success)
      after?.()
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

function Card({
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
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-xl font-semibold tabular-nums',
          tone === 'up' && 'text-up',
          tone === 'down' && 'text-down',
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  )
}

function Choice<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// --- Items -----------------------------------------------------------------------------------------

function ItemDialog({ item, onClose }: { item: FinItem | 'new'; onClose: () => void }) {
  const existing = item === 'new' ? null : item
  const [form, setForm] = useState<FinItemInput>(
    existing ?? {
      name: '',
      kind: 'bank',
      asset_class: 'cash',
      is_liquid: true,
      interest_pct: null,
      archived: false,
    },
  )
  const set = (patch: Partial<FinItemInput>) => setForm((f) => ({ ...f, ...patch }))
  const save = useFinanceMutation(
    () => saveFinItem(form, existing?.id),
    existing ? 'Item updated' : 'Item added',
    onClose,
  )
  const liability = isLiability(form.kind)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit item' : 'Add item'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Name">
            <Input
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="HDFC savings"
            />
          </Field>
          <Field label="Kind">
            <Choice
              value={form.kind}
              onChange={(kind) =>
                set({
                  kind,
                  asset_class: KIND_DEFAULTS[kind].asset_class,
                  is_liquid: KIND_DEFAULTS[kind].is_liquid,
                })
              }
              options={(Object.keys(KIND_DEFAULTS) as FinKind[]).map((k) => ({
                value: k,
                label: KIND_DEFAULTS[k].label,
              }))}
            />
          </Field>
          {liability ? (
            <Field label="Interest rate % a year" hint="Used to flag expensive debt.">
              <Input
                type="number"
                step="0.1"
                value={form.interest_pct ?? ''}
                onChange={(e) => set({ interest_pct: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
          ) : (
            <>
              <Field label="Asset class">
                <Choice
                  value={form.asset_class}
                  onChange={(asset_class) => set({ asset_class })}
                  options={ASSET_CLASSES}
                />
              </Field>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={form.is_liquid}
                  onChange={(e) => set({ is_liquid: e.target.checked })}
                />
                Liquid - counts towards the emergency fund (available within a few days)
              </label>
            </>
          )}
          {existing && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={form.archived}
                onChange={(e) => set({ archived: e.target.checked })}
              />
              Archived - closed account; hidden from the monthly update, history kept. Record a final 0 first.
            </label>
          )}
        </div>
        <DialogFooter>
          <Button disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate(undefined)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Each journal account's balance right now, by account id - what a linked trade_account item is
 *  worth. Same arithmetic as the journal itself (opening + deposits - withdrawals + net P&L). */
function useTradeBalances(enabled: boolean) {
  const accounts = useQuery({ queryKey: ['tradeAccounts'], queryFn: () => getTradeAccounts(), enabled })
  const trades = useQuery({ queryKey: ['manualTrades'], queryFn: getManualTrades, enabled })
  const adjustments = useQuery({ queryKey: ['balanceAdjustments'], queryFn: getBalanceAdjustments, enabled })
  return useMemo(() => {
    const out = new Map<number, number>()
    if (!accounts.data || !trades.data || !adjustments.data)
      return { balances: out, ready: !enabled, accounts: accounts.data ?? [] }
    for (const a of accounts.data) {
      const b = accountBalance(
        a,
        tradesForAccount(trades.data, a.id),
        adjustments.data.filter((x) => x.account_id === a.id),
      )
      if (b != null) out.set(a.id, b)
    }
    return { balances: out, ready: true, accounts: accounts.data }
  }, [accounts.data, trades.data, adjustments.data, enabled])
}

function CasDialog({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [result, setResult] = useState<CasImportResult | null>(null)
  const queryClient = useQueryClient()
  const run = useMutation({
    mutationFn: () => importCas(file as File, password),
    onSuccess: (r) => {
      setResult(r)
      queryClient.invalidateQueries({ queryKey: ['finance'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import CAS statement</DialogTitle>
        </DialogHeader>
        {!result ? (
          <>
            <p className="text-xs text-muted-foreground">
              The Consolidated Account Statement PDF. CDSL/NSDL email one every month (stocks, bonds, demat
              MFs, NPS); CAMS/KFintech send every mutual fund folio on request (MF Central or camsonline.com).
              The password is usually your PAN in capitals. Neither the PDF nor the password is stored.
            </p>
            <Field label="CAS PDF">
              <Input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Field>
            <Field label="PDF password">
              <Input
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button disabled={!file || !password || run.isPending} onClick={() => run.mutate()}>
                {run.isPending ? <Spinner /> : 'Import'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <div className="space-y-2 text-xs">
            <p>
              {result.file_type ?? 'CAS'} statement as of <b>{formatDate(result.as_of)}</b> -{' '}
              {result.imported.length} holding(s) recorded.
            </p>
            <div className="max-h-[40vh] space-y-1 overflow-y-auto">
              {result.imported.map((r) => (
                <div key={r.name} className="flex justify-between gap-2">
                  <span className="truncate">
                    {r.name}
                    {r.new && <span className="ml-1 text-up">new</span>}
                  </span>
                  <span className="tabular-nums">{inr(r.value)}</span>
                </div>
              ))}
            </div>
            {result.missing.length > 0 && (
              <p className="text-amber-600 dark:text-amber-400">
                Not in this statement: {result.missing.join(', ')}. If you sold them, set them to 0 in the
                monthly update and archive them; if they come from a different kind of CAS, ignore this.
              </p>
            )}
            {result.warnings.map((w) => (
              <p key={w} className="text-muted-foreground">
                {w}
              </p>
            ))}
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function LinkAccountsDialog({ data, onClose }: { data: FinanceData; onClose: () => void }) {
  const { accounts, balances } = useTradeBalances(true)
  const linked = new Set(data.items.filter((i) => i.source === 'trade_account').map((i) => i.external_key))
  const link = useFinanceMutation((id: number) => linkTradeAccount(id), 'Account linked')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link trading accounts</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Journal accounts that hold real money. The monthly update pre-fills them with the journal's current
          balance. Paper accounts aren't listed - simulated money isn't net worth.
        </p>
        <div className="space-y-1.5">
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 text-xs">
              <span>
                {a.name} <span className="text-muted-foreground">{inr(balances.get(a.id))}</span>
              </span>
              {linked.has(String(a.id)) ? (
                <span className="text-muted-foreground">linked</span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={link.isPending}
                  onClick={() => link.mutate(a.id)}
                >
                  Link
                </Button>
              )}
            </div>
          ))}
          {!accounts.length && <p className="text-xs text-muted-foreground">No journal accounts.</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function MonthlyUpdateDialog({ data, onClose }: { data: FinanceData; onClose: () => void }) {
  const [asOf, setAsOf] = useState(today())
  const latest = useMemo(() => latestValues(data.snapshots), [data.snapshots])
  const items = data.items.filter((i) => !i.archived)
  const hasLinked = items.some((i) => i.source === 'trade_account')
  const { balances, ready } = useTradeBalances(hasLinked)
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(items.map((i) => [i.id, String(latest.get(i.id)?.value ?? '')])),
  )
  const live = (i: FinItem) =>
    i.source === 'trade_account' ? balances.get(Number(i.external_key)) : undefined
  // Linked accounts arrive after the journal loads - fill them in once, then they're editable.
  const [filled, setFilled] = useState(false)
  if (ready && hasLinked && !filled) {
    setFilled(true)
    setValues((v) => {
      const next = { ...v }
      for (const i of items) {
        const b = live(i)
        if (b != null) next[i.id] = String(Math.max(0, b))
      }
      return next
    })
  }
  const month = `${asOf.slice(0, 7)}-01`
  const existingFlow = data.cashflow.find((c) => c.month === month)
  const [income, setIncome] = useState(String(existingFlow?.income ?? ''))
  const [expenses, setExpenses] = useState(String(existingFlow?.expenses ?? ''))
  const bad = Object.values(values).some((v) => v.trim() !== '' && !(Number(v) >= 0))
  const save = useFinanceMutation(
    () =>
      saveMonthlyUpdate({
        snapshots: items
          .filter((i) => (values[i.id] ?? '').trim() !== '')
          .map((i) => ({ item_id: i.id, as_of: asOf, value: Number(values[i.id]) })),
        cashflow:
          income.trim() || expenses.trim() ? { month, income: num(income), expenses: num(expenses) } : null,
      }),
    'Balances saved',
    onClose,
  )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Monthly update</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Pre-filled with each item's last value - change what moved. A blank row is skipped. Liabilities are
          the amount outstanding, as a positive number.
        </p>
        <Field label="As of">
          <Input type="date" value={asOf} max={today()} onChange={(e) => setAsOf(e.target.value)} />
        </Field>
        <div className="max-h-[45vh] space-y-1.5 overflow-y-auto pr-1">
          {items.map((i) => (
            <div key={i.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs">
                {i.name}
                <span className="ml-1 text-muted-foreground">· {KIND_DEFAULTS[i.kind].label}</span>
                {live(i) != null && <span className="ml-1 text-up">· live from journal</span>}
              </span>
              <Input
                className="w-36 text-right tabular-nums"
                type="number"
                min="0"
                step="any"
                value={values[i.id] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [i.id]: e.target.value }))}
              />
            </div>
          ))}
          {!items.length && <p className="text-xs text-muted-foreground">Add an item first.</p>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={`Income in ${month.slice(0, 7)}`}>
            <Input type="number" min="0" value={income} onChange={(e) => setIncome(e.target.value)} />
          </Field>
          <Field label={`Expenses in ${month.slice(0, 7)}`}>
            <Input type="number" min="0" value={expenses} onChange={(e) => setExpenses(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button disabled={bad || !asOf || save.isPending} onClick={() => save.mutate(undefined)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NetWorthTab({ data }: { data: FinanceData }) {
  const [editing, setEditing] = useState<FinItem | 'new' | null>(null)
  const [updating, setUpdating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [linking, setLinking] = useState(false)
  const remove = useFinanceMutation((id: number) => deleteFinItem(id), 'Item deleted')
  const nw = useMemo(() => netWorth(data.items, data.snapshots), [data])
  const latest = useMemo(() => latestValues(data.snapshots), [data.snapshots])
  const series = useMemo(() => netWorthSeries(data.items, data.snapshots), [data])
  const datasets = useMemo(
    () =>
      series.length < 2
        ? []
        : (['net', 'assets', 'liabilities'] as const).map((key, i) => ({
            key: key === 'net' ? 'Net worth' : key === 'assets' ? 'Assets' : 'Liabilities',
            color: seriesColor(i),
            points: series.map((p) => ({ time: chartTime(`${p.as_of}T00:00:00`), value: p[key] })),
          })),
    [series],
  )
  const lastDate = series.at(-1)?.as_of
  const prev = series.at(-2)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setUpdating(true)} disabled={!data.items.length}>
          Monthly update
        </Button>
        <Button variant="outline" onClick={() => setEditing('new')}>
          <PlusIcon /> Add item
        </Button>
        <Button variant="outline" onClick={() => setImporting(true)}>
          <FileUpIcon /> Import CAS
        </Button>
        <Button variant="outline" onClick={() => setLinking(true)}>
          <LinkIcon /> Link trading accounts
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Card
          label="Net worth"
          value={inr(Math.round(nw.net))}
          sub={
            prev
              ? `${nw.net - prev.net >= 0 ? '+' : ''}${inr(Math.round(nw.net - prev.net))} since ${formatDate(prev.as_of)}`
              : undefined
          }
          tone={nw.net >= 0 ? 'up' : 'down'}
        />
        <Card label="Assets" value={inr(Math.round(nw.assets))} />
        <Card
          label="Liabilities"
          value={inr(Math.round(nw.liabilities))}
          tone={nw.liabilities ? 'down' : undefined}
        />
        <Card
          label="Liquid"
          value={inr(Math.round(nw.liquid))}
          sub={lastDate ? `Last update ${formatDate(lastDate)}` : 'No balances yet'}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="rounded-xl border bg-card p-3">
          <p className="mb-2 text-sm font-semibold">Net worth over time</p>
          {datasets.length ? (
            <SeriesChart datasets={datasets} format={(v) => inr(Math.round(v))} />
          ) : (
            <p className="text-xs text-muted-foreground">Appears after two monthly updates.</p>
          )}
        </div>
        <AllocationDonut
          title="Allocation"
          slices={ASSET_CLASSES.map((c) => ({ label: c.label, value: nw.byClass[c.value] }))}
        />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Class</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead>As of</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((i) => {
            const s = latest.get(i.id)
            return (
              <TableRow key={i.id} className={cn(i.archived && 'opacity-50')}>
                <TableCell>
                  {i.name}
                  {i.is_liquid && <span className="ml-1 text-[11px] text-muted-foreground">liquid</span>}
                  {i.source !== 'manual' && (
                    <span className="ml-1 text-[11px] text-muted-foreground">· {i.source}</span>
                  )}
                </TableCell>
                <TableCell>{KIND_DEFAULTS[i.kind].label}</TableCell>
                <TableCell>
                  {isLiability(i.kind)
                    ? i.interest_pct
                      ? `${i.interest_pct}%`
                      : '—'
                    : ASSET_CLASSES.find((c) => c.value === i.asset_class)?.label}
                </TableCell>
                <TableCell className={cn('text-right tabular-nums', isLiability(i.kind) && 'text-down')}>
                  {s ? inr(Math.round(isLiability(i.kind) ? -s.value : s.value)) : '—'}
                </TableCell>
                <TableCell>{s ? formatDate(s.as_of) : '—'}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditing(i)} aria-label="Edit">
                    <PencilIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete"
                    onClick={() => {
                      if (
                        confirm(
                          `Delete "${i.name}" and its whole history? Archive it instead to keep the history.`,
                        )
                      )
                        remove.mutate(i.id)
                    }}
                  >
                    <Trash2Icon />
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
          {!data.items.length && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-xs text-muted-foreground">
                Add your bank accounts, investments and loans, then run a monthly update.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {editing && <ItemDialog item={editing} onClose={() => setEditing(null)} />}
      {updating && <MonthlyUpdateDialog data={data} onClose={() => setUpdating(false)} />}
      {importing && <CasDialog onClose={() => setImporting(false)} />}
      {linking && <LinkAccountsDialog data={data} onClose={() => setLinking(false)} />}
    </div>
  )
}

// --- Goals -----------------------------------------------------------------------------------------

function GoalDialog({
  goal,
  data,
  onClose,
}: {
  goal: FinGoal | 'new'
  data: FinanceData
  onClose: () => void
}) {
  const existing = goal === 'new' ? null : goal
  const [form, setForm] = useState<FinGoalInput>(
    existing ?? {
      name: '',
      category: 'savings',
      target_amount: 0,
      target_date: `${new Date().getFullYear() + 3}-12-31`,
      priority: 3,
      expected_return_pct: 7,
      monthly_contribution: 0,
      funding: [],
      notes: null,
    },
  )
  const set = (patch: Partial<FinGoalInput>) => setForm((f) => ({ ...f, ...patch }))
  const pctOf = (id: number) => form.funding.find((f) => f.item_id === id)?.pct
  const setPct = (id: number, pct: number) =>
    set({
      funding: [
        ...form.funding.filter((f) => f.item_id !== id),
        ...(pct > 0 ? [{ item_id: id, pct: Math.min(100, pct) }] : []),
      ],
    })
  const latest = useMemo(() => latestValues(data.snapshots), [data.snapshots])
  const preview = goalProgress({ ...form, id: 0 }, latest, today())
  const save = useFinanceMutation(
    () => saveFinGoal(form, existing?.id),
    existing ? 'Goal updated' : 'Goal added',
    onClose,
  )
  const assets = data.items.filter((i) => !isLiability(i.kind) && !i.archived)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit goal' : 'Add goal'}</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[65vh] gap-3 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name">
              <Input
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Car down payment"
              />
            </Field>
            <Field label="Category">
              <Choice value={form.category} onChange={(category) => set({ category })} options={CATEGORIES} />
            </Field>
            <Field label="Target ₹ (in today's money is fine)">
              <Input
                type="number"
                min="0"
                value={form.target_amount || ''}
                onChange={(e) => set({ target_amount: num(e.target.value) })}
              />
            </Field>
            <Field label="Target date">
              <Input
                type="date"
                value={form.target_date}
                onChange={(e) => set({ target_date: e.target.value })}
              />
            </Field>
            <Field label="Priority (1 = most important)">
              <Choice
                value={String(form.priority)}
                onChange={(p) => set({ priority: Number(p) })}
                options={['1', '2', '3', '4', '5'].map((p) => ({ value: p, label: p }))}
              />
            </Field>
            <Field label="Expected return % a year" hint="FD ~7, equity MF ~11 - be conservative.">
              <Input
                type="number"
                step="0.5"
                value={form.expected_return_pct}
                onChange={(e) => set({ expected_return_pct: num(e.target.value) })}
              />
            </Field>
            <Field label="Planned monthly SIP ₹">
              <Input
                type="number"
                min="0"
                value={form.monthly_contribution || ''}
                onChange={(e) => set({ monthly_contribution: num(e.target.value) })}
              />
            </Field>
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">
              Funded from - share of each item earmarked for this goal
            </p>
            <div className="space-y-1.5">
              {assets.map((i) => (
                <div key={i.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {i.name}
                    <span className="ml-1 text-muted-foreground">
                      {inr(Math.round(latest.get(i.id)?.value ?? 0))}
                    </span>
                  </span>
                  <Input
                    className="w-20 text-right"
                    type="number"
                    min="0"
                    max="100"
                    placeholder="0"
                    value={pctOf(i.id) ?? ''}
                    onChange={(e) => setPct(i.id, num(e.target.value))}
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
              ))}
            </div>
          </div>
          {form.target_amount > 0 && (
            <p className="rounded-lg bg-muted p-2 text-xs">
              Funded {inr(Math.round(preview.funded))} · needs{' '}
              <b>
                {inr(
                  Math.round(
                    requiredMonthly(
                      form.target_amount,
                      preview.funded,
                      form.expected_return_pct,
                      preview.months,
                    ),
                  ),
                )}
              </b>
              {preview.months > 0 ? `/month for ${preview.months} months` : ' now'} · projected{' '}
              {inr(Math.round(preview.projected))} ·{' '}
              <span className={STATUS_TONE[preview.status]}>{preview.status}</span>
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            disabled={!form.name.trim() || !(form.target_amount > 0) || !form.target_date || save.isPending}
            onClick={() => save.mutate(undefined)}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GoalsTab({ data }: { data: FinanceData }) {
  const [editing, setEditing] = useState<FinGoal | 'new' | null>(null)
  const remove = useFinanceMutation((id: number) => deleteFinGoal(id), 'Goal deleted')
  const latest = useMemo(() => latestValues(data.snapshots), [data.snapshots])
  const t = today()
  return (
    <div className="space-y-4">
      <Button onClick={() => setEditing('new')}>
        <PlusIcon /> Add goal
      </Button>
      <div className="grid gap-3 md:grid-cols-2">
        {data.goals.map((g) => {
          const p = goalProgress(g, latest, t)
          return (
            <div key={g.id} className="space-y-2 rounded-xl border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{g.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {CATEGORIES.find((c) => c.value === g.category)?.label} · P{g.priority} · by{' '}
                    {formatDate(g.target_date)}
                  </p>
                </div>
                <div className="flex items-center">
                  <span className={cn('mr-1 text-xs font-medium', STATUS_TONE[p.status])}>{p.status}</span>
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditing(g)} aria-label="Edit">
                    <PencilIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete"
                    onClick={() => confirm(`Delete goal "${g.name}"?`) && remove.mutate(g.id)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary" style={{ width: `${p.pct * 100}%` }} />
              </div>
              <p className="text-xs tabular-nums">
                {inr(Math.round(p.funded))} of {inr(Math.round(g.target_amount))} ({(p.pct * 100).toFixed(0)}
                %)
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {p.months > 0 ? `${p.months} months left` : 'Date passed'} · needs{' '}
                {inr(Math.round(p.required))}
                {p.months > 0 ? '/mo' : ''} · planned {inr(g.monthly_contribution)}/mo · projected{' '}
                {inr(Math.round(p.projected))}
              </p>
            </div>
          )
        })}
      </div>
      {!data.goals.length && <p className="text-xs text-muted-foreground">No goals yet.</p>}
      {editing && <GoalDialog goal={editing} data={data} onClose={() => setEditing(null)} />}
    </div>
  )
}

// --- Focus -----------------------------------------------------------------------------------------

const LEVEL_STYLE = {
  act: 'border-l-down',
  watch: 'border-l-amber-500',
  ok: 'border-l-up',
} as const

function SettingsForm({ settings }: { settings: FinSettings }) {
  const [form, setForm] = useState(settings)
  const save = useFinanceMutation(() => saveFinSettings(form), 'Settings saved')
  const sum = form.target_equity_pct + form.target_debt_pct + form.target_gold_pct
  const fields: [keyof FinSettings, string][] = [
    ['emergency_months', 'Emergency fund, months of expenses'],
    ['target_equity_pct', 'Target equity %'],
    ['target_debt_pct', 'Target debt & cash %'],
    ['target_gold_pct', 'Target gold %'],
  ]
  return (
    <div className="space-y-2 rounded-xl border bg-card p-3">
      <p className="text-sm font-semibold">Targets</p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {fields.map(([key, label]) => (
          <Field key={key} label={label}>
            <Input
              type="number"
              min="0"
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: num(e.target.value) }))}
            />
          </Field>
        ))}
      </div>
      {sum !== 100 && <p className="text-xs text-down">Allocation targets add up to {sum}%, not 100%.</p>}
      <Button size="sm" disabled={sum !== 100 || save.isPending} onClick={() => save.mutate(undefined)}>
        Save targets
      </Button>
    </div>
  )
}

function FocusTab({ data }: { data: FinanceData }) {
  const findings = useMemo(() => focus({ ...data, today: today() }), [data])
  const remove = useFinanceMutation((month: string) => deleteFinCashflow(month), 'Month removed')
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        In order: emergency fund, expensive debt, goals behind schedule, whether your surplus pays for every
        goal, then allocation. Arithmetic on your own numbers - not advice.
      </p>
      <div className="space-y-2">
        {findings.map((f) => (
          <div key={f.title} className={cn('rounded-lg border border-l-4 bg-card p-3', LEVEL_STYLE[f.level])}>
            <p className="text-sm font-medium">{f.title}</p>
            <p className="text-xs text-muted-foreground">{f.detail}</p>
          </div>
        ))}
      </div>
      <SettingsForm key={JSON.stringify(data.settings)} settings={data.settings} />
      <div className="rounded-xl border bg-card p-3">
        <p className="mb-2 text-sm font-semibold">Cash flow</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Income</TableHead>
              <TableHead className="text-right">Expenses</TableHead>
              <TableHead className="text-right">Saved</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...data.cashflow].reverse().map((c) => (
              <TableRow key={c.month}>
                <TableCell>{c.month.slice(0, 7)}</TableCell>
                <TableCell className="text-right tabular-nums">{inr(c.income)}</TableCell>
                <TableCell className="text-right tabular-nums">{inr(c.expenses)}</TableCell>
                <TableCell
                  className={cn(
                    'text-right tabular-nums',
                    c.income - c.expenses >= 0 ? 'text-up' : 'text-down',
                  )}
                >
                  {inr(c.income - c.expenses)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete"
                    onClick={() => remove.mutate(c.month)}
                  >
                    <Trash2Icon />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!data.cashflow.length && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-xs text-muted-foreground">
                  Enter income and expenses in the monthly update.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// --- Projection ------------------------------------------------------------------------------------

/** Rough annual volatility presets - what one year can swing around the expected return. */
const MIXES = [
  { label: 'FD / debt', returnPct: 7, volatilityPct: 2 },
  { label: 'Balanced (50/50)', returnPct: 9.5, volatilityPct: 9 },
  { label: 'Equity index (Nifty)', returnPct: 12, volatilityPct: 17 },
] as const
const SIM_RUNS = 2000

function ProjectionTab({ data }: { data: FinanceData }) {
  // Defaults from your own numbers: today's net worth and your average monthly surplus.
  const [plan, setPlan] = useState<SavingsPlan & { volatilityPct: number; target: number }>(() => {
    const flow = avgCashflow(data.cashflow)
    return {
      start: Math.max(0, Math.round(netWorth(data.items, data.snapshots).net)),
      monthly: Math.max(0, Math.round(flow?.surplus ?? 10000)),
      stepUpPct: 5,
      returnPct: 11,
      years: 15,
      inflationPct: 6,
      volatilityPct: 15,
      target: 0,
    }
  })
  const set = (patch: Partial<typeof plan>) => setPlan((p) => ({ ...p, ...patch }))
  const valid = plan.years >= 1 && plan.years <= 50 && plan.start >= 0 && plan.monthly >= 0
  const rows = useMemo(() => (valid ? projectSavings(plan) : []), [plan, valid])
  const sim = useMemo(
    () =>
      valid
        ? simulateSavings(plan, {
            volatilityPct: plan.volatilityPct,
            runs: SIM_RUNS,
            target: plan.target || null,
          })
        : null,
    [plan, valid],
  )
  const last = rows.at(-1)
  const lastSim = sim?.years.at(-1)
  const thisYear = new Date().getFullYear()
  const datasets = useMemo(() => {
    if (!sim || rows.length < 2) return []
    const t = (year: number) => chartTime(`${thisYear + year}-01-01T00:00:00`)
    const line = (key: string, i: number, pick: (year: number) => number) => ({
      key,
      color: seriesColor(i),
      points: rows.map((r) => ({ time: t(r.year), value: pick(r.year) })),
    })
    return [
      line('Invested', 4, (y) => rows[y].invested),
      line('Projection', 0, (y) => rows[y].value),
      line('Bad case (p10)', 3, (y) => sim.years[y].p10),
      line('Median', 1, (y) => sim.years[y].p50),
      line('Good case (p90)', 2, (y) => sim.years[y].p90),
    ]
  }, [rows, sim, thisYear])
  const numField = (key: keyof typeof plan, label: string, hint?: string, step = '1') => (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        step={step}
        min="0"
        value={plan[key]}
        onChange={(e) => set({ [key]: num(e.target.value) } as Partial<typeof plan>)}
      />
    </Field>
  )
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        "If I save this much, what do I end up with?" The <b>projection</b> assumes the same return every
        year. The <b>simulation</b> runs the plan {SIM_RUNS.toLocaleString('en-IN')} times with returns that
        swing year to year, giving a bad case (1 in 10 runs ends lower), a median and a good case. It's a
        model, not a promise. Real markets have fatter tails than this.
      </p>
      <div className="space-y-3 rounded-xl border bg-card p-3">
        <div className="flex flex-wrap gap-2">
          {MIXES.map((m) => (
            <Button
              key={m.label}
              size="sm"
              variant="outline"
              onClick={() => set({ returnPct: m.returnPct, volatilityPct: m.volatilityPct })}
            >
              {m.label}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {numField('start', 'Starting amount ₹', 'Default: your net worth')}
          {numField('monthly', 'Monthly saving ₹', 'Default: your average surplus')}
          {numField('stepUpPct', 'Raise saving by % a year', 'Salary hikes', '0.5')}
          {numField('years', 'Years')}
          {numField('returnPct', 'Expected return % a year', undefined, '0.5')}
          {numField('volatilityPct', 'Volatility % a year', 'How much a year can swing', '0.5')}
          {numField('inflationPct', 'Inflation % a year', "For 'today's money'", '0.5')}
          {numField('target', 'Target ₹ (optional)', 'Shows the chance of reaching it')}
        </div>
        {!valid && <p className="text-xs text-down">Years must be 1-50 and amounts non-negative.</p>}
      </div>
      {last && lastSim && sim && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Card
              label={`After ${plan.years} years`}
              value={inr(Math.round(last.value))}
              sub={`${inr(Math.round(last.real))} in today's money`}
              tone="up"
            />
            <Card
              label="You put in"
              value={inr(Math.round(last.invested))}
              sub={`Growth ${inr(Math.round(last.value - last.invested))}`}
            />
            <Card
              label="Simulated range (p10 – p90)"
              value={`${inr(Math.round(lastSim.p10))} – ${inr(Math.round(lastSim.p90))}`}
              sub={`Median ${inr(Math.round(lastSim.p50))}`}
            />
            <Card
              label={
                sim.successRate != null
                  ? 'Chance of reaching target'
                  : 'Chance of ending below what you put in'
              }
              value={`${(((sim.successRate ?? sim.lossRate) as number) * 100).toFixed(0)}%`}
              sub={
                sim.successRate != null
                  ? `${(sim.lossRate * 100).toFixed(0)}% of runs end below what you put in`
                  : 'Set a target to see the chance of reaching it'
              }
              tone={sim.successRate != null ? (sim.successRate >= 0.7 ? 'up' : 'down') : undefined}
            />
          </div>
          <div className="rounded-xl border bg-card p-3">
            <p className="mb-2 text-sm font-semibold">Growth over time</p>
            <SeriesChart datasets={datasets} format={(v) => inr(Math.round(v))} />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead className="text-right">Invested</TableHead>
                <TableHead className="text-right">Projection</TableHead>
                <TableHead className="text-right">Today's money</TableHead>
                <TableHead className="text-right">Bad case</TableHead>
                <TableHead className="text-right">Median</TableHead>
                <TableHead className="text-right">Good case</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(1).map((r) => (
                <TableRow key={r.year}>
                  <TableCell>
                    {r.year} <span className="text-muted-foreground">({thisYear + r.year})</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{inr(Math.round(r.invested))}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(Math.round(r.value))}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {inr(Math.round(r.real))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {inr(Math.round(sim.years[r.year].p10))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {inr(Math.round(sim.years[r.year].p50))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {inr(Math.round(sim.years[r.year].p90))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  )
}

export default function FinancePage() {
  usePageTitle('Net worth & goals')
  const { view } = useSearch({ from: '/finance' })
  const navigate = useNavigate({ from: '/finance' })
  const { data, isPending, error } = useQuery({ queryKey: ['finance'], queryFn: getFinance })
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold">Net worth & goals</h1>
        <p className="text-xs text-muted-foreground">
          One balance per account per month - no bank sync needed. Goals earmark shares of those balances.
        </p>
      </div>
      {isPending ? (
        <Spinner />
      ) : error || !data ? (
        <p className="text-sm text-down">{error?.message ?? 'Failed to load'}</p>
      ) : (
        <Tabs value={view} onValueChange={(next) => navigate({ search: { view: next } })}>
          <TabsList>
            <TabsTab value="networth">Net worth</TabsTab>
            <TabsTab value="goals">Goals</TabsTab>
            <TabsTab value="focus">Focus</TabsTab>
            <TabsTab value="projection">Projection</TabsTab>
            <TabsIndicator />
          </TabsList>
          <TabsPanel value="networth">
            <NetWorthTab data={data} />
          </TabsPanel>
          <TabsPanel value="goals">
            <GoalsTab data={data} />
          </TabsPanel>
          <TabsPanel value="focus">
            <FocusTab data={data} />
          </TabsPanel>
          <TabsPanel value="projection">
            <ProjectionTab data={data} />
          </TabsPanel>
        </Tabs>
      )}
    </div>
  )
}
