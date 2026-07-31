# Response style

- Terse, code-first. Lead with the diff/code, not a preamble restating the request.
- No trailing summary of what changed — the diff/output already shows it.
- Skip narrating obvious steps ("Now I'll edit X", "Let me check Y") unless something surprising turns up.
- One-line note only when a choice isn't obvious from the code itself (a workaround, a constraint, a tradeoff) — not a design essay.

# UI changes

- Don't start a dev server or do browser/preview render checks for UI changes. Ship the code change and stop.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
