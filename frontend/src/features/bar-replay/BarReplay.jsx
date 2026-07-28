import { useEffect, useMemo, useRef, useState } from 'react'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import {
  ActivityIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  DatabaseIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SettingsIcon,
  SkipBackIcon,
  SkipForwardIcon,
  WalletIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import SymbolCombobox from '@/components/SymbolCombobox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { inr } from '@/lib/format'
import { aggregateBars, REPLAY_SPEEDS, REPLAY_TIMEFRAMES } from '@/lib/replay'
import { usePageTitle } from '@/lib/usePageTitle'
import { collectMaxHistory, getMaxHistory, getMaxHistoryStatus } from '@/services/api'
import CloseTradeDialog from './CloseTradeDialog'
import FloatingPanel from './FloatingPanel'
import IndicatorControls from './IndicatorControls'
import OrderTicketDialog from './OrderTicketDialog'
import { processBarForOrders } from './orderEngine'
import ReplayChart from './ReplayChart'
import TradingPanel from './TradingPanel'

const numeric = (v) => (v === '' || v == null ? null : Number(v))

const FIELD_LABEL = { stopLoss: 'Stop loss', target: 'Target' }

export default function BarReplay() {
  usePageTitle('Bar Replay')
  const { symbol, timeframe, barIndex, orders } = useSearch({ from: '/backtest/replay' })
  const navigate = useNavigate({ from: '/backtest/replay' })
  const queryClient = useQueryClient()

  const setSearch = (patch) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  const setOrders = (next) => setSearch({ orders: next })
  const changeSymbol = (next) => setSearch({ symbol: next, barIndex: undefined, orders: [] })
  const changeTimeframe = (next) => setSearch({ timeframe: next, barIndex: undefined, orders: [] })

  const [startDate, setStartDate] = useState('')
  const [dateDraft, setDateDraft] = useState('')
  const [playing, setPlaying] = useState(false)
  const [speedMs, setSpeedMs] = useState(1000)
  const [indicators, setIndicators] = useState([{ key: 'default-ema20', type: 'ema', period: 20 }])
  const [orderDraft, setOrderDraft] = useState(null)
  // Auto-triggered closes (stop loss/target hit) and manual "Close" clicks both land here and
  // share the same confirm dialog, shown one at a time. An order only leaves `orders` once its
  // entry in this queue is actually confirmed - dismissing the dialog just drops the queue entry
  // and leaves the order open, so nothing is silently lost.
  const [closeQueue, setCloseQueue] = useState([])

  const wasRunning = useRef(false)
  const { data: maxHistory } = useQuery({
    queryKey: ['maxHistory', symbol],
    queryFn: () => getMaxHistory(symbol),
    enabled: !!symbol,
  })
  const { data: maxStatus } = useQuery({
    queryKey: ['maxHistoryStatus', symbol],
    queryFn: () => getMaxHistoryStatus(symbol),
    enabled: !!symbol,
    refetchInterval: (q) => (q.state.data?.running ? 1500 : false),
  })
  useEffect(() => {
    if (wasRunning.current && !maxStatus?.running)
      queryClient.invalidateQueries({ queryKey: ['maxHistory', symbol] })
    wasRunning.current = !!maxStatus?.running
  }, [maxStatus?.running, symbol, queryClient])
  const collect = useMutation({
    mutationFn: () => collectMaxHistory(symbol),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['maxHistoryStatus', symbol] }),
    onError: (e) => toast.error(e.message),
  })
  const hasMaxData = (maxHistory?.length ?? 0) > 0

  const allBars = useMemo(
    () => (maxHistory ? aggregateBars(maxHistory, timeframe) : []),
    [maxHistory, timeframe],
  )
  const started = barIndex != null && allBars.length > 0
  const currentIndex = started ? Math.min(barIndex, allBars.length - 1) : null
  const visibleBars = started ? allBars.slice(0, currentIndex + 1) : []
  const lastBar = visibleBars.length ? visibleBars[visibleBars.length - 1] : null
  const atEnd = started && currentIndex >= allBars.length - 1

  const setBarIndex = (idx) => setSearch({ barIndex: idx })

  // Fresh symbol/timeframe - nothing carries over (a limit/SL/target from a different instrument
  // makes no sense), so the trigger-detection cursor and any queued closes reset too.
  const prevIndexRef = useRef(null)
  useEffect(() => {
    prevIndexRef.current = null
    setCloseQueue([])
  }, [symbol, timeframe])

  // Runs trigger detection against the single newly-revealed bar whenever currentIndex advances
  // by one (the normal Step/Play case). Stepping backward, or the very first bar of a session,
  // intentionally does not (re-)trigger anything.
  useEffect(() => {
    if (currentIndex == null) {
      prevIndexRef.current = null
      return
    }
    const prev = prevIndexRef.current
    prevIndexRef.current = currentIndex
    if (prev == null || currentIndex <= prev || orders.length === 0) return
    const bar = allBars[currentIndex]
    if (!bar) return
    const { nextOrders, triggeredCloses, changed } = processBarForOrders(orders, bar, currentIndex)
    if (changed) setOrders(nextOrders)
    if (triggeredCloses.length) {
      setCloseQueue((q) => [
        ...q,
        ...triggeredCloses
          .filter((tc) => !q.some((existing) => existing.order.id === tc.order.id))
          .map((tc) => ({ order: tc.order, exitPrice: tc.exitPrice, exitDate: bar.date, reason: tc.reason })),
      ])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex])

  useEffect(() => {
    if (!playing || !started) return
    if (atEnd) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setBarIndex(currentIndex + 1), speedMs)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, currentIndex, atEnd, started, speedMs])

  const startReplay = () => {
    if (allBars.length === 0) return
    let idx = allBars.length > 1 ? Math.floor(allBars.length / 2) : 0
    if (startDate) {
      const found = allBars.findIndex((b) => b.date >= startDate)
      if (found >= 0) idx = found
    }
    setSearch({ barIndex: idx })
  }

  // Jump mid-session to any date within the collected range (Playback panel's date picker) -
  // same nearest-bar-on-or-after lookup as starting fresh, just usable once replay is running
  // too. Pauses autoplay so a jump doesn't immediately keep stepping from the new spot.
  const jumpToDate = (dateStr) => {
    if (!dateStr || allBars.length === 0) return
    const found = allBars.findIndex((b) => b.date >= dateStr)
    if (found < 0) return
    setPlaying(false)
    setBarIndex(found)
  }

  // The date field's displayed value tracks what's typed/picked immediately, but the actual
  // jump only fires on blur or the Apply button - typing a date segment-by-segment used to fire
  // onChange (and jump) after every partial edit, which felt like the replay was jumping
  // constantly while still composing a date.
  useEffect(() => {
    setDateDraft(lastBar?.date ?? '')
  }, [lastBar?.date])

  const restart = () => {
    setPlaying(false)
    setCloseQueue([])
    prevIndexRef.current = null
    setSearch({ barIndex: undefined, orders: [] })
  }

  const openOrderTicket = (direction) => {
    if (!lastBar) return
    setOrderDraft({
      direction,
      orderType: 'market',
      entryPrice: '',
      qty: '1',
      slEnabled: false,
      sl: '',
      targetEnabled: false,
      target: '',
    })
  }
  const updateDraft = (patch) => setOrderDraft((d) => (d ? { ...d, ...patch } : d))

  // ponytail: a market order fills immediately at the current (last revealed) bar's close rather
  // than TradingView's stricter next-bar-open timing - simpler, and good enough for practicing
  // entries/exits against real price action.
  const submitOrder = () => {
    if (!orderDraft || !lastBar) return
    const isLimit = orderDraft.orderType === 'limit'
    const entryPrice = isLimit ? numeric(orderDraft.entryPrice) : lastBar.close
    if (entryPrice == null) return
    const newOrder = {
      id: crypto.randomUUID(),
      type: isLimit ? 'limit' : 'market',
      status: isLimit ? 'pending' : 'open',
      direction: orderDraft.direction,
      quantity: Number(orderDraft.qty),
      entryPrice,
      stopLoss: orderDraft.slEnabled ? numeric(orderDraft.sl) : null,
      target: orderDraft.targetEnabled ? numeric(orderDraft.target) : null,
      entryBarIndex: isLimit ? null : currentIndex,
    }
    setOrders([...orders, newOrder])
    setOrderDraft(null)
  }

  // Dragging a stop-loss/target line on the chart commits here: round to paise, patch just that
  // order's field, and confirm with a toast since the change has no other visible confirmation.
  const adjustOrder = (orderId, field, price) => {
    const rounded = Math.round(price * 100) / 100
    setOrders(orders.map((o) => (o.id === orderId ? { ...o, [field]: rounded } : o)))
    toast.success(`${FIELD_LABEL[field]} updated to ${inr(rounded)}`)
  }

  const previewOrder =
    orderDraft && lastBar
      ? {
          direction: orderDraft.direction,
          entry:
            orderDraft.orderType === 'limit'
              ? (numeric(orderDraft.entryPrice) ?? lastBar.close)
              : lastBar.close,
          stop_loss: orderDraft.slEnabled ? numeric(orderDraft.sl) : null,
          target: orderDraft.targetEnabled ? numeric(orderDraft.target) : null,
        }
      : null

  const requestClose = (order) => {
    if (!lastBar) return
    setCloseQueue((q) =>
      q.some((existing) => existing.order.id === order.id)
        ? q
        : [...q, { order, exitPrice: lastBar.close, exitDate: lastBar.date, reason: 'manual' }],
    )
  }
  const activeClose = closeQueue[0] ?? null

  // 'B'/'S' shortcuts open the order ticket, same as clicking Buy/Sell - ignored automatically
  // while typing in any input/textarea (ignoreInputs defaults true for single-key hotkeys).
  const hotkeysEnabled = started && !orderDraft
  useHotkey('b', () => openOrderTicket('long'), { enabled: hotkeysEnabled })
  useHotkey('s', () => openOrderTicket('short'), { enabled: hotkeysEnabled })

  return (
    <div className="fixed inset-y-0 right-0 left-16 z-40 bg-background">
      <ReplayChart
        bars={visibleBars}
        indicators={indicators}
        orders={orders}
        previewOrder={previewOrder}
        resetKey={`${symbol}-${timeframe}`}
        onAdjustOrder={adjustOrder}
      />

      {/* Each cluster below is its own small absolutely-positioned box (explicit z-10), not one
          full-viewport wrapper - no reliance on pointer-events inheritance racing against the
          chart's own canvas layers. */}
      <div className="absolute top-4 left-4 z-10 flex w-72 flex-col gap-3">
        <Link
          to="/backtesting"
          search={{ tab: 'manual' }}
          className="flex w-fit items-center gap-1.5 rounded-full border bg-card/95 px-3 py-1.5 text-sm text-muted-foreground shadow-lg backdrop-blur-sm hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" /> Back to backtesting
        </Link>

        <FloatingPanel title="Setup" icon={SettingsIcon}>
          <SymbolCombobox value={symbol ?? ''} onChange={changeSymbol} className="w-full" />
          <Select value={timeframe} onValueChange={changeTimeframe}>
            <SelectTrigger className="w-full">
              <SelectValue>{(v) => REPLAY_TIMEFRAMES.find((t) => t.value === v)?.label ?? v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {REPLAY_TIMEFRAMES.map((t) => (
                <SelectItem key={t.value} value={t.value} disabled={!t.available}>
                  {t.label}
                  {!t.available ? ' (soon)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={!symbol || maxStatus?.running || hasMaxData}
            onClick={() => collect.mutate()}
          >
            {maxStatus?.running ? <Spinner className="size-4" /> : <DatabaseIcon className="size-4" />}
            Collect max data
          </Button>
          {symbol && !hasMaxData && (
            <p className="text-xs text-muted-foreground">
              {maxStatus?.running
                ? 'Collecting full history from NSE listing…'
                : 'Needed before replay can start.'}
            </p>
          )}
          {symbol && hasMaxData && !started && (
            <div className="space-y-2 border-t pt-2">
              <label className="text-xs text-muted-foreground">Start date</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                onClick={(e) => e.currentTarget.showPicker?.()}
                className="w-full"
              />
              <Button size="sm" className="w-full" onClick={startReplay}>
                <PlayIcon className="size-4" /> Start replay
              </Button>
              <p className="text-xs text-muted-foreground">
                Leave blank to start roughly midway through history.
              </p>
            </div>
          )}
        </FloatingPanel>

        {symbol && hasMaxData && (
          <FloatingPanel title="Indicators" icon={ActivityIcon} defaultOpen={false}>
            <IndicatorControls indicators={indicators} onChange={setIndicators} />
          </FloatingPanel>
        )}
      </div>

      {symbol && hasMaxData && started && (
        <div className="absolute top-4 right-4 z-10 w-72">
          <FloatingPanel title="Trade" icon={WalletIcon}>
            <TradingPanel
              orders={orders}
              lastBar={lastBar}
              onOpenTicket={openOrderTicket}
              onRequestClose={requestClose}
            />
          </FloatingPanel>
        </div>
      )}

      {started && (
        <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
          <FloatingPanel className="w-fit" title="Playback" icon={PlayIcon}>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Step back"
                disabled={currentIndex === 0}
                onClick={() => setBarIndex(currentIndex - 1)}
              >
                <SkipBackIcon className="size-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={playing ? 'Pause' : 'Play'}
                disabled={atEnd}
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Step forward"
                disabled={atEnd}
                onClick={() => setBarIndex(currentIndex + 1)}
              >
                <SkipForwardIcon className="size-4" />
              </Button>
              <Select value={String(speedMs)} onValueChange={(v) => setSpeedMs(Number(v))}>
                <SelectTrigger size="sm" className="w-20">
                  <SelectValue>
                    {(v) => REPLAY_SPEEDS.find((s) => String(s.value) === v)?.label ?? v}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {REPLAY_SPEEDS.map((s) => (
                    <SelectItem key={s.value} value={String(s.value)}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={dateDraft}
                min={allBars[0]?.date}
                max={allBars[allBars.length - 1]?.date}
                onChange={(e) => setDateDraft(e.target.value)}
                onBlur={() => jumpToDate(dateDraft)}
                onClick={(e) => e.currentTarget.showPicker?.()}
                className="h-7 w-32 text-xs"
                aria-label="Jump to date"
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Go to date"
                onClick={() => jumpToDate(dateDraft)}
              >
                <ArrowRightIcon className="size-3.5" />
              </Button>
              <span className="text-xs whitespace-nowrap text-muted-foreground">
                {currentIndex + 1}/{allBars.length}
              </span>
              <Button size="sm" variant="ghost" onClick={restart}>
                <RotateCcwIcon className="size-4" /> Restart
              </Button>
            </div>
          </FloatingPanel>
        </div>
      )}

      <OrderTicketDialog
        draft={orderDraft}
        onChange={updateDraft}
        onCancel={() => setOrderDraft(null)}
        onSubmit={submitOrder}
        symbol={symbol}
        lastBar={lastBar}
      />

      <CloseTradeDialog
        open={!!activeClose}
        onOpenChange={(next) => {
          if (!next) setCloseQueue((q) => q.slice(1))
        }}
        symbol={symbol}
        order={activeClose?.order ?? null}
        exitPrice={activeClose?.exitPrice}
        exitDate={activeClose?.exitDate}
        reason={activeClose?.reason}
        onClosed={() => {
          queryClient.invalidateQueries({ queryKey: ['manualTrades'] })
          const closedId = activeClose?.order.id
          setOrders(orders.filter((o) => o.id !== closedId))
          setCloseQueue((q) => q.slice(1))
        }}
      />
    </div>
  )
}
