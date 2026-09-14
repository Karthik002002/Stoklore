# Agent

[← Back to index](README.md)

`/agent` — the chatbot on one tab, and a flow diagram of what that chat actually
executed on the other.

## Using it

- **Chat** — conversations down the left, transcript on the right. Every chat the
  app has ever had is in that list, including ones the floating widget started.
- **A run keeps going when you leave.** Send something, navigate to Holdings,
  come back — it's still working, or finished while you were gone. Close the tab
  entirely and the run still completes; reopening the chat replays it from the
  beginning. A chat still working shows a spinner in the sidebar, *in every
  browser*, because the answer comes from the server rather than from whichever
  tab started it.
- **Workflow** — saved graphs that run **without you**. That is the whole
  difference between the two tabs: Chat waits for you to type, a workflow runs on
  a schedule with nobody watching.
  - The list is the manager: arm/disarm, **Run now**, when each last ran.
  - Open one for the editor — palette left, canvas middle, node settings right.
  - **Notify me** asks for desktop-notification permission (a click, because
    browsers refuse an unprompted request).
- ⌘K → **Agent > Chat** / **Agent > Workflow**, or the robot in the sidebar.

## Building a workflow

Start from a **template** — three working graphs on the list page (morning
movers, watchlist price log, event triage). They clone **disarmed**: a template
is a starting point, and arming something you haven't read is exactly the
surprise this feature must not spring.

Six node kinds:

| Kind | Does |
|---|---|
| **trigger** | what sets it off — schedule, manual, or after the daily event scan |
| **tool** | one of the agent's own tools, with arguments you fill in |
| **agent** | one LLM call: a prompt with upstream data pasted into it |
| **condition** | a gate — everything downstream is **skipped** unless it holds |
| **collect** | appends rows to a named series, so the workflow builds up data |
| **output** | files the result to the alerts feed |

### The condition node is the point

A workflow that files something every morning is just another inbox. One that
files only when a number crosses a line is what lets you stop looking. So a
failed condition does **not** fail the run — it marks the branch `skipped`, a
third outcome beside done and error, and the run reports *"Nothing crossed the
line — no alert."*

Comparisons are deliberately few: `gt gte lt lte eq ne contains not_empty`. A
threshold test against a missing field is **False**, never an error — a workflow
should go quiet, not break, when an optional field is absent.

Drag between the dots to wire one node into the next. **An edge grants a
reference; a template spends it** — `{{ nodeId.field }}` in an argument reads
that node's output. Two steps rather than one because a node usually wants one
field of a parent's result, and a visual field-mapper for arbitrary JSON is a
bigger idea than this page needs. A node only sees what it is wired to, so a
missing edge shows up as missing data instead of quietly working anyway.

**`for each` is the fan-out.** Point it at a list (`{{ watchlist.list }}`) and the
node runs once per item with `{{ item }}` in scope; its output is the list of
results. That's what puts *"8 items"* on a wire. One item failing becomes that
item's result rather than ending the run — seven of eight symbols answering is a
useful run.

A lone `{{ x }}` keeps its **type** (a list stays a list, which is what `for each`
needs); anything with text around it becomes a string.

## Collected data, and the Data view

A `collect` node appends its input to a named series each run — a list becomes
that many rows, anything else becomes one, so a series is always a table. **Data**
on the workflow list shows it: sortable table, a line chart of any numeric
column over time, and four health tiles.

**Retention counts runs, not rows.** A run that collected eight symbols and one
that collected two are both *one* run; pruning by row count would keep a ragged
window that means nothing on a chart. It's per workflow (`retain_runs`, default
30) because a daily scan and an hourly one mean very different things by "the
last 30", and pruning happens right after each run — the moment there's a new
run is the moment an old one falls out of the window.

A **skipped** collect appends nothing. Silence must not quietly poison a series
with blank rows.

**Health** is the other half of the same question: runs kept, how many failed,
average duration, and which node fails most. That's the thing a feed which has
simply gone quiet cannot tell you, and the list row carries a **"N failed in a
row"** badge for the same reason.

## When things go wrong

- **Retries.** `tool` and `agent` nodes retry three times with growing delays
  (1s, 3s, 8s) — most failures are somebody else's transient 5xx, and a
  scheduled run has nobody to press the button again. `condition` and `collect`
  aren't retried: neither fails for a reason a second attempt would fix.
- **A failed node fails the run.** Nodes are caught individually so the rest of
  the graph still runs, but the *run* is recorded `failed` and files to the
  alerts feed. Recording it green is how a workflow ends up producing nothing
  for a week while the history looks fine.
- **`fail_streak`** counts consecutive failed runs and resets on any success. The
  workflow stays armed — a two-day upstream outage shouldn't silently turn your
  automation off — but the count is on the row and in the alert.
- **One run at a time.** A scheduled workflow whose previous run is still going
  is skipped this tick; two copies of a scan would double every write it makes,
  and a fan-out over a watchlist can genuinely outlast an hourly tick.
- **A per-item failure inside a fan-out** is that item's result, not the end of
  the run. Seven of eight symbols answering is a useful run.

## The daily digest

Five armed workflows mean five separate alerts every morning — the inbox this
was meant to replace. So once a day (18:00 IST, after the evening workflows) the
day's workflow results are rolled into **one** summary alert. The originals are
left alone: the digest is an extra row, not a deletion, so nothing is lost if the
roll-up misses something. Same once-per-IST-day guard as everything else, so a
restart can't double-file it.

## Triggers

- **Manual only** — Run now, nothing else.
- **Daily at HH:MM** IST — an hourly tick asks "has today's run happened yet",
  the same shape as the event-scan and shareholding loops. No cron dependency, a
  machine asleep at 09:15 still runs when it wakes, and a restart can't
  double-fire because the last-run date is a column, not memory.
- **After the daily event scan** — runs on what the scan just found, which is the
  only reason to hang it off that rather than off a clock.

Enabled is the standing permission, and it's on the list row rather than buried
in the editor because turning one **off** is what you want to do in a hurry.

## What a workflow is allowed to do

**Workflows bypass the agent's confirm gate.** `scrape_stock` normally returns
"needs confirmation" instead of running; inside a workflow it just runs. Creating
and arming a workflow *is* the confirmation — given in advance, deliberately, for
that exact graph — and a 09:15 run has nobody to ask.

That is safe here because of what the tool table actually contains: prices,
movers, EMA state, watchlists, holdings, scraping, search, rule checks, and
`add_stock_event`. **There is no order-placing tool**, so no workflow can trade,
however it is wired.

## Where results go

- **The alerts feed** — an `output` node files there, alongside price alerts and
  broker events. It's already the app's "what happened while I wasn't looking"
  inbox.
- **Run history** — every execution, with its flow diagram, in the editor's
  right-hand panel.
- **A desktop notification** when a run finishes, *while the app is open in some
  tab*. A workflow that runs at 09:15 with the browser closed files to the alerts
  feed and waits for you there; a real push needs a service worker and a
  subscription the server can reach, which is a different feature.

## A workflow run is a run

Executing a workflow writes the same `chat_runs` + `chat_tool_calls` rows a chat
turn does, with `workflow_id` set and `session_id` null. So the run history and
the flow diagram are the *same* history and the *same* diagram — the picture of
what a workflow did and the picture of what a chat did are one piece of code
(`app/services/workflow.py`), and each node execution is a row exactly like a
tool call.

## Why a run is a row, not a request

The floating widget runs the agent *inside* its streaming HTTP response, so
navigating away kills it mid-tool-call. That's fine for a question you're
watching and wrong for "scan my watchlist and tell me what moved."

So `POST /api/agent/runs` writes a `chat_runs` row, starts a daemon thread and
returns a run id immediately. The thread drives the agent loop and writes each
tool call to `chat_tool_calls` as it starts and finishes. The browser subscribes
to `GET /api/agent/runs/{id}/events`, which **replays what is already stored and
then follows** — so a reconnect after a refresh, or a second window on the same
run, sees the whole thing rather than whatever is left of it.

This page deliberately does **not** use the AI SDK's `useChat`: that hook owns
the request, which is exactly the coupling being removed here.

`ponytail:` the follow half polls the run's rows every 400ms rather than using a
pub/sub. A run makes a handful of tool calls over seconds to minutes, so it's a
few cheap indexed reads — and unlike an in-process queue, a subscriber that
arrives late (or after a restart) still sees everything. Swap for
`LISTEN`/`NOTIFY` if runs ever get chatty.

## `round` is what makes it a graph

`llm.run_agent_stream` yields a `round` with every tool event: the loop iteration
that asked for the call. Every tool in one round was requested by **one model
turn** — they're siblings that fan out from the same decision, which is precisely
the split/merge shape an n8n graph draws. Ordering by arrival alone would render
a straight line and silently claim the second tool waited for the first.

So `app/services/workflow.py` lays out **a column per round**, rows stacked
within it, every node of one column wired to every node of the next (the agent
hands the model *all* prior results before picking the next tools, so a narrower
edge set would invent a dependency). It's pure — rows in, `{nodes, edges}` out,
positions included — which is what lets `tests/workflow.selfcheck.py` check the
fan-out, the item counts, a failed tool and a run still in flight against
fixtures instead of a live agent. The browser renders it verbatim and never
recomputes the layout.

A run that called nothing still draws `trigger → reply`. "The model knew it
without looking anything up" is a real answer, and a blank canvas reads as
breakage.

## Tools on every backend now

The agent loop used to be gated to `ollama/` and `litellm/` models, with
OmniRoute falling back to retrieval-augmented chat because tool support varies
across its upstream providers. It isn't gated any more: every model gets tools,
and if the provider rejects the tools payload the turn degrades to
`_rag_reply()` — the same retrieval path as before — instead of failing.

Without that, the free-tier routing in [Model Settings](model-settings.md) could
never produce a workflow at all: no tool calls, no diagram.

## What is checked

```bash
.venv/bin/python tests/workflow.selfcheck.py
.venv/bin/python tests/workflow_engine.selfcheck.py
```

The engine's `execute()` takes an `on_node` callback and does no persistence
itself, which is what lets the second file run whole graphs against fake tools
with no database and no model:

- templates and the type rule (`{{ x }}` alone keeps its type — a list stays a
  list, which `for each` depends on)
- dependency order, a refused cycle, an edge to a deleted node
- scope: an unwired reference is `None`, not the other node's value
- the fan-out, and one item failing without taking the run with it
- **conditions**: a gate passing, a gate skipping its child *and its child's
  child*, skipped ≠ error, a gated-off run filing nothing, a missing number not
  passing a threshold
- **collect**: a list becoming many rows, a scalar becoming one, a skipped
  collect appending nothing
- **retries**: a flaky tool succeeding on the third attempt, a permanently dead
  one still failing after them, and that pure nodes aren't retried

`RETRY_DELAYS` is set to `()` at the top of the file so the suite stays instant,
and restored where the retry behaviour itself is checked.


Rounds as columns, the fan-out and the merge, siblings never chained to each
other, item counts from a list vs a scalar, a running run, a failed tool, and
that no edge ever points at a node that doesn't exist — React Flow drops a
dangling edge silently, so that bug would look like a missing dependency.

**Not covered:** the background thread and the SSE feed. Those need a live model
and a database; they're exercised by using the page.

| Piece | Job |
|---|---|
| `app/services/agent_runs.py` | Starting a chat run, persisting it, replay-then-follow |
| `app/services/workflow_engine.py` | Topological execution, templates, fan-out, gates, retries |
| `app/services/workflow_templates.py` | The three starter graphs |
| `frontend/src/agent/WorkflowData.tsx` | Collected series, chart, health |
| `app/services/jobs.py` | `run_triggered_workflows`, the hourly schedule tick |
| `app/routers/workflows.py` | CRUD, the palette catalogue, Run now |
| `frontend/src/agent/WorkflowEditor.tsx` | The builder |
| `app/services/workflow.py` | Rows → `{nodes, edges}` |
| `app/routers/agent.py` | `/api/agent/runs`, `/api/agent/*/workflow` |
| `frontend/src/agent/AgentChat.tsx` | Sidebar, transcript, run subscription |
| `frontend/src/agent/RunDiagram.tsx` | The read-only diagram of one run |
