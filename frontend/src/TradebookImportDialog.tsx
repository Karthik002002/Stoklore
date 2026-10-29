// Import a broker tradebook CSV into the journal (POST /api/manual-trades/import/*, see
// app/core/tradebook.py). Pick the file, see exactly what it would write - new round trips, what's
// already in, positions still open, fills it won't guess about - then Import. Nothing is written
// until then, and importing the same file again adds nothing.
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileUpIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { fmt, inr } from '@/lib/format'
import type { TradeAccount } from '@/lib/types'
import { cn } from '@/lib/utils'
import type { TradebookPreview, TradebookTrade } from '@/services/api'
import { commitTradebook, previewTradebook } from '@/services/api'

const BROKERS: Record<string, string> = {
  zerodha: 'Zerodha',
  groww: 'Groww',
  upstox: 'Upstox',
  angelone: 'Angel One',
}
const NONE = 'none'
const when = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

function TradeRows({ rows, open }: { rows: TradebookTrade[]; open?: boolean }) {
  return (
    <table className="w-full font-mono text-xs">
      <thead className="sticky top-0 bg-background text-[10px] text-muted-foreground uppercase">
        <tr className="border-b">
          <th className="py-1 text-left font-medium">Symbol</th>
          <th className="text-left font-medium">Side</th>
          <th className="text-right font-medium">Qty</th>
          <th className="text-right font-medium">Entry</th>
          <th className="text-right font-medium">{open ? 'Still held' : 'Exit'}</th>
          <th className="text-right font-medium">P&L</th>
          <th className="text-right font-medium">Fills</th>
          <th className="pl-2 text-left font-medium">Entered → exited</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t, i) => {
          const pnl =
            t.exit_price == null
              ? null
              : (t.exit_price - t.entry_price) * t.quantity * (t.direction === 'long' ? 1 : -1)
          return (
            <tr key={`${t.symbol}-${t.entried_at}-${i}`} className="border-b border-border/40">
              <td className="py-1 font-semibold">{t.symbol}</td>
              <td className={t.direction === 'long' ? 'text-up' : 'text-down'}>{t.direction}</td>
              <td className="text-right tabular-nums">{fmt(t.quantity, 0)}</td>
              <td className="text-right tabular-nums">{inr(t.entry_price)}</td>
              <td className="text-right tabular-nums">
                {open ? fmt(t.remaining ?? t.quantity, 0) : t.exit_price == null ? '—' : inr(t.exit_price)}
              </td>
              <td
                className={cn('text-right tabular-nums', pnl != null && (pnl >= 0 ? 'text-up' : 'text-down'))}
              >
                {open || pnl == null ? '—' : inr(pnl)}
              </td>
              <td className="text-right tabular-nums">{t.fills}</td>
              <td className="pl-2 whitespace-nowrap text-muted-foreground">
                {when(t.entried_at)}
                {!open && ` → ${when(t.exited_at)}`}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default function TradebookImportDialog({
  open,
  onOpenChange,
  accounts,
  defaultAccount,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: TradeAccount[]
  defaultAccount: number | null
}) {
  const queryClient = useQueryClient()
  const [csv, setCsv] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [account, setAccount] = useState<number | null>(defaultAccount)
  const [preview, setPreview] = useState<TradebookPreview | null>(null)

  const reset = () => {
    setCsv(null)
    setFileName('')
    setPreview(null)
  }
  const load = useMutation({
    mutationFn: (text: string) => previewTradebook(text, account),
    onSuccess: setPreview,
    onError: (e) => {
      setPreview(null)
      toast.error(e.message)
    },
  })
  const commit = useMutation({
    mutationFn: () => commitTradebook(csv!, account),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['manualTrades'] })
      toast.success(
        r.created
          ? `${r.created} trade${r.created === 1 ? '' : 's'} imported${r.duplicates ? ` · ${r.duplicates} already in the journal` : ''}`
          : 'Nothing new - every trade in this file is already in the journal',
      )
      reset()
      onOpenChange(false)
    },
    onError: (e) => toast.error(e.message),
  })

  const pick = async (file: File | undefined) => {
    if (!file) return
    const text = await file.text()
    setFileName(file.name)
    setCsv(text)
    load.mutate(text)
  }

  const p = preview
  const skipped = p ? Object.entries(p.skipped) : []
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUpIcon className="size-4" /> Import a broker tradebook
          </DialogTitle>
          <DialogDescription>
            A tradebook CSV - Zerodha Console › Reports › Tradebook, or the trade history export from Groww,
            Upstox or Angel One. Partial fills become one trade; only cash equity is imported.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted/50">
            <FileUpIcon className="size-4" />
            {fileName || 'Choose CSV…'}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                pick(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
          <Select
            value={account == null ? NONE : String(account)}
            onValueChange={(v) => setAccount(v === NONE ? null : Number(v))}
          >
            <SelectTrigger size="sm" className="w-56" title="The journal account the trades are filed under">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No account</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {load.isPending && <Spinner className="size-4" />}
        </div>

        {p && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {BROKERS[p.broker] ?? 'Unrecognised broker - read by column names'} · {p.fills} fills ·{' '}
              <span className="font-medium text-foreground">{p.trades.length} new trades</span>
              {p.duplicates > 0 && ` · ${p.duplicates} already in the journal`}
              {p.open.length > 0 && ` · ${p.open.length} still open`}
              {p.ambiguous.length > 0 && (
                <span className="text-amber-600 dark:text-amber-400"> · {p.ambiguous.length} need you</span>
              )}
              {skipped.map(([why, n]) => ` · ${n} skipped (${why})`)}
            </p>

            {p.trades.length > 0 && (
              <section>
                <h3 className="mb-1 text-xs font-semibold">Will be imported</h3>
                <div className="max-h-64 overflow-y-auto rounded-md border px-2">
                  <TradeRows rows={p.trades} />
                </div>
              </section>
            )}
            {p.ambiguous.length > 0 && (
              <section>
                <h3 className="mb-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  Not imported - the file doesn't say what happened
                </h3>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2 text-xs">
                  {p.ambiguous.map((a, i) => (
                    <li key={i}>
                      <span className="font-mono font-semibold">{a.symbol}</span>{' '}
                      <span className="font-mono text-muted-foreground">
                        {a.side ?? a.direction} {fmt(a.quantity, 0)}
                        {a.price != null && ` @ ${inr(a.price)}`} · {when(a.at ?? a.entried_at)}
                      </span>{' '}
                      - {a.reason}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {p.open.length > 0 && (
              <section>
                <h3 className="mb-1 text-xs font-semibold text-muted-foreground">
                  Still open at the end of the file - imported once a later file covers the exit
                </h3>
                <div className="max-h-40 overflow-y-auto rounded-md border px-2">
                  <TradeRows rows={p.open} open />
                </div>
              </section>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!p || p.trades.length === 0 || commit.isPending} onClick={() => commit.mutate()}>
            {commit.isPending ? <Spinner className="size-4" /> : <FileUpIcon className="size-4" />}
            Import {p?.trades.length || ''} trade{p?.trades.length === 1 ? '' : 's'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
