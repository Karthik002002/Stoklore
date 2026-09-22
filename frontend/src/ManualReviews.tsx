import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import DatePicker from '@/components/DatePicker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { fmt, formatDate, inr } from '@/lib/format'
import { seriesFor } from '@/lib/tradeStats'
import { beforeAfter, localDay, summarize, topMistakes, tradesInPeriod } from '@/lib/tradeReview'
import type { Trade } from '@/lib/types'
import type { TradeReview, TradeReviewRequest } from '@/services/api'
import { deleteTradeReview, getTradeReviews, saveTradeReview } from '@/services/api'

// Keep / Stop / Improve / Test, and ONE evidence-based change per review. The change carries the
// date it took effect, and each card compares the trades before it with the trades after it - up
// to the next change, so two changes never get credit for each other.

const PROMPTS = [
  { key: 'keep', label: 'Keep', hint: 'What works?', tone: 'border-emerald-500/40 bg-emerald-500/[0.06]' },
  { key: 'stop', label: 'Stop', hint: 'What hurts results?', tone: 'border-red-500/40 bg-red-500/[0.06]' },
  {
    key: 'improve',
    label: 'Improve',
    hint: 'What can be executed better?',
    tone: 'border-sky-500/40 bg-sky-500/[0.06]',
  },
  {
    key: 'test',
    label: 'Test',
    hint: 'What deserves study?',
    tone: 'border-violet-500/40 bg-violet-500/[0.06]',
  },
] as const

type Draft = Omit<TradeReviewRequest, 'account_id'>

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + n)
  return localDay(d.toISOString())
}

/** Last full Monday-Sunday week, with the change starting the Monday after - the usual rhythm of a
 *  weekend review. */
function freshDraft(): Draft {
  const today = new Date()
  const sinceMonday = (today.getDay() + 6) % 7
  const thisMonday = addDays(localDay(today.toISOString()), -sinceMonday)
  const start = addDays(thisMonday, -7)
  return {
    period_start: start,
    period_end: addDays(start, 6),
    keep: '',
    stop: '',
    improve: '',
    test: '',
    change: '',
    change_from: thisMonday,
  }
}

function Numbers({ s }: { s: ReturnType<typeof summarize> }) {
  const items = [
    ['Trades', fmt(s.count, 0)],
    ['Win rate', s.winRate == null ? '—' : `${fmt(s.winRate, 1)}%`],
    ['Net P&L', inr(s.netPnl)],
    ['Avg R', s.avgR == null ? '—' : `${fmt(s.avgR, 2)}R`],
    ['Avg execution', s.avgScore == null ? '—' : `${fmt(s.avgScore, 1)}/10`],
    ['Mistake rate', s.mistakeRate == null ? '—' : `${fmt(s.mistakeRate, 1)}%`],
  ]
  return (
    <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-md border bg-card px-2 py-1.5">
          <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</dt>
          <dd className="text-sm font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** What the period's trades say - put next to the four boxes so the review is written from the
 *  numbers, not from memory. */
function Evidence({ trades }: { trades: Trade[] }) {
  const closed = trades.filter((t) => t.exit_price != null)
  const setups = seriesFor(closed, 'setup', 'netPnl')
  const mistakes = topMistakes(closed)
  if (!closed.length)
    return <p className="text-xs text-muted-foreground">No closed trades logged in this period.</p>
  return (
    <div className="space-y-2">
      <Numbers s={summarize(trades)} />
      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <p className="mb-1 font-medium">By setup</p>
          {setups.slice(0, 5).map((r) => (
            <p key={r.label} className="flex justify-between gap-2">
              <span className="truncate">
                {r.label} <span className="text-muted-foreground">×{r.count}</span>
              </span>
              <span className={`tabular-nums ${(r.value ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>
                {inr(r.value)}
              </span>
            </p>
          ))}
        </div>
        <div>
          <p className="mb-1 font-medium">Repeating mistakes</p>
          {mistakes.length === 0 ? (
            <p className="text-muted-foreground">None recorded.</p>
          ) : (
            mistakes.map((m) => (
              <p key={m.mistake} className="flex justify-between gap-2">
                <span className="truncate">
                  {m.mistake} <span className="text-muted-foreground">×{m.count}</span>
                </span>
                <span className="text-down tabular-nums">{inr(m.netPnl)}</span>
              </p>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function Compare({
  trades,
  changeFrom,
  prev,
  next,
}: {
  trades: Trade[]
  changeFrom: string
  prev: string | null
  next: string | null
}) {
  const { before, after } = beforeAfter(trades, changeFrom, prev, next)
  const rows: [string, (s: typeof before) => number | null, (v: number) => string][] = [
    ['Trades', (s) => s.count, (v) => fmt(v, 0)],
    ['Win rate', (s) => s.winRate, (v) => `${fmt(v, 1)}%`],
    ['Avg P&L', (s) => s.avgPnl, inr],
    ['Avg R', (s) => s.avgR, (v) => `${fmt(v, 2)}R`],
    ['Avg execution', (s) => s.avgScore, (v) => `${fmt(v, 1)}/10`],
    ['Mistake rate', (s) => s.mistakeRate, (v) => `${fmt(v, 1)}%`],
  ]
  const show = (v: number | null, f: (v: number) => string) => (v == null ? '—' : f(v))
  return (
    <div className="overflow-hidden rounded-lg border text-xs">
      <div className="grid grid-cols-3 border-b bg-muted/40 px-3 py-1.5 font-medium">
        <span />
        <span className="text-right">Before{prev ? ` (from ${formatDate(prev)})` : ''}</span>
        <span className="text-right">
          After{next ? ` (to ${formatDate(addDays(next, -1))})` : ' (to now)'}
        </span>
      </div>
      {rows.map(([label, of, f]) => (
        <div key={label} className="grid grid-cols-3 px-3 py-1">
          <span className="text-muted-foreground">{label}</span>
          <span className="text-right tabular-nums">{show(of(before), f)}</span>
          <span className="text-right tabular-nums">{show(of(after), f)}</span>
        </div>
      ))}
      {after.count < 20 && (
        <p className="border-t px-3 py-1.5 text-muted-foreground">
          {after.count} trade{after.count === 1 ? '' : 's'} since the change — too few to call it yet. One
          trade gives you an outcome; a sample gives you information.
        </p>
      )}
    </div>
  )
}

function ReviewDialog({
  open,
  onOpenChange,
  review,
  trades,
  accountId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  review: TradeReview | null
  trades: Trade[]
  accountId: number | null
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft>(freshDraft)
  useEffect(() => {
    if (!open) return
    setDraft(
      review
        ? {
            period_start: review.period_start,
            period_end: review.period_end,
            keep: review.keep ?? '',
            stop: review.stop ?? '',
            improve: review.improve ?? '',
            test: review.test ?? '',
            change: review.change ?? '',
            change_from: review.change_from,
          }
        : freshDraft(),
    )
  }, [open, review])
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const periodTrades = tradesInPeriod(trades, draft.period_start, draft.period_end)

  const save = useMutation({
    mutationFn: () =>
      saveTradeReview(
        {
          ...draft,
          account_id: review ? review.account_id : accountId,
          change_from: draft.change?.trim() ? draft.change_from : null,
        },
        review?.id,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tradeReviews'] })
      toast.success(review ? 'Review updated' : 'Review saved')
      onOpenChange(false)
    },
    onError: (e) => toast.error(e.message),
  })

  const invalid = !draft.period_start || !draft.period_end || draft.period_end < draft.period_start

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{review ? 'Edit review' : 'New review'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Period</span>
            <DatePicker
              value={draft.period_start}
              onChange={(v) => set({ period_start: v })}
              className="w-36"
            />
            <span className="text-muted-foreground">to</span>
            <DatePicker
              value={draft.period_end}
              onChange={(v) => set({ period_end: v })}
              min={draft.period_start}
              className="w-36"
            />
          </div>

          <Evidence trades={periodTrades} />

          <div className="grid gap-2 sm:grid-cols-2">
            {PROMPTS.map((p) => (
              <label key={p.key} className={`space-y-1 rounded-lg border p-2.5 ${p.tone}`}>
                <span className="block text-xs font-semibold">
                  {p.label}: <span className="font-normal text-muted-foreground">{p.hint}</span>
                </span>
                <Textarea
                  rows={3}
                  value={draft[p.key] ?? ''}
                  onChange={(e) => set({ [p.key]: e.target.value })}
                  className="bg-background"
                />
              </label>
            ))}
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">The one change</p>
            <Textarea
              rows={2}
              value={draft.change ?? ''}
              onChange={(e) => set({ change: e.target.value })}
              placeholder="e.g. No entries in the first 30 minutes"
            />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Takes effect from</span>
              <DatePicker
                value={draft.change_from}
                onChange={(v) => set({ change_from: v })}
                className="w-36"
                disabled={!draft.change?.trim()}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              One change at a time. If you change everything, you learn nothing — this date is where the tab
              splits your trades into before and after.
            </p>
          </div>

          <Button className="w-full" disabled={invalid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Spinner className="size-4" />}
            {review ? 'Save changes' : 'Save review'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function ManualReviews({ trades, accountId }: { trades: Trade[]; accountId: number | null }) {
  const queryClient = useQueryClient()
  const { data: allReviews = [] } = useQuery({ queryKey: ['tradeReviews'], queryFn: getTradeReviews })
  const [editing, setEditing] = useState<TradeReview | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  // Reviews belong to the scope they were written in: an account's own, or "All accounts" (null).
  const reviews = useMemo(() => allReviews.filter((r) => r.account_id === accountId), [allReviews, accountId])
  // Every dated change in this scope, oldest first - each change's comparison is bounded by its
  // neighbours.
  const changes = useMemo(
    () =>
      reviews
        .map((r) => r.change_from)
        .filter((d): d is string => !!d)
        .sort(),
    [reviews],
  )

  const remove = useMutation({
    mutationFn: deleteTradeReview,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tradeReviews'] }),
    onError: (e) => toast.error(e.message),
  })

  const openNew = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Review a period, then make one evidence-based change and see what it did.
        </p>
        <Button size="sm" onClick={openNew}>
          <PlusIcon className="size-4" /> New review
        </Button>
      </div>

      {reviews.length === 0 ? (
        <div className="rounded-xl border bg-card py-10 text-center text-sm text-muted-foreground">
          No reviews for this account yet.
        </div>
      ) : (
        reviews.map((r) => {
          const i = r.change_from ? changes.indexOf(r.change_from) : -1
          return (
            <div key={r.id} className="space-y-3 rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {formatDate(r.period_start)} – {formatDate(r.period_end)}
                  </p>
                  <p className="text-xs text-muted-foreground">Written {formatDate(r.created_at)}</p>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Edit review"
                    onClick={() => {
                      setEditing(r)
                      setDialogOpen(true)
                    }}
                  >
                    <PencilIcon className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Delete review"
                    onClick={() => {
                      if (window.confirm('Delete this review? It cannot be recovered.')) remove.mutate(r.id)
                    }}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </div>

              <Numbers s={summarize(tradesInPeriod(trades, r.period_start, r.period_end))} />

              <div className="grid gap-2 sm:grid-cols-4">
                {PROMPTS.map((p) => (
                  <div key={p.key} className={`rounded-lg border p-2.5 text-sm ${p.tone}`}>
                    <p className="text-xs font-semibold">{p.label}</p>
                    <p className="whitespace-pre-wrap">
                      {r[p.key] || <span className="text-muted-foreground">—</span>}
                    </p>
                  </div>
                ))}
              </div>

              {r.change && (
                <div className="space-y-2">
                  <p className="text-sm">
                    <span className="font-medium">Change:</span> {r.change}
                    {r.change_from && (
                      <span className="text-muted-foreground"> — from {formatDate(r.change_from)}</span>
                    )}
                  </p>
                  {r.change_from && (
                    <Compare
                      trades={trades}
                      changeFrom={r.change_from}
                      prev={i > 0 ? changes[i - 1] : null}
                      next={i >= 0 && i < changes.length - 1 ? changes[i + 1] : null}
                    />
                  )}
                </div>
              )}
            </div>
          )
        })
      )}

      <ReviewDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        review={editing}
        trades={trades}
        accountId={accountId}
      />
    </div>
  )
}
