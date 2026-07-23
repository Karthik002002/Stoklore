import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { useQuery } from '@tanstack/react-query'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
} from 'lexical'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClockIcon, NewspaperIcon, TagIcon, TrendingUpIcon } from 'lucide-react'
import { PromptInputSubmit } from '@/components/ai-elements/prompt-input'

const editorConfig = {
  namespace: 'ChatComposer',
  theme: {},
  onError: (error) => console.error('Chat composer error:', error),
}

const TAG_TYPE_META = {
  stock: { icon: TrendingUpIcon, label: 'Stock' },
  rule: { icon: TagIcon, label: 'Watch rule' },
  event: { icon: NewspaperIcon, label: 'Event' },
}

// Wraps either a slash command or an @ tag (stock/watch rule/event) as a typeahead option - `key`
// just needs to be unique within its own menu.
class TextOption extends MenuOption {
  constructor(key, data) {
    super(key)
    this.data = data
  }
}

// One LexicalTypeaheadMenuPlugin per trigger character - Lexical's own examples run several of
// these side by side (e.g. "#" and "@" together), so "/" for commands and "@" for tags as two
// independent plugin instances is the supported pattern, not a hack.
function SlashMenuPlugin({ commands, onOpenChange }) {
  const [editor] = useLexicalComposerContext()
  const [queryString, setQueryString] = useState(null)
  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('/', { minLength: 0 })

  const options = useMemo(() => {
    const q = (queryString ?? '').toLowerCase()
    return commands.filter((c) => c.name.toLowerCase().includes(q)).map((c) => new TextOption(c.name, c))
  }, [commands, queryString])

  const onSelectOption = useCallback(
    (option, nodeToReplace, closeMenu) => {
      editor.update(() => {
        const textNode = $createTextNode(option.data.template)
        if (nodeToReplace) nodeToReplace.replace(textNode)
        textNode.selectEnd()
        closeMenu()
      })
    },
    [editor],
  )

  return (
    <LexicalTypeaheadMenuPlugin
      options={options}
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      onOpen={() => onOpenChange(true)}
      onClose={() => onOpenChange(false)}
      triggerFn={checkForTriggerMatch}
      menuRenderFn={(_ref, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => {
        if (queryString === null || options.length === 0) return null
        return (
          <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-lg border bg-popover shadow-lg">
            {options.map((option, index) => (
              <button
                key={option.key}
                type="button"
                data-active={index === selectedIndex}
                className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-accent data-[active=true]:bg-accent"
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectOptionAndCleanUp(option)
                }}
              >
                <CalendarClockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block font-medium">{option.data.name}</span>
                  <span className="block text-xs text-muted-foreground">{option.data.description}</span>
                </span>
              </button>
            ))}
          </div>
        )
      }}
    />
  )
}

// @ tags a scraped stock, a watch rule, or an event inline - inserted as plain text (no custom
// pill node), so it reads naturally in the sent message and, for stocks, still matches the
// server's existing ticker-detection regex (\b[A-Z]{2,15}\b tolerates a leading "@"). Events
// insert their URL rather than their headline - that's what makes the agent's scrape_url tool
// engage (its system prompt fires on any URL in the message), a headline alone gives it nothing
// to fetch.
function TagMenuPlugin({ rules, onOpenChange }) {
  const [editor] = useLexicalComposerContext()
  const [queryString, setQueryString] = useState(null)

  // Stock list comes from the server (every scraped symbol, up to 30), searched live as the
  // user types - the old client-side list only covered watchlisted stocks.
  const { data: stockMatches = [] } = useQuery({
    queryKey: ['stockSearch', queryString],
    queryFn: () => fetch(`/api/stocks/search?q=${encodeURIComponent(queryString)}`).then((r) => r.json()),
    enabled: queryString !== null,
  })
  // All available events (not just the current watchlist tab's filtered view) - url-less events
  // are skipped since there's nothing for scrape_url to fetch.
  const { data: events = [] } = useQuery({
    queryKey: ['taggableEvents'],
    queryFn: () => fetch('/api/events?limit=1000').then((r) => r.json()),
  })
  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch('@', { minLength: 0 })

  const options = useMemo(() => {
    const q = (queryString ?? '').toLowerCase()
    const stockTags = stockMatches.map((s) => ({ type: 'stock', label: s.symbol, insertText: s.symbol }))
    const ruleTags = rules
      .filter((r) => r.name.toLowerCase().includes(q))
      .map((r) => ({ type: 'rule', label: r.name, insertText: r.name }))
    const eventTags = events
      .filter((e) => e.url && e.headline.toLowerCase().includes(q))
      .map((e) => ({ type: 'event', label: e.headline, insertText: e.url }))
    return [...stockTags, ...ruleTags, ...eventTags].map((t, i) => new TextOption(`${t.type}:${i}`, t))
  }, [stockMatches, rules, events, queryString])

  const onSelectOption = useCallback(
    (option, nodeToReplace, closeMenu) => {
      editor.update(() => {
        const textNode = $createTextNode(`@${option.data.insertText} `)
        if (nodeToReplace) nodeToReplace.replace(textNode)
        textNode.selectEnd()
        closeMenu()
      })
    },
    [editor],
  )

  return (
    <LexicalTypeaheadMenuPlugin
      options={options}
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      onOpen={() => onOpenChange(true)}
      onClose={() => onOpenChange(false)}
      triggerFn={checkForTriggerMatch}
      menuRenderFn={(_ref, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => {
        if (queryString === null) return null
        return (
          <div className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-64 overflow-y-auto rounded-lg border bg-popover shadow-lg">
            {options.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No stocks, events, or watch rules match.
              </p>
            )}
            {options.map((option, index) => {
              const Icon = TAG_TYPE_META[option.data.type].icon
              return (
                <button
                  key={option.key}
                  type="button"
                  data-active={index === selectedIndex}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-accent data-[active=true]:bg-accent"
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectOptionAndCleanUp(option)
                  }}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{option.data.label}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {TAG_TYPE_META[option.data.type].label}
                  </span>
                </button>
              )
            })}
          </div>
        )
      }}
    />
  )
}

function ChatInputInner({ commands, status, disabled, onSubmit, open, pendingInsert, onInsertHandled }) {
  const [editor] = useLexicalComposerContext()
  const menuOpenRef = useRef({ slash: false, tag: false })

  const { data: rules = [] } = useQuery({
    queryKey: ['watchRules'],
    queryFn: () => fetch('/api/watch-rules').then((r) => r.json()),
  })

  useEffect(() => {
    editor.setEditable(!disabled)
  }, [editor, disabled])

  // Autofocus whenever the chat panel opens - it's only CSS-hidden, never unmounted, so this
  // fires on every open, not just mount.
  useEffect(() => {
    if (open) editor.focus()
  }, [open, editor])

  // "Tag in chat" from an event/news card - replaces the input with "@<url> " and focuses, so
  // the agent's scrape_url tool has something to act on as soon as the user hits send.
  const onInsertHandledRef = useRef(onInsertHandled)
  onInsertHandledRef.current = onInsertHandled
  useEffect(() => {
    if (!pendingInsert) return
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      const textNode = $createTextNode(pendingInsert.text)
      paragraph.append(textNode)
      root.append(paragraph)
      textNode.selectEnd()
    })
    editor.focus()
    onInsertHandledRef.current?.()
  }, [pendingInsert, editor])

  // Callers pass a fresh onSubmit every render (and disabled flips while a run streams) - read
  // both through refs so `submit`, and the Enter command registration below, stay stable.
  const onSubmitRef = useRef(onSubmit)
  onSubmitRef.current = onSubmit
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled

  const submit = useCallback(() => {
    if (disabledRef.current) return
    let message = ''
    editor.getEditorState().read(() => {
      message = $getRoot().getTextContent().trim()
    })
    if (!message) return
    onSubmitRef.current(message)
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      root.append(paragraph)
      paragraph.select()
    })
  }, [editor])

  // Enter submits; Shift+Enter inserts a newline. Registered at LOW priority so the typeahead
  // plugins (which claim Enter while their menu is open) win first - menuOpenRef defers to them.
  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (menuOpenRef.current.slash || menuOpenRef.current.tag) return false
          if (event?.shiftKey) return false
          event?.preventDefault()
          submit()
          return true
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor, submit],
  )

  return (
    <div className="grid grid-cols-[1fr_auto] items-end gap-2">
      <div className="relative min-w-0">
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              aria-label="Chat message"
              className="field-sizing-content max-h-48 min-h-16 w-full resize-none rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:border-ring"
            />
          }
          placeholder={
            <div className="pointer-events-none absolute top-2 left-3 text-sm text-muted-foreground">
              Ask about a stock, / for commands, @ to tag a stock, event, or rule…
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <SlashMenuPlugin
          commands={commands}
          onOpenChange={(open) => {
            menuOpenRef.current.slash = open
          }}
        />
        <TagMenuPlugin
          rules={rules}
          onOpenChange={(open) => {
            menuOpenRef.current.tag = open
          }}
        />
      </div>
      <PromptInputSubmit status={status} onClick={submit} />
    </div>
  )
}

export default function ChatInput(props) {
  return (
    <LexicalComposer initialConfig={editorConfig}>
      <ChatInputInner {...props} />
    </LexicalComposer>
  )
}
