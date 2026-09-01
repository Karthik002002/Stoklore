import { useEffect } from 'react'
import {
  addSeconds,
  dayKey,
  liveWatchers,
  markSynced,
  pendingSync,
  prune,
  publishLive,
  readStore,
  secondsOn,
  writeStore,
} from '@/lib/activityTime'
import { postActivityTime } from '@/services/api'

// How often the accumulated time is written to localStorage. Cheap (one small JSON string), and
// frequent enough that a hard crash loses seconds rather than a session.
const SAVE_INTERVAL_MS = 10_000
// How often the backlog is pushed to the server. Deliberately slow: the number on screen comes
// from localStorage, so this is a background catch-up for the year graph, not a heartbeat the
// feature depends on. It replaces a socket that ticked every 20s and retried every 5s when it
// couldn't connect - that retry storm was the bug, and there is nothing to retry now.
const SYNC_INTERVAL_MS = 120_000
// No pointer, key or scroll for this long and the tab is not being USED, whatever the visibility
// API says. A chart left open on a second monitor all afternoon is not five hours of practice.
const IDLE_AFTER_MS = 5 * 60_000
// Cadence of the on-screen counter. Runs only while something is subscribed (the Profile modal
// being open), and never touches storage - persistence stays on SAVE_INTERVAL_MS.
const LIVE_INTERVAL_MS = 1_000

// No visible UI. Counts foreground, non-idle time into localStorage (per local calendar day) and
// occasionally tells the server, so the Profile modal's "today" is right even when the sync isn't
// working at all. See lib/activityTime.js for why the server stopped being the ledger.
export default function ActivityTracker() {
  useEffect(() => {
    let store = prune(readStore())
    let pending = 0 // seconds counted but not yet written to localStorage
    let lastTick = Date.now()
    let lastInput = Date.now()
    let syncing = false

    const active = () => document.visibilityState === 'visible' && Date.now() - lastInput < IDLE_AFTER_MS

    // Bank the time since the last call. Every path (save, sync, tab hidden, unmount) goes through
    // here first, so no branch can lose the slice it was sitting on.
    const tick = () => {
      const now = Date.now()
      const elapsed = (now - lastTick) / 1000
      lastTick = now
      // Only count it if the tab was active for that whole slice, and cap at one interval: a laptop
      // resuming from sleep reports hours since the last tick, none of it spent here.
      if (active() && elapsed > 0) pending += Math.min(elapsed, SAVE_INTERVAL_MS / 1000)
    }

    const save = () => {
      tick()
      if (pending < 1) return
      store = addSeconds(store, dayKey(), pending)
      pending = 0
      writeStore(store)
    }

    const sync = async () => {
      save()
      const days = pendingSync(store)
      if (!days.length || syncing) return
      syncing = true
      try {
        await postActivityTime(days)
        // Re-read first: `save()` may have run while the request was in flight, and markSynced
        // credits only what was actually sent.
        store = markSynced({ ...readStore(), ...store }, days)
        writeStore(store)
      } catch {
        // Nothing to do and nothing lost - the backlog stays in the store and the next sync (or
        // the next page load) sends it. This is exactly the case the old socket dropped.
      } finally {
        syncing = false
      }
    }

    // Passive listeners, and only a timestamp written - this runs on every mousemove.
    const onInput = () => {
      // Coming back from idle: bank the (uncounted) gap before moving the marker, or the first
      // tick after it would credit the whole idle stretch.
      tick()
      lastInput = Date.now()
    }
    const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll']
    for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { passive: true })

    const onVisibility = () => {
      tick()
      if (document.visibilityState === 'visible') {
        // A tab that has just been switched back to is being used by definition, whatever the last
        // input timestamp says.
        lastInput = Date.now()
      } else {
        save()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    // Last chance to bank the current slice. Only localStorage - a request started here is not
    // reliably delivered, and the seconds are safe in the store for the next load to sync.
    const onUnload = () => save()
    window.addEventListener('pagehide', onUnload)

    // Banked + the slice not yet written, so the number moves every second instead of stepping
    // 10s at a time. Skipped entirely when nobody is watching.
    const publish = () => {
      if (!liveWatchers()) return
      tick()
      publishLive(secondsOn(store, dayKey()) + Math.round(pending))
    }

    const liveTimer = setInterval(publish, LIVE_INTERVAL_MS)
    const saveTimer = setInterval(save, SAVE_INTERVAL_MS)
    const syncTimer = setInterval(sync, SYNC_INTERVAL_MS)
    // Catch up on anything an earlier session couldn't deliver, without waiting two minutes.
    sync()

    return () => {
      clearInterval(liveTimer)
      clearInterval(saveTimer)
      clearInterval(syncTimer)
      for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onUnload)
      save()
    }
  }, [])

  return null
}
