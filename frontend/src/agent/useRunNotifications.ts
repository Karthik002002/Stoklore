import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAgentRuns } from '@/services/api'
import type { AgentRun } from '@/services/api'

// Tells you when a background run finishes while you're looking at something else.
//
// Mounted app-wide (App.tsx), not on the agent page: the whole point is that you left. It watches
// the running list - already polled for the sidebar's spinners, so this costs no extra request -
// and notifies on the transition out of it.
//
// **Scope, honestly:** this fires while the app is open in some tab. A workflow that runs at 09:15
// with the browser closed files to the alerts feed and waits for you there; a real push would need
// a service worker and a subscription the server can reach, which is a different feature.
export const canNotify = () => typeof Notification !== 'undefined'

// Stable, for the same reason WatchlistManager needs one: a `= []` destructuring default is a new
// array every render while `data` is undefined, and this one is an effect dependency.
const NO_RUNS: AgentRun[] = []

/** Must be called from a click - browsers refuse an unprompted permission request, and asking on
 *  page load is how a site gets permanently blocked. */
export async function askToNotify() {
  if (!canNotify()) return 'denied'
  return Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
}

export default function useRunNotifications() {
  const { data: running = NO_RUNS } = useQuery({
    queryKey: ['agentRunsRunning'],
    queryFn: () => getAgentRuns({ status: 'running' }),
    refetchInterval: 5000,
  })

  // Undefined until the first poll lands: without that, every run already in flight when the app
  // opened would look like one that just finished.
  const previous = useRef<Set<string> | null>(null)

  useEffect(() => {
    const now = new Set(running.map((r) => r.id))
    const before = previous.current
    previous.current = now
    if (!before || !canNotify() || Notification.permission !== 'granted') return

    for (const id of before) {
      if (now.has(id)) continue
      // It left the running list. Ask what it was rather than remembering: a run row carries its
      // own prompt and outcome, and this way a failure reads as a failure.
      getAgentRuns({})
        .then((all) => all.find((r) => r.id === id))
        .then((run) => {
          if (!run) return
          const failed = run.status === 'failed'
          new Notification(failed ? 'Run failed' : 'Run finished', {
            body: `${run.prompt}\n${failed ? (run.error ?? '') : (run.reply ?? '')}`.slice(0, 180),
            tag: run.id,
          })
        })
        .catch(() => {})
    }
  }, [running])
}
