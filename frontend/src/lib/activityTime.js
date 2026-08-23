// Where time-on-app is actually counted: localStorage, per calendar day, on this machine.
//
// It used to be counted on the server - one WebSocket per tab, a tick every 20s, and a reconnect
// attempt every 5s whenever that socket wouldn't open. When the socket was unavailable the ticks
// had nowhere to go, so the day's total stayed at 0 while the reconnect loop hammered away: the
// number the Profile modal exists to show was the one thing the design couldn't survive losing.
//
// So the browser keeps the tally and the server gets told occasionally. A failed sync now costs
// nothing - the seconds are already banked locally, the unsynced remainder is carried, and the
// next successful flush sends it (for the right DAY, not for whenever the sync happened to land).
//
// Shape: { "2026-08-23": { total: 900, synced: 880 }, ... }
//   total  - seconds counted on this machine that day
//   synced - how much of it the server has already been told about
// The difference is the backlog. Everything below is pure except readStore/writeStore, so the
// arithmetic is checkable under plain node: src/lib/activityTime.selfcheck.mjs
//
// Days are LOCAL calendar days (see dayKey) - the user's day, not the database server's UTC one.

export const STORAGE_KEY = 'activity.time'

// A day older than this is dropped: unsynced time from two weeks ago is not worth carrying, and
// the year-long graph lives on the server anyway.
export const KEEP_DAYS = 14

/** "YYYY-MM-DD" in the LOCAL timezone. Deliberately not toISOString().slice(0, 10), which is UTC -
 *  that files an 11pm IST session under tomorrow and splits one evening across two days. */
export function dayKey(at = new Date()) {
  const y = at.getFullYear()
  const m = String(at.getMonth() + 1).padStart(2, '0')
  const d = String(at.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Adds seconds to a day's tally. Returns a NEW store; negative/zero/NaN adds are ignored rather
 *  than corrupting the total (a clock jumping backwards is the realistic source of those). */
export function addSeconds(store, day, seconds) {
  if (!(seconds > 0)) return store
  const prev = store[day] ?? { total: 0, synced: 0 }
  return { ...store, [day]: { ...prev, total: prev.total + seconds } }
}

/** What the server hasn't been told yet, oldest day first. Each entry is one day's backlog, so a
 *  session that spanned midnight (or a sync that failed all evening) still lands on the day it
 *  was actually spent. */
export function pendingSync(store) {
  return Object.entries(store)
    .map(([date, day]) => ({ date, seconds: Math.round(day.total - day.synced) }))
    .filter((d) => d.seconds > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Records that `sent` (the array pendingSync returned) made it to the server.
 *
 *  Re-reads `total` from the CURRENT store rather than trusting what was sent: time keeps being
 *  counted while the request is in flight, and setting synced = total here would silently swallow
 *  whatever accumulated in between. */
export function markSynced(store, sent) {
  const next = { ...store }
  for (const { date, seconds } of sent) {
    const day = next[date]
    if (day) next[date] = { ...day, synced: Math.min(day.total, day.synced + seconds) }
  }
  return next
}

/** Drops days older than KEEP_DAYS, synced or not. */
export function prune(store, today = dayKey()) {
  const cutoff = new Date(`${today}T00:00:00`)
  cutoff.setDate(cutoff.getDate() - KEEP_DAYS)
  const oldest = dayKey(cutoff)
  return Object.fromEntries(Object.entries(store).filter(([date]) => date >= oldest))
}

export const secondsOn = (store, day = dayKey()) => Math.round(store[day]?.total ?? 0)

// --- live readout -------------------------------------------------------------------------------
// The ledger is only written every ~10s (see ActivityTracker), which is right for persistence and
// wrong for a counter someone is watching. So the tracker publishes a per-second figure - banked
// plus the slice it is currently holding - and anything on screen subscribes to that instead of
// re-reading storage.
//
// Nothing is computed unless someone is actually looking: the tracker checks `liveWatchers()` and
// skips the whole per-second path when the set is empty, which is every moment the Profile modal
// is closed.

const liveListeners = new Set()

export const liveWatchers = () => liveListeners.size

export function publishLive(seconds) {
  for (const fn of liveListeners) fn(seconds)
}

/** Subscribe to the live count; returns the unsubscribe.
 *
 *  Deliberately does NOT replay the last published value: publishing stops while nobody is
 *  watching, so that value is from whenever the previous watcher left and replaying it would tick
 *  the counter BACKWARDS for the one second before the next publish. Subscribers seed themselves
 *  from the store instead (which is at most one save interval behind, and never wrong). */
export function subscribeLive(fn) {
  liveListeners.add(fn)
  return () => liveListeners.delete(fn)
}

// --- localStorage edges -------------------------------------------------------------------------
// Wrapped in try/catch, not because quota is a real risk for a handful of small numbers, but
// because localStorage throws outright in some privacy modes - and a consistency tracker must never
// be the reason the app fails to render.

export function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function writeStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Counting continues in memory for this session; only the persistence is lost.
  }
}
