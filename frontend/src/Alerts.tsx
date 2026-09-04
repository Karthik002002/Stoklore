// Everything being watched, and everything that has already happened.
//
// Moved out of the live-trading page, where it lived as a side panel. Two reasons it did not
// belong there: alerts run whether or not live trading is switched on (watching a level is not
// trading, and usually precedes deciding to), and a side panel has room for a level and a
// direction - not for thirteen conditions, a trigger mode and an expiry.
//
// The condition vocabulary is fetched from the backend (/api/alerts/conditions) rather than
// duplicated here, so a condition added to app/core/alerts.py appears in this picker without a
// matching edit in two places - and, more importantly, can never appear here without the engine
// knowing how to evaluate it.
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellIcon, BellRingIcon, PauseIcon, PencilIcon, PlayIcon, PlusIcon, TrashIcon } from 'lucide-react'
import { toast } from 'sonner'
import SymbolCombobox from '@/components/SymbolCombobox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime, inr, timeAgo } from '@/lib/format'
import { usePageTitle } from '@/lib/usePageTitle'
import type { Alert, AlertCondition, AlertConditionMeta, AlertCreated, AlertTrigger } from '@/services/api'
import {
  acknowledgeAlerts,
  createAlert,
  deleteAlert,
  getAlertConditions,
  getAlerts,
  updateAlert,
} from '@/services/api'

const TRIGGER_LABELS: Record<AlertTrigger, string> = {
  once: 'Only once',
  once_per_day: 'Once per day',
  every_time: 'Every time',
}

/** The form, before any of it is a number. Everything is a string because that is what an input
 *  holds; the numbers happen once, on submit. */
type Draft = {
  symbol: string
  condition: AlertCondition
  value: string
  value2: string
  trigger: AlertTrigger
  expires: string
  note: string
}

const BLANK: Draft = {
  symbol: '',
  condition: 'crossing_up',
  value: '',
  value2: '',
  trigger: 'once',
  expires: '',
  note: '',
}

const draftFrom = (alert: Alert): Draft => ({
  symbol: alert.symbol ?? '',
  condition: alert.condition ?? 'crossing_up',
  value: alert.price == null ? '' : String(alert.price),
  value2: alert.price2 == null ? '' : String(alert.price2),
  trigger: alert.trigger_mode ?? (alert.recurring ? 'every_time' : 'once'),
  // <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" with no zone on the end.
  expires: alert.expires_at ? alert.expires_at.slice(0, 16) : '',
  note: alert.note ?? '',
})

function AlertDialog({
  open,
  onOpenChange,
  editing,
  conditions,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The alert being edited, or null when arming a new one. */
  editing: Alert | null
  conditions: AlertConditionMeta[]
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft>(BLANK)
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  useEffect(() => {
    if (open) setDraft(editing ? draftFrom(editing) : BLANK)
  }, [open, editing])

  const meta = conditions.find((c) => c.value === draft.condition)
  const value = Number(draft.value)
  const value2 = Number(draft.value2)
  const complete = !!draft.symbol && value > 0 && (!meta?.channel || (value2 > 0 && value2 !== value))

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['alerts'] })
  const save = useMutation({
    // Create answers with the arming receipt (is it already true?), edit answers with the row.
    // The one thing the caller reads off either is that receipt, so the union is narrowed there.
    mutationFn: (): Promise<Alert | AlertCreated> => {
      const payload = {
        symbol: draft.symbol,
        condition: draft.condition,
        price: value,
        price2: meta?.channel ? value2 : null,
        note: draft.note || null,
        trigger_mode: draft.trigger,
        expires_at: draft.expires ? new Date(draft.expires).toISOString() : null,
        recurring: false,
      }
      return editing ? updateAlert(editing.id, payload) : createAlert(payload)
    },
    onSuccess: (data) => {
      refresh()
      onOpenChange(false)
      // An alert whose condition is already true fires on the very next sweep. That is correct,
      // and surprising enough to say out loud rather than let it look like a bug.
      const already = 'already_true' in data && data.already_true
      toast[already ? 'warning' : 'success'](
        already
          ? `Armed — but ${draft.symbol} already satisfies this, so it fires on the next sweep`
          : `Watching ${draft.symbol}`,
      )
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit alert' : 'New alert'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Symbol</p>
            <SymbolCombobox
              value={draft.symbol}
              onChange={(symbol: string) => set({ symbol })}
              className="w-full"
            />
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Condition</p>
            <Select
              value={draft.condition}
              onValueChange={(v) => set({ condition: String(v) as AlertCondition })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {conditions.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Said where it is chosen, not in a help page: a crossing is the one kind of
                condition this app can genuinely miss. */}
            {meta?.stateful && (
              <p className="text-[11px] text-muted-foreground">
                Compares against the previous check. A move that crosses and comes back within one sweep is
                invisible — use <span className="font-medium">Greater than</span> or{' '}
                <span className="font-medium">Less than</span> when being told matters more than being told at
                the instant.
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {meta?.channel ? 'Bound' : meta?.move ? (meta.percent ? 'Move %' : 'Move ₹') : 'Price'}
              </p>
              <Input
                type="number"
                step="0.05"
                value={draft.value}
                onChange={(e) => set({ value: e.target.value })}
                placeholder={meta?.percent ? '5' : '100'}
              />
            </div>
            {meta?.channel && (
              <div className="flex-1 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Other bound</p>
                <Input
                  type="number"
                  step="0.05"
                  value={draft.value2}
                  onChange={(e) => set({ value2: e.target.value })}
                  placeholder="110"
                />
              </div>
            )}
          </div>
          {meta?.move && (
            <p className="text-[11px] text-muted-foreground">
              Measured from the price when this was armed, and re-measured from wherever it last fired — not
              from the previous candle.
            </p>
          )}

          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Trigger</p>
              <Select
                value={draft.trigger}
                onValueChange={(v) => set({ trigger: String(v) as AlertTrigger })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TRIGGER_LABELS) as AlertTrigger[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {TRIGGER_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Expires</p>
              <Input
                type="datetime-local"
                value={draft.expires}
                onChange={(e) => set({ expires: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Message</p>
            <Textarea
              rows={2}
              value={draft.note}
              onChange={(e) => set({ note: e.target.value })}
              placeholder="Why you are watching this — it goes in the notification."
            />
          </div>

          <Button className="w-full" disabled={!complete || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Spinner className="size-4" />}
            {editing ? 'Save alert' : 'Arm alert'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The condition in words, mirroring app/core/alerts.py's `describe` - the table has to read the
 *  same way the notification does, and both have to say the numbers. */
function conditionText(alert: Alert, conditions: AlertConditionMeta[]) {
  const meta = conditions.find((c) => c.value === alert.condition)
  const label = meta?.label ?? alert.condition ?? '—'
  if (meta?.channel && alert.price != null && alert.price2 != null) {
    const [lo, hi] = alert.price <= alert.price2 ? [alert.price, alert.price2] : [alert.price2, alert.price]
    return `${label} ${inr(lo)}–${inr(hi)}`
  }
  if (alert.price == null) return label
  return `${label} ${meta?.percent ? `${alert.price}%` : inr(alert.price)}`
}

export default function Alerts() {
  usePageTitle('Alerts')
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Alert | null>(null)

  const { data: vocabulary } = useQuery({
    queryKey: ['alertConditions'],
    queryFn: getAlertConditions,
    staleTime: Number.POSITIVE_INFINITY,
  })
  // Polled, not pushed: the sweep runs server-side every few seconds (app/core/live.py), so the
  // browser only has to notice. A websocket for a list this short would be more moving parts than
  // the thing it delivers.
  const { data: alerts = [], isPending } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => getAlerts({ limit: 200 }),
    refetchInterval: 10_000,
  })

  const conditions = vocabulary?.conditions ?? []
  const armed = useMemo(() => alerts.filter((a) => a.kind === 'price' && a.active), [alerts])
  const paused = useMemo(
    () => alerts.filter((a) => a.kind === 'price' && !a.active && !a.triggered_at),
    [alerts],
  )
  const feed = useMemo(
    () => alerts.filter((a): a is Alert & { triggered_at: string } => Boolean(a.triggered_at)),
    [alerts],
  )
  const unread = feed.filter((a) => !a.acknowledged_at).length

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['alerts'] })
  const remove = useMutation({ mutationFn: deleteAlert, onSuccess: refresh })
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => updateAlert(id, { active }),
    onSuccess: refresh,
    onError: (e) => toast.error(e.message),
  })
  const ack = useMutation({ mutationFn: () => acknowledgeAlerts(), onSuccess: refresh })

  const openNew = () => {
    setEditing(null)
    setDialogOpen(true)
  }
  const openEdit = (alert: Alert) => {
    setEditing(alert)
    setDialogOpen(true)
  }

  const rows = [...armed, ...paused]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            {unread > 0 ? <BellRingIcon className="size-4 text-primary" /> : <BellIcon className="size-4" />}
            Alerts
            {unread > 0 && <Badge variant="default">{unread}</Badge>}
          </h1>
          <p className="text-sm text-muted-foreground">
            Checked every few seconds while the market is open. Price alerts run whether or not live trading
            is switched on.
          </p>
        </div>
        <Button size="sm" onClick={openNew}>
          <PlusIcon className="size-4" /> New alert
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Condition</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last check</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  <Spinner className="mr-2 inline size-4" /> Loading alerts…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  Nothing armed. Alerts you set show up here until they fire.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.symbol}</TableCell>
                  <TableCell>
                    {conditionText(a, conditions)}
                    {a.note && <p className="text-xs text-muted-foreground">{a.note}</p>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {TRIGGER_LABELS[a.trigger_mode ?? (a.recurring ? 'every_time' : 'once')]}
                    {a.fire_count > 0 && (
                      <span className="ml-1 text-xs">
                        · fired {a.fire_count}
                        {a.fire_count === 1 ? ' time' : ' times'}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.expires_at ? formatDateTime(a.expires_at) : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={a.active ? 'default' : 'outline'}>{a.active ? 'Armed' : 'Paused'}</Badge>
                  </TableCell>
                  {/* The last price this alert saw. On a crossing condition it is not decoration -
                      it is the other half of the comparison. */}
                  <TableCell className="text-muted-foreground tabular-nums">
                    {a.last_price == null ? '—' : inr(a.last_price)}
                    {a.last_checked_at && <span className="ml-1 text-xs">{timeAgo(a.last_checked_at)}</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={a.active ? 'Pause alert' : 'Resume alert'}
                        onClick={() => toggle.mutate({ id: a.id, active: !a.active })}
                      >
                        {a.active ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Edit alert"
                        onClick={() => openEdit(a)}
                      >
                        <PencilIcon className="size-3.5" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Delete alert"
                        onClick={() => remove.mutate(a.id)}
                      >
                        <TrashIcon className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">What happened</h2>
          {unread > 0 && (
            <Button size="sm" variant="ghost" onClick={() => ack.mutate()}>
              Mark read
            </Button>
          )}
        </div>
        {/* Fired levels and everything the broker did, in one list - see app/core/alerts.py on why
            these are not two inboxes. */}
        <div className="max-h-96 space-y-1 overflow-y-auto rounded-xl border p-1">
          {feed.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Nothing yet. Fired alerts, fills and rejections land here.
            </p>
          ) : (
            feed.map((a) => (
              <div
                key={a.id}
                className={`rounded-lg px-2 py-1.5 text-xs ${
                  a.acknowledged_at ? 'text-muted-foreground' : 'bg-muted/50'
                }`}
              >
                <span className={a.kind === 'order' ? 'font-medium' : ''}>{a.message}</span>
                <span className="ml-1.5 text-[11px] text-muted-foreground">{timeAgo(a.triggered_at)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} conditions={conditions} />
    </div>
  )
}
