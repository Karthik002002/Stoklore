# Model Settings

[← Back to index](README.md)

## Using it

- Settings → **Model** tab: pick which model backend answers chat
  (`ollama/*`, `litellm/*`, or an OmniRoute model).
- Settings → **OmniRoute** tab: the multi-provider gateway. Needs **nothing
  configured** to work — the fields are only for a gateway on another machine
  and for an endpoint key. Start it with `npx omniroute serve`, connect
  providers in its own dashboard at `http://localhost:20128`, and its models
  appear in the Model tab by their own ids.
- Settings → **LiteLLM** tab: point at your running LiteLLM proxy (URL +
  key) — see the main setup steps in the README if you haven't set one up.
- Settings → **Cogencis** tab: paste a token to enable Top News.
- Settings is a page, `/settings`, and deep-links via URL: `/settings?tab=broker`
  opens straight to the Broker tab. An older `?settings=broker` on any page
  redirects there.

## Auto-routing and fallback

The Model tab lists a handful of `auto…` entries **above** the concrete models.
They are the only ones that fall back: OmniRoute builds a virtual combo from
every provider you have connected, scores them live, and moves to the next
healthy one when a model is rate-limited, out of quota, or erroring — so a chat
doesn't die because one free tier ran out mid-answer.

| Model id | Routes to |
|---|---|
| `auto/chat:free` | **free-tier models only**, falling back across all of them |
| `auto` | balanced; sticks to the last good provider |
| `auto/cheap` | cheapest per token first |
| `auto/fast` | lowest latency first |
| `auto/offline` | most quota headroom first |
| `auto/smart` | quality first, with 10% exploration for better models |
| `auto/coding` | quality weights for code |
| `auto/reasoning:free` · `auto/vision:free` | free reasoning / vision-capable models |

The grammar is `auto/<category>[:<tier>]` — categories `coding · reasoning ·
vision · chat · multimodal`, tiers `fast · cheap · reliable · free · pro` — and
OmniRoute resolves any valid combination on demand, so the list above is a
curated subset rather than a limit. Only some of them are advertised in the
gateway's own `/v1/models`, which is why `llm.AUTO_MODELS` adds them to the
picker rather than reading them from the catalog.

**`:free` is a preference, not a guarantee.** OmniRoute's tier filter is
*fail-open*: if no connected free model can serve a request it routes to the
full pool instead of failing. That is the right default for a chat that
shouldn't dead-end, but it does mean a paid provider can answer a `:free` route
if you have one connected and nothing free fits.

**The app does not retry across models itself.** Falling back is the gateway's
entire job; a second loop in `llm.py` would be a worse router fighting a better
one, and would re-send prompts a circuit breaker had already parked.

## How it works

**Routing** is a plain prefix check repeated at every call site (chat,
tool-calling, ticker extraction, bulk-trade screenshot analysis, ...):
`model.startswith("ollama/")` → Ollama's own API; `"litellm/"` → your
configured LiteLLM proxy; anything else → OmniRoute. No abstraction layer
picks a client for you — each function just branches on the string prefix
itself. OmniRoute being the *fall-through* rather than a prefix is what lets an
`auto/chat:free` id reach the gateway verbatim — the suffix IS the free-tier
filter, so anything that rewrote the id would quietly turn the filter off.
`tests/llm_routing.selfcheck.py` pins that, the auth header, and the model list.

**OmniRoute's base URL defaults to `http://localhost:20128/v1`** and only moves
if you set one, because a local `omniroute serve` with its keyless free
providers answers with no account and no key at all. An empty saved value falls
back to the default rather than routing to `""`. The endpoint key is optional
and, like LiteLLM's, never echoed back to the UI.

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

## A fallback model for unattended runs

Settings → **Model** has a second picker: **Fallback for unattended runs**.

A workflow runs at 09:15 with nobody watching, pinned to whatever the default
model is. When that model can't be reached — a proxy with no egress, a provider
having a bad ten minutes, Ollama not running — every armed workflow dies at its
agent step, and the only sign is an alert that never arrived. That is what
happened to a 15:00 run here: `litellm/gpt-4o-mini` answered fine minutes later,
so the outage was transient and the schedule was simply unlucky.

- The fallback is tried **only when the default fails**. A working default is
  never quietly swapped out underneath you.
- **A local model is the dependable choice**: it's up whenever the machine is.
- The run says which model answered — *"(answered by ollama/… — litellm/gpt-4o-mini
  wasn't reachable)"* — because a different model means a different answer, and
  that belongs in the record rather than hidden.
- With no fallback set, the step fails with the fix named: *"No fallback model is
  set - pick one in Settings → Model."* On a run's diagram, that step's drawer
  offers **Open Settings → Model**.

Checked in `tests/test_agent.py`: the default is used when it works, the fallback
only on failure, a missing fallback names the setting, and both failing reports
both.
