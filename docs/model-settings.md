# Model Settings

[← Back to index](README.md)

## Using it

- Settings → **Model** tab: pick which model backend answers chat
  (`ollama/*`, `litellm/*`, or an OmniRoute model).
- Settings → **LiteLLM** tab: point at your running LiteLLM proxy (URL +
  key) — see the main setup steps in the README if you haven't set one up.
- Settings → **Cogencis** tab: paste a token to enable Top News.
- Settings deep-links via URL, e.g. `?settings=broker` opens straight to
  the Broker tab.

## How it works

**Routing** is a plain prefix check repeated at every call site (chat,
tool-calling, ticker extraction, bulk-trade screenshot analysis, ...):
`model.startswith("ollama/")` → Ollama's own API; `"litellm/"` → your
configured LiteLLM proxy; anything else → OmniRoute. No abstraction layer
picks a client for you — each function just branches on the string prefix
itself.

**Active model** is a single row in a `settings` table
(`db.get_active_model`/`set_active_model`), keyed `'active_model'`. Most
endpoints default to it when a request doesn't specify a model explicitly
— a chat session can also pin its *own* model independently
(`db.get_session_model`), which is why switching the global active model
mid-session doesn't retroactively change what an already-open session
uses.

**The Model tab's dropdown is a live query, not a static list.** It hits
`GET /api/models` → `llm.get_models()`, which always includes local
Ollama's default, then *actually queries* OmniRoute's `/models` endpoint
and, if a LiteLLM proxy is configured, its `/models` endpoint too — each
independently, degrading to an empty contribution (not an error) if that
backend isn't reachable right now. So the list you see reflects what's
genuinely up at that moment, not a hardcoded catalog.

**Wildcard expansion** (`model_name: openai/*` in `litellm.config.yaml`)
isn't a live call to OpenAI — LiteLLM expands it from its own bundled
catalog of known model ids for that provider (~200 for OpenAI). The
`?return_wildcard_routes=true` query param that triggers this expansion at
all is added on the backend side, inside `llm.get_models()` — a plain
`GET /models` without it would just show the literal string `"openai/*"`
as one entry instead of the ~200 real ids.
