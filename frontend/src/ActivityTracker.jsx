import { useEffect, useRef } from 'react'

const FLUSH_INTERVAL_MS = 20_000
const RECONNECT_DELAY_MS = 5_000

function socketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/activity`
}

// No visible UI - accumulates elapsed foreground time (paused while the tab is hidden/blurred)
// and sends it over one persistent WebSocket connection, socket-only (no REST heartbeat
// endpoint at all). If the socket isn't open yet (or dropped and is reconnecting), the elapsed
// time just keeps accumulating locally instead of being sent or dropped - the next successful
// flush sends the full backlog. Purely local: the numbers only ever come back to this same app's
// own Profile modal.
export default function ActivityTracker() {
  const accumulatedRef = useRef(0)
  const lastTickRef = useRef(document.visibilityState === 'visible' ? Date.now() : null)
  const socketRef = useRef(null)

  useEffect(() => {
    let reconnectTimer = null
    let stopped = false

    const connect = () => {
      const ws = new WebSocket(socketUrl())
      socketRef.current = ws
      ws.onclose = () => {
        socketRef.current = null
        if (!stopped) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS)
      }
      ws.onerror = () => ws.close()
    }
    connect()

    const tick = () => {
      if (lastTickRef.current != null) {
        accumulatedRef.current += (Date.now() - lastTickRef.current) / 1000
      }
      lastTickRef.current = document.visibilityState === 'visible' ? Date.now() : null
    }

    const flush = () => {
      tick()
      const seconds = Math.round(accumulatedRef.current)
      if (seconds <= 0) return
      if (socketRef.current?.readyState !== WebSocket.OPEN) return // keep accumulating, don't lose it
      socketRef.current.send(JSON.stringify({ seconds }))
      accumulatedRef.current = 0
    }

    const interval = setInterval(flush, FLUSH_INTERVAL_MS)

    const onVisibilityChange = () => {
      tick()
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('beforeunload', flush)

    return () => {
      stopped = true
      clearInterval(interval)
      clearTimeout(reconnectTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('beforeunload', flush)
      flush()
      socketRef.current?.close()
    }
  }, [])

  return null
}
