# Promoter shareholding — tracking the *shape* of the change

`/shareholding` in the icon rail. Not to be confused with [Holdings](holdings.md), which is your
own broker portfolio; this page is about who owns the **companies**.

## The idea

A promoter going from 15% to 66% in one quarter and a promoter going from 15% to 18% over four
quarters both "went up". They mean nearly opposite things:

- **Gradual, steady increase** — usually open-market buying with the promoter's own money. Real
  skin in the game.
- **Sudden, large jump** — almost never open-market buying. A preferential allotment, a warrant
  conversion, a reclassification, or a change of control. Whether that is good or bad depends on
  the mechanism, which the raw number cannot tell you.

So the page does not rank by "promoter % went up". It sorts stocks into **organic** and **needs
verifying**, so the handful of filings worth actually reading rise to the top instead of you
eyeballing shareholding tables across a watchlist every quarter.

## Why percentages alone cannot answer it

This is the fact the whole feature is built around. Every category sums to 100, so issuing new
shares to a promoter pushes promoter % up and public % down in exactly the shape that buying from
the public would.

AJOONI, as filed with NSE in 2026:

| | 30-JUN | 12-AUG |
|---|---|---|
| Promoter shares | 46,324,766 | **55,324,766** |
| Public shares | 125,918,832 | **125,918,832** |
| Total shares | 172,243,598 | **181,243,598** |
| Public shareholders | 60,670 | 60,164 |
| Promoter entities | 5 | **6** |

Promoter holding went 26.89% → 30.53%, and **the public sold nothing** — their share count is
identical to the digit. Nine million new shares were created for a sixth promoter entity that did
not exist the quarter before. On percentages alone that reads as accumulation. It is dilution of
everyone else.

So the ledger stores **share counts**, and the verdicts are decided on them:

| Pattern | Verdict |
|---|---|
| Total flat, promoter up, public down | Bought from the public (**organic**) |
| Total flat, promoter down | Sold to the public (**organic**) |
| Total up, promoter up ≈ the whole increase, public flat | New shares issued to the promoter |
| Total up, promoter flat | Diluted by an issue to others |
| Total flat, promoter *entity count* drops, shares cross to public | Looks like a reclassification |
| Anything else | Needs the filing read |
| No share counts fetched yet | Says so — it does not guess |

That last row matters: a verdict invented from percentages is precisely the mistake this exists to
prevent, so a filing without its detail reports `detail_missing` rather than a plausible-looking
answer.

The page never claims a corporate action was good or bad. That needs the filing itself, read by a
person. It decides *which* filings are worth that.

## The other free signal: off-cycle filings

SEBI requires a fresh shareholding pattern within ten days of any capital change over 2%. So a
filing whose period is **not a quarter end** exists *because* something happened — the date alone
is a corporate-action flag, with no extra fetch. In a typical quarter ~154 of ~2,466 filings are
off-cycle. They are always flagged, and always earn a detail fetch however small the move looks.

Revisions are handled too: NSE restates ~79 filings a quarter, and a restatement counted as its own
period would invent a quarter's worth of change out of a correction. The latest submission for a
period wins.

## Where the data comes from

Two sources, deliberately unequal in cost:

| | Covers | Cost | Gives |
|---|---|---|---|
| `/api/corporate-share-holdings-master` | Every listed company, one 90-day window | **One request** (~2,500 filings) | Percentages, dates, revision flag, XBRL link |
| The filing's own XBRL | One filing | 85–270 KB each | Share counts, shareholder counts, allotment date |

A blanket XBRL sweep would be ~350 MB and thousands of requests per quarter, so detail is fetched
only for filings that **moved ≥ 0.5pp or are off-cycle** — a few dozen a quarter — and only once
ever, since a filing never changes (`detail_fetched_at` is the marker). Everything is keyed on
NSE's own `record_id`, so re-collecting a window you already have upserts the same rows instead of
duplicating quarters. That is what makes the daily job and a 5-year backfill safe to run over each
other.

**Collect** on the page pulls 1–5 years, or an explicit **from/to span** picked on the calendar —
useful for re-pulling a single quarter, or reaching back to a period the years shorthand doesn't
cover. Either way it walks 90-day windows, newest first, so an interrupted run keeps the useful
end; the span wins when both are set. Re-collecting a range you already have is idempotent (record
ids again), so "just pull that quarter again" is a reasonable thing to do. A background job runs **once per IST day** — newest window plus up to 60 detail
fetches, the rest picked up tomorrow — checked hourly, so a machine that was asleep at the target
hour catches up when it wakes. Same shape as the daily watchlist event scan.

## Reading the table

| Column | What it says |
|---|---|
| **Promoter** | Latest promoter + promoter group % |
| **Δ latest** | Change at the most recent filing, in percentage points |
| **Δ window** | Cumulative change over the last four filings, tagged *gradual* or *one step* — "one step" means a single filing carried more than 75% of the move |
| **Shape** | The last several filings as bars: a steady climb and a cliff look different at a glance |
| **Flag** | `Organic` / `Verify` / `Quiet` — the sort key that does the work |
| **What happened** | The verdict, plus shares created and the change in public shareholder count when the detail has been read |
| **Period** | The filing period, badged `off-cycle` when it isn't a quarter end |

Filters: symbol/company search, flag (**Moved** by default, or Needs verifying / Organic only /
Everything), and a minimum move in pp — though off-cycle filings are always shown regardless.

## Nothing derived is stored

Changes, pace and flags are computed on read from the stored filings, the same rule P&L and R:R
follow in the journal. It matters more here: a filing's XBRL detail can arrive days after the
filing itself, and a stored verdict would still be saying "mechanism unknown" long after the data
to answer it landed.

```bash
.venv/bin/python tests/shareholding.selfcheck.py
```

Checks the AJOONI pair above (the same +3.64pp read both ways), every verdict, the detail gating,
window tiling, revision handling and the screener's own sort.

## Limits

- **The mechanism, not the diagnosis.** A preferential allotment, a warrant conversion and a
  promoter subscribing to a rights issue all look identical from share counts. The page tells you
  new shares were created and who got them; the filing tells you why.
- **Only promoter vs public.** The XBRL's sub-category breakdown (FII/DII/individuals) is parsed
  past, not stored — it isn't needed to answer "were new shares created", and storing it would mean
  tracking SEBI's category taxonomy.
- **NSE equities only**, and only what NSE has published since your first collect.
