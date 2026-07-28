import { useEffect, useRef } from 'react'
import { CandlestickSeries, LineSeries, createChart } from 'lightweight-charts'
import { INDICATOR_COLORS, INDICATOR_TYPES } from '@/lib/indicators'

const COLORS = { up: '#22c55e', down: '#ef4444', text: '#9ca3af', grid: 'rgba(148, 163, 184, 0.15)' }

// How many of the most recent bars the chart shows on its first render (per symbol/timeframe/
// replay-start) - after that, zoom/pan is entirely user-controlled (see the chart's fitContent
// comment below).
const INITIAL_VISIBLE_BARS = 200

// How close (in px) a pointer-down needs to land next to a stop-loss/target line to grab it for
// dragging - see the drag-to-adjust effect below.
const DRAG_HIT_PX = 6

// Chart/series objects live in refs and persist across bar steps - only `resetKey` (symbol +
// timeframe) tears down and recreates the chart. Every other update (new bar revealed,
// indicator data) goes through .setData() on the existing series, so a user's zoom/pan survives
// stepping or playing forward instead of being wiped by fitContent() on every single bar.
export default function ReplayChart({ bars, indicators, orders, previewOrder, resetKey, onAdjustOrder }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const candleSeriesRef = useRef(null)
  const indicatorSeriesRef = useRef(new Map())
  const orderLinesRef = useRef(new Map())
  const previewLinesRef = useRef([])
  const hasFitRef = useRef(false)

  // Drag handlers close over ordersRef/onAdjustRef instead of orders/onAdjustOrder directly so
  // the pointer listeners only need attaching once per chart instance, not on every order change.
  const ordersRef = useRef(orders)
  ordersRef.current = orders
  const onAdjustRef = useRef(onAdjustOrder)
  onAdjustRef.current = onAdjustOrder

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
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
      borderVisible: false,
    })
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
  }, [resetKey])

  // Drag-to-adjust for open orders' stop-loss/target lines: pointerdown near a line grabs it
  // (and pauses chart pan/zoom so a vertical drag doesn't also scrub the timeline), pointermove
  // repositions the line live via applyOptions (cheap, no React re-render), pointerup commits the
  // final price to the caller. Bound once per chart instance (not per order-list change) via refs.
  useEffect(() => {
    const container = containerRef.current
    const chart = chartRef.current
    if (!container || !chart) return

    let drag = null // { orderId, field }

    const priceAt = (clientY) => {
      const rect = container.getBoundingClientRect()
      return candleSeriesRef.current?.coordinateToPrice(clientY - rect.top) ?? null
    }
    const coordFor = (price) => candleSeriesRef.current?.priceToCoordinate(price) ?? null

    const findHandle = (clientY) => {
      const rect = container.getBoundingClientRect()
      const y = clientY - rect.top
      for (const order of ordersRef.current) {
        if (order.status !== 'open') continue
        for (const field of ['stopLoss', 'target']) {
          const price = order[field]
          if (price == null) continue
          const coord = coordFor(price)
          if (coord != null && Math.abs(coord - y) <= DRAG_HIT_PX) return { orderId: order.id, field }
        }
      }
      return null
    }

    const onPointerDown = (e) => {
      const handle = findHandle(e.clientY)
      if (!handle) return
      drag = handle
      chart.applyOptions({ handleScroll: false, handleScale: false })
      container.style.cursor = 'ns-resize'
    }
    const onPointerMove = (e) => {
      if (!drag) return
      const price = priceAt(e.clientY)
      if (price == null) return
      orderLinesRef.current.get(`${drag.orderId}:${drag.field}`)?.applyOptions({ price })
    }
    const onPointerUp = (e) => {
      if (!drag) return
      const { orderId, field } = drag
      const price = priceAt(e.clientY)
      drag = null
      chart.applyOptions({ handleScroll: true, handleScale: true })
      container.style.cursor = ''
      if (price != null) onAdjustRef.current?.(orderId, field, price)
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
  // bar step, so their zoom-affecting add/remove doesn't fire during normal replay.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    indicatorSeriesRef.current.forEach((series) => chart.removeSeries(series))
    const next = new Map()
    indicators.forEach((ind, i) => {
      next.set(
        ind.key,
        chart.addSeries(LineSeries, {
          color: INDICATOR_COLORS[i % INDICATOR_COLORS.length],
          lineWidth: 1,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
        }),
      )
    })
    indicatorSeriesRef.current = next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators, resetKey])

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
  // positions get a dashed gray one) - redrawn whenever the order list changes. Keyed by
  // `orderId:role` so the drag effect above can reposition a single line without a full redraw.
  useEffect(() => {
    const candles = candleSeriesRef.current
    if (!candles) return
    orderLinesRef.current.forEach((line) => candles.removePriceLine(line))
    const next = new Map()
    orders.forEach((order) => {
      const pending = order.status === 'pending'
      next.set(
        `${order.id}:entry`,
        candles.createPriceLine({
          price: order.entryPrice,
          color: pending ? '#eab308' : '#9ca3af',
          lineWidth: 1,
          lineStyle: pending ? 3 : 2,
          title: pending ? 'Limit' : 'Entry',
        }),
      )
      if (order.stopLoss != null) {
        next.set(
          `${order.id}:stopLoss`,
          candles.createPriceLine({
            price: order.stopLoss,
            color: COLORS.down,
            lineWidth: 1,
            lineStyle: 2,
            title: 'SL',
          }),
        )
      }
      if (order.target != null) {
        next.set(
          `${order.id}:target`,
          candles.createPriceLine({
            price: order.target,
            color: COLORS.up,
            lineWidth: 1,
            lineStyle: 2,
            title: 'Target',
          }),
        )
      }
    })
    orderLinesRef.current = next
  }, [orders, resetKey])

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
      if (previewOrder.stop_loss != null) {
        previewLinesRef.current.push(
          candles.createPriceLine({
            price: previewOrder.stop_loss,
            color: COLORS.down,
            lineWidth: 1,
            lineStyle: 1,
            title: 'SL',
          }),
        )
      }
      if (previewOrder.target != null) {
        previewLinesRef.current.push(
          candles.createPriceLine({
            price: previewOrder.target,
            color: COLORS.up,
            lineWidth: 1,
            lineStyle: 1,
            title: 'Target',
          }),
        )
      }
    }
  }, [previewOrder, resetKey])

  return (
    <div ref={containerRef} className="absolute inset-0 z-0">
      {bars.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Pick a symbol and start replay.
        </div>
      )}
    </div>
  )
}
