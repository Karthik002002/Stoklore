import { useEffect, useMemo, useRef, useState } from 'react'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { inr } from '@/lib/format'
import { aggregateBars, isIntraday } from '@/lib/replay'
import { useMaxHistoryCollector } from '@/lib/useMaxHistoryCollector'
import { usePageTitle } from '@/lib/usePageTitle'
import { accountBalance, tradesForAccount } from '@/lib/tradeAccounts'
import { getBalanceAdjustments, getIntradayBars, getManualTrades, getTradeAccounts } from '@/services/api'
import BottomBar from './BottomBar'
import CloseTradeDialog from './CloseTradeDialog'
import OrderTicketDialog from './OrderTicketDialog'
import { processBarForOrders } from './orderEngine'
import ReplayChart from './ReplayChart'
import ReplayCommandDialog from './ReplayCommandDialog'
import SettingsDialog from './SettingsDialog'
import { useBarReplayStore } from './store'

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
  const view = useBarReplayStore((s) => s.view)
  const accountId = useBarReplayStore((s) => s.accountId)
  const changeSymbol = useBarReplayStore((s) => s.setSymbol)
  const changeTimeframe = useBarReplayStore((s) => s.setTimeframe)
  const setBarIndex = useBarReplayStore((s) => s.setBarIndex)
  const setOrders = useBarReplayStore((s) => s.setOrders)
  const setIndicators = useBarReplayStore((s) => s.setIndicators)
  const setSpeedMs = useBarReplayStore((s) => s.setSpeedMs)
  const setChartSettings = useBarReplayStore((s) => s.setSettings)
  const setView = useBarReplayStore((s) => s.setView)
  const setAccountId = useBarReplayStore((s) => s.setAccountId)
  const restartStore = useBarReplayStore((s) => s.restart)

  const { data: accounts = [] } = useQuery({ queryKey: ['tradeAccounts'], queryFn: () => getTradeAccounts() })
  // The selected account's live wallet, so the order ticket can show a position's size as a
  // percentage of it. Assembled exactly the way ManualBacktesting does it (opening balance +
  // adjustments + realised P&L, see lib/tradeAccounts) rather than reading opening_balance
  // directly, which would be wrong the moment the account has taken a single trade.
  const { data: allJournalTrades = [] } = useQuery({
    queryKey: ['manualTrades'],
    queryFn: getManualTrades,
  })
  const { data: adjustments = [] } = useQuery({
    queryKey: ['balanceAdjustments'],
    queryFn: getBalanceAdjustments,
  })
  const balance = accountBalance(
    accounts.find((a) => a.id === accountId) ?? null,
    tradesForAccount(allJournalTrades, accountId),
    adjustments.filter((a) => a.account_id === accountId),
  )

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
  // 'symbol' | 'timeframe' | null - which centred quick-switcher is open (see ReplayCommandDialog).
  const [commandMode, setCommandMode] = useState(null)
  // Armed by PositionsList's "Add stop loss"/"Add target" toggle on an already-open position -
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

  // 15m/1H/4H come from the minute dataset instead of the daily price_history_max this page
  // otherwise runs on (see lib/replay.js). Slow only on a symbol's first fetch - the backend
  // caches the extract - so it gets its own long-lived query rather than blocking the daily path.
  const intraday = isIntraday(timeframe)
  const { data: intradayData, isFetching: intradayLoading } = useQuery({
    queryKey: ['intradayBars', symbol, timeframe],
    queryFn: () => getIntradayBars(symbol, timeframe),
    enabled: !!symbol && intraday,
    staleTime: Infinity,
    retry: false,
  })

  // Both paths hand ReplayChart the same {date, time, ...} shape: `date` is the calendar day the
  // date-jump/start-date pickers match on, `time` is what lightweight-charts plots. Daily bars
  // are keyed by day either way, so their `time` is just the date string.
  const allBars = useMemo(() => {
    if (intraday) return intradayData?.bars ?? []
    if (!maxHistory) return []
    return aggregateBars(maxHistory, timeframe).map((b) => ({ ...b, time: b.date }))
  }, [intraday, intradayData, maxHistory, timeframe])

  // The "Collect max data" gate only applies to the daily timeframes - intraday fetches its own
  // bars and needs no prior collection.
  const barsReady = intraday ? allBars.length > 0 : hasMaxData
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

  // Toggled by PositionsList's "Add stop loss"/"Add target" button on an already-open position -
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
  // Symbol and timeframe switchers. Not gated on `started` like the trading keys above - swapping
  // instruments is the main thing you do *before* a replay is running. Mod+K stays the global
  // palette (CommandPalette), so these take the single keys TradingView uses for the same jobs.
  useHotkey('/', () => setCommandMode('symbol'), { enabled: !orderDraft })
  useHotkey('t', () => setCommandMode('timeframe'), { enabled: !orderDraft })
  // TradingView's own bar-replay bindings: Shift+Down plays/pauses, Shift+Right steps one bar.
  useHotkey('shift+down', () => setPlaying((p) => !p), { enabled: hotkeysEnabled && (!atEnd || playing) })
  useHotkey('shift+right', () => setBarIndex(currentIndex + 1), { enabled: hotkeysEnabled && !atEnd })
  // useHotkey('escape', () => setDrawMode(null), { enabled: !!drawMode })

  return (
    // Chart above, one control bar below - a plain flex column, so the chart's box is whatever
    // height is left over and nothing ever overlaps the candles. (This page used to float
    // Setup/Indicators/Trade/Playback cards on top of the chart; see BottomBar.jsx.)
    <div className="fixed inset-y-0 right-0 left-16 z-40 flex flex-col bg-background">
      <div className="relative min-h-0 flex-1">
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
          // Same three handlers the Positions popover uses - the on-chart pills are just a second
          // surface onto them, so a level added or dropped from either place is the same action.
          onArmAddLevel={armAddLevel}
          onRemoveLevel={removeLevel}
          onRequestClose={requestClose}
          view={view}
          onViewChange={setView}
          settings={chartSettings}
          // drawMode={drawMode}
          // drawings={drawings}
          // onDrawComplete={handleDrawComplete}
          // onConvertDrawing={convertDrawingToOrder}
        />
      </div>

      <BottomBar
        onOpenSettings={() => setSettingsOpen(true)}
        setup={{
          symbol,
          onSymbolChange: changeSymbol,
          accounts,
          accountId,
          onAccountChange: setAccountId,
          timeframe,
          onTimeframeChange: changeTimeframe,
          intraday,
          intradayLoading,
          intradayEmpty: intraday && !intradayLoading && !!symbol && allBars.length === 0,
          intradayFallback: intraday && intradayData?.source === 'yfinance',
          sources,
          source,
          onSourceChange: setSource,
          onCollect: () => collect.mutate(),
          collecting: !!maxStatus?.running,
          collectError: maxStatus?.error,
          hasMaxData,
          barsReady,
          canStart: !!symbol && barsReady && !started,
          bars: allBars,
          startDate,
          onStartDateChange: setStartDate,
          onStart: startReplay,
          indicators,
          onIndicatorsChange: setIndicators,
        }}
        playback={{
          started,
          playing,
          atEnd,
          currentIndex,
          total: allBars.length,
          onStepBack: () => setBarIndex(currentIndex - 1),
          onPlayToggle: () => setPlaying((p) => !p),
          onStepForward: () => setBarIndex(currentIndex + 1),
          speedMs,
          onSpeedChange: setSpeedMs,
          bars: allBars,
          dateDraft,
          onJumpDate: jumpToDate,
          onRestart: restart,
        }}
        trade={{
          visible: !!symbol && barsReady && started,
          orders,
          lastBar,
          onOpenTicket: openOrderTicket,
          onRequestClose: requestClose,
          addLevelMode,
          onArmAddLevel: armAddLevel,
          onRemoveLevel: removeLevel,
        }}
      />

      <ReplayCommandDialog
        mode={commandMode}
        onOpenChange={(next) => !next && setCommandMode(null)}
        timeframe={timeframe}
        onSymbol={changeSymbol}
        onTimeframe={changeTimeframe}
      />

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
        accountBalance={balance}
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
        accountId={accountId}
        // The replayed period this trade actually happened in. It is NOT the same as when the
        // trade gets journaled (that's wall-clock now, see CloseTradeDialog) - without these the
        // backend would score a 2022 replay against today's chart.
        entryDate={
          activeClose?.order?.entryBarIndex != null
            ? (allBars[activeClose.order.entryBarIndex]?.date ?? null)
            : null
        }
        exitDate={lastBar?.date ?? null}
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
