// /microcaps - every company between ₹100 and ₹2,000 Cr, for shortlisting long-term ideas by hand
// (app/routers/microcaps.py). Screener.in fundamentals + Leaders' strength + NSE shareholding, one
// weekly snapshot. Filters and presets narrow it; a row opens the detail drawer (10-year
// statements, links, your thesis); up to five rows go side by side in Compare.
//
// Red flags are facts to look into - pledge, promoter selling, weak cash flow, debt, dilution,
// thin trading. Nothing here says buy.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLinkIcon, RefreshCwIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ChartButton } from '@/components/ChartModal'
import RsPill from '@/components/RsPill'
import SortTh from '@/components/SortTh'
import StockLinks from '@/components/StockLinks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { fmt } from '@/lib/format'
import { sortRows } from '@/lib/sortRows'
import type { Sort } from '@/lib/sortRows'
import { usePageTitle } from '@/lib/usePageTitle'
import { cn } from '@/lib/utils'
import ScreenerPanel from '@/ScreenerPanel'
import type { Microcap, MicrocapThesis } from '@/services/api'
import {
  deleteMicrocapThesis,
  getMicrocaps,
  getMicrocapStatus,
  getMicrocapTheses,
  refreshMicrocaps,
  saveMicrocapThesis,
} from '@/services/api'

const BATCH = 60
const COMPARE_MAX = 5

const num = (v: number | null | undefined, d = 1) => (v == null ? '—' : fmt(v, d))
const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${fmt(v, d)}%`)
const tone = (v: number | null | undefined) => (v == null || v === 0 ? '' : v > 0 ? 'text-up' : 'text-down')

// --- filters ------------------------------------------------------------------------------------

type Filters = {
  q: string
  minRoce: string
  maxPe: string
  minRs: string
  minPromoter: string
  minTurnover: string
  minQtrSales: string
  noFlags: boolean
  nseOnly: boolean
  thesisOnly: boolean
}
const EMPTY: Filters = {
  q: '',
  minRoce: '',
  maxPe: '',
  minRs: '',
  minPromoter: '',
  minTurnover: '',
  minQtrSales: '',
  noFlags: false,
  nseOnly: false,
  thesisOnly: false,
}
// Starting points, not recommendations - each is a handful of the filters below.
const BUILT_IN: { name: string; f: Partial<Filters> }[] = [
  { name: 'All', f: {} },
  { name: 'Quality compounder', f: { minRoce: '15', minPromoter: '50', minTurnover: '0.5', noFlags: true } },
  { name: 'Cheap + profitable', f: { maxPe: '15', minRoce: '12', minTurnover: '0.5' } },
  { name: 'Growing + strong', f: { minQtrSales: '20', minRs: '70', minTurnover: '0.5' } },
  { name: 'Clean books', f: { noFlags: true, nseOnly: true } },
]
const PRESETS_KEY = 'microcaps.presets'
const readPresets = (): { name: string; f: Filters }[] => {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]')
  } catch {
    return []
  }
}

const n = (s: string) => (s.trim() === '' ? null : Number(s))
function passes(r: Microcap, f: Filters, theses: Set<string>) {
  const q = f.q.trim().toUpperCase()
  if (q && !(r.symbol ?? '').includes(q) && !r.name.toUpperCase().includes(q) && r.bse_code !== q)
    return false
  const atLeast = (v: number | null, min: number | null) => min == null || (v != null && v >= min)
  const atMost = (v: number | null, max: number | null) => max == null || (v != null && v <= max && v > 0)
  return (
    atLeast(r.roce, n(f.minRoce)) &&
    atMost(r.pe, n(f.maxPe)) &&
    atLeast(r.rs, n(f.minRs)) &&
    atLeast(r.promoter_pct, n(f.minPromoter)) &&
    atLeast(r.avg_value_cr, n(f.minTurnover)) &&
    atLeast(r.qtr_sales_yoy, n(f.minQtrSales)) &&
    (!f.noFlags || r.flags.length === 0) &&
    (!f.nseOnly || !!r.symbol) &&
    (!f.thesisOnly || theses.has(r.key))
  )
}

function NumField({
  label,
  value,
  onChange,
  title,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  title?: string
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground" title={title}>
      {label}
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.-]/g, ''))}
        inputMode="decimal"
        className="h-7 w-16 px-1.5 text-xs"
      />
    </label>
  )
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-primary"
      />
      {label}
    </label>
  )
}

// --- table --------------------------------------------------------------------------------------

function Flags({ flags }: { flags: string[] }) {
  if (!flags.length) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex flex-wrap gap-1" title={flags.join('\n')}>
      {flags.map((f) => (
        <span key={f} className="rounded border border-down/40 px-1 text-[9px] whitespace-nowrap text-down">
          {f}
        </span>
      ))}
    </span>
  )
}

function Table({
  rows,
  picked,
  onPick,
  onOpen,
  open,
  theses,
}: {
  rows: Microcap[]
  picked: string[]
  onPick: (key: string) => void
  onOpen: (key: string) => void
  open: string | null
  theses: Set<string>
}) {
  const [sort, setSort] = useState<Sort>(null)
  // infinite scroll, same as Leaders: a sentinel under the last row renders the next batch
  const [shown, setShown] = useState(BATCH)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const rowsKey = `${rows.length}:${rows[0]?.key}:${rows.at(-1)?.key}`
  useEffect(() => {
    setShown(BATCH)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [rowsKey, sort])
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && setShown((x) => x + BATCH), {
      root: scrollRef.current,
      rootMargin: '200px',
    })
    io.observe(el)
    return () => io.disconnect()
  })
  const sorted = sortRows(rows, sort, {
    name: (r) => r.symbol ?? r.name,
    mcap: (r) => r.mcap_cr,
    pe: (r) => r.pe,
    roce: (r) => r.roce,
    roe: (r) => r.roe,
    qs: (r) => r.qtr_sales_yoy,
    qp: (r) => r.qtr_profit_yoy,
    prom: (r) => r.promoter_pct,
    prom4: (r) => r.promoter_chg_4q,
    fii: (r) => r.fii_pct,
    rs: (r) => r.rs,
    r12: (r) => r.r12m,
    high: (r) => r.from_high_pct,
    value: (r) => r.avg_value_cr,
    flags: (r) => r.flags.length,
  })
  const th = (label: string, k: string) => <SortTh label={label} k={k} sort={sort} onSort={setSort} />
  return (
    <div ref={scrollRef} className="max-h-[72vh] overflow-auto rounded-xl border bg-card">
      <table className="w-full min-w-[78rem] font-mono text-xs">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b text-[10px] tracking-widest text-muted-foreground uppercase">
            <th className="w-6" title="Pick up to five to compare" />
            <th className="w-6" />
            <SortTh label="Company" k="name" sort={sort} onSort={setSort} align="left" first="asc" />
            {th('Mcap ₹Cr', 'mcap')}
            {th('P/E', 'pe')}
            {th('ROCE', 'roce')}
            {th('ROE', 'roe')}
            {th('Qtr sales', 'qs')}
            {th('Qtr profit', 'qp')}
            {th('Promoter', 'prom')}
            {th('Δ 4Q', 'prom4')}
            {th('FII', 'fii')}
            {th('RS', 'rs')}
            {th('12M', 'r12')}
            {th('From 52wH', 'high')}
            {th('₹Cr/day', 'value')}
            {th('Flags', 'flags')}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={17} className="py-8 text-center text-muted-foreground">
                Nothing passes these filters.
              </td>
            </tr>
          )}
          {sorted.slice(0, shown).map((r) => (
            <tr
              key={r.key}
              onClick={() => onOpen(r.key)}
              className={cn(
                'cursor-pointer border-b border-border/40 hover:bg-muted/40',
                open === r.key && 'bg-muted/60',
              )}
            >
              <td className="py-1 pl-1" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`Compare ${r.symbol ?? r.name}`}
                  checked={picked.includes(r.key)}
                  disabled={!picked.includes(r.key) && picked.length >= COMPARE_MAX}
                  onChange={() => onPick(r.key)}
                  className="accent-primary"
                />
              </td>
              <td className="py-1">{r.symbol && <ChartButton symbol={r.symbol} />}</td>
              <td className="max-w-56 px-2 py-1">
                <span className="font-semibold">{r.symbol ?? r.bse_code}</span>
                {theses.has(r.key) && (
                  <span className="ml-1.5 rounded border border-primary/50 px-1 text-[9px] text-primary">
                    THESIS
                  </span>
                )}
                <span className="block truncate font-sans text-[11px] text-muted-foreground">{r.name}</span>
              </td>
              <td className="px-2 py-1 text-right tabular-nums">{num(r.mcap_cr, 0)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{num(r.pe)}</td>
              <td
                className={cn(
                  'px-2 py-1 text-right tabular-nums',
                  r.roce != null && r.roce >= 15 && 'text-up',
                )}
              >
                {num(r.roce)}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">{num(r.roe)}</td>
              <td className={cn('px-2 py-1 text-right tabular-nums', tone(r.qtr_sales_yoy))}>
                {pct(r.qtr_sales_yoy, 0)}
              </td>
              <td className={cn('px-2 py-1 text-right tabular-nums', tone(r.qtr_profit_yoy))}>
                {pct(r.qtr_profit_yoy, 0)}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">{num(r.promoter_pct)}</td>
              <td className={cn('px-2 py-1 text-right tabular-nums', tone(r.promoter_chg_4q))}>
                {r.promoter_chg_4q == null
                  ? '—'
                  : `${r.promoter_chg_4q >= 0 ? '+' : ''}${fmt(r.promoter_chg_4q, 2)}`}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">{num(r.fii_pct)}</td>
              <td className="px-2 py-1 text-right">{r.rs == null ? '—' : <RsPill rs={r.rs} />}</td>
              <td className={cn('px-2 py-1 text-right tabular-nums', tone(r.r12m))}>{pct(r.r12m, 0)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{pct(r.from_high_pct, 0)}</td>
              <td className="px-2 py-1 text-right text-muted-foreground tabular-nums">
                {num(r.avg_value_cr, 2)}
              </td>
              <td className="max-w-64 px-2 py-1">
                <Flags flags={r.flags} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown < sorted.length && (
        <div
          ref={sentinelRef}
          className="flex items-center justify-center gap-2 p-3 text-xs text-muted-foreground"
        >
          <Spinner className="size-3.5" /> {shown} of {sorted.length}
        </div>
      )}
    </div>
  )
}

// --- detail drawer ------------------------------------------------------------------------------

// The figures shown in the drawer and in Compare, in reading order.
const FIELDS: { k: keyof Microcap; label: string; f?: (v: number) => string }[] = [
  { k: 'price', label: 'Price ₹' },
  { k: 'mcap_cr', label: 'Market cap ₹Cr', f: (v) => fmt(v, 0) },
  { k: 'pe', label: 'P/E' },
  { k: 'pb', label: 'P/B' },
  { k: 'roce', label: 'ROCE %' },
  { k: 'roe', label: 'ROE %' },
  { k: 'opm', label: 'OPM %' },
  { k: 'div_yield', label: 'Div yield %', f: (v) => fmt(v, 2) },
  { k: 'sales_qtr_cr', label: 'Sales, latest qtr ₹Cr' },
  { k: 'qtr_sales_yoy', label: 'Qtr sales YoY %' },
  { k: 'np_qtr_cr', label: 'Profit, latest qtr ₹Cr' },
  { k: 'qtr_profit_yoy', label: 'Qtr profit YoY %' },
  { k: 'sales_cagr_3y', label: 'Sales CAGR 3y %' },
  { k: 'profit_cagr_3y', label: 'Profit CAGR 3y %' },
  { k: 'debt_equity', label: 'Debt / equity', f: (v) => fmt(v, 2) },
  { k: 'pledge_pct', label: 'Pledged %' },
  { k: 'cfo_cr', label: 'Operating cash flow ₹Cr' },
  { k: 'promoter_pct', label: 'Promoter %' },
  { k: 'promoter_chg_4q', label: 'Promoter Δ 4Q pp', f: (v) => fmt(v, 2) },
  { k: 'fii_pct', label: 'FII %' },
  { k: 'rs', label: 'RS rating', f: (v) => fmt(v, 0) },
  { k: 'r12m', label: '12M return %' },
  { k: 'from_high_pct', label: 'From 52-week high %' },
  { k: 'avg_value_cr', label: '₹Cr traded / day', f: (v) => fmt(v, 2) },
]
const show = (r: Microcap, fd: (typeof FIELDS)[number]) => {
  const v = r[fd.k] as number | null
  return v == null ? '—' : fd.f ? fd.f(v) : fmt(v, 1)
}

const SINCE_LABELS: Record<string, string> = {
  price: 'Price',
  roce: 'ROCE',
  pe: 'P/E',
  promoter_pct: 'Promoter %',
  rs: 'RS',
  mcap_cr: 'Mcap ₹Cr',
}

function ThesisEditor({ row, thesis }: { row: Microcap; thesis?: MicrocapThesis }) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState(thesis?.note ?? '')
  const [minRoce, setMinRoce] = useState(thesis?.min_roce?.toString() ?? '')
  const [maxPe, setMaxPe] = useState(thesis?.max_pe?.toString() ?? '')
  const [maxDrop, setMaxDrop] = useState(thesis?.max_promoter_drop?.toString() ?? '')
  const done = () => queryClient.invalidateQueries({ queryKey: ['microcapTheses'] })
  const save = useMutation({
    mutationFn: () =>
      saveMicrocapThesis(row.key, {
        note,
        min_roce: n(minRoce),
        max_pe: n(maxPe),
        max_promoter_drop: n(maxDrop),
      }),
    onSuccess: () => {
      done()
      toast.success(thesis ? 'Thesis updated' : `${row.symbol ?? row.name} added to your long-term list`)
    },
    onError: (e) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: () => deleteMicrocapThesis(row.key),
    onSuccess: done,
    onError: (e) => toast.error(e.message),
  })
  return (
    <section className="space-y-2 rounded-lg border p-3">
      <h3 className="text-sm font-semibold">{thesis ? 'Your thesis' : 'Add to long-term list'}</h3>
      {thesis && thesis.breaches.length > 0 && (
        <ul className="space-y-0.5 text-xs text-down">
          {thesis.breaches.map((b) => (
            <li key={b}>⚠ {b}</li>
          ))}
        </ul>
      )}
      {thesis && (
        <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-[11px]">
          {Object.entries(thesis.since).map(([k, [a, b]]) => (
            <div key={k}>
              <span className="text-muted-foreground">{SINCE_LABELS[k] ?? k}</span>{' '}
              <span className="font-mono tabular-nums">
                {a == null ? '—' : fmt(a, 1)} → {b == null ? '—' : fmt(b, 1)}
              </span>
            </div>
          ))}
          <div className="col-span-3 text-muted-foreground">
            since {new Date(thesis.created_at).toLocaleDateString()}
          </div>
        </div>
      )}
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Why this company? What has to stay true?"
        className="min-h-20 text-xs"
      />
      <p className="text-[11px] text-muted-foreground">
        Re-checked after every weekly pull. A newly broken limit, or a new results quarter, lands in Alerts.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <NumField label="ROCE ≥" value={minRoce} onChange={setMinRoce} />
        <NumField label="P/E ≤" value={maxPe} onChange={setMaxPe} />
        <NumField
          label="Promoter drop ≤"
          value={maxDrop}
          onChange={setMaxDrop}
          title="Percentage points below the promoter holding when the thesis was written"
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          {thesis ? 'Save' : 'Add'}
        </Button>
        {thesis && (
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => remove.mutate()}>
            <Trash2Icon className="size-3.5" /> Remove
          </Button>
        )}
      </div>
    </section>
  )
}

function Drawer({ row, thesis, onClose }: { row: Microcap; thesis?: MicrocapThesis; onClose: () => void }) {
  return (
    <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l bg-background shadow-2xl">
      <header className="flex items-start gap-2 border-b p-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold">
            {row.symbol ?? row.bse_code}
            {row.symbol && <ChartButton symbol={row.symbol} />}
          </p>
          <p className="truncate text-xs text-muted-foreground">{row.name}</p>
        </div>
        <a
          href={row.screener_url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          screener <ExternalLinkIcon className="size-3" />
        </a>
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}>
          <XIcon className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {row.flags.length > 0 && (
          <section>
            <h3 className="mb-1 text-xs font-semibold text-down">Red flags</h3>
            <Flags flags={row.flags} />
          </section>
        )}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {FIELDS.map((fd) => (
            <div key={fd.k} className="flex justify-between gap-2 border-b border-border/40 py-0.5">
              <dt className="text-muted-foreground">{fd.label}</dt>
              <dd className="font-mono tabular-nums">{show(row, fd)}</dd>
            </div>
          ))}
        </dl>
        <ThesisEditor key={row.key + (thesis?.created_at ?? '')} row={row} thesis={thesis} />
        {row.symbol && <StockLinks symbol={row.symbol} />}
        <ScreenerPanel symbol={row.symbol ?? row.bse_code ?? row.key} />
      </div>
    </aside>
  )
}

function Compare({ rows, onClose }: { rows: Microcap[]; onClose: () => void }) {
  return (
    <Dialog open={rows.length > 0} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Compare</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full font-mono text-xs">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b">
                <th />
                {rows.map((r) => (
                  <th key={r.key} className="px-2 py-1 text-right font-semibold">
                    {r.symbol ?? r.bse_code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FIELDS.map((fd) => (
                <tr key={fd.k} className="border-b border-border/40">
                  <td className="py-0.5 pr-2 font-sans text-muted-foreground">{fd.label}</td>
                  {rows.map((r) => (
                    <td key={r.key} className="px-2 py-0.5 text-right tabular-nums">
                      {show(r, fd)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td className="py-1 pr-2 font-sans text-muted-foreground">Flags</td>
                {rows.map((r) => (
                  <td key={r.key} className="px-2 py-1 text-right">
                    <Flags flags={r.flags} />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// --- page ---------------------------------------------------------------------------------------

export default function MicrocapsPage() {
  usePageTitle('Microcaps')
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: ['microcapStatus'],
    queryFn: getMicrocapStatus,
    // poll while a pull runs, so the table appears when it lands
    refetchInterval: (q) => (q.state.data?.running ? 5000 : false),
  })
  const snap = useQuery({ queryKey: ['microcaps', status.data?.as_of], queryFn: getMicrocaps, retry: false })
  const { data: thesisList = [] } = useQuery({ queryKey: ['microcapTheses'], queryFn: getMicrocapTheses })
  const theses = useMemo(() => new Map(thesisList.map((t) => [t.key, t])), [thesisList])
  const thesisKeys = useMemo(() => new Set(theses.keys()), [theses])

  const [f, setF] = useState<Filters>(EMPTY)
  const set =
    <K extends keyof Filters>(k: K) =>
    (v: Filters[K]) =>
      setF((p) => ({ ...p, [k]: v }))
  const [saved, setSaved] = useState(readPresets)
  const savePreset = () => {
    const name = window.prompt('Name this preset')?.trim()
    if (!name) return
    const next = [...saved.filter((p) => p.name !== name), { name, f }]
    setSaved(next)
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(next))
    } catch {}
  }
  const dropPreset = (name: string) => {
    const next = saved.filter((p) => p.name !== name)
    setSaved(next)
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(next))
    } catch {}
  }

  const all = useMemo(() => snap.data?.stocks ?? [], [snap.data])
  const rows = useMemo(() => all.filter((r) => passes(r, f, thesisKeys)), [all, f, thesisKeys])
  const [open, setOpen] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)
  const byKey = useMemo(() => new Map(all.map((r) => [r.key, r])), [all])
  const openRow = open ? byKey.get(open) : undefined

  const refresh = useMutation({
    mutationFn: refreshMicrocaps,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['microcapStatus'] })
      toast.info('Pulling the microcap universe - about 3 minutes')
    },
    onError: (e) => toast.error(e.message),
  })

  const st = status.data
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-lg font-semibold">Microcaps</h1>
        <p className="text-xs text-muted-foreground">
          {snap.data
            ? `${snap.data.count.toLocaleString()} companies · ₹${snap.data.band_cr[0]}–${snap.data.band_cr[1].toLocaleString()} Cr · as of ${snap.data.as_of}`
            : 'No snapshot yet'}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7 gap-1.5"
          disabled={st?.running || refresh.isPending || !st?.has_cookie}
          title={
            st?.has_cookie
              ? 'Pull a fresh snapshot now'
              : 'Needs a screener.in session cookie (Settings › Screener)'
          }
          onClick={() => refresh.mutate()}
        >
          {st?.running ? <Spinner className="size-3.5" /> : <RefreshCwIcon className="size-3.5" />}
          {st?.running ? 'Pulling…' : 'Refresh'}
        </Button>
      </div>
      {st && !st.has_cookie && (
        <p className="rounded-lg border border-amber-500/40 p-2 text-xs">
          Paste your screener.in <code>sessionid</code> cookie in Settings › Screener - the universe comes
          from one screener.in query that needs you signed in.
        </p>
      )}
      {st?.error && (
        <p className="rounded-lg border border-down/40 p-2 text-xs text-down">Last pull failed: {st.error}</p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {BUILT_IN.map((p) => (
          <Button
            key={p.name}
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => setF({ ...EMPTY, ...p.f })}
          >
            {p.name}
          </Button>
        ))}
        {saved.map((p) => (
          <span key={p.name} className="flex items-center">
            <Button
              size="sm"
              variant="secondary"
              className="h-7 rounded-r-none"
              onClick={() => setF({ ...EMPTY, ...p.f })}
            >
              {p.name}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-7 rounded-l-none px-1.5"
              aria-label={`Delete preset ${p.name}`}
              onClick={() => dropPreset(p.name)}
            >
              <XIcon className="size-3" />
            </Button>
          </span>
        ))}
        <Button size="sm" variant="ghost" className="h-7" onClick={savePreset}>
          Save current…
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-2">
        <Input
          value={f.q}
          onChange={(e) => set('q')(e.target.value)}
          placeholder="Symbol, name or BSE code"
          className="h-7 w-48 text-xs"
        />
        <NumField label="ROCE ≥" value={f.minRoce} onChange={set('minRoce')} />
        <NumField
          label="P/E ≤"
          value={f.maxPe}
          onChange={set('maxPe')}
          title="Loss-makers (no P/E) are left out once this is set"
        />
        <NumField label="RS ≥" value={f.minRs} onChange={set('minRs')} />
        <NumField label="Promoter ≥" value={f.minPromoter} onChange={set('minPromoter')} />
        <NumField label="Qtr sales YoY ≥" value={f.minQtrSales} onChange={set('minQtrSales')} />
        <NumField label="₹Cr/day ≥" value={f.minTurnover} onChange={set('minTurnover')} />
        <Check label="No red flags" checked={f.noFlags} onChange={set('noFlags')} />
        <Check label="NSE only" checked={f.nseOnly} onChange={set('nseOnly')} />
        <Check label={`My theses (${thesisKeys.size})`} checked={f.thesisOnly} onChange={set('thesisOnly')} />
        <span className="ml-auto text-xs text-muted-foreground">{rows.length.toLocaleString()} shown</span>
        <Button size="sm" className="h-7" disabled={picked.length < 2} onClick={() => setComparing(true)}>
          Compare {picked.length || ''}
        </Button>
        {picked.length > 0 && (
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setPicked([])}>
            Clear
          </Button>
        )}
      </div>

      {snap.isPending ? (
        <div className="flex justify-center p-8">
          <Spinner className="size-5" />
        </div>
      ) : snap.isError ? (
        <p className="p-8 text-center text-sm text-muted-foreground">
          {st?.running ? 'The first pull is running…' : 'No microcap snapshot yet - press Refresh.'}
        </p>
      ) : (
        <Table
          rows={rows}
          picked={picked}
          onPick={(k) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))}
          onOpen={setOpen}
          open={open}
          theses={thesisKeys}
        />
      )}
      <p className="text-xs text-muted-foreground">
        Fundamentals are the columns your screener.in account shows - switch more on there (any screen → Edit
        columns: Sales growth 3Years, Debt to equity, Pledged percentage, Cash from operations last year…) and
        the next pull picks them up. RS and returns cover NSE main board only.
      </p>

      {openRow && <Drawer row={openRow} thesis={theses.get(openRow.key)} onClose={() => setOpen(null)} />}
      {comparing && (
        <Compare
          rows={picked.map((k) => byKey.get(k)).filter((r): r is Microcap => !!r)}
          onClose={() => setComparing(false)}
        />
      )}
    </div>
  )
}
