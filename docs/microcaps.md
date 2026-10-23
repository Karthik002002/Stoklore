# Microcap Universe

[← Back to index](README.md)

Every listed company between **₹100 and ₹2,000 Cr** market cap (about 2,100 of them), with enough
data to shortlist long-term candidates by hand: fundamentals, strength, ownership, **objective red
flags**, and your own thesis on the ones you keep. It reports facts. It never says buy.

Open it from **Discover › Microcaps** in the sidebar, or `⌘K → Microcaps`.

## The page

- **Table:** every company, sortable on every column. Columns: market cap, P/E, ROCE, ROE, latest
  quarter sales and profit vs a year ago, promoter % and its change over 4 quarters, FII %, RS, 12-month
  return, distance from the 52-week high, ₹ Cr traded a day, and red flags. Click a row for the detail
  drawer; the chart icon opens the chart modal.
- **Filters:** search (symbol, name or BSE code), ROCE ≥, P/E ≤ (loss-makers drop out once set), RS ≥,
  promoter ≥, quarterly sales growth ≥, turnover ≥, *No red flags*, *NSE only*, *My theses*.
- **Presets:** *Quality compounder*, *Cheap + profitable*, *Growing + strong*, *Clean books* — starting
  points, not recommendations. **Save current…** keeps your own (in this browser).
- **Compare:** tick up to five rows and press *Compare* for every figure side by side.
- **Detail drawer:** every figure, the red flags, your thesis, links to Moneycontrol / ET / Tickertape /
  Trendlyne, and screener.in's 10+ years of statements (the same panel as the stock page).
- **Refresh:** pulls a fresh snapshot now (about 3 minutes); the page polls until it lands.

## Theses (your long-term list)

In the drawer, **Add to long-term list** saves a note ("why this company, what has to stay true") and
up to three limits that would break it:

| Limit | Breaks when |
|---|---|
| ROCE ≥ | the latest ROCE is below it |
| P/E ≤ | the latest P/E is above it |
| Promoter drop ≤ | promoter holding has fallen more than this many percentage points since you wrote the thesis |

The stock's numbers on the day you wrote it are kept, so the drawer shows **price, ROCE, P/E,
promoter %, RS and market cap then → now**. Editing the note or limits keeps that starting point.

After every weekly pull, each thesis is re-checked and two things can land in **Alerts**:

- **Thesis check:** a limit newly broken, or the stock gone from the band (moved above ₹2,000 Cr,
  below ₹100 Cr, or delisted). Reported once, when it first appears, not every week.
- **New quarter:** the latest-quarter sales or profit changed since the previous snapshot, which is
  what a results filing looks like from a weekly pull: `sales ₹Cr 50 → 60, profit ₹Cr 5 → 7, …`.

## Where the numbers come from

| Data | Source | Notes |
|---|---|---|
| Market cap, P/E, ROCE, ROE, dividend yield, latest-quarter sales/profit and YoY growth, FII %, promoter change | screener.in, one raw screen query on market cap alone | 42 pages of 50, **4 s apart** (faster than that and screener answers 429 after ~25 pages). **Needs your session cookie** (Settings › Screener) |
| RS rating, 12m return, distance from 52-week high, 20-day turnover | the [Leaders](leaders.md) bhavcopy table | NSE main board only. SME and BSE-only names have these blank |
| Promoter %, its change over 4 quarters, capital-change filings | NSE [shareholding](shareholding.md) filings | NSE's figure wins over screener's when both exist |

**The fundamentals are the columns your screener.in account shows.** Signed in, screener returns
the columns from your own column settings, not one per query condition. To add more, open any
screen on screener.in → **Edit columns** and switch on, for example, *Sales growth 3Years*, *Profit
growth 3Years/5Years*, *Debt to equity*, *Pledged percentage*, *Cash from operations last year*,
*Net profit last year*, *OPM*, *Price to book value*. The next pull picks them up. Until then those
fields, and the red flags that need them (pledge, cash flow, debt), stay blank.

The query filters on market cap alone on purpose. Padding it with always-true conditions ("Debt to
equity > -1e9") made screener drop every company with that cell blank: 842 of 2,088.

The band is fixed in `app/core/microcap.py` (`MCAP_MIN_CR` / `MCAP_MAX_CR`).

## Red flags

Things to look into, not reasons to reject. Missing data never raises a flag.

| Flag | When |
|---|---|
| `pledge N%` | any promoter shares pledged |
| `promoter -Npp in 4Q` | promoter holding down 2 percentage points or more over four quarterly filings |
| `cash flow below profit` | last year's operating cash flow under half of a positive net profit |
| `D/E N` | debt to equity above 1 |
| `N capital change filing(s) in 2y` | off-cycle shareholding filings. SEBI requires one only after a capital change over 2% (preferential allotment, QIP, warrants), so they point at dilution |
| `illiquid` | 20-day average turnover under ₹50 L a day |

Not covered yet: ASM/GSM surveillance lists and auditor or rating changes.

## Refresh

- **Weekly, automatically:** a background loop pulls a new snapshot once the latest is 7 days old.
  It stays idle while no screener cookie is saved. An expired cookie is retried once a day, not
  every hour.
- **On demand:** the Refresh button, or `POST /api/microcaps/refresh`.
- Each pull is stored whole in `microcap_snapshots`, one row per day. A second pull on the same day
  replaces that day. Earlier snapshots are kept; the new-quarter check compares against the previous one.

## API

| Endpoint | |
|---|---|
| `GET /api/microcaps` | the latest snapshot: `as_of`, `band_cr`, `count`, `stocks[]` (404 before the first pull) |
| `GET /api/microcaps/status` | `running`, last `error`, `as_of`, `has_cookie` |
| `POST /api/microcaps/refresh` | start a pull. `{started: false}` if one is already running |
| `GET /api/microcaps/theses` | every thesis, with `since` (field → [then, now]) and current `breaches` |
| `PUT /api/microcaps/theses/{key}` | create or edit: `note`, `min_roce`, `max_pe`, `max_promoter_drop` (404 if the stock isn't in the latest snapshot) |
| `DELETE /api/microcaps/theses/{key}` | remove a thesis |

`key` is the NSE symbol, or the BSE code for a BSE-only company. Each stock also carries `symbol`
(null for BSE-only), `bse_code`, `name`, `screener_url`, the fundamentals above, `rs`, `r3m`, `r12m`,
`from_high_pct`, `avg_value_cr`, `template_score`, `promoter_pct`, `promoter_chg_4q`, `off_cycle_2y`
and `flags[]`. Sorted by RS, unrated last.

Self-check: `python tests/microcap.selfcheck.py`.
