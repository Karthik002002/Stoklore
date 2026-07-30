import { useEffect, useMemo, useRef, useState } from 'react'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
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
import SourceSelect from '@/components/SourceSelect'
import SymbolCombobox from '@/components/SymbolCombobox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { inr } from '@/lib/format'
import { aggregateBars, REPLAY_SPEEDS, REPLAY_TIMEFRAMES } from '@/lib/replay'
import { useMaxHistoryCollector } from '@/lib/useMaxHistoryCollector'
import { usePageTitle } from '@/lib/usePageTitle'
import CloseTradeDialog from './CloseTradeDialog'
import FloatingPanel from './FloatingPanel'
import IndicatorControls from './IndicatorControls'
import OrderTicketDialog from './OrderTicketDialog'
import { processBarForOrders } from './orderEngine'
import ReplayChart from './ReplayChart'
import SettingsDialog from './SettingsDialog'
import { useBarReplayStore } from './store'
import TradingPanel from './TradingPanel'

const numeric = (v) => (v === '' || v == null ? null : Number(v))
const round2 = (v) => Math.round(v * 100) / 100

const FIELD_LABEL = { stopLoss: 'Stop loss', target: 'Target' }

// Identifies one queued (or already-queued) close - order id alone for a full/manual/target
// close, order+leg id for one leg of a laddered stop-loss, so two different legs of the same
// order can both be queued without the second looking like a duplicate of the first.
const closeKey = (entry) => (entry.leg ? `${entry.order.id}:${entry.leg.id}` : entry.order.id)

export default function BarReplay() {
  usePageTitle('Bar Replay')
  const queryClient = useQueryClient()

  // Session state (symbol/timeframe/bar position, orders, indicators, speed, chart settings)
  // lives in the persisted Zustand store (store.js) - see its comment for why that's the right
  // home for it instead of the URL or plain component state. Selected field-by-field (not one
  // object selector) so each setter only re-renders on its own slice changing.
  const symbol = useBarReplayStore((s) => s.symbol)
  const timeframe = useBarReplayStore((s) => s.timeframe)
  const barIndex = useBarReplayStore((s) => s.barIndex)
  const orders = useBarReplayStore((s) => s.orders)
  const indicators = useBarReplayStore((s) => s.indicators)
  const speedMs = useBarReplayStore((s) => s.speedMs)
  const chartSettings = useBarReplayStore((s) => s.settings)
  const changeSymbol = useBarReplayStore((s) => s.setSymbol)
  const changeTimeframe = useBarReplayStore((s) => s.setTimeframe)
  const setBarIndex = useBarReplayStore((s) => s.setBarIndex)
  const setOrders = useBarReplayStore((s) => s.setOrders)
  const setIndicators = useBarReplayStore((s) => s.setIndicators)
  const setSpeedMs = useBarReplayStore((s) => s.setSpeedMs)
  const setChartSettings = useBarReplayStore((s) => s.setSettings)
  const restartStore = useBarReplayStore((s) => s.restart)

  const [startDate, setStartDate] = useState('')
  const [dateDraft, setDateDraft] = useState('')
  const [playing, setPlaying] = useState(false)
  const [orderDraft, setOrderDraft] = useState(null)
  // Draw long/short tool - disabled for now, kept for later (see the commented-out wiring below).
  // 'long' | 'short' | null - armed by the Draw long/short buttons, disarmed after one drag on
  // the chart (see ReplayChart's DrawZone) or Escape. Only one tool active at a time.
  // const [drawMode, setDrawMode] = useState(null)
  // Zones dropped onto the chart by the draw tool - purely visual until clicked (see
  // convertDrawingToOrder below). Not persisted: sketches, not trades.
  // const [drawings, setDrawings] = useState([])
  // Auto-triggered closes (stop loss/target hit) and manual "Close" clicks both land here and
  // share the same confirm dialog, shown one at a time. An order only leaves `orders` once its
  // entry in this queue is actually confirmed - dismissing the dialog just drops the queue entry
  // and leaves the order open, so nothing is silently lost. Deliberately plain component state,
  // not in the persisted store - a stale confirm dialog reopening after a reload would be worse
  // than just losing track of an unconfirmed close.
  const [closeQueue, setCloseQueue] = useState([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Armed by TradingPanel's "Add stop loss"/"Add target" toggle on an already-open position -
  // { orderId, kind: 'stopLoss' | 'target' } while waiting for the next chart click to place the
  // new level there, null otherwise. Placing directly on the chart (see placeLevel below) instead
  // of a price input field - there's already a chart right there showing exactly where price is.
  const [addLevelMode, setAddLevelMode] = useState(null)
  // Imperative handle onto ReplayChart (see its captureScreenshot) - grabbing a snapshot of the
  // chart at close time isn't state the chart needs to re-render for, so a ref fits better than
  // threading a callback prop down just to call it back up.
  const replayChartRef = useRef(null)

  const {
    maxHistory,
    hasMaxData,
    status: maxStatus,
    sources,
    source,
    setSource,
    collect,
  } = useMaxHistoryCollector(symbol)

  const allBars = useMemo(
    () => (maxHistory ? aggregateBars(maxHistory, timeframe) : []),
    [maxHistory, timeframe],
  )
  const started = barIndex != null && allBars.length > 0
  const currentIndex = started ? Math.min(barIndex, allBars.length - 1) : null
  const visibleBars = started ? allBars.slice(0, currentIndex + 1) : []
  const lastBar = visibleBars.length ? visibleBars[visibleBars.length - 1] : null
  const atEnd = started && currentIndex >= allBars.length - 1

  // Fresh symbol/timeframe - nothing carries over (a limit/SL/target from a different instrument
  // makes no sense), so the trigger-detection cursor and any queued closes reset too.
  const prevIndexRef = useRef(null)
  useEffect(() => {
    prevIndexRef.current = null
    setCloseQueue([])
    setAddLevelMode(null)
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
      // Snapshot the chart once for this batch (same bar for all of them) rather than per-order -
      // captureScreenshot is async, so the queue only gets appended to once it resolves.
      replayChartRef.current?.captureScreenshot().then((chartImage) => {
        // Keyed by order+leg (not just order id) - a laddered stop can have two legs trigger in
        // the same bar (a gap through both), which now needs two separate queued closes for the
        // same order rather than being deduped down to one.
        setCloseQueue((q) => [
          ...q,
          ...triggeredCloses
            .filter((tc) => !q.some((existing) => closeKey(existing) === closeKey(tc)))
            .map((tc) => ({
              order: tc.order,
              exitPrice: tc.exitPrice,
              reason: tc.reason,
              leg: tc.leg ?? null,
              chartImage,
            })),
        ])
      })
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
    setBarIndex(idx)
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
    setAddLevelMode(null)
    prevIndexRef.current = null
    restartStore()
  }

  const openOrderTicket = (direction) => {
    if (!lastBar) return
    setOrderDraft({
      direction,
      orderType: 'market',
      entryPrice: '',
      qty: String(chartSettings.defaultQty),
      slEnabled: false,
      stopLosses: [],
      targetEnabled: false,
      targets: [],
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
    // Only fully-filled-in rows become real legs - a row with an empty price/qty (mid-edit, or
    // just never finished) is silently dropped rather than blocking submission. Same rule for
    // both ladders (stop-loss and target).
    const legsFrom = (rows) =>
      rows
        .filter((r) => numeric(r.price) != null && numeric(r.qty) > 0)
        .map((r) => ({ id: r.id, price: numeric(r.price), qty: numeric(r.qty) }))
    const newOrder = {
      id: crypto.randomUUID(),
      type: isLimit ? 'limit' : 'market',
      status: isLimit ? 'pending' : 'open',
      direction: orderDraft.direction,
      quantity: Number(orderDraft.qty),
      entryPrice,
      stopLosses: orderDraft.slEnabled ? legsFrom(orderDraft.stopLosses) : [],
      targets: orderDraft.targetEnabled ? legsFrom(orderDraft.targets) : [],
      entryBarIndex: isLimit ? null : currentIndex,
    }
    setOrders([...orders, newOrder])
    setOrderDraft(null)
  }

  // Dragging one specific leg's line on the chart (stop-loss or target - both are ladders of
  // legs now, see orderEngine.js/store.js) commits here: round to paise, patch just that leg's
  // price, and confirm with a toast since the change has no other visible confirmation.
  const adjustOrder = (orderId, field, price, legId) => {
    const rounded = round2(price)
    const legField = field === 'stopLoss' ? 'stopLosses' : 'targets'
    setOrders(
      orders.map((o) =>
        o.id === orderId
          ? { ...o, [legField]: o[legField].map((l) => (l.id === legId ? { ...l, price: rounded } : l)) }
          : o,
      ),
    )
    toast.success(`${FIELD_LABEL[field]} updated to ${inr(rounded)}`)
  }

  // Toggled by TradingPanel's "Add stop loss"/"Add target" button on an already-open position -
  // arms (or, clicked again on the same order+kind, disarms) waiting for the next chart click to
  // place the new level (see placeLevel below and ReplayChart's addLevelMode handling).
  const armAddLevel = (orderId, kind) =>
    setAddLevelMode((m) => (m?.orderId === orderId && m.kind === kind ? null : { orderId, kind }))

  // Fires once, from ReplayChart, on the first chart click after arming - the new level covers
  // whatever quantity isn't already protected by an existing leg on that side (a fresh ladder has
  // none, so this covers the whole size, same as the old one-shot "Set stop loss"/"Set target"
  // did). A no-op if that side is already fully covered - resizing an existing leg happens by
  // dragging its line, not by adding another.
  const placeLevel = (price) => {
    if (!addLevelMode) return
    const { orderId, kind } = addLevelMode
    setAddLevelMode(null)
    const legField = kind === 'stopLoss' ? 'stopLosses' : 'targets'
    const order = orders.find((o) => o.id === orderId)
    if (!order) return
    const covered = order[legField].reduce((s, l) => s + l.qty, 0)
    const remaining = order.quantity - covered
    if (remaining <= 0) return
    const newLeg = { id: crypto.randomUUID(), price: round2(price), qty: remaining }
    setOrders(orders.map((o) => (o.id === orderId ? { ...o, [legField]: [...o[legField], newLeg] } : o)))
  }

  // Removing a leg just drops its protection - the quantity it covered goes back to being
  // un-stopped/un-targeted (same as never having set one on that slice at all), it does NOT
  // close any part of the position. Only an actual bar touching a leg's price does that.
  const removeLevel = (orderId, kind, legId) => {
    const legField = kind === 'stopLoss' ? 'stopLosses' : 'targets'
    setOrders(
      orders.map((o) =>
        o.id === orderId ? { ...o, [legField]: o[legField].filter((l) => l.id !== legId) } : o,
      ),
    )
  }

  // const toggleDrawMode = (direction) => setDrawMode((m) => (m === direction ? null : direction))

  // The Draw long/short tool (ReplayChart's DrawZone) hands off the dragged levels here as a
  // saved zone - it just sits on the chart, nothing is submitted yet. Clicking the zone itself
  // (convertDrawingToOrder below) is what turns it into an order to review.
  // const handleDrawComplete = ({ direction, entryPrice, target, stopLoss }) => {
  //   setDrawMode(null)
  //   setDrawings((ds) => [...ds, { id: crypto.randomUUID(), direction, entryPrice, target, stopLoss }])
  // }

  // Clicking a drawn zone opens the same ticket used for typed entries (as a Limit at the drawn
  // entry price) so qty, R:R, and the target/SL-side validation all still apply before anything
  // is actually submitted. The drawing itself is left on the chart, in case it's reused.
  // const convertDrawingToOrder = (drawing) => {
  //   setOrderDraft({
  //     direction: drawing.direction,
  //     orderType: 'limit',
  //     entryPrice: String(round2(drawing.entryPrice)),
  //     qty: '1',
  //     slEnabled: true,
  //     sl: String(round2(drawing.stopLoss)),
  //     targetEnabled: true,
  //     target: String(round2(drawing.target)),
  //   })
  // }

  const previewOrder =
    orderDraft && lastBar
      ? {
          direction: orderDraft.direction,
          entry:
            orderDraft.orderType === 'limit'
              ? (numeric(orderDraft.entryPrice) ?? lastBar.close)
              : lastBar.close,
          stop_losses: orderDraft.slEnabled
            ? orderDraft.stopLosses.map((r) => numeric(r.price)).filter((p) => p != null)
            : [],
          targets: orderDraft.targetEnabled
            ? orderDraft.targets.map((r) => numeric(r.price)).filter((p) => p != null)
            : [],
        }
      : null

  const requestClose = async (order) => {
    if (!lastBar) return
    const chartImage = await replayChartRef.current?.captureScreenshot()
    setCloseQueue((q) =>
      q.some((existing) => existing.order.id === order.id)
        ? q
        : [...q, { order, exitPrice: lastBar.close, reason: 'manual', chartImage }],
    )
  }
  const activeClose = closeQueue[0] ?? null
  // The close-trade feedback modal asks for result/emotion/notes - autoplay revealing more bars
  // underneath while it's open would move the replay on without the user noticing.
  useEffect(() => {
    if (activeClose) setPlaying(false)
  }, [activeClose])

  // 'B'/'S' shortcuts open the order ticket, same as clicking Buy/Sell - ignored automatically
  // while typing in any input/textarea (ignoreInputs defaults true for single-key hotkeys).
  const hotkeysEnabled = started && !orderDraft
  useHotkey('b', () => openOrderTicket('long'), { enabled: hotkeysEnabled })
  useHotkey('s', () => openOrderTicket('short'), { enabled: hotkeysEnabled })
  // TradingView's own bar-replay bindings: Shift+Down plays/pauses, Shift+Right steps one bar.
  useHotkey('shift+down', () => setPlaying((p) => !p), { enabled: hotkeysEnabled && (!atEnd || playing) })
  useHotkey('shift+right', () => setBarIndex(currentIndex + 1), { enabled: hotkeysEnabled && !atEnd })
  // useHotkey('escape', () => setDrawMode(null), { enabled: !!drawMode })

  return (
    <div className="fixed inset-y-0 right-0 left-16 z-40 bg-background">
      <ReplayChart
        ref={replayChartRef}
        bars={visibleBars}
        indicators={indicators}
        orders={orders}
        previewOrder={previewOrder}
        resetKey={`${symbol}-${timeframe}`}
        onAdjustOrder={adjustOrder}
        addLevelMode={addLevelMode}
        onPlaceLevel={placeLevel}
        settings={chartSettings}
        // drawMode={drawMode}
        // drawings={drawings}
        // onDrawComplete={handleDrawComplete}
        // onConvertDrawing={convertDrawingToOrder}
      />

      {/* Each cluster below is its own small absolutely-positioned box (explicit z-10), not one
          full-viewport wrapper - no reliance on pointer-events inheritance racing against the
          chart's own canvas layers. */}
      <div className="absolute top-4 left-4 z-10 flex w-72 flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Link
            to="/backtesting"
            search={{ tab: 'manual' }}
            className="flex w-fit items-center gap-1.5 rounded-full border bg-card/95 px-3 py-1.5 text-sm text-muted-foreground shadow-lg backdrop-blur-sm hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" /> Back to backtesting
          </Link>
          <Button
            size="icon-sm"
            variant="outline"
            className="rounded-full bg-card/95 shadow-lg backdrop-blur-sm"
            aria-label="Chart settings"
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon className="size-4" />
          </Button>
        </div>

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
          <SourceSelect sources={sources} value={source} onChange={setSource} className="w-full" />
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
              {maxStatus?.running ? 'Collecting full history…' : 'Needed before replay can start.'}
            </p>
          )}
          {maxStatus?.error && <p className="text-xs text-destructive">{maxStatus.error}</p>}
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
        <div className="absolute top-4 right-[5%] z-10 w-72">
          <FloatingPanel title="Trade" icon={WalletIcon}>
            <TradingPanel
              orders={orders}
              lastBar={lastBar}
              onOpenTicket={openOrderTicket}
              onRequestClose={requestClose}
              addLevelMode={addLevelMode}
              onArmAddLevel={armAddLevel}
              onRemoveLevel={removeLevel}
              // drawMode={drawMode}
              // onToggleDraw={toggleDrawMode}
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

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={chartSettings}
        onSave={setChartSettings}
      />

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
        reason={activeClose?.reason}
        leg={activeClose?.leg ?? null}
        chartImage={activeClose?.chartImage}
        onClosed={() => {
          queryClient.invalidateQueries({ queryKey: ['manualTrades'] })
          const { order, leg, reason } = activeClose
          if (leg) {
            // A laddered stop-loss OR target leg hit: only that leg's slice of the position
            // actually closed. Drop just that leg and shrink quantity by its share - if it was
            // the last one covering the whole position, this is really a full close, same as
            // below (and the other side's ladder, if any, is now moot - it's dropped too).
            const legField = reason === 'target' ? 'targets' : 'stopLosses'
            const remainingLegs = order[legField].filter((l) => l.id !== leg.id)
            const remainingQty = order.quantity - leg.qty
            setOrders(
              remainingQty > 0
                ? orders.map((o) =>
                    o.id === order.id ? { ...o, quantity: remainingQty, [legField]: remainingLegs } : o,
                  )
                : orders.filter((o) => o.id !== order.id),
            )
          } else {
            setOrders(orders.filter((o) => o.id !== order.id))
          }
          setCloseQueue((q) => q.slice(1))
        }}
      />
    </div>
  )
}
