// Price alerts on one symbol, for a chart: the same rows (and the same ['alerts'] query) as the
// Alerts page, so arming, dragging or deleting one on a chart is what that page shows, and back.
// Only level alerts are drawn - a moving_* alert's `price` is the size of a move, not a level.
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { inr } from '@/lib/format'
import { createAlert, deleteAlert, getAlerts, updateAlert } from '@/services/api'
import type { Alert } from '@/services/api'

export type ChartAlert = Pick<Alert, 'id' | 'condition' | 'price' | 'price2' | 'active' | 'note'> & { price: number }

/** NSE's tick: a level dropped by the pointer lands on a price that can actually trade. */
const tick = (p: number) => Math.round(p * 20) / 20

/** What the chart's right-click menu can arm at a price. The two range ones are a channel: armed
 *  as a band RANGE_HALF_WIDTH either side of the click, whose edges then drag on their own. */
export type ChartAlertKind = 'crossing' | 'crossing_up' | 'crossing_down' | 'entering_channel' | 'exiting_channel'
export const CHART_ALERT_KINDS: [ChartAlertKind, string][] = [
  ['crossing', 'Crossing'],
  ['crossing_up', 'Crossing up'],
  ['crossing_down', 'Crossing down'],
  ['entering_channel', 'Range break-in'],
  ['exiting_channel', 'Range breakout'],
]
const RANGE_HALF_WIDTH = 0.01
const KIND_TEXT: Record<ChartAlertKind, string> = {
  crossing: 'crossing',
  crossing_up: 'crossing up',
  crossing_down: 'crossing down',
  entering_channel: 'entering',
  exiting_channel: 'breaking out of',
}

export function useChartAlerts(symbol: string | null | undefined) {
  const queryClient = useQueryClient()
  const { data = [] } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => getAlerts({ limit: 200 }),
    refetchInterval: 10_000,
    enabled: !!symbol,
  })
  const alerts = useMemo(
    () =>
      data.filter(
        (a): a is Alert & { price: number } =>
          a.kind === 'price' &&
          a.symbol === symbol &&
          a.price != null &&
          !a.condition?.startsWith('moving') &&
          // what the Alerts page lists as armed or paused - a fired one-shot is history
          (a.active || !a.triggered_at),
      ),
    [data, symbol],
  )
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['alerts'] })
  const onError = (e: Error) => {
    toast.error(e.message)
    refresh()
  }

  const levels = (price: number, kind: ChartAlertKind): [number, number | null] =>
    kind.endsWith('_channel')
      ? [tick(price * (1 - RANGE_HALF_WIDTH)), tick(price * (1 + RANGE_HALF_WIDTH))]
      : [tick(price), null]
  const add = useMutation({
    mutationFn: ({ price, kind }: { price: number; kind: ChartAlertKind }) =>
      createAlert({
        symbol: symbol!,
        condition: kind,
        price: levels(price, kind)[0],
        price2: levels(price, kind)[1],
        note: null,
        trigger_mode: 'once',
        expires_at: null,
        recurring: false,
      }),
    onSuccess: (r, { price, kind }) => {
      const [lo, hi] = levels(price, kind)
      const where = hi == null ? inr(lo) : `${inr(lo)} – ${inr(hi)} (drag either edge to resize)`
      toast.success(
        `Alert armed: ${symbol} ${KIND_TEXT[kind]} ${where}${r.already_true ? ' - already true, fires on the next check' : ''}`,
      )
      refresh()
    },
    onError,
  })
  const move = useMutation({
    mutationFn: ({ id, price, which }: { id: number; price: number; which: 'price' | 'price2' }) =>
      updateAlert(id, { [which]: tick(price) }),
    // the line stays where it was dropped instead of snapping back until the refetch lands
    onMutate: ({ id, price, which }) =>
      queryClient.setQueryData<Alert[]>(['alerts'], (old) =>
        old?.map((a) => (a.id === id ? { ...a, [which]: tick(price) } : a)),
      ),
    onSuccess: refresh,
    onError,
  })
  const remove = useMutation({
    mutationFn: deleteAlert,
    onMutate: (id: number) =>
      queryClient.setQueryData<Alert[]>(['alerts'], (old) => old?.filter((a) => a.id !== id)),
    onSuccess: refresh,
    onError,
  })

  return {
    alerts: alerts as ChartAlert[],
    onAddAlert: (price: number, kind: ChartAlertKind) => add.mutate({ price, kind }),
    onMoveAlert: (id: number, price: number, which: 'price' | 'price2') => move.mutate({ id, price, which }),
    onRemoveAlert: (id: number) => remove.mutate(id),
  }
}
