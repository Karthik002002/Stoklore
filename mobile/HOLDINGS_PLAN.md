# Plan: Holdings, live value, hourly updates and alerts (mobile app)

Status: **plan for review**. No code is written yet.

**Goal:** you load your holdings into the app once, by typing them in or importing a CSV or PDF. After that the phone:
- shows their live value;
- sends a notification every hour during market hours, plus one before the open and one after the close;
- warns you when your own limits are hit, e.g. "my ₹1,20,000 has fallen to ₹1,08,000", and says which stocks caused the fall.

There is no broker link and no login. Holdings never leave the phone.

---

## 1. What data is needed

### Required: three fields per holding

| Field | Why | Example |
|---|---|---|
| **Symbol** (NSE) | To get its live price | `TCS` |
| **Quantity** | Value = quantity × price. Without it there is no ₹ value and no ₹ alerts | `10` |
| **Average buy price** | Profit/loss = (price − buy price) × quantity | `3,450.50` |

> **"Symbol and buy price" alone isn't enough.** The app also needs **quantity**. Your example of "₹1,20,000 falls to ₹1,08,000" is a ₹ amount, and that needs to know how many shares you hold.

### Optional: each one unlocks something extra

| Field | Unlocks |
|---|---|
| Buy date | Holding period, short- vs long-term (the 1-year line), annualised return (XIRR) |
| Exchange (NSE/BSE) | Correct prices for BSE-only stocks |
| Type: stock, ETF or mutual fund | Mutual funds are priced from AMFI's daily NAV, not live |
| ISIN | Matching rows from CAS and broker PDFs, which list ISINs rather than symbols |
| Note or tag (e.g. "long term", "trading") | Grouping, and alerts per group |
| Account name (e.g. "Mine", "Family") | Several portfolios on one phone |

**Several buys of one stock:** enter them as separate lots, or as one row with the average price. Phase 1 stores one row per stock, with quantity and average price. Lot-by-lot detail (for tax) is a later option.

---

## 2. How holdings get into the app

| # | Method | Effort | Notes |
|---|---|---|---|
| 1 | **Add by hand** | Small | Search a stock (existing ET search), then enter quantity and buy price |
| 2 | **CSV upload** | Small–medium | Columns are recognised automatically (table below). There's a review screen before saving |
| 3 | **Paste text** | Small | Paste rows copied from a spreadsheet or broker page. Same parser as CSV |
| 4 | **Broker holdings PDF** | Medium | Text pulled out with the bundled PDF library pdf.js (~1 MB, Apache-2.0). Each broker's layout needs its own pattern; Zerodha, Groww, Dhan and Upstox to start |
| 5 | **CAS PDF (CDSL/NSDL)** | Large | Password-protected (your PAN plus date of birth), which pdf.js can open. Gives every stock and mutual fund across brokers. Hardest to parse reliably; the web app already does this on its server, but the phone app has no server |

**CSV column detection** (not case-sensitive; first match wins):

| Field | Header names recognised |
|---|---|
| symbol | `symbol`, `tradingsymbol`, `instrument`, `scrip`, `stock`, `stock name`, `company`, `isin` |
| quantity | `qty`, `quantity`, `quantity available`, `units`, `shares` |
| buy price | `avg`, `avg. cost`, `average price`, `avg price`, `buy price`, `buy avg`, `cost price` |
| buy date | `date`, `buy date`, `purchase date` |

Zerodha Console exports `.xlsx` by default. Reading `.xlsx` needs another ~900 KB library, so phase 1 asks for "Download → CSV" instead.

**Matching to a live price:**
1. Exact NSE symbol: ET search confirms it.
2. A company name: ET search picks the best match. The review screen shows "TATA MOTORS → TATAMOTORS ✓", or "? pick one" when it isn't sure.
3. ISIN: *to check before building* whether ET search accepts ISINs. If it doesn't, ISIN rows need a one-time manual pick.

Every import ends on the **review screen**: matched, unsure and failed rows, each one editable. Nothing is saved until you tap **Save**.

**Picking a file:** the WebView needs `onShowFileChooser` in `MainActivity` for `<input type=file>` to open Android's file picker. That's about 30 lines of platform code, with no storage permission needed.

---

## 3. Live value: where prices come from

| Holding | Source | Cost per refresh |
|---|---|---|
| Stocks in ET's sector feed (~1,600 NSE stocks) | ET sector feed, which the app already uses | **1 request for all of them** |
| Stocks or ETFs not in that feed | Moneycontrol price history by NSE symbol (latest 5-min bar) | 1 request each |
| Mutual funds | AMFI daily NAV file (`amfiindia.com/spages/NAVAll.txt`), one new allowed host | 1 request a day |

Prices are those feeds' near-live prices, a few minutes behind. These are the same numbers the app shows today.

**The Holdings screen:**
- **Top:** total value, today's change in ₹ and %, overall P&L in ₹ and %, invested amount.
- **Rows:** symbol, quantity, buy price, live price, today %, P&L in ₹ and %. Sortable, and tapping a row opens the existing stock screen.
- **Allocation:** by sector, from the ET sector feed, as a heat strip like the sector map. Also by size: large, mid and small.
- **Movers:** today's top 3 contributors and top 3 drags, in ₹.

---

## 4. Notifications

| When | What |
|---|---|
| **Before the open** (~09:00 IST) | "Holdings ₹1,20,340 at yesterday's close · P&L +₹20,340" |
| **Every hour, 10:15–15:15** | "₹1,21,580 · +₹1,240 (+1.0%) this hour · today +₹3,100 · TCS +2.1% · INFY −1.2%" |
| **After the close** (~15:45 IST) | "Closed ₹1,22,050 · today +₹1,710 (+1.4%) · best TCS +₹900 · worst INFY −₹420" |

- **Settings:** on or off, frequency (hourly, every 2 hours, open and close only), quiet on weekends.
- **Holidays:** NSE's holiday list can't be fetched (NSE blocks the app). Instead, if no new price bar came in today, there's no notification.

**How it runs in the background:**
- The page can't run while the app is closed. So a native Android job (`JobScheduler`, built into Android with no extra libraries, which fits the no-Gradle build) wakes the app.
- It fetches prices in Java, works out the value and posts the notification.
- **Android 13+** needs the notification permission (`POST_NOTIFICATIONS`). The app asks the first time you turn notifications on.
- **Timing isn't exact.** Android delays background jobs in Doze, and some makers (Xiaomi, Oppo, Vivo, Samsung) kill them more aggressively. "Hourly" can land a few minutes to tens of minutes late. Settings would link to the phone's "unrestricted battery" page for Stoklore.

---

## 5. Alerts: "tell me before I give back my profit"

| Alert | Example | Fires when |
|---|---|---|
| **Portfolio falls to** | Value ≤ ₹1,08,000 | The total crosses below |
| **Portfolio rises to** | Value ≥ ₹1,50,000 | The total crosses above |
| **Protect profit** (trailing) | "Don't give back more than ₹10,000 from the high" | Value ≤ highest value since the alert was set − ₹10,000 |
| **Day loss** | "Down more than 2% (or ₹5,000) today" | Today's change crosses the limit |
| **Stock price** | TCS ≤ ₹3,300 / ≥ ₹4,000 | That stock crosses |
| **Stock day move** | Any holding −5% today | Any one holding crosses |

**The notification says what fell:** "₹1,07,900 — below your ₹1,08,000. Since last check: INFY −₹2,100, HDFCBANK −₹1,300, TCS −₹600."

**No repeats:**
- An alert fires **once** when the line is crossed.
- It re-arms only after the value moves back past the line by a margin (0.5%). So an alert that's hovering around the line doesn't fire 10 times.
- Each alert is set to "once" or "every time", and the app keeps a history of when each one fired.

**Checking:**
- Every **15 minutes** during market hours, which is Android's shortest repeating background job.
- So an alert can arrive up to ~15–30 minutes after the cross, more if Doze delays it.
- True real-time alerts would need a permanent foreground notification and drain the battery, so **not recommended**.
- This is a warning to go and look, not a stop-loss. The app can't place orders.

---

## 6. Storage: yes, a small database now

Your earlier question about a database: settings didn't need one, but holdings do.

- The background job is Java and **can't read the WebView's local storage**.
- So holdings and alerts go in **SQLite**, the database built into Android (no extra libraries). Java owns it, and the page reads and writes it through the existing `Native` bridge.

| Table | Columns |
|---|---|
| `holdings` | id, symbol, et_id, isin, name, exchange, type, qty, avg_price, buy_date, account, note |
| `alerts` | id, kind, target (portfolio or symbol), value, armed, repeat, created, last_fired |
| `snapshots` | time, value, invested, day_change (hourly; feeds "before/after" and the trailing high; pruned after 90 days) |
| `alert_log` | time, alert_id, value, message |

- **Settings** stay in local storage (fine as they are), but join the backup file below.
- **Backup:** Settings → Data gets **Export** (one JSON file with holdings, alerts and settings, via Android's share menu) and **Import**. This matters more now that the phone holds data you typed in.
- **Privacy:** quantities and prices never leave the phone. Price requests send only symbols to ET and Moneycontrol, as the app already does.

---

## 7. Where it sits in the app

There are five tabs today. Holdings needs one, and six don't fit on a phone. **Recommended:** Feed · **Holdings** · Markets · Sectors · Settings, with **Search** moving to a magnifier on the top bar.

The Feed can also gain a "Your holdings" card on page 1 when holdings exist: value, today's change, and the biggest mover.

---

## 8. Phases

| Phase | Scope | Native (Java) work |
|---|---|---|
| **1. Holdings** | Holdings tab: add by hand, CSV upload and paste, matching and review, live value, P&L, allocation, movers. SQLite through the bridge. Export/import | SQLite helper, bridge methods, file picker |
| **2. Notifications** | Before-open, hourly and after-close summaries; permission flow; settings | `JobScheduler` job, price fetch and value in Java, notification channel |
| **3. Alerts** | The six alert types, re-arm margin, "what fell" text, alert history | Alert checks in the same job, every 15 min |
| **4. PDFs** | Broker holdings PDFs, then CAS PDFs (with password), then mutual funds via AMFI NAV | None (pdf.js runs in the page); AMFI host allowed |

Each phase ships on its own as a new APK version.

---

## 9. Testing

**Pure logic in `lib.js`, tested in `check.mjs`:**
- CSV and paste parsing, column detection, number formats (`1,20,000.50`, `₹`).
- Symbol matching results.
- Valuation and P&L.
- Alert checks with the re-arm margin and the trailing high.
- Notification text.

**One rule in two languages:** the background job repeats the value and alert maths in Java. So a shared file of test cases (`holdings-cases.json`) is checked by **both** `check.mjs` and a small `java Check.java`. If either side's maths changes, one of them fails.

**On the phone:**
- import a real CSV from your broker;
- leave the app closed for a market day and confirm the hourly and close notifications arrive;
- set an alert just below the current value and confirm it fires once, not repeatedly.

---

## 10. Decisions for you

1. **Quantity:** OK to require it? Without it there are no ₹ values or ₹ alerts.
2. **Mutual funds:** in scope (phase 4, daily NAV only), or stocks and ETFs only?
3. **Tabs:** Holdings replaces Search as a tab, with Search moving to the top bar? Recommended.
4. **Alert timing:** is a check every 15 minutes, sometimes later, acceptable? Real-time would need an always-on notification and costs battery.
5. **More than one portfolio** (yours and family's), or one?
6. **Which broker's CSV/PDF first?** Send a sample with the numbers blanked out, so its layout gets matched exactly.
