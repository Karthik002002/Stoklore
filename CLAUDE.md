# Git & GitHub

- **Never push to GitHub unless explicitly asked.** All changes are local only. You control when/if code goes to GitHub.
- Commits can be made if requested, but ask first.
- No `git push`, `git push --force`, or any remote operations without explicit permission.

# Response style

- Terse, code-first. Lead with the diff/code, not a preamble restating the request.
- No trailing summary of what changed — the diff/output already shows it.
- Skip narrating obvious steps ("Now I'll edit X", "Let me check Y") unless something surprising turns up.
- One-line note only when a choice isn't obvious from the code itself (a workaround, a constraint, a tradeoff) — not a design essay.

# UI changes

- Don't start a dev server or do browser/preview render checks for UI changes. Ship the code change and stop.

# Touching the database

`DATABASE_URL` points at the user's **real, live journal** — `manual_trades`, `watchlists`,
`balance_adjustments` and the rest hold data they typed in by hand and cannot retype. There is no
PITR (`archive_mode=off`) and no automatic dump. A wrong `DELETE` is permanent.

**This already happened once**: a verification script inserted 3 test trades, then "cleaned up"
with `DELETE ... WHERE symbol IN ('TCS','INFY','WIPRO') AND account_id IS NULL`. That predicate
matched 22 rows — every pre-existing trade in those symbols, because the `account_id` column had
just been added and was NULL everywhere. The whole journal was destroyed. Rules that follow from it:

- **Never write to the live DB to test something.** Verify against a scratch database
  (`createdb crawler_scratch`, point `DATABASE_URL` at it, drop it after) or with a transaction
  that is always rolled back. Reading the live DB is fine.
- **Delete only by primary key, only ids this session created.** Capture the id returned from the
  INSERT and delete that exact id. Never delete by a content predicate (symbol, date, name, a NULL
  column) — a predicate matches rows you didn't create.
- **Count before you delete.** Run the `SELECT` form of the predicate first, print the count, and
  confirm it equals the number of rows you inserted. If it doesn't match, stop.
- **Read the numbers your own script prints.** "deleted 22" after inserting 3 is a failure, not a
  pass. Never let a `PASSED` line print after an unchecked destructive step.
- A newly added column is NULL for every existing row. Never use `<new_column> IS NULL` to mean
  "the rows I just made".
- Same care for `DROP`, `TRUNCATE`, `UPDATE` without a key, and destructive `psql -c` one-liners.

## Trade Log Simulation (`/simulation`)

Monte Carlo over your own trade history, not asset returns. Two independent modes:

- **Single** — one account in depth. URL: `?account=ID&mode=single`
- **Multiple** — n accounts compared. Each runs separately (never pooled). Inner tabs: Comparison + one per account. URL: `?mode=multiple&accounts=1,2,3&view=comparison|account-id`

**Engine** (`frontend/src/lib/tradeSimulation.js`):
- Pure functions, no React, no network. Synchronous, single-threaded.
- `simulate()` — runs the whole thing. ~1M iterations in single-digit ms.
- Bootstrap (with replacement) and shuffle (without replacement) models.
- Position sizing: as-logged, fixed-₹ risk, or fixed-% of equity.
- `dailyTotals()` + `pearson()` + `correlationMatrix()` — correlates accounts on realised daily P&L (stationary, not simulated curves).
- Self-check: `node frontend/src/lib/tradeSimulation.selfcheck.mjs` (passing).

**Important:** correlation is computed on daily P&L over shared trading days only. Days one account didn't trade are dropped (not zero-filled), and cells with <10 shared days are greyed out in the UI. Correlating two equity curves would report ~0.99 for any two profitable strategies (both drift up = time passing, not agreement).

**Backend:** zero changes. Reuses `getManualTrades()` and `getTradeAccounts('journal'|'paper')`. Paper exits are written to `manual_trades` tagged 'paper', so both logs are one client-side filter apart.

**URL state:**
- Single: `account` (required for this tab)
- Multiple: `accounts` (comma-separated IDs), `view` ('comparison' or stringified account ID for per-account tab)
- Shared: `mode` ('single' or 'multiple'), config saved to `localStorage` as `tradeSimulation.preset`

**Exports:** CSV (percentile summary + per-run data in Single; every metric per percentile + correlation matrix in Multiple), PDF (browser's print-to-PDF, nav/config drops out via `.no-print`), preset (localStorage).

**Docs:** [docs/trade-simulation.md](docs/trade-simulation.md) — full usage manual, correlation explanation, limits.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
