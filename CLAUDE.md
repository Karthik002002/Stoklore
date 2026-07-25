# Response style

- Terse, code-first. Lead with the diff/code, not a preamble restating the request.
- No trailing summary of what changed — the diff/output already shows it.
- Skip narrating obvious steps ("Now I'll edit X", "Let me check Y") unless something surprising turns up.
- One-line note only when a choice isn't obvious from the code itself (a workaround, a constraint, a tradeoff) — not a design essay.

# UI changes

- Don't start a dev server or do browser/preview render checks for UI changes. Ship the code change and stop.
