import { useRef } from 'react'
import { Outlet, useLocation, useNavigate, useSearch } from '@tanstack/react-router'
import { Tabs, TabsIndicator, TabsList, TabsTab } from '@/components/ui/tabs'
import { usePageTitle } from '@/lib/usePageTitle'
import AgentChat from './AgentChat'

// One page, two ways of putting the agent to work.
//
// **Chat** is hand-driven: you ask, it answers, you read it. **Workflow** is the same agent with
// nobody watching - a saved instruction that runs on a schedule and files what it found. The split
// is who pulls the trigger, which is why they are tabs on one page rather than two pages: the
// tools, the model and the run history are identical.
//
// This is the layout; each screen under it is its own route (router.tsx), so the tabs read the
// URL rather than owning it. Same Tabs component the Backtesting page uses.
export default function AgentPage() {
  usePageTitle('Agent')
  const navigate = useNavigate()
  const onWorkflows = useLocation({ select: (l) => l.pathname.startsWith('/agent/workflows') })
  const { session } = useSearch({ strict: false }) as { session?: string }

  // The chat you were in, so Workflow -> Chat returns to it instead of an empty transcript. The
  // layout stays mounted across its child routes, so a ref outlives the tab switch.
  const lastSession = useRef(session)
  if (!onWorkflows) lastSession.current = session

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col gap-3">
      <Tabs
        value={onWorkflows ? 'workflow' : 'chat'}
        onValueChange={(next) =>
          next === 'workflow'
            ? navigate({ to: '/agent/workflows' })
            : navigate({ to: '/agent', search: { session: lastSession.current } })
        }
        className="shrink-0 self-start"
      >
        <TabsList>
          <TabsTab value="chat">Chat</TabsTab>
          <TabsTab value="workflow">Workflow</TabsTab>
          <TabsIndicator />
        </TabsList>
      </Tabs>

      {/* The screens own the remaining height rather than scrolling the page - both a transcript
          and a canvas need a definite height to size against. */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-card">
        <Outlet />
      </div>
    </div>
  )
}

export function AgentChatView() {
  const navigate = useNavigate()
  const { session } = useSearch({ from: '/agent/' })
  return (
    <AgentChat
      sessionId={session ?? null}
      onSessionChange={(id) => navigate({ to: '/agent', search: { session: id } })}
    />
  )
}
