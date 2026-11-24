# Net Worth & Money Goals (`/finance`)

Track what you own, what you owe, what you are saving for, and what to fix first.

## Why there is no bank sync

- **Bank APIs**: Indian banks don't offer one to individuals.
- **Account Aggregator (Setu, Finvu, OneMoney)**: live data needs an RBI-regulated entity
  registered as a Financial Information User, certified through Sahamati, and paying per fetch.
  The sandboxes only serve mock data.
- **SMS and email parsing**: it works, but it is a regex per bank that breaks silently.

Goal tracking doesn't need transactions. It needs each account's balance about once a month, so
that is what the page stores.

## Data in

| Source | Covers | How |
|---|---|---|
| Monthly update | Everything | **Net worth › Monthly update**: one row per item, pre-filled with the last value, plus the month's income and expenses. Takes about 5 minutes. |
| CAS PDF | Mutual funds, demat stocks/bonds, demat MF units, NPS | **Net worth › Import CAS**. CDSL/NSDL email one every month. For CAMS/KFintech, request one on MF Central or camsonline.com. The password is usually your PAN in capitals. |
| Journal accounts | Trading capital | **Net worth › Link trading accounts**. The monthly update pre-fills the journal's current balance (opening + deposits − withdrawals + net P&L). Paper accounts can't be linked. |

Re-saving a date overwrites that date's values, so fixing a typo means saving again.

### How CAS holdings map to items

| Item | Key | Notes |
|---|---|---|
| One per mutual fund held in folio form | ISIN | CAMS, KFintech and NSDL/CDSL statements share the key, so importing two kinds of statement never double counts. |
| One per demat account for stocks | – | Summed |
| One per demat account for bonds | – | Summed |
| One per demat-held MF | – | |
| One per NPS scheme | – | |

When you re-import:

- The same holding updates the same item, and your renames and class edits are kept.
- Holdings an earlier CAS listed but this one doesn't are **reported, not zeroed**. A CAMS
  statement leaves out demat holdings, which is not a sale. If you did sell, record a 0 and
  archive the item.

The PDF and password are never stored.

## Items

| Field | Meaning |
|---|---|
| Kind | Bank, FD, MF, stocks, EPF, PPF, NPS, gold, property, cash, other. **Loan** and **credit card** are liabilities: enter the outstanding amount as a positive number, and it subtracts. |
| Asset class | Equity, debt, gold, cash, real estate, other. Drives the allocation donut and the drift check. |
| Liquid | Counts towards the emergency fund. Use it for money available within days: savings, sweep FDs, liquid funds. |
| Interest % | Liabilities only. At 10% or more, or any credit card balance, the debt is flagged. |
| Archived | Hidden from the monthly update; history is kept. Record a final 0 first. Delete removes the history too. |

## Goals

Each goal has:

- a target and a target date
- a priority (1 = most important)
- an expected return (be conservative: FD about 7%, equity MF about 11%)
- a planned monthly SIP
- **Funded from**: a share of one or more items

For each goal the page shows:

| Shown | How it's worked out |
|---|---|
| Funded | Σ item value × share |
| Needs /month | The SIP that takes the funded amount to the target by the date, at the expected return. It's an annuity, using the monthly rate equivalent to the annual one (12%/yr ≈ 0.949%/month). |
| Projected | The funded amount plus your planned SIP, grown to the date |

Each goal gets one status:

| Status | Meaning |
|---|---|
| done | Funded ≥ target |
| overdue | The date has passed and it isn't funded |
| on-track | Projected ≥ target |
| at-risk | Projected ≥ 90% of the target |
| off-track | Anything else |

An item earmarked more than 100% across goals is flagged, because the same rupee is being
counted twice.

## Focus

The Focus tab lists findings in a fixed order:

1. **Emergency fund**: liquid assets against *N* months of average expenses (the last 6 recorded
   months; 6 by default, set under Targets).
2. **Expensive debt**: credit card balances, and loans at 10% or more.
3. **Goals behind schedule**: by priority, then date.
4. **Surplus vs goals**: the total SIP all active goals need against your average surplus. If the
   surplus is short, it lists the lowest-priority goals whose SIPs would close the gap if pushed
   back.
5. **Short goals in equity**: a goal under 36 months away funded from an equity item.
6. **Allocation drift**: equity / debt+cash / gold against your targets, flagged at ±10 points.
7. **Housekeeping**: items earmarked over 100%, balances older than 45 days, trading capital as a
   share of net worth, and savings rate.

It is arithmetic on your own numbers, not advice. The thresholds are constants at the top of
`frontend/src/lib/goalMath.ts`.

## Projection

**Projection** answers "if I save this much, what do I end up with?" It is a what-if tool: nothing
on this tab is saved.

### Inputs

| Input | Default / meaning |
|---|---|
| Starting amount | Your current net worth |
| Monthly saving | Your average surplus over the last 6 recorded months |
| Raise saving by % a year | Salary hikes. The monthly amount steps up after every 12 months. |
| Years | 1–50 |
| Expected return % | The plain projection's rate, and the simulation's **median** year |
| Volatility % | How far one year can swing. Presets: FD/debt 7%/2%, balanced 9.5%/9%, Nifty index 12%/17%. |
| Inflation % | Shown as "in today's money" (the final value deflated) |
| Target | Optional. Adds the chance of reaching it. |

### What you get

- **Projection**: the same return every month (the monthly rate equivalent to the annual one),
  saving added at each month-end. It is the same arithmetic the goal SIPs use.
- **Simulation**: 2,000 runs with random monthly returns (normal log-returns, median = expected
  return, annual standard deviation = volatility). Each year it shows:
  - the bad case (p10: 1 run in 10 ends lower)
  - the median
  - the good case (p90)

  You also get the chance of hitting the target and the chance of ending below what you put in.
  It is seeded, so the same inputs give the same answer.

With 0% volatility every run equals the projection.

### Ceiling

Months are independent and normal: there are no crash clusters or fat tails, so the real bad case
is worse than p10. The upgrade path is to bootstrap from real Nifty monthly returns.

## Where things live

| Area | Files |
|---|---|
| Tables | `fin_items`, `fin_snapshots` (unique per item+date), `fin_goals` (funding as JSONB), `fin_cashflow` (one row per month), and the `finance` key in `settings` for the targets |
| API | `app/routers/finance.py`: `GET /api/finance` returns everything in one call. Writes go to `/items`, `/monthly-update`, `/goals`, `/settings`, `/cas` and `/link-trade-account/{id}`. |
| CAS mapping | `app/core/cas.py`. Self-check: `.venv/bin/python -m app.core.cas` |
| Arithmetic | `frontend/src/lib/goalMath.ts`. Self-check: `node frontend/src/lib/goalMath.selfcheck.mjs` |
| Page | `frontend/src/FinancePage.tsx`, with tabs at `?view=networth\|goals\|focus\|projection` |

## Limits

- **No transaction categories**: spending is one expenses number per month. A bank-statement CSV
  import would add categories; it hasn't been built.
- **Goal targets are nominal**: enter a future cost, or use a real (after-inflation) expected
  return.
- **CAS parsing is only as good as casparser**: re-printed PDFs and MF Central statements aren't
  supported. casparser 1.4.1 drops a CDSL account when its broker name extracts after its
  `DP Id` line. `app/core/cas.py` patches that row (`_patch_cdsl_summary_row`); remove the patch
  once an upstream release fixes it. Every import also checks coverage: it warns when nothing is
  found, or when the demat holdings don't add up to the account totals the statement prints.
