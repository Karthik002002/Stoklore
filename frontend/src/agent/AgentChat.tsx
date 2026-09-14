import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { MessageCircleIcon, SquarePenIcon, Trash2Icon } from 'lucide-react'
import ChatInput from '@/ChatInput'
import { ToolCallChip, slashCommands } from '@/ChatWidget'
import type { ToolPart } from '@/ChatWidget'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { getAgentRuns, startAgentRun } from '@/services/api'
import type { AgentRun, AgentRunEvent } from '@/services/api'

// The agent page's chat: many conversations down the left, one transcript on the right.
//
// **It does not use `useChat`.** The AI SDK's hook owns the request, so a run lives and dies with
// the fetch that started it - which is exactly the thing this page exists not to do. Here a turn
// is a row on the server (app/services/agent_runs.py): POST returns a run id, the work continues
// without us, and an EventSource replays the run from its beginning whenever we (re)connect. So
// navigating away, switching chats, or reloading loses nothing, and a chat still working shows a
// live dot in the sidebar even in a browser that never started it.

type Part =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; output?: unknown; error?: boolean }

type Msg = { id: string; role: 'user' | 'assistant'; parts: Part[] }

const newId = () => crypto.randomUUID()

/** Stored messages are plain text (chat_messages holds no parts) - tool calls come back from the
 *  run feed instead, which is the only place they exist. */
type StoredMessage = { id: string; role: 'user' | 'assistant'; parts: { type: string; text?: string }[] }

const toMsg = (m: StoredMessage): Msg => ({
  id: m.id,
  role: m.role,
  parts: [{ kind: 'text', text: m.parts.map((p) => p.text ?? '').join('') }],
})

/** What the model is given as history. The server windows it again; this only decides what the
 *  client claims is on screen. */
const historyOf = (messages: Msg[]) =>
  messages.map((m) => ({
    role: m.role,
    content: m.parts.map((p) => (p.kind === 'text' ? p.text : `[${p.name}]`)).join('\n'),
  }))

export default function AgentChat({
  sessionId,
  onSessionChange,
}: {
  sessionId: string | null
  onSessionChange: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState<Msg[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const sourceRef = useRef<EventSource | null>(null)

  const { data: sessions = [] } = useQuery({
    queryKey: ['chatSessions'],
    queryFn: () =>
      fetch('/api/chat/sessions').then((r) => r.json() as Promise<{ id: string; title: string | null }[]>),
  })

  // Which chats are still working, answered by the server. Polled rather than pushed: it is one
  // indexed read, and a chat that finished while this tab was on another page has to show up
  // without anything having told us.
  const { data: running = [] } = useQuery({
    queryKey: ['agentRunsRunning'],
    queryFn: () => getAgentRuns({ status: 'running' }),
    refetchInterval: 2000,
  })
  const runningSessions = new Set(running.map((r) => r.session_id))

  const upsertTool = useCallback((id: string, patch: Partial<Extract<Part, { kind: 'tool' }>>) => {
    setMessages((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (!last || last.role !== 'assistant') return prev
      const parts = [...last.parts]
      const at = parts.findIndex((p) => p.kind === 'tool' && p.id === id)
      if (at === -1) parts.push({ kind: 'tool', id, name: '', input: undefined, ...patch })
      else parts[at] = { ...parts[at], ...patch } as Part
      next[next.length - 1] = { ...last, parts }
      return next
    })
  }, [])

  /** Subscribe to a run. Replays from the start, so this is also how a reload catches up. */
  const watch = useCallback(
    (id: string) => {
      sourceRef.current?.close()
      const source = new EventSource(`/api/agent/runs/${id}/events`)
      sourceRef.current = source
      setRunId(id)

      source.onmessage = (e) => {
        if (e.data === '[DONE]') return source.close()
        const event = JSON.parse(e.data) as AgentRunEvent
        if (event.type === 'tool-input-available') {
          upsertTool(event.toolCallId, { name: event.toolName, input: event.input })
        } else if (event.type === 'tool-output-available') {
          upsertTool(event.toolCallId, { output: event.output, error: event.isError })
        } else if (event.type === 'done') {
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            const text = event.reply || (event.error ? `⚠️ ${event.error}` : '')
            if (last?.role === 'assistant') {
              next[next.length - 1] = { ...last, parts: [...last.parts, { kind: 'text', text }] }
            }
            return next
          })
          setRunId(null)
          source.close()
          queryClient.invalidateQueries({ queryKey: ['chatSessions'] })
          queryClient.invalidateQueries({ queryKey: ['agentRunsRunning'] })
          queryClient.invalidateQueries({ queryKey: ['agentWorkflow'] })
        } else if (event.type === 'error') {
          toast.error(event.error)
          setRunId(null)
          source.close()
        }
      }
      source.onerror = () => source.close()
    },
    [queryClient, upsertTool],
  )

  // Opening a session loads its transcript and rejoins whatever it is still doing. This is the
  // whole background story: the run never belonged to the tab that started it.
  useEffect(() => {
    sourceRef.current?.close()
    setRunId(null)
    if (!sessionId) {
      setMessages([])
      return
    }
    let cancelled = false
    ;(async () => {
      const stored: StoredMessage[] = await fetch(`/api/chat/sessions/${sessionId}/messages`).then((r) =>
        r.json(),
      )
      if (cancelled) return
      setMessages(stored.map(toMsg))
      const runs: AgentRun[] = await getAgentRuns({ session_id: sessionId })
      if (cancelled) return
      const live = runs.find((r) => r.status === 'running')
      if (live) {
        // Its answer hasn't been written yet, so give the replay somewhere to land.
        setMessages((prev) => [...prev, { id: newId(), role: 'assistant', parts: [] }])
        watch(live.id)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, watch])

  useEffect(() => () => sourceRef.current?.close(), [])

  const send = async (text: string) => {
    const id = sessionId ?? newId()
    if (!sessionId) onSessionChange(id)
    const history = historyOf(messages)
    setMessages((prev) => [
      ...prev,
      { id: newId(), role: 'user', parts: [{ kind: 'text', text }] },
      { id: newId(), role: 'assistant', parts: [] },
    ])
    try {
      const { run_id } = await startAgentRun({ session_id: id, message: text, history })
      watch(run_id)
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start that run')
    }
  }

  const remove = async (id: string) => {
    await fetch(`/api/chat/sessions/${id}`, { method: 'DELETE' })
    queryClient.invalidateQueries({ queryKey: ['chatSessions'] })
    if (id === sessionId) onSessionChange(newId())
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[15rem_1fr]">
      <aside className="flex min-h-0 flex-col border-r bg-muted/20">
        <div className="border-b p-2">
          <Button size="sm" variant="outline" className="w-full" onClick={() => onSessionChange(newId())}>
            <SquarePenIcon className="size-3.5" />
            New chat
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {sessions.length === 0 && (
            <p className="p-3 text-xs text-muted-foreground">Nothing yet. Ask something below.</p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm ${
                s.id === sessionId ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
              }`}
            >
              <button
                type="button"
                onClick={() => onSessionChange(s.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                {runningSessions.has(s.id) ? (
                  <Spinner className="size-3 shrink-0" />
                ) : (
                  <MessageCircleIcon className="size-3 shrink-0 opacity-50" />
                )}
                <span className="truncate">{s.title || 'New chat'}</span>
              </button>
              <button
                type="button"
                aria-label={`Delete ${s.title || 'chat'}`}
                onClick={() => remove(s.id)}
                className="opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Trash2Icon className="size-3 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section className="flex min-h-0 flex-col">
        <Conversation className="min-h-0 flex-1">
          <ConversationContent>
            {messages.length === 0 && (
              <ConversationEmptyState
                title="Ask the agent"
                description="It can scrape, search, check rules and read your watchlists — and it keeps working if you leave this page."
              />
            )}
            {messages.map((m) => (
              <Message key={m.id} from={m.role}>
                <MessageContent>
                  {m.parts.map((p, i) =>
                    p.kind === 'text' ? (
                      <MessageResponse key={`t${i}`}>{p.text}</MessageResponse>
                    ) : (
                      <ToolCallChip
                        key={p.id}
                        part={{
                          type: 'dynamic-tool',
                          toolName: p.name,
                          state: p.output === undefined ? 'input-available' : 'output-available',
                          input: p.input,
                          // ToolPart types `output` as the confirm-gate shape the widget looks
                          // for; a run's output is whatever the tool returned. ToolCallChip only
                          // renders it structurally, so the cast is the honest edge.
                          output: p.output as ToolPart['output'],
                          errorText: p.error ? String(p.output) : undefined,
                        }}
                      />
                    ),
                  )}
                  {m.role === 'assistant' && m.parts.length === 0 && <Spinner className="size-4" />}
                </MessageContent>
              </Message>
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        <div className="border-t p-3">
          <ChatInput
            commands={slashCommands()}
            status={runId ? 'streaming' : undefined}
            onSubmit={send}
            open
          />
        </div>
      </section>
    </div>
  )
}
