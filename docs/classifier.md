# Laya Classifier

[← Back to index](README.md)

[Laya](https://github.com/NandhaKishorM/laya) (Apache-2.0) is a local, non-autoregressive
decision model — the open-source alternative to Jev. Instead of generating text it answers a
typed question about a piece of text in one forward pass, with a calibrated confidence:

| Type | Asks | Returns |
|---|---|---|
| `choice` | pick one label | the label, every label's probability, confidence |
| `score` | a point on an ordered scale | the expected position on the scale |
| `noul` | yes / no | the probability of yes |

It runs beside the chat LLM, not instead of it. Model: `convaiinnovations/laya` (ModernBERT-large,
421M params, English), ~1.7 GB, downloaded from Hugging Face on first use and held in memory
after that. On Apple silicon it runs on MPS — about 0.2–0.45 s per news story (three questions
in one pass) after a ~25 s first load.

## Using it

**Settings › Classifier** → tick **Use the Laya classifier**. Off by default. Off (or the package
missing, or the model failing) means every feature below behaves exactly as it did without it —
nothing errors.

- **Chat guard rails** — each message you send is checked for credentials/personal data and for
  pasted text that tries to steer the assistant; a hit shows a warning toast. Every tool result
  (scraped news, fetched pages, reports) is checked for injection attempts on top of the existing
  regex, and a hit adds the same security note the regex adds. It warns; it never blocks.
- **News tags** — every scraped story (a stock's news, Events feed news, Top news) gets an
  **event type** (earnings, order win, corporate action, deal, management, regulatory,
  operations, rating, market, other) and a **materiality** rating. Hover a badge for the exact
  numbers. **Material only** on Events and Top news keeps stories rated moderate/major or likely
  to move the price. Tagging runs in the background after a scrape, so badges appear on the next
  load; switching the classifier on backfills stories already saved.
- **Journal suggestions** — **Suggest from notes** in a trade's review (trade form and Bar
  Replay's close dialog) pre-selects the mistake and emotion the notes describe. It replaces the
  mistakes picked so far and says what it chose; nothing is stored until you save the trade.
- **`classify_text` tool** — the chat agent can call it, and so can a workflow tool node:
  `text`, `question` (refer to the input as `` `text` ``), `type` (`choice` / `score` / `noul`),
  `options` (labels, optionally `label: description`; in a workflow, one per line or
  comma-separated). The answer is `{answer, confidence, …}`, so a Condition node can branch on it.

## How it works

`app/core/classifier.py` is the only module that touches Laya. `predict()` returns `None` —
never raises — when the setting is off, the package isn't installed, or the model fails, and every
caller has a pre-Laya path for that. The model loads lazily behind a lock, once per process.

- **Guard.** `llm.py` stays a pure network client with no storage dependency, so the tool-result
  check is a hook (`llm.TOOL_RESULT_GUARD`) that `main.py` points at
  `classifier.injection_flagged` at startup. A flag needs ≥ 0.6. Only the first ~2,500 characters
  of a result are read; anything deeper is left to the regex and the data-not-instructions
  boundary every result is wrapped in. The chat's own message check travels to the UI as a
  `data-guard` stream part.
- **News tags** live in a `laya_tags` JSONB column on `stock_news`, `top_news` and `stock_events`
  (news and research rows only — a price move has no text). `NULL` means not tagged yet.
  `tag_pending_async()` runs one background pass at a time over untagged rows after a scrape, an
  event scan, a Top news read, or switching the classifier on.
- **Journal suggestions** (`POST /api/manual-trades/suggest-review`) ask one `choice` over the
  mistake labels, each with a short definition (`MISTAKE_HINTS`), plus one `choice` over emotions.
  A second mistake is suggested only when it has ≥ 0.2 of the probability. The vocabulary comes
  from the form, so labels renamed in Settings are used as-is (without a definition, less sharply).

### Question wording matters

This model is sensitive to phrasing, and the questions in `classifier.py` were picked by testing:

- "Is `news` price-sensitive information?" scored every headline ~0.15; "Could `news` move the
  company's share price significantly?" separates an order win (0.63) from market chatter (0.09).
- A yes/no per mistake label scored everything ~0.1; one choice over *described* labels picked
  Chasing at 0.9997 on a chasing note and Normal loss at 0.9995 on a clean one.
- It has no world knowledge — asked which sector "Coforge bags $200 million deal" is in, it said
  Banking. It classifies what the text says, nothing more.

For your own `classify_text` questions: name the input in backticks, prefer a `choice` over
several yes/no questions, and give each option a few words of description.

## Checks

```bash
.venv/bin/python tests/classifier.selfcheck.py
```

Runs against a stubbed model (no download, no database): off → `None`, the answer flattening
each caller reads, workflow option parsing, guard thresholds, text clipping, one forward pass per
guard check, and a failing model degrading to `None`.
