# Watch Rules

[← Back to index](README.md)

## Using it

- Settings → **Watch rules** → describe a rule in plain text (e.g. "P/E
  under 20 and a golden cross") — it's parsed into concrete criteria.
- Check it against one stock: `/rule NAME SYMBOL` in chat, or ask the agent
  "does TCS meet my rule". Omit the symbol to run it as a screener across
  your whole watchlist.

## How it works

**Parsing a rule is a one-time LLM call, not something re-run on every
check.** When you save a rule, `llm.parse_watch_rule(text, model)` sends
your plain-text description to the active model with instructions to reply
with *only* a JSON object containing whichever of four fields it can
identify: `max_pe`, `ema_short`, `ema_long`, `no_negative_events_days`. The
reply is sliced between its first `{` and last `}` and parsed, falling
back to an empty object on any parse failure — so a rule the model
couldn't parse at all just saves with no criteria set (and later never
passes, since evaluation requires at least one criterion). These fields
are stored as plain nullable columns; NULL means "not part of this rule,"
not "fails."

**Checking a rule never calls the LLM again** — `rules.evaluate(rule,
symbol)` inspects only whichever fields are non-null, independently:
- `max_pe` — live `trailingPE` from a quote, compared directly.
- `ema_short`/`ema_long` — reuses the exact same `prices.ema_crossover`
  math as the Stock Detail page's EMA panel (see
  [Stock Detail](stock-detail.md#how-it-works)); passes if the short EMA is
  currently above the long EMA.
- `no_negative_events_days` — looks at events already recorded for that
  symbol in the last N days (from the [Events Feed](events-feed.md)'s
  scans, not a fresh live check) and passes only if none of them were
  scored negative.

The rule as a whole passes only if at least one criterion is set *and*
every set criterion passes — a rule with nothing parseable out of it can
never report a pass, which is a deliberate fail-safe rather than a bug: an
unparseable rule shouldn't silently behave like "always true."
