import { useNavigate, useSearch } from '@tanstack/react-router'
import { usePageTitle } from '@/lib/usePageTitle'
import AgentChat from './AgentChat'

// The agent: ask, it answers, you read it. Workflows - the same tools with nobody watching - used to
// be a second tab here and are their own section at /workflows now; this page is only the chat.
// `session` is the open conversation, so a pasted link carries it.
export default function AgentPage() {
  usePageTitle('Agent')
  const navigate = useNavigate()
  const { session } = useSearch({ from: '/agent' })

  return (
    <div className="h-[calc(100vh-5rem)] overflow-hidden rounded-xl border bg-card">
      <AgentChat
        sessionId={session ?? null}
        onSessionChange={(id) => navigate({ to: '/agent', search: { session: id } })}
      />
    </div>
  )
}
