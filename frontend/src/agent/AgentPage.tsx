import { useNavigate, useSearch } from '@tanstack/react-router'
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { usePageTitle } from '@/lib/usePageTitle'
import AgentChat from './AgentChat'
import WorkflowTab from './WorkflowTab'

// One page, two ways of putting the agent to work.
//
// **Chat** is hand-driven: you ask, it answers, you read it. **Workflow** is the same agent with
// nobody watching - a saved instruction that runs on a schedule and files what it found. The split
// is who pulls the trigger, which is why they are tabs on one page rather than two pages: the
// tools, the model and the run history are identical.
//
// Same Tabs component the Backtesting page uses, so the two read as the same app.
export default function AgentPage() {
  usePageTitle('Agent')
  const navigate = useNavigate()
  const { view, session } = useSearch({ from: '/agent' })

  const setSearch = (next: { view?: string; session?: string }) =>
    navigate({ to: '/agent', search: (prev) => ({ ...prev, ...next }) as never })

  return (
    <Tabs
      value={view}
      onValueChange={(next) => setSearch({ view: next as string })}
      className="flex h-[calc(100vh-5rem)] flex-col gap-3"
    >
      <TabsList className="shrink-0 self-start">
        <TabsTab value="chat">Chat</TabsTab>
        <TabsTab value="workflow">Workflow</TabsTab>
        <TabsIndicator />
      </TabsList>

      {/* The panels own the remaining height rather than scrolling the page - both a transcript
          and a canvas need a definite height to size against. */}
      <TabsPanel value="chat" className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-card">
        <AgentChat sessionId={session ?? null} onSessionChange={(id) => setSearch({ session: id })} />
      </TabsPanel>
      <TabsPanel value="workflow" className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-card">
        <WorkflowTab />
      </TabsPanel>
    </Tabs>
  )
}
