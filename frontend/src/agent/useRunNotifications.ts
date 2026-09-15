import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { getAgentRuns, getRecentWorkflowNotifications } from '@/services/api'
import type { AgentRun, WorkflowNotification } from '@/services/api'

// Tells you when something finishes while you're looking at something else.
//
// Mounted app-wide (App.tsx), not on one page: the whole point is that you left. Two sources:
//   - **chat runs** leaving the running list (already polled for the sidebar's spinners);
//   - **workflow notifications** the server decided to deliver. A workflow's own rules (mute,
//     snooze, quiet hours, which events) are applied server-side, so a muted workflow never pops up
//     here - which is why workflow runs are NOT announced off the running list as well.
//
// **Scope, honestly:** this fires while the app is open in some tab. With the browser closed, a
// workflow's notification waits in its inbox - or reaches Telegram, if that workflow sends there.
export const canNotify = () => typeof Notification !== 'undefined'

// Stable, for the same reason WatchlistManager needs one: a `= []` destructuring default is a new
// array every render while `data` is undefined, and this one is an effect dependency.
const NO_RUNS: AgentRun[] = []
const NO_NOTES: WorkflowNotification[] = []

/** Must be called from a click - browsers refuse an unprompted permission request, and asking on
 *  page load is how a site gets permanently blocked. */
export async function askToNotify() {
  if (!canNotify()) return 'denied'
  return Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
}

export default function useRunNotifications() {
  const navigate = useNavigate()
  const allowed = canNotify() && Notification.permission === 'granted'

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
    if (!before || !allowed) return

    for (const id of before) {
      if (now.has(id)) continue
      // It left the running list. Ask what it was rather than remembering: a run row carries its
      // own prompt and outcome, and this way a failure reads as a failure.
      getAgentRuns({})
        .then((all) => all.find((r) => r.id === id))
        .then((run) => {
          if (!run || run.workflow_id) return
          const failed = run.status === 'failed'
          new Notification(failed ? 'Run failed' : 'Run finished', {
            body: `${run.prompt}\n${failed ? (run.error ?? '') : (run.reply ?? '')}`.slice(0, 180),
            tag: run.id,
          })
        })
        .catch(() => {})
    }
  }, [running, allowed])

  // Workflow notifications delivered since the app opened. `since` only moves forward, so each
  // one pops up once; clicking it opens that notification in its workflow's inbox.
  const since = useRef(new Date().toISOString())
  const shown = useRef(new Set<number>())
  const { data: delivered = NO_NOTES } = useQuery({
    queryKey: ['workflowNotificationsRecent'],
    queryFn: () => getRecentWorkflowNotifications(since.current),
    refetchInterval: 5000,
    enabled: allowed,
  })

  useEffect(() => {
    for (const note of delivered) {
      if (shown.current.has(note.id)) continue
      shown.current.add(note.id)
      if (note.meta.delivered_at && note.meta.delivered_at > since.current)
        since.current = note.meta.delivered_at
      const workflowId = note.meta.workflow_id
      const popup = new Notification(note.workflow_name ?? 'Workflow', {
        body: (note.message ?? '').slice(0, 180),
        tag: `workflow-notification-${note.id}`,
      })
      popup.onclick = () => {
        window.focus()
        if (workflowId) {
          navigate({
            to: '/workflows/$workflowId/notifications',
            params: { workflowId },
            search: { open: note.id },
          })
        }
        popup.close()
      }
    }
  }, [delivered, navigate])
}
