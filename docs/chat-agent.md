# Chat Agent

[← Back to index](README.md)

## Using it

- Open the floating chat button (bottom-right). Drag its top-left corner to
  resize.
- Type `@` to tag a stock, watch rule, or event into the message — tagging
  an event inserts its source URL so the agent can actually fetch it.
- Every tool call the agent makes shows as a clickable chip — click to see
  the exact input/output.
- Adding a brand-new stock (`scrape_stock`) always asks for confirmation
  first — use the inline **Confirm**/**Cancel** buttons, or type
  `/confirm scrape_stock symbol=TCS`.
- Slash commands: `/history SYMBOL FROM TO`, `/sentiment URL`,
  `/rule NAME [SYMBOL]`, `/clear`.
- Past sessions are listed from the dropdown in the chat header — reopen or
  delete any of them.

## How it works

### Two chat paths, one endpoint

`POST /api/chat` (`api.py:1572`) resolves the active model
(`db.get_session_model`/`db.get_active_model`) and decides `use_agent` —
true for `ollama/*`/`litellm/*` models, which support native tool calling.
Everything else (an OmniRoute model) falls back to plain retrieval-augmented
chat: it regex-scans your message for ticker-looking tokens
(`TICKER_PATTERN`), live-scrapes any it finds, embeds the query
(`llm.embed()`, always against local Ollama's `nomic-embed-text`
regardless of which model is chatting — the stored `scraped_items.embedding`
column is a fixed `VECTOR(768)`), and runs `db.similarity_search()`
(`ORDER BY embedding <=> query LIMIT 3`) for context.

### The tool-calling loop (agent path)

No LangChain — `_OllamaDriver`/`_OpenAICompatDriver` (`llm.py:113`) each
normalize their backend's native tool-call response shape into one
`(assistant_msg, calls)` tuple. `run_agent_stream()` (`llm.py:195`) is the
actual loop: call the model → if it didn't ask for a tool, yield the final
text and stop → otherwise execute each requested tool
(`tool_impls[name](**args)`), wrap the result, feed it back as a `role:
"tool"` message, and loop again (capped at 5 rounds).

### Streaming to the browser

The response streams as Server-Sent Events implementing the Vercel AI SDK's
"UI Message Stream" protocol (`_sse`, `api.py:763`): `start` →
`tool-input-available`/`tool-output-available` pairs as each tool call
resolves → `text-start`/`text-delta`/`text-end` for the reply → an optional
`data-title` event (first message in a session auto-titles it) → `finish`.
That's what lets the frontend render live tool-call chips instead of a
plain wall of text.

**Session history**: one row per turn in `chat_sessions`/`chat_messages`.
Replay is capped to the last 20 messages (`MAX_HISTORY_MESSAGES`), and any
tool output within that replayed window over 1500 chars gets truncated with
`"…(truncated)"` — a fresh, in-turn tool call is never truncated, only
older replayed ones.

### The confirmation gate

`CONFIRM_TOOLS = {"scrape_stock"}` — any tool in that set gets wrapped by
`_guarded()` (`api.py:1432`) so calling it returns
`{requires_confirmation: true, tool, args, message}` instead of actually
running. The system prompt tells the model to relay that message and stop.
`/confirm scrape_stock symbol=TCS` is parsed server-side by a dedicated
regex and calls the *real*, unwrapped tool implementation directly —
bypassing the model and the guard for that one invocation.

### Prompt-injection defense

Every tool result — live or replayed from history — is wrapped in
`<tool_result tool="...">...</tool_result>` before it re-enters the model's
context, explicitly labeling it as data, not instructions
(`_wrap_tool_result`, `llm.py:176`). A regex (`_INJECTION_MARKERS`) flags
obvious override phrasing — "ignore previous instructions," "you are now
a/an," "reveal your system prompt," and similar — appending a
`[SECURITY NOTE...]` line inside the wrapper when it matches, rather than
silently stripping anything.

### `@` tags and slash commands

The `@`/`/` menu (`ChatInput.jsx`, a Lexical typeahead plugin) is pure
client-side autocomplete — selecting an item just inserts text into the
input box (`@SYMBOL `, or a `/history ` template). Nothing is parsed or
executed client-side except `/clear`, which is intercepted before any
network call and issues `DELETE /api/chat/sessions/{id}/messages` directly.
Every other command (`/history`, `/sentiment`, `/rule`, `/confirm`) is sent
as an ordinary chat message and matched server-side against dedicated
regexes in `api.py`, each resolved by its own reply helper before the
message ever reaches the agent/RAG paths above.
