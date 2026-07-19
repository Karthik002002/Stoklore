import { useCallback, useEffect, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { DefaultChatTransport } from 'ai'
import { toast } from 'sonner'
import { BotIcon, CalendarClockIcon, HistoryIcon, MessageCircleIcon, SquarePenIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getActiveModel, getModels } from '@/services/api'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from '@/components/ai-elements/prompt-input'

const newId = () => crypto.randomUUID()
const textOf = (m) => m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('')

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

function ChatThread({ chatId, initialMessages, onTitle, onDone, symbol, model }) {
  const { messages, sendMessage, status } = useChat({
    id: chatId,
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: '/api/chat', body: { sessionId: chatId } }),
    onData: (part) => {
      if (part.type === 'data-title') onTitle(chatId, part.data.title)
    },
    onFinish: ({ message }) => onDone(textOf(message)),
  })

  const [input, setInput] = useState('')
  const textareaRef = useRef(null)
  const commands = slashCommands(symbol)
  const showSlashMenu = input === '/'

  const applyCommand = (template) => {
    setInput(template)
    if (textareaRef.current) {
      textareaRef.current.value = template
      textareaRef.current.focus()
    }
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
          {messages.map((m) => (
            <Message from={m.role} key={m.id}>
              <MessageContent>
                <MessageResponse>{textOf(m)}</MessageResponse>
              </MessageContent>
            </Message>
          ))}
          {status === 'submitted' && <TypingIndicator />}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="relative border-t p-3">
        {showSlashMenu && (
          <div className="absolute inset-x-3 bottom-full mb-2 overflow-hidden rounded-lg border bg-popover shadow-lg">
            {commands.map((cmd) => (
              <button
                key={cmd.name}
                type="button"
                className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-accent"
                onClick={() => applyCommand(cmd.template)}
              >
                <CalendarClockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block font-medium">{cmd.name}</span>
                  <span className="block text-xs text-muted-foreground">{cmd.description}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <PromptInput
          className="grid grid-cols-[1fr_auto] items-end gap-2"
          onSubmit={({ text }) => {
            if (!text?.trim()) return
            sendMessage({ text }, model ? { body: { model } } : undefined)
            setInput('')
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea
              ref={textareaRef}
              placeholder="Ask about a stock, or type / for commands…"
              onChange={(e) => setInput(e.target.value)}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputSubmit status={status} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </>
  )
}

export default function ChatWidget() {
  const { symbol } = useParams({ strict: false })
  const [open, setOpen] = useState(false)
  const openRef = useRef(open)
  openRef.current = open

  const [sessions, setSessions] = useState([])
  const [chatId, setChatId] = useState(newId)
  const [initialMessages, setInitialMessages] = useState([])
  const [model, setModel] = useState(null)

  const { data: models } = useQuery({ queryKey: ['models'], queryFn: getModels })
  const { data: active } = useQuery({ queryKey: ['activeModel'], queryFn: getActiveModel })
  const effectiveModel = model ?? active?.model ?? null

  const loadSessions = useCallback(() => {
    fetch('/api/chat/sessions').then((r) => r.json()).then(setSessions)
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

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
        className={`fixed right-6 bottom-24 z-50 flex h-[34rem] w-[26rem] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl ${open ? '' : 'hidden'}`}
      >
        <header className="flex items-center gap-2 border-b px-4 py-2.5">
          <BotIcon className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Research chat</span>
          <div className="ml-auto flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label="Chat history" />}
              >
                <HistoryIcon className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
                {sessions.length === 0 && (
                  <DropdownMenuItem disabled>No past chats</DropdownMenuItem>
                )}
                {sessions.map((s) => (
                  <DropdownMenuItem key={s.id} onClick={() => openSession(s)}>
                    <span className="truncate">{s.title || 'Untitled'}</span>
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
        <div className="border-b px-3 py-1.5">
          <Select value={effectiveModel ?? ''} onValueChange={(m) => m && setModel(m)}>
            <SelectTrigger size="sm" className="w-full border-none shadow-none">
              <SelectValue placeholder="Model…" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
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
