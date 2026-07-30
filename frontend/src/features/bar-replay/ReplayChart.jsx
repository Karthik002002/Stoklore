import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { CandlestickSeries, LineSeries, createChart } from 'lightweight-charts'
// import { inr } from '@/lib/format' // only used by the Draw long/short tool, disabled for now
import { INDICATOR_COLORS, INDICATOR_TYPES } from '@/lib/indicators'
import { tradeReturnPct } from '@/lib/manualTrades'
import { DEFAULT_CHART_SETTINGS } from './store'

const COLORS = { up: '#22c55e', down: '#ef4444', text: '#9ca3af', grid: 'rgba(148, 163, 184, 0.15)' }

// Maps the user-configurable chart settings (see store.js) onto lightweight-charts'
// candlestick series options - shared by the initial creation and the reactive re-apply below.
function candleOptionsFrom(settings) {
  return {
    upColor: settings.bodyUpColor,
    downColor: settings.bodyDownColor,
    wickUpColor: settings.wickUpColor,
    wickDownColor: settings.wickDownColor,
    borderVisible: settings.borderVisible,
    borderUpColor: settings.borderUpColor,
    borderDownColor: settings.borderDownColor,
  }
}

// How many of the most recent bars the chart shows on its first render (per symbol/timeframe/
// replay-start) - after that, zoom/pan is entirely user-controlled (see the chart's fitContent
// comment below).
const INITIAL_VISIBLE_BARS = 200

// How close (in px) a pointer-down needs to land next to a stop-loss/target line to grab it for
// dragging - see the drag-to-adjust effect below.
const DRAG_HIT_PX = 6

// Draw long/short tool - disabled for now, kept for later (see the other commented-out pieces
// in this file: the pan/zoom effect, the draw branches in the pointer effect, the render below,
// and the DrawZone component at the bottom).
// Turns a "Draw long/short" drag into a finished zone: the drag mirrors around the entry click
// (TradingView's Long/Short Position tool sizes both sides of the click together), and which
// mirrored price becomes target vs. stop-loss depends only on tool direction - not on which way
// the pointer actually moved - so the zone is always green-above/red-below for long (flipped for
// short) regardless of drag direction.
// function zoneFromDrag(draw, dragPrice, x1) {
//   const { direction, entryPrice, x0 } = draw
//   const mirrored = entryPrice - (dragPrice - entryPrice)
//   const above = Math.max(dragPrice, mirrored)
//   const below = Math.min(dragPrice, mirrored)
//   return {
//     direction,
//     entryPrice,
//     target: direction === 'long' ? above : below,
//     stopLoss: direction === 'long' ? below : above,
//     x0,
//     x1,
//   }
// }

// Chart/series objects live in refs and persist across bar steps - only `resetKey` (symbol +
// timeframe) tears down and recreates the chart. Every other update (new bar revealed,
// indicator data) goes through .setData() on the existing series, so a user's zoom/pan survives
// stepping or playing forward instead of being wiped by fitContent() on every single bar.
const ReplayChart = forwardRef(function ReplayChart(
  {
    bars,
    indicators,
    orders,
    previewOrder,
    resetKey,
    onAdjustOrder,
    addLevelMode,
    onPlaceLevel,
    settings = DEFAULT_CHART_SETTINGS,
    // drawMode,
    // drawings = [],
    // onDrawComplete,
    // onConvertDrawing,
  },
  ref,
) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const candleSeriesRef = useRef(null)
  const indicatorSeriesRef = useRef(new Map())
  const orderLinesRef = useRef(new Map())
  const previewLinesRef = useRef([])
  const hasFitRef = useRef(false)
  // The live entry/target/stop-loss zone box while a "Draw long/short" drag is in progress (see
  // the pointer effect below) - null the rest of the time. Plain React state (not a ref) since,
  // unlike the order-line drag, this needs to actually re-render the overlay div on every move.
  // const [drawPreview, setDrawPreview] = useState(null)

  // Drag handlers close over ordersRef/onAdjustRef instead of orders/onAdjustOrder directly so
  // the pointer listeners only need attaching once per chart instance, not on every order change.
  const ordersRef = useRef(orders)
  ordersRef.current = orders
  const onAdjustRef = useRef(onAdjustOrder)
  onAdjustRef.current = onAdjustOrder
  const addLevelModeRef = useRef(addLevelMode)
  addLevelModeRef.current = addLevelMode
  const onPlaceLevelRef = useRef(onPlaceLevel)
  onPlaceLevelRef.current = onPlaceLevel
  // const drawModeRef = useRef(drawMode)
  // drawModeRef.current = drawMode
  // const onDrawCompleteRef = useRef(onDrawComplete)
  // onDrawCompleteRef.current = onDrawComplete

  // Lets the caller (BarReplay, when a trade closes) grab a snapshot of exactly what's on the
  // chart right now - candles, indicators, RSI pane, order lines - to attach to the journaled
  // trade. `takeScreenshot` is lightweight-charts' own API (no html2canvas or similar needed);
  // canvas.toBlob is async, so this resolves a Blob (or null before the chart exists).
  useImperativeHandle(ref, () => ({
    captureScreenshot: () =>
      new Promise((resolve) => {
        const canvas = chartRef.current?.takeScreenshot()
        if (!canvas) {
          resolve(null)
          return
        }
        canvas.toBlob((blob) => resolve(blob), 'image/png')
      }),
  }))

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: COLORS.text, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: COLORS.grid } },
      timeScale: { borderVisible: false },
      rightPriceScale: { borderVisible: false },
      localization: { priceFormatter: (p) => `₹${p.toFixed(2)}` },
    })
    chartRef.current = chart
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, candleOptionsFrom(settings))
    indicatorSeriesRef.current = new Map()
    orderLinesRef.current = new Map()
    previewLinesRef.current = []
    hasFitRef.current = false
    return () => {
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      indicatorSeriesRef.current = new Map()
      orderLinesRef.current = new Map()
      previewLinesRef.current = []
    }
    // Only reads `settings` at creation time - the reactive effect right below re-applies later
    // changes without needing to recreate (and reset the zoom/pan of) the whole chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  // Re-applies candle colors when the user changes them in Settings, without recreating the
  // chart (which would wipe zoom/pan) - the creation effect above only sets them once, at mount.
  useEffect(() => {
    candleSeriesRef.current?.applyOptions(candleOptionsFrom(settings))
  }, [settings])

  // Draw long/short tool - disabled for now, kept for later.
  // Disabling pan/zoom has to happen the moment the tool is armed (button click), not reactively
  // inside onPointerDown below - the chart's own pan handler lives on its canvas, a descendant of
  // `container`, so it sees the same mousedown before our container-level listener does (bubbling)
  // and would already start panning with the still-enabled options. Toggling here instead means
  // handleScroll/handleScale are already off by the time any mousedown happens, so the chart
  // never starts its own drag - otherwise the visible price/time scale shifts mid-drag and the
  // zone ends up drawn against a scale that's already moved, effectively vanishing.
  // useEffect(() => {
  //   chartRef.current?.applyOptions({ handleScroll: !drawMode, handleScale: !drawMode })
  // }, [drawMode])

  // "Add stop loss"/"Add target" on an already-open position (see TradingPanel) arms addLevelMode
  // and waits for the next chart click to place the new level there - same reasoning as the draw
  // tool above for disabling pan/zoom reactively at arm time rather than inside onPointerDown:
  // the chart's own pan handler sees the same pointerdown before this component's container
  // listener does (it's on a descendant canvas), so toggling handleScroll/handleScale has to
  // already be off by the time any click happens, not turned off in response to it.
  useEffect(() => {
    chartRef.current?.applyOptions({ handleScroll: !addLevelMode, handleScale: !addLevelMode })
    if (containerRef.current) containerRef.current.style.cursor = addLevelMode ? 'crosshair' : ''
  }, [addLevelMode])

  // Drag-to-adjust an existing order's SL/target line: pointerdown near a line grabs it (and
  // pauses chart pan/zoom so a vertical drag doesn't also scrub the timeline), pointermove
  // repositions the line live via applyOptions (cheap, no React re-render), pointerup commits the
  // final price to the caller. Bound once per chart instance (not per order-list change) via refs.
  // (This effect used to also drive the "Draw long/short" tool - see the commented-out `draw`
  // branches below if re-enabling it.)
  useEffect(() => {
    const container = containerRef.current
    const chart = chartRef.current
    if (!container || !chart) return

    let drag = null // { orderId, field, legId? }
    // let draw = null // { direction, entryPrice, x0 }

    const priceAt = (clientY) => {
      const rect = container.getBoundingClientRect()
      return candleSeriesRef.current?.coordinateToPrice(clientY - rect.top) ?? null
    }
    const coordFor = (price) => candleSeriesRef.current?.priceToCoordinate(price) ?? null

    // A position can have several stop-loss legs AND several target legs (both are ladders, see
    // orderEngine.js/store.js) - each leg on either side is its own draggable line.
    const findHandle = (clientY) => {
      const rect = container.getBoundingClientRect()
      const y = clientY - rect.top
      for (const order of ordersRef.current) {
        if (order.status !== 'open') continue
        for (const [field, legs] of [
          ['stopLoss', order.stopLosses ?? []],
          ['target', order.targets ?? []],
        ]) {
          for (const leg of legs) {
            const coord = coordFor(leg.price)
            if (coord != null && Math.abs(coord - y) <= DRAG_HIT_PX)
              return { orderId: order.id, field, legId: leg.id }
          }
        }
      }
      return null
    }

    const onPointerDown = (e) => {
      const handle = findHandle(e.clientY)
      if (handle) {
        drag = handle
        chart.applyOptions({ handleScroll: false, handleScale: false })
        container.style.cursor = 'ns-resize'
        return
      }
      // Armed by TradingPanel's "Add stop loss"/"Add target" toggle - a click that isn't grabbing
      // an existing line places the new level here instead (see BarReplay's placeLevel).
      if (addLevelModeRef.current) {
        const price = priceAt(e.clientY)
        if (price != null) onPlaceLevelRef.current?.(price)
        return
      }
      // if (drawModeRef.current) {
      //   const rect = container.getBoundingClientRect()
      //   const entryPrice = priceAt(e.clientY)
      //   if (entryPrice == null) return
      //   draw = { direction: drawModeRef.current, entryPrice, x0: e.clientX - rect.left }
      //   setDrawPreview(zoneFromDrag(draw, entryPrice, draw.x0))
      // }
    }
    const onPointerMove = (e) => {
      if (drag) {
        const price = priceAt(e.clientY)
        if (price == null) return
        orderLinesRef.current.get(`${drag.orderId}:${drag.field}:${drag.legId}`)?.applyOptions({ price })
        return
      }
      // if (draw) {
      //   const rect = container.getBoundingClientRect()
      //   const dragPrice = priceAt(e.clientY)
      //   if (dragPrice == null) return
      //   setDrawPreview(zoneFromDrag(draw, dragPrice, e.clientX - rect.left))
      // }
    }
    const onPointerUp = (e) => {
      if (drag) {
        const { orderId, field, legId } = drag
        const price = priceAt(e.clientY)
        drag = null
        chart.applyOptions({ handleScroll: true, handleScale: true })
        container.style.cursor = ''
        if (price != null) onAdjustRef.current?.(orderId, field, price, legId)
        return
      }
      // if (draw) {
      //   const dragPrice = priceAt(e.clientY)
      //   const rect = container.getBoundingClientRect()
      //   const zone = dragPrice != null ? zoneFromDrag(draw, dragPrice, e.clientX - rect.left) : null
      //   draw = null
      //   setDrawPreview(null)
      //   if (zone && zone.target !== zone.entryPrice) onDrawCompleteRef.current?.(zone)
      // }
    }

    container.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [resetKey])

  // Indicator SERIES objects only change when the indicator list itself changes - not on every
  // bar step, so their zoom-affecting add/remove doesn't fire during normal replay. Oscillators
  // (RSI - anything with `pane: 'separate'`, see lib/indicators.js) get their own pane below the
  // candles via lightweight-charts' multi-pane support, fixed to a 0-100 scale with 30/70
  // reference lines, rather than overlaying the price series like EMA/SMA do.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    indicatorSeriesRef.current.forEach((series) => chart.removeSeries(series))
    const hasOscillator = indicators.some((ind) => INDICATOR_TYPES[ind.type]?.pane === 'separate')
    if (!hasOscillator && chart.panes().length > 1) chart.removePane(1)
    const next = new Map()
    indicators.forEach((ind, i) => {
      const separatePane = INDICATOR_TYPES[ind.type]?.pane === 'separate'
      const series = chart.addSeries(
        LineSeries,
        {
          color: INDICATOR_COLORS[i % INDICATOR_COLORS.length],
          lineWidth: 1,
          crosshairMarkerVisible: false,
          lastValueVisible: separatePane,
          priceLineVisible: false,
        },
        separatePane ? 1 : 0,
      )
      if (separatePane) {
        series.priceScale().applyOptions({ autoScale: false })
        series.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) })
        // Configurable in Settings (store.js's rsiLevels) - not just the usual 30/70,
        // any number of reference lines. >=50 reads as "overbought" (down color), below as
        // "oversold" (up color), same convention as the classic 30/70 pair.
        settings.rsiLevels.forEach((level) => {
          series.createPriceLine({
            price: level,
            color: level >= 50 ? settings.bodyDownColor : settings.bodyUpColor,
            lineWidth: 1,
            lineStyle: 2,
            title: String(level),
          })
        })
      }
      next.set(ind.key, series)
    })
    indicatorSeriesRef.current = next
    const panes = chart.panes()
    if (panes[1]) {
      panes[0].setStretchFactor(3)
      panes[1].setStretchFactor(1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators, resetKey, settings.rsiLevels, settings.bodyUpColor, settings.bodyDownColor])

  // Data updates - runs on every bar step, but only ever calls .setData() on already-existing
  // series, never recreates the chart. The initial view only fires once per resetKey (first data
  // after a symbol/timeframe change or fresh replay start), never on subsequent steps - and shows
  // just the most recent INITIAL_VISIBLE_BARS bars rather than fitContent()'ing the entire
  // history (which, starting deep into a symbol's history, would zoom out to cram thousands of
  // candles into view instead of a readable recent window).
  useEffect(() => {
    const candles = candleSeriesRef.current
    if (!candles || bars.length === 0) return
    candles.setData(
      bars.map((b) => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close })),
    )
    const indicatorBars = bars.map((b) => ({ time: b.date, close: b.close }))
    indicators.forEach((ind) => {
      const series = indicatorSeriesRef.current.get(ind.key)
      if (!series) return
      series.setData(INDICATOR_TYPES[ind.type].compute(indicatorBars, ind.period))
    })
    if (!hasFitRef.current) {
      if (bars.length > INITIAL_VISIBLE_BARS) {
        chartRef.current
          ?.timeScale()
          .setVisibleLogicalRange({ from: bars.length - INITIAL_VISIBLE_BARS, to: bars.length - 1 })
      } else {
        chartRef.current?.timeScale().fitContent()
      }
      hasFitRef.current = true
    }
  }, [bars, indicators])

  // Entry/SL/target lines for every order (pending limits get a dotted amber entry line, filled
  // positions get a dashed gray one) - redrawn whenever the order list changes, or a new bar
  // reveals a fresh close, so the entry line's label can show the position's live return. Keyed
  // by `orderId:role` so the drag effect above can reposition a single line without a full redraw.
  useEffect(() => {
    const candles = candleSeriesRef.current
    if (!candles) return
    orderLinesRef.current.forEach((line) => candles.removePriceLine(line))
    const next = new Map()
    const lastClose = bars.length ? bars[bars.length - 1].close : null
    orders.forEach((order) => {
      const pending = order.status === 'pending'
      let entryTitle = pending ? 'Limit' : 'Entry'
      if (!pending && lastClose != null) {
        const pct = tradeReturnPct({
          direction: order.direction,
          entry_price: order.entryPrice,
          exit_price: lastClose,
        })
        if (pct != null) entryTitle = `${order.quantity}  ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
      }
      next.set(
        `${order.id}:entry`,
        candles.createPriceLine({
          price: order.entryPrice,
          color: pending ? '#eab308' : '#9ca3af',
          lineWidth: 1,
          lineStyle: pending ? 3 : 2,
          title: entryTitle,
        }),
      )
      const slLegs = order.stopLosses ?? []
      slLegs.forEach((leg, i) => {
        next.set(
          `${order.id}:stopLoss:${leg.id}`,
          candles.createPriceLine({
            price: leg.price,
            color: COLORS.down,
            lineWidth: 1,
            lineStyle: 2,
            title: slLegs.length > 1 ? `SL${i + 1} ${leg.qty}` : 'SL',
          }),
        )
      })
      const targetLegs = order.targets ?? []
      targetLegs.forEach((leg, i) => {
        next.set(
          `${order.id}:target:${leg.id}`,
          candles.createPriceLine({
            price: leg.price,
            color: COLORS.up,
            lineWidth: 1,
            lineStyle: 2,
            title: targetLegs.length > 1 ? `T${i + 1} ${leg.qty}` : 'Target',
          }),
        )
      })
    })
    orderLinesRef.current = next
  }, [orders, resetKey, bars])

  // Live preview lines while the order ticket is open (dotted, distinct from confirmed orders'
  // lines above) - updates as the user edits the dialog, before anything is actually placed.
  useEffect(() => {
    const candles = candleSeriesRef.current
    if (!candles) return
    previewLinesRef.current.forEach((line) => candles.removePriceLine(line))
    previewLinesRef.current = []
    if (previewOrder) {
      previewLinesRef.current.push(
        candles.createPriceLine({
          price: previewOrder.entry,
          color: '#9ca3af',
          lineWidth: 1,
          lineStyle: 1,
          title: previewOrder.direction === 'long' ? 'Buy' : 'Sell',
        }),
      )
      ;(previewOrder.stop_losses ?? []).forEach((price, i, arr) => {
        previewLinesRef.current.push(
          candles.createPriceLine({
            price,
            color: COLORS.down,
            lineWidth: 1,
            lineStyle: 1,
            title: arr.length > 1 ? `SL${i + 1}` : 'SL',
          }),
        )
      })
      ;(previewOrder.targets ?? []).forEach((price, i, arr) => {
        previewLinesRef.current.push(
          candles.createPriceLine({
            price,
            color: COLORS.up,
            lineWidth: 1,
            lineStyle: 1,
            title: arr.length > 1 ? `T${i + 1}` : 'Target',
          }),
        )
      })
    }
  }, [previewOrder, resetKey])

  return (
    <div ref={containerRef} className="absolute inset-0 z-0">
      {bars.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Pick a symbol and start replay.
        </div>
      )}
      {/* Draw long/short tool - disabled for now, kept for later.
      {drawPreview && <DrawZone zone={drawPreview} candles={candleSeriesRef.current} />}
      {drawings.map((zone) => (
        <DrawZone
          key={zone.id}
          zone={zone}
          candles={candleSeriesRef.current}
          onClick={() => onConvertDrawing?.(zone)}
        />
      ))}
      */}
    </div>
  )
})

export default ReplayChart

// Green/red zone box for the "Draw long/short" tool (colored purely by tool direction - long:
// green above entry, red below; short: flipped - not by which way the pointer moved, matching
// TradingView's Long/Short Position tool). Used both for the live in-progress drag (no onClick,
// pointer-events off so it never blocks the gesture creating it) and for zones that have already
// been dropped onto the chart (clickable - onClick converts it into an order ticket).
// function DrawZone({ zone, candles, onClick }) {
//   if (!candles) return null
//   const { direction, entryPrice, target, stopLoss, x0, x1 } = zone
//   const entryY = candles.priceToCoordinate(entryPrice)
//   const targetY = candles.priceToCoordinate(target)
//   const stopY = candles.priceToCoordinate(stopLoss)
//   if (entryY == null || targetY == null || stopY == null) return null
//   const isLong = direction === 'long'
//   const upperY = Math.min(targetY, stopY)
//   const lowerY = Math.max(targetY, stopY)
//   const rewardPct = (Math.abs(target - entryPrice) / entryPrice) * 100
//   const riskPct = (Math.abs(stopLoss - entryPrice) / entryPrice) * 100
//   const left = Math.min(x0, x1)
//   const width = Math.max(Math.abs(x1 - x0), 100)
//   const upColor = 'rgba(34, 197, 94, 0.22)'
//   const downColor = 'rgba(239, 68, 68, 0.22)'
//
//   return (
//     <div
//       className={onClick ? 'absolute cursor-pointer' : 'pointer-events-none absolute'}
//       style={{ left, top: upperY, width, height: lowerY - upperY }}
//       onClick={onClick}
//       title={onClick ? 'Click to convert to an order' : undefined}
//     >
//       <div
//         className="absolute inset-x-0 flex items-start justify-center pt-1 text-xs font-medium text-white"
//         style={{ top: 0, height: entryY - upperY, background: isLong ? upColor : downColor }}
//       >
//         {isLong ? `Target ${inr(target)} +${rewardPct.toFixed(2)}%` : `SL ${inr(stopLoss)} -${riskPct.toFixed(2)}%`}
//       </div>
//       <div
//         className="absolute inset-x-0 flex items-end justify-center pb-1 text-xs font-medium text-white"
//         style={{ top: entryY - upperY, height: lowerY - entryY, background: isLong ? downColor : upColor }}
//       >
//         {isLong ? `SL ${inr(stopLoss)} -${riskPct.toFixed(2)}%` : `Target ${inr(target)} +${rewardPct.toFixed(2)}%`}
//       </div>
//     </div>
//   )
// }
