# Agent

[← Back to index](README.md)

`/agent` — the chatbot. Workflows, the same tools run with nobody watching, have
their own section: see **[Workflows](workflows.md)** for the pages, triggers and
notifications.

## Using it

- **Chat** — conversations down the left, transcript on the right. Every chat the
  app has ever had is in that list, including ones the floating widget started.
- **A run keeps going when you leave.** Send something, navigate to Holdings,
  come back — it's still working, or finished while you were gone. Close the tab
  entirely and the run still completes; reopening the chat replays it from the
  beginning. A chat still working shows a spinner in the sidebar, *in every
  browser*, because the answer comes from the server rather than from whichever
  tab started it.
- **Workflows** — saved graphs that run **without you** — live at `/workflows`.
  That is the whole difference between the two: chat waits for you to type, a
  workflow runs on a trigger with nobody watching. Pages, triggers and
  notifications: [Workflows](workflows.md).
- ⌘K → **Agent**, **Workflows**, **Workflows > New workflow**, any saved workflow
  by name, or the icons in the sidebar.

## Every screen is a URL

The chat is `/agent?session=<id>`. Every workflow screen's URL is listed in
[Workflows → Pages](workflows.md#pages). Old `/agent/workflows/…` links and
`/agent?view=workflow` redirect there.

`?node=` changes are `replace`, not a new history entry. Otherwise every click on
the canvas would be one more Back press.

### The editor guards unsaved work

- An amber dot on the name means the canvas has something the server doesn't.
  "Unsaved" is a comparison of name, trigger, arm state, retention, node
  positions/data and edges against the saved copy. Selecting or measuring nodes
  doesn't count.
- **⌘S** saves (rebindable in Settings → Shortcuts, *Workflow editor*). With
  nothing to save the button reads **Saved**.
- Leaving for another page with unsaved edits asks: **Keep editing**,
  **Discard**, or **Save & leave**. Closing the tab gets the browser's own
  prompt.
- **Run now** on a dirty canvas becomes **Save & run**. Running the last-saved
  copy of a graph you're looking at would run something other than what's on
  screen.

## Building a workflow

Start from a **template**: **Templates** on the workflow list opens a gallery of
16 working graphs, nine to a page in a 3×3 grid, filterable by category —
Market, Watchlist, Events, Portfolio, Screener. They clone **disarmed**: a
template is a starting point, and arming something you haven't read is exactly
the surprise this feature must not spring.

Most alerting templates share one tail: an agent node that answers with the
sentinel `NOTHING_TO_REPORT` when nothing qualifies, and a `not_contains` gate
that drops the branch when it does. A sentinel rather than "none", because "none
of the others moved" is ordinary prose and gating on it would silence a real
finding.

**Every template is run in a test, not just loaded.**
`tests/workflow_templates.selfcheck.py` checks that each `{{ reference }}` names a
node it's wired to, then executes every template against fake tools shaped
exactly like the real ones — and requires fan-outs to fan out, gates to open on
interesting data, and quiet days to file nothing. It exists because two of the
first three templates were broken and nothing noticed: *Watchlist price log*
fanned out over `{{ lists.symbols }}`, but `list_watchlists` returns a list, so it
resolved to nothing; *Event triage* gated on `scan_events`, which starts a scan
and returns "started" immediately, so its condition could never pass. Both ran
"successfully" and did nothing. The same check then caught a third: the shared
alert tail filed `{{ say }}` from a node wired only to the gate, so every alert
would have been blank.

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

A `for each` that resolves to **nothing** is a wiring mistake, and the node fails
before its tool runs, with a message naming the fix. For example: *"'Price each'
loops over `{{ lists.symbols }}`, but 'lists' is already a list of 6 - loop over
`{{ lists }}` instead, and read a field of each with `{{ item.symbol }}`"*. It used
to run the tool once with `item` missing, which only failed later on the absent
argument (`'NoneType' object has no attribute 'upper'`), three steps from the
real cause.

A lone `{{ x }}` keeps its **type** (a list stays a list, which is what `for each`
needs); anything with text around it becomes a string.

## Workflows from screener.in screens

Paste any public screen URL into **Generate from a screener.in screen** at the
top of the gallery, and it becomes a workflow: run the screen daily, keep what
it matched as a series, and — only when it matched anything — summarise the
strongest five. Three screens also ship as templates (promoter share holding
finder, swing trading, quarterly growers). The generator and the templates build
the *same* graph (`screen_graph`), so a pasted screen and a shipped one can't
drift apart.

The screen is fetched **before** anything is saved, so a URL that isn't a screen
fails while you're looking at it — not in tomorrow evening's run. The first page
also supplies the workflow's name and puts the screen's query in its description.

How a screen is read (`scraper.get_screen`):

- **Pages via `?limit=50&page=N`**, capped at 2 per run by default (4 for the
  agent tool). A 344-result screen is seven pages; an alert about 350 companies
  isn't one, and every page is a throttled request to somebody else's server.
  The result says `truncated` when it stopped early.
- **Columns are not fixed** — screener adds one per condition in the query — so
  rows are keyed by each column's own tooltip (`Current Price` → `current_price`),
  never by position.
- **Rows are picked by their company link.** Screener repeats the header row
  part-way down a long table; "skip the first row" would read it as a company.
- **A company with no NSE listing** is addressed by its numeric BSE code, which
  goes in `bse_code`, not `symbol` — so no tool is ever handed `538786` as a
  ticker.
- **Numbers are numbers** (`1,300.50` → `1300.5`, blank → `None`), which is what
  lets a condition node compare them.
- **Only screener.in screen URLs are fetched.** This is a server-side fetch of a
  pasted URL, so anything else — another host, a company page, `localhost`,
  `file://` — is refused before a request is made.

### The login wall

**screener.in only lets an anonymous visitor open a few screens.** After that
the same URL — the one that returned a full table minutes earlier — answers with
its register page: a `200` with a sign-up form, not an error status. Verified
from both plain curl and the app's own transport, with and without a referer;
company pages keep working throughout, so it's specific to screens.

That is recognised by content and reported as exactly that
(`ScreenLoginRequired`), not as "private or deleted". A screen workflow that hits
it fails its run, files the failure to the alerts feed and counts toward its
fail streak — the honest outcome, rather than a run that looks green while
fetching a sign-up page.

**Give it your own session and the wall goes away.** Settings → **Screener**
takes the `sessionid` cookie from your own signed-in screener.in browser session;
every screen fetch then sends it, on screener's own cookie pool. **Open a test
screen** there proves it before tomorrow's run depends on it. The message says
which problem you have: with no cookie saved it tells you to add one, with one
saved it says yours has expired — a session cookie does expire, and pasting a
fresh one is the fix.

The app never asks for your screener.in password and never logs in for you; it
sends a cookie you pasted, to screener.in only.

## Collected data, and the Data view

A `collect` node appends its input to a named series each run — a list becomes
that many rows, anything else becomes one, so a series is always a table. **Data**
on the workflow list shows it: sortable table, a line chart of any numeric
column over time, four health tiles, and a strip of the last runs — one bar each,
red for failed. Click a bar to open that run.

The chart uses **lightweight-charts**, the library the journal and paper pages
already use, with the same axis and grid colours. It draws **one coloured line
per dataset**:

- **A line per `symbol`** (or any other column that names 2–60 groups) by default.
  **One line** turns the split off. Colours are assigned alphabetically, so a
  symbol keeps its colour from run to run. There are ten fixed hues, then
  golden-angle steps, so a 25-symbol watchlist still gets 25 distinguishable
  lines.
- **The legend is the control:** click to hide a line, double-click to show only
  it, hover to pick it out from the rest. It shows the values under the
  crosshair, or the latest ones.
- One run so far means one point per line. The dots are drawn so the point is
  visible, and a note says each run adds the next.

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
  and a fan-out over a watchlist can genuinely outlast the gap between two ticks.
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

Daily, interval, weekly, monthly, around the market open or close, cron, after
the event scan, on a price alert, on a live order event, or after another
workflow finishes. Any clock trigger can skip NSE holidays. All of it is covered
in [Workflows → Triggers](workflows.md#triggers).

Enabled is the standing permission. It's on the list row and the workflow header
rather than buried in the editor, because turning one **off** is what you want to
do in a hurry.

## What a workflow is allowed to do

**Workflows bypass the agent's confirm gate.** `scrape_stock` normally returns
"needs confirmation" instead of running; inside a workflow it just runs. Creating
and arming a workflow *is* the confirmation — given in advance, deliberately, for
that exact graph — and a 09:15 run has nobody to ask.

That is safe here because of what the tool table actually contains: prices,
movers, EMA state, watchlists, holdings, scraping, search, rule checks, recent
events, screener.in screens, and `add_stock_event`. **There is no order-placing tool**, so no workflow can trade,
however it is wired.

## Where results go

- **The alerts feed** — an `output` node files there, alongside price alerts and
  broker events. It's already the app's "what happened while I wasn't looking"
  inbox.
- **Run history** — every execution, with its flow diagram, listed in the editor's
  right-hand panel. Each run is its own page, with older/newer arrows and **Run
  again**.
- **Step details** — click any node on a run's diagram and a drawer opens with
  the **full error** (the node itself truncates it), what the step was **called
  with** (a fan-out shows what it was wired with and what it looped over,
  since its arguments differ per item), and what it
  **returned**. Each section has a copy button. A fan-out says how many of its
  items failed. A step a condition switched off shows as **Skipped**, not as a
  green tick. A failure the app can walk you out of says so and offers the button
  that fixes it — a screener login wall links straight to Settings → Screener.
  When a run failed, a banner names the failing step and **Inspect →** opens it. `Esc` or clicking the canvas closes the drawer. The open
  step is in the URL, so a failure can be sent as a link straight to the broken
  step.
- **The workflow's own inbox**, with delivery rules — mute, snooze, quiet hours,
  digest, and Telegram for when the app is closed. See
  [Workflows → Notifications](workflows.md#notifications).
- **A desktop notification** when a workflow delivers one, *while the app is open
  in some tab*. Clicking it opens that notification in its inbox.

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

```bash
.venv/bin/python tests/workflow_templates.selfcheck.py
.venv/bin/python tests/test_screener.py
```

The first runs **every** template end to end against real-shaped fakes (see
above). The second parses a screen fixture carrying both traps — a repeated
header row and a BSE-only company — plus the register-wall page, and checks the
URL guard refuses other hosts, company pages, `localhost` and `file://`.

**Not covered:** fetching a live screen. That needs screener.in to serve it,
which it stops doing for anonymous visitors (see *The login wall*).


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
| `app/services/workflow_templates.py` | The 16 starter graphs, and `screen_graph` |
| `app/core/scraper.py` | `get_screen`, `parse_screen_html`, `screen_url` |
| `frontend/src/workflows/TemplateGallery.tsx` | The 3×3 template gallery and the screen generator |
| `frontend/src/workflows/WorkflowData.tsx` | Collected series, chart, health |
| `app/services/jobs.py` | `run_triggered_workflows`, the minute schedule tick |
| `app/routers/workflows.py` | CRUD, the palette catalogue, Run now |
| `frontend/src/workflows/WorkflowEditor.tsx` | The builder |
| `app/services/workflow.py` | Rows → `{nodes, edges}` |
| `app/routers/agent.py` | `/api/agent/runs`, `/api/agent/*/workflow` |
| `frontend/src/agent/AgentChat.tsx` | Sidebar, transcript, run subscription |
| `frontend/src/workflows/RunDiagram.tsx` | The read-only diagram of one run, and the step-details drawer |
| `frontend/src/workflows/WorkflowRun.tsx` | The run page: status, older/newer runs |
| `frontend/src/workflows/WorkflowList.tsx` | Status counts/filters, per-row last run, 5s polling |
| `frontend/src/router.tsx` | `/agent` layout and its workflow child routes |

## The canvas in dark mode

React Flow ships its own light and dark palettes, and it defaults to light. In
this app's dark theme that meant the zoom controls rendered with
`color: inherit` (white) on their own white buttons, and the minimap drew a
white panel. What you saw was one white rectangle with nothing in it. Both
canvases now pass `colorMode` from the applied theme (`useAppliedTheme` in
`lib/theme.ts`, which follows the root `dark` class) and let the card show
through behind the canvas. The run minimap colours nodes by status and draws the connectors between them (React Flow's own minimap draws nodes only), each wire in its source node's colour and failed ones in red. The editor's minimap does the same, with nodes coloured by kind (agent green, condition amber, collect blue, output red).
