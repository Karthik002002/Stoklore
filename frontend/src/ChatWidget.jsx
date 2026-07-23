import { useCallback, useEffect, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { DefaultChatTransport } from 'ai'
import { toast } from 'sonner'
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  HistoryIcon,
  MessageCircleIcon,
  SquarePenIcon,
  Trash2Icon,
  WrenchIcon,
  XCircleIcon,
  XIcon,
} from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getActiveModel, getModels } from '@/services/api'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import ChatInput from './ChatInput'

const newId = () => crypto.randomUUID()

// ChatWidget is a single instance mounted once in App - a window event is the simplest way for
// distant components (event/news cards) to tell it "open yourself and tag this URL" without
// threading a callback down through App's whole tree.
const TAG_EVENT = 'chat:tag'

export function tagInChat(url, label) {
  window.dispatchEvent(new CustomEvent(TAG_EVENT, { detail: { url, label } }))
}

// Streamed tool parts arrive typed `tool-${name}` (or `dynamic-tool` when the client has no
// static tool defs, which is our case - the server owns the tool schemas).
const toolPartsOf = (m) => m.parts.filter((p) => p.type === 'dynamic-tool' || p.type?.startsWith('tool-'))
const toolNameOf = (p) => (p.type === 'dynamic-tool' ? p.toolName : p.type.slice('tool-'.length))

// Truncates a tool arg/result for display - scrape_stock etc. can return a full markdown report.
const formatToolValue = (value) => {
  const s = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return s.length > 400 ? `${s.slice(0, 400)}…` : s
}

// Click to expand and see exactly what the tool was called with and what it returned - the live
// step-by-step trace of what the agent is doing, not just a name and a checkmark.
function ToolCallChip({ part }) {
  const [open, setOpen] = useState(false)
  const done = part.state === 'output-available' || part.state === 'output-error'
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
      >
        <WrenchIcon className="size-3" />
        {toolNameOf(part)}
        {done ? <CheckIcon className="size-3 text-up" /> : <Spinner className="size-3" />}
        <ChevronDownIcon className={`size-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="max-w-xs space-y-1.5 rounded-lg border bg-muted/30 px-2.5 py-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
          {part.input !== undefined && (
            <div>
              <span className="text-foreground">input </span>
              {formatToolValue(part.input)}
            </div>
          )}
          {part.output !== undefined && (
            <div>
              <span className="text-foreground">output </span>
              {formatToolValue(part.output)}
            </div>
          )}
          {part.errorText && (
            <div className="text-down">
              <span className="text-foreground">error </span>
              {part.errorText}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// A confirm-gated tool call (scrape_stock/scan_events/sync_prices) comes back with
// output.requires_confirmation instead of running - shown as a Confirm/Cancel prompt instead of
// a plain chip, so the user doesn't have to type `/confirm <tool>` by hand.
function ConfirmToolCard({ part, onConfirm, onCancel, resolved }) {
  const { tool, args, message } = part.output
  if (resolved) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
        <WrenchIcon className="size-3" />
        {tool}
        {resolved === 'cancelled' ? (
          <XCircleIcon className="size-3 text-down" />
        ) : (
          <CheckIcon className="size-3 text-up" />
        )}
      </span>
    )
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-xs">
      <span className="flex items-center gap-1.5 font-medium text-foreground">
        <WrenchIcon className="size-3" />
        Run {tool}?
      </span>
      <p className="text-muted-foreground">{message}</p>
      <div className="flex gap-2">
        <Button size="sm" className="h-6 px-2.5 text-xs" onClick={() => onConfirm(tool, args)}>
          Confirm
        </Button>
        <Button size="sm" variant="outline" className="h-6 px-2.5 text-xs" onClick={() => onCancel()}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
const textOf = (m) =>
  m.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('')

const todayIso = () => new Date().toISOString().slice(0, 10)
const monthAgoIso = () => {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  return d.toISOString().slice(0, 10)
}

function slashCommands(symbol) {
  const sym = symbol || 'SYMBOL'
  return [
    {
      name: '/history',
      description: 'Scrape price history for a date range',
      template: `/history ${sym} ${monthAgoIso()} ${todayIso()}`,
    },
    {
      name: '/sentiment',
      description: 'Analyze a news/blog URL: related stocks + sentiment',
      template: '/sentiment ',
    },
    {
      name: '/rule',
      description: 'Check a watch rule (set up in Settings > Watch rules) against live data',
      template: `/rule ${sym} `,
    },
    {
      name: '/confirm',
      description: 'Approve adding a stock the agent asked permission for',
      template: '/confirm ',
    },
    {
      name: '/clear',
      description: 'Clear this chat’s messages (same session, empty transcript)',
      template: '/clear',
    },
  ]
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <BotIcon className="size-4" />
      </div>
      <div className="flex items-center gap-1 rounded-full bg-muted px-4 py-3">
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
      </div>
    </div>
  )
}

function ChatThread({
  chatId,
  initialMessages,
  onTitle,
  onDone,
  symbol,
  model,
  open,
  pendingInsert,
  onInsertHandled,
}) {
  const { messages, setMessages, sendMessage, status } = useChat({
    id: chatId,
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: '/api/chat', body: { sessionId: chatId } }),
    onData: (part) => {
      if (part.type === 'data-title') onTitle(chatId, part.data.title)
    },
    onFinish: ({ message }) => onDone(textOf(message)),
  })

  const commands = slashCommands(symbol)
  const isBusy = status === 'submitted' || status === 'streaming'

  // toolCallId -> 'confirmed' | 'cancelled', once the user has acted on a confirm-gated tool
  // call's Confirm/Cancel prompt - collapses it to a plain chip so it can't be re-triggered.
  const [resolvedCalls, setResolvedCalls] = useState({})
  const confirmTool = (tool, args) => {
    const argsStr = Object.entries(args ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')
    sendMessage(
      { text: `/confirm ${tool}${argsStr ? ' ' + argsStr : ''}` },
      model ? { body: { model } } : undefined,
    )
  }

  // /clear wipes this session's transcript server-side too (same chatId, so it stays "new" the
  // next time it's reopened from History) instead of just resetting what's shown client-side.
  const submitMessage = (text) => {
    if (text.trim().toLowerCase() === '/clear') {
      fetch(`/api/chat/sessions/${chatId}/messages`, { method: 'DELETE' })
      setMessages([])
      setResolvedCalls({})
      return
    }
    sendMessage({ text }, model ? { body: { model } } : undefined)
  }

  return (
    <>
      <Conversation className="flex-1">
        <ConversationContent className="gap-4">
          {messages.length === 0 && (
            <ConversationEmptyState
              icon={<BotIcon className="size-8" />}
              title="NSE research assistant"
              description="Ask about a tracked stock, mention any NSE ticker to scrape it live, or type / for commands."
            />
          )}
          {messages.map((m) => {
            const toolParts = toolPartsOf(m)
            return (
              <Message from={m.role} key={m.id}>
                <MessageContent>
                  {toolParts.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {toolParts.map((p, i) => {
                        const id = p.toolCallId ?? i
                        if (p.state === 'output-available' && p.output?.requires_confirmation) {
                          return (
                            <ConfirmToolCard
                              key={id}
                              part={p}
                              resolved={resolvedCalls[id]}
                              onConfirm={(tool, args) => {
                                setResolvedCalls((prev) => ({ ...prev, [id]: 'confirmed' }))
                                confirmTool(tool, args)
                              }}
                              onCancel={() => setResolvedCalls((prev) => ({ ...prev, [id]: 'cancelled' }))}
                            />
                          )
                        }
                        return <ToolCallChip key={id} part={p} />
                      })}
                    </div>
                  )}
                  <MessageResponse>{textOf(m)}</MessageResponse>
                </MessageContent>
              </Message>
            )
          })}
          {status === 'submitted' && <TypingIndicator />}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="border-t p-3">
        <ChatInput
          commands={commands}
          status={status}
          disabled={isBusy}
          open={open}
          pendingInsert={pendingInsert}
          onInsertHandled={onInsertHandled}
          onSubmit={submitMessage}
        />
      </div>
    </>
  )
}

// Default panel size, same as the old fixed h-[34rem] w-[26rem]. Panel is anchored bottom-right
// (fixed right/bottom), so growing width/height alone naturally expands it toward the top-left -
// no repositioning needed, just resist the temptation to also track top/left.
const DEFAULT_SIZE = { width: 416, height: 544 }
const MIN_SIZE = { width: 288, height: 256 }

function useTopLeftResize(size, setSize) {
  const dragRef = useRef(null)

  const onPointerDown = (e) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, startSize: size }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }
  const onPointerMove = (e) => {
    const { startX, startY, startSize } = dragRef.current
    const maxWidth = window.innerWidth - 48
    const maxHeight = window.innerHeight * 0.85
    setSize({
      // dragging the top-left handle left/up should grow the panel, not shrink it
      width: Math.min(maxWidth, Math.max(MIN_SIZE.width, startSize.width + (startX - e.clientX))),
      height: Math.min(maxHeight, Math.max(MIN_SIZE.height, startSize.height + (startY - e.clientY))),
    })
  }
  const onPointerUp = () => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }

  return onPointerDown
}

export default function ChatWidget() {
  const { symbol } = useParams({ strict: false })
  const [open, setOpen] = useState(false)
  const openRef = useRef(open)
  openRef.current = open

  const [size, setSize] = useState(DEFAULT_SIZE)
  const startResize = useTopLeftResize(size, setSize)

  const [sessions, setSessions] = useState([])
  const [chatId, setChatId] = useState(newId)
  const [initialMessages, setInitialMessages] = useState([])
  const [model, setModel] = useState(null)
  const [pendingInsert, setPendingInsert] = useState(null)

  const { data: models } = useQuery({ queryKey: ['models'], queryFn: getModels })
  const { data: active } = useQuery({ queryKey: ['activeModel'], queryFn: getActiveModel })
  const effectiveModel = model ?? active?.model ?? null
  const currentTitle = sessions.find((s) => s.id === chatId)?.title || 'New chat'

  const loadSessions = useCallback(() => {
    fetch('/api/chat/sessions')
      .then((r) => r.json())
      .then(setSessions)
  }, [])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  // A "Tag in chat" click from an event/news card - open the panel and hand the URL to
  // ChatInput to insert, nonce'd so tagging the same URL twice in a row still re-triggers.
  useEffect(() => {
    const onTag = (e) => {
      setOpen(true)
      setPendingInsert({ text: `@${e.detail.url} `, nonce: Date.now() })
    }
    window.addEventListener(TAG_EVENT, onTag)
    return () => window.removeEventListener(TAG_EVENT, onTag)
  }, [])

  const openSession = async (session) => {
    const msgs = await fetch(`/api/chat/sessions/${session.id}/messages`).then((r) => r.json())
    setInitialMessages(msgs)
    setModel(session.model ?? null)
    setChatId(session.id)
  }

  const startNew = () => {
    setInitialMessages([])
    setModel(null)
    setChatId(newId())
  }

  const deleteSession = async (e, session) => {
    e.stopPropagation() // don't also trigger the item's onClick (openSession)
    await fetch(`/api/chat/sessions/${session.id}`, { method: 'DELETE' })
    setSessions((prev) => prev.filter((s) => s.id !== session.id))
    if (session.id === chatId) startNew() // its transcript is gone - don't keep viewing it
  }

  const onTitle = (id, title) => {
    setSessions((prev) =>
      prev.some((s) => s.id === id)
        ? prev.map((s) => (s.id === id ? { ...s, title } : s))
        : [{ id, title, created_at: new Date().toISOString() }, ...prev],
    )
  }

  const onDone = (text) => {
    if (openRef.current) return
    toast('Response ready', {
      description: text.length > 140 ? `${text.slice(0, 140)}…` : text,
      action: { label: 'View', onClick: () => setOpen(true) },
    })
  }

  return (
    <>
      <div
        style={{ width: size.width, height: size.height }}
        className={`fixed right-6 bottom-24 z-50 flex flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl ${open ? '' : 'hidden'}`}
      >
        <div
          onPointerDown={startResize}
          aria-hidden="true"
          className="absolute top-0 left-0 z-10 size-4 cursor-nwse-resize touch-none rounded-br-lg hover:bg-muted"
        >
          <svg viewBox="0 0 16 16" className="size-full p-0.5 text-muted-foreground">
            <path
              fill="currentColor"
              d="M1 1h2v2H1zM5 1h2v2H5zM1 5h2v2H1zM9 1h2v2H9zM5 5h2v2H5zM1 9h2v2H1z"
            />
          </svg>
        </div>

        <header className="flex items-center gap-2 border-b px-4 py-2.5">
          <BotIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-sm font-medium">{currentTitle}</span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label="Chat history" />}
              >
                <HistoryIcon className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
                {sessions.length === 0 && <DropdownMenuItem disabled>No past chats</DropdownMenuItem>}
                {sessions.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    onClick={() => openSession(s)}
                    className="group/session pr-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate">{s.title || 'Untitled'}</span>
                    <button
                      type="button"
                      aria-label={`Delete "${s.title || 'Untitled'}"`}
                      onClick={(e) => deleteSession(e, s)}
                      className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:text-destructive group-hover/session:opacity-100"
                    >
                      <Trash2Icon className="size-3.5" />
                    </button>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="icon-sm" aria-label="New chat" onClick={startNew}>
              <SquarePenIcon className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setOpen(false)}>
              <XIcon className="size-4" />
            </Button>
          </div>
        </header>
        <div className="flex justify-end border-b px-3 py-1.5">
          <Select value={effectiveModel ?? ''} onValueChange={(m) => m && setModel(m)}>
            <SelectTrigger size="sm" className="max-w-full border-none shadow-none">
              <SelectValue placeholder="Model…" className="justify-end truncate" />
            </SelectTrigger>
            <SelectContent className="max-h-72" align="end">
              {(models ?? []).map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ChatThread
          key={chatId}
          chatId={chatId}
          initialMessages={initialMessages}
          onTitle={onTitle}
          onDone={onDone}
          symbol={symbol}
          model={effectiveModel}
          open={open}
          pendingInsert={pendingInsert}
          onInsertHandled={() => setPendingInsert(null)}
        />
      </div>

      <Button
        size="icon-lg"
        aria-label={open ? 'Close chat' : 'Open chat'}
        className="fixed right-6 bottom-6 z-50 size-13 rounded-full shadow-lg"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <XIcon className="size-5" /> : <MessageCircleIcon className="size-5" />}
      </Button>
    </>
  )
}
