import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  preferredQuantity,
  processBarForOrders,
  setLegQty,
  trailStops,
  withStopsAtBreakeven,
} from './orderEngine'
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

// How long the chart's framing is allowed to settle before it's written to the persisted store.
// Long enough that a whole pan or zoom gesture costs one write, short enough that a reload right
// after letting go still lands where you left it.
const VIEW_SAVE_MS = 400

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
  const drawings = useBarReplayStore((s) => s.drawings)
  const indicators = useBarReplayStore((s) => s.indicators)
  const speedMs = useBarReplayStore((s) => s.speedMs)
  const chartSettings = useBarReplayStore((s) => s.settings)
  const accountId = useBarReplayStore((s) => s.accountId)
  const changeSymbol = useBarReplayStore((s) => s.setSymbol)
  const changeTimeframe = useBarReplayStore((s) => s.setTimeframe)
  const setBarIndex = useBarReplayStore((s) => s.setBarIndex)
  const setOrders = useBarReplayStore((s) => s.setOrders)
  const setDrawings = useBarReplayStore((s) => s.setDrawings)
  const setIndicators = useBarReplayStore((s) => s.setIndicators)
  const setSpeedMs = useBarReplayStore((s) => s.setSpeedMs)
  const setChartSettings = useBarReplayStore((s) => s.setSettings)
  const setView = useBarReplayStore((s) => s.setView)
  const setAccountId = useBarReplayStore((s) => s.setAccountId)
  const restartStore = useBarReplayStore((s) => s.restart)

  // `view` (zoom window, pane heights, price scales) is deliberately NOT subscribed: it changes on
  // every frame of a pan or zoom, and re-rendering this page that often re-sliced `bars` and made
  // the chart re-set every candle and recompute every indicator mid-drag. Read once, at mount -
  // from there the chart owns its framing and only reports it back.
  const initialViewRef = useRef(useBarReplayStore.getState().view)
  // And the reports are coalesced: a drag emits dozens of them, each one otherwise a synchronous
  // localStorage write of the whole session (zustand's persist middleware).
  const pendingViewRef = useRef(null)
  const viewTimerRef = useRef(0)
  const flushView = useCallback(() => {
    window.clearTimeout(viewTimerRef.current)
    viewTimerRef.current = 0
    const pending = pendingViewRef.current
    pendingViewRef.current = null
    if (pending) setView(pending)
  }, [setView])
  const handleViewChange = useCallback(
    (next) => {
      pendingViewRef.current = { ...pendingViewRef.current, ...next }
      if (viewTimerRef.current) return
      viewTimerRef.current = window.setTimeout(flushView, VIEW_SAVE_MS)
    },
    [flushView],
  )
  // Leaving the page mid-drag still saves where it was left.
  useEffect(() => flushView, [flushView])

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
  // Drawing tool armed from the bar's Draw popover, and which drawn shape is selected on the
  // chart. Both are transient UI, not session state - a tool left armed across a reload would be a
  // surprise, and a selection is only meaningful while you're looking at it.
  const [drawTool, setDrawTool] = useState(null)
  const [selectedDrawingId, setSelectedDrawingId] = useState(null)
  const [closeQueue, setCloseQueue] = useState([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 'symbol' | 'timeframe' | null - which centred quick-switcher is open (see ReplayCommandDialog).
  const [commandMode, setCommandMode] = useState(null)
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
  // Memoised: this array is the chart's `bars` prop, and a fresh one on an unrelated re-render
  // (a hover, a pill update) re-runs setData over the whole history plus every indicator.
  const visibleBars = useMemo(
    () => (started ? allBars.slice(0, currentIndex + 1) : []),
    [started, allBars, currentIndex],
  )
  const lastBar = visibleBars.length ? visibleBars[visibleBars.length - 1] : null
  const atEnd = started && currentIndex >= allBars.length - 1

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
    // Trail BEFORE hit-detection: the SL levels the bar is checked against are the ones the
    // ratchet raised (or left alone), matching the real-world "your stop is armed at what it
    // was raised to yesterday" semantics.
    const trailed = trailStops(orders, allBars.slice(0, currentIndex + 1))
    const workingOrders = trailed.changed ? trailed.orders : orders
    const { nextOrders, triggeredCloses, changed } = processBarForOrders(workingOrders, bar, currentIndex)
    if (changed || trailed.changed) setOrders(nextOrders)
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

  // Same pick the Jump to date › Random bar menu item makes, callable without the menu - used by
  // the close dialog's "jump after logging" preference. Announced with a toast because the whole
  // chart changes underneath the user without them having clicked anything.
  const jumpToRandomBar = () => {
    if (allBars.length === 0) return
    const bar = allBars[Math.floor(Math.random() * allBars.length)]
    jumpToDate(bar.date)
    toast.success(`Jumped to ${bar.date}`, { description: 'Random bar — replay paused here.' })
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
    restartStore()
  }

  // The size a new position starts at, from the Settings > Preferences sizing preference - a fixed
  // share count, or a % of the selected account's live balance at the current price. Read here,
  // once, so the ticket and the one-key market orders can never disagree about it.
  const startingQty = lastBar ? preferredQuantity(chartSettings, balance, lastBar.close) : 1

  const openOrderTicket = (direction) => {
    if (!lastBar) return
    setOrderDraft({
      direction,
      orderType: 'market',
      entryPrice: '',
      qty: String(startingQty),
      slEnabled: false,
      stopLosses: [],
      targetEnabled: false,
      targets: [],
      // Trailing stop configuration ({ atrPeriod, atrMult }) or null - the engine's trailStops
      // ratchets SL legs each bar when this is set. See OrderTicketDialog for the UI toggle.
      trailing: null,
      // "Size by risk" input in the ticket - a % of account balance the user is willing to lose
      // to the tightest stop. Back-solves the Shares field on demand (see sizeByRisk).
      sizeRiskPct: '',
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
      // The bar this fills on, captured now. A pending limit has no entry yet - the engine
      // stamps it when the price is actually crossed.
      entryDate: isLimit ? null : lastBar.date,
      // Only meaningful if the position also has at least one SL leg to trail. Kept on the
      // order (not on individual legs) since one trail rule ratchets every leg together.
      trailing: orderDraft.slEnabled ? (orderDraft.trailing ?? null) : null,
    }
    setOrders([...orders, newOrder])
    setOrderDraft(null)
  }

  // Straight to market at the current bar's close, no ticket - the fast path for "I want in, now",
  // sized by the same preference the ticket uses. Naked by design: no SL/target legs, since there
  // is no dialog to type them into. They can still be added from the chart or the Positions strip.
  const placeMarketOrder = (direction) => {
    if (!lastBar) return
    const quantity = preferredQuantity(chartSettings, balance, lastBar.close)
    setOrders([
      ...orders,
      {
        id: crypto.randomUUID(),
        type: 'market',
        status: 'open',
        direction,
        quantity,
        entryPrice: lastBar.close,
        stopLosses: [],
        targets: [],
        entryBarIndex: currentIndex,
        entryDate: lastBar.date,
        trailing: null,
      },
    ])
    toast.success(`${direction === 'long' ? 'Bought' : 'Sold'} ${quantity} at ${inr(lastBar.close)}`)
  }

  // Dragging one specific leg's line on the chart commits here: round to paise, patch just
  // that leg's price, and confirm with a toast since the change has no other visible
  // confirmation. `field: 'entry'` is a pending limit's own entry-price line being dragged; it
  // takes no legId and updates the order's entryPrice directly (no-op on filled positions -
  // entry only exists as a movable level while the order is still pending).
  const adjustOrder = (orderId, field, price, legId) => {
    const rounded = round2(price)
    if (field === 'entry') {
      setOrders(
        orders.map((o) => (o.id === orderId && o.status === 'pending' ? { ...o, entryPrice: rounded } : o)),
      )
      toast.success(`Entry updated to ${inr(rounded)}`)
      return
    }
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

  // "Move stops to breakeven" - the standard risk-free adjustment once a trade is comfortably
  // in profit. Pure engine call (see withStopsAtBreakeven), same shape as adjustOrder.
  const moveStopsToBreakeven = (orderId) => {
    const order = orders.find((o) => o.id === orderId)
    if (!order?.stopLosses?.length) return
    setOrders(orders.map((o) => (o.id === orderId ? withStopsAtBreakeven(o) : o)))
    toast.success(`Stop moved to breakeven ${inr(order.entryPrice)}`)
  }

  // Cancelling a pending limit is NOT the same as closing a filled position - it never traded,
  // so nothing gets journaled and no P&L exists. Guarded to pending only; open positions have
  // to go through requestClose so a real trade is logged.
  const cancelPending = (orderId) => {
    const order = orders.find((o) => o.id === orderId)
    if (!order || order.status !== 'pending') return
    setOrders(orders.filter((o) => o.id !== orderId))
    toast.success('Pending order cancelled')
  }

  // Adds a new SL or target leg to an open position at `price`. Called from the chart's
  // right-click menu with a concrete order+kind+price - no arm-then-click state to keep in sync.
  // The new leg covers whatever quantity is still unprotected on that side (a fresh ladder =
  // whole position); no-op once that side is fully covered, since resizing an existing leg
  // happens by dragging its line, not by stacking a second one on top of it.
  const placeLevel = (orderId, kind, price) => {
    const legField = kind === 'stopLoss' ? 'stopLosses' : 'targets'
    const order = orders.find((o) => o.id === orderId)
    if (!order) return
    const covered = order[legField].reduce((s, l) => s + l.qty, 0)
    const remaining = order.quantity - covered
    if (remaining <= 0) return
    const newLeg = { id: crypto.randomUUID(), price: round2(price), qty: remaining }
    setOrders(orders.map((o) => (o.id === orderId ? { ...o, [legField]: [...o[legField], newLeg] } : o)))
  }

  // Editing a leg's quantity in place on its chart pill. Validation lives in the engine
  // (setLegQty) so the "legs on one side can't sum past the position" rule holds wherever it's
  // called from; a rejected edit toasts why and leaves the order exactly as it was.
  const adjustLegQty = (orderId, kind, legId, qty) => {
    const order = orders.find((o) => o.id === orderId)
    if (!order) return
    const { order: next, error } = setLegQty(order, kind, legId, qty)
    if (error) {
      toast.error(error)
      return
    }
    setOrders(orders.map((o) => (o.id === orderId ? next : o)))
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
  // Same dispatcher as requestClose but pre-fills a partial qty - the close dialog's qty field
  // will start at this value and can still be edited. Kept as a wrapper (not a second parameter
  // on requestClose) so the plain "close all at market" call site stays a one-liner.
  const requestPartialClose = async (order, qty) => {
    if (!lastBar) return
    const chartImage = await replayChartRef.current?.captureScreenshot()
    setCloseQueue((q) =>
      q.some((existing) => existing.order.id === order.id)
        ? q
        : [...q, { order, exitPrice: lastBar.close, reason: 'manual', chartImage, partialQty: qty }],
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
  // Shift skips the ticket entirely and fills at market, at the preference's size.
  useHotkey('shift+b', () => placeMarketOrder('long'), { enabled: hotkeysEnabled })
  useHotkey('shift+s', () => placeMarketOrder('short'), { enabled: hotkeysEnabled })
  // Symbol and timeframe switchers. Not gated on `started` like the trading keys above - swapping
  // instruments is the main thing you do *before* a replay is running. Mod+K stays the global
  // palette (CommandPalette), so these take the single keys TradingView uses for the same jobs.
  useHotkey('/', () => setCommandMode('symbol'), { enabled: !orderDraft })
  useHotkey('t', () => setCommandMode('timeframe'), { enabled: !orderDraft })
  // TradingView's own bar-replay bindings: Shift+Down plays/pauses, Shift+Right steps one bar.
  useHotkey('shift+down', () => setPlaying((p) => !p), { enabled: hotkeysEnabled && (!atEnd || playing) })
  useHotkey('shift+right', () => setBarIndex(currentIndex + 1), { enabled: hotkeysEnabled && !atEnd })
  // Shuffle to a random bar - the keyboard half of the bottom bar's dice button (and of the close
  // dialog's "jump after logging"). Not gated on `started`: picking a random spot is a perfectly
  // good way to *begin* a session.
  useHotkey('shift+r', jumpToRandomBar, { enabled: !orderDraft && allBars.length > 0 })
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
          // Same handlers the Positions strip uses - the on-chart controls and the strip are
          // two surfaces onto the same actions, so a change made from either goes through here.
          onRemoveLevel={removeLevel}
          onAdjustLegQty={adjustLegQty}
          onPlaceLevel={placeLevel}
          onRequestClose={requestClose}
          onMoveToBreakeven={moveStopsToBreakeven}
          onCancelPending={cancelPending}
          drawings={drawings}
          onDrawingsChange={setDrawings}
          drawTool={drawTool}
          onDrawToolChange={setDrawTool}
          selectedDrawingId={selectedDrawingId}
          onSelectDrawing={setSelectedDrawingId}
          view={initialViewRef.current}
          onViewChange={handleViewChange}
          settings={chartSettings}
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
        draw={{
          tool: drawTool,
          onToolChange: setDrawTool,
          count: drawings.length,
          selected: !!selectedDrawingId,
          onDeleteSelected: () => {
            setDrawings(drawings.filter((d) => d.id !== selectedDrawingId))
            setSelectedDrawingId(null)
          },
          onClearAll: () => {
            setDrawings([])
            setSelectedDrawingId(null)
            setDrawTool(null)
          },
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
          onRandomBar: jumpToRandomBar,
          onRestart: restart,
        }}
        trade={{
          visible: !!symbol && barsReady && started,
          orders,
          lastBar,
          onOpenTicket: openOrderTicket,
          onMarketOrder: placeMarketOrder,
          startingQty,
          onRequestClose: requestClose,
          onRequestPartialClose: requestPartialClose,
          onMoveToBreakeven: moveStopsToBreakeven,
          onCancelPending: cancelPending,
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
        balance={balance}
        price={lastBar?.close ?? null}
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
        partialQty={activeClose?.partialQty ?? null}
        chartImage={activeClose?.chartImage}
        accountId={accountId}
        // The replayed bars this trade actually opened and closed on - what it gets journaled
        // under. Read off the order itself, where it was stamped at fill. The index lookup is
        // only a fallback for orders that were already open before entryDate existed: an index
        // means nothing once collecting more history has prepended older bars to the array, which
        // is exactly how this used to arrive null and date every replay trade to today.
        entryDate={
          activeClose?.order?.entryDate ??
          (activeClose?.order?.entryBarIndex != null
            ? (allBars[activeClose.order.entryBarIndex]?.date ?? null)
            : null)
        }
        exitDate={lastBar?.date ?? null}
        onClosed={(closedQty) => {
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
          } else if (closedQty != null && closedQty < order.quantity) {
            // Partial manual close: keep the position open with the remainder, same shape as a
            // laddered leg hit but without any leg to drop.
            const remainingQty = order.quantity - closedQty
            setOrders(orders.map((o) => (o.id === order.id ? { ...o, quantity: remainingQty } : o)))
          } else {
            setOrders(orders.filter((o) => o.id !== order.id))
          }
          setCloseQueue((q) => q.slice(1))
          // Only once the last queued close is dealt with: a laddered exit can queue several
          // dialogs at the same bar, and jumping after the first would strand the rest on a
          // chart that has moved on. Read straight from the store rather than subscribed, since
          // nothing here re-renders on the preference changing.
          if (closeQueue.length === 1 && useBarReplayStore.getState().autoRandomJump) jumpToRandomBar()
        }}
      />
    </div>
  )
}
