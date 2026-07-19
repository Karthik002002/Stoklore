import { useCallback, useEffect, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { toast } from 'sonner'
import { BotIcon, HistoryIcon, MessageCircleIcon, SquarePenIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

function ChatThread({ chatId, initialMessages, onTitle, onDone }) {
  const { messages, sendMessage, status } = useChat({
    id: chatId,
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: '/api/chat', body: { sessionId: chatId } }),
    onData: (part) => {
      if (part.type === 'data-title') onTitle(chatId, part.data.title)
    },
    onFinish: ({ message }) => onDone(textOf(message)),
  })

  return (
    <>
      <Conversation className="flex-1">
        <ConversationContent className="gap-4">
          {messages.length === 0 && (
            <ConversationEmptyState
              icon={<BotIcon className="size-8" />}
              title="NSE research assistant"
              description="Ask about a tracked stock, or mention any NSE ticker to scrape it live."
            />
          )}
          {messages.map((m) => (
            <Message from={m.role} key={m.id}>
              <MessageContent>
                <MessageResponse>{textOf(m)}</MessageResponse>
              </MessageContent>
            </Message>
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="border-t p-3">
        <PromptInput
          className="grid grid-cols-[1fr_auto] items-end gap-2"
          onSubmit={({ text }) => text?.trim() && sendMessage({ text })}
        >
          <PromptInputBody>
            <PromptInputTextarea placeholder="Ask about a stock…" />
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
  const [open, setOpen] = useState(false)
  const openRef = useRef(open)
  openRef.current = open

  const [sessions, setSessions] = useState([])
  const [chatId, setChatId] = useState(newId)
  const [initialMessages, setInitialMessages] = useState([])

  const loadSessions = useCallback(() => {
    fetch('/api/chat/sessions').then((r) => r.json()).then(setSessions)
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  const openSession = async (id) => {
    const msgs = await fetch(`/api/chat/sessions/${id}/messages`).then((r) => r.json())
    setInitialMessages(msgs)
    setChatId(id)
  }

  const startNew = () => {
    setInitialMessages([])
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
                  <DropdownMenuItem key={s.id} onClick={() => openSession(s.id)}>
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
        <ChatThread
          key={chatId}
          chatId={chatId}
          initialMessages={initialMessages}
          onTitle={onTitle}
          onDone={onDone}
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
