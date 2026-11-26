# Plan: a "doom scroll" market feed for the Stoklore app

Status: **plan for review**. No code is written yet.

---

## 1. My take

It's a good fit for this app, with one change in framing.

**Why it fits:**
- The app already holds everything needed to make cards: about 1,000+ stocks with today's move, market cap, sector and volume, plus 30 sectors, 4 index quotes and chart bars for any NSE symbol.
- A full-screen, one-card-at-a-time feed is the most natural way to browse that on a phone. It also surfaces things the list screens hide, like "this stock is up 6% while its sector is down".

**The change:** build it to **inform, not to hook**.
- A pure engagement feed in a trading app pushes overtrading: endless red and green cards and no stopping point.
- So the feed:
  - ends a session with a **"You're caught up"** summary card;
  - has no autoplay, no notifications and no streaks or badges;
  - has **no buy/sell buttons**. Cards lead to the existing chart and research screens, TradingView and Dhan, as today.
- This doesn't make it less fun to scroll. It makes it something you'd want on your phone.

I'd call it **Feed** in the app rather than "doom scroll".

---

## 2. What the user sees

- A new bottom tab, **Feed**. It goes first, so there are five tabs: Feed · Markets · Sectors · Search · Theme.
- Each card fills the screen between the top bar and the tab bar. You swipe up for the next one, and each swipe lands exactly on a card.
- Each card has:
  - a big headline line, e.g. "TATA MOTORS +6.4%" or "Metals: 14 of 17 up";
  - a one-line story in plain words, e.g. "Up while Auto is down 1.2% — the sector's best today";
  - a chart (1D for indices, 6M for stocks) drawn with the existing chart code and theme colours;
  - 3 or 4 key numbers;
  - actions: **Open** (the stock, index or sector screen), **TradingView**, **Dhan**.
- Taps:
  - tap anywhere on the card: open the stock, index or sector screen;
  - back returns to the same card.
- After **40 cards**, a "caught up" card shows:
  - today's breadth;
  - the best and worst sector;
  - how many cards you saw.
  - It has two buttons: **Keep going** (another 40, lower-ranked) and **Back to top**.
- At the top, a small refresh button and the time of the last update.

---

## 3. Card types (phase 1: only data the app already fetches)

| # | Type | Built from | Story line (example) |
|---|---|---|---|
| 1 | **Index** | Moneycontrol quote + 1D bars (4 indices) | "NIFTY 50 +0.25%, 21 up / 29 down" |
| 2 | **Big mover** | ET sector feed, ranked by `abs(change%) × log(mcap)` so a big company's move outranks a penny stock's | "Largest gainer among large caps today" |
| 3 | **Against the tide** | A stock's % minus its sector's %: the biggest gaps | "Up 4.1% while Pharma is down 0.8%" |
| 4 | **Sector** | One sector: its move, breadth bar, top 3 and bottom 3 | "Banks: 9 of 12 down, led by …" |
| 5 | **Market breadth** | Totals across all sectors | "1,204 up · 987 down — 18 of 30 sectors green" |
| 6 | **Size cut** | Average move of large, mid and small caps (the existing buckets) | "Small caps −1.1% vs large caps +0.3%" |
| 7 | **Volume standout** | `volume_k` against that stock's 20-day average volume, fetched lazily with its chart | "Traded 3.2× its 20-day average" |

**Extra detail filled in as the card's chart loads:**
- The 6M bars give "x% from 52W high", "5-day streak up" and the 20-day average volume.
- This fills in a line on the card that's already showing; the card never waits for it.
- Type 7 only appears when a card's history shows volume of 2× or more. It replaces that card's story line rather than adding a separate card.

### Phase 2 (only if wanted, check first)

**Headlines.** ET Markets publishes public RSS feeds.
- This needs one new allowed host in `MainActivity.HOSTS` and XML parsing with `DOMParser`.
- Before building, confirm the feed returns 200 to the app's headers, the same check done for the other feeds.
- A headline card shows the title, source and time, and opens in the browser. Stoklore never shows the article text.

---

## 4. How the feed is built (`lib.js`, pure and tested)

One function, no network:

```
buildFeed({ sectors, indices, seen, offset }) -> cards[]
```

1. **Candidate pools**, one per card type, each sorted by its own score:
   - movers: `abs(change%) × log10(mcap + 10)`, with large/mid/small taken from `allStocks()`;
   - against-the-tide: `abs(stock% − sector%)`, only where the two have opposite signs;
   - sectors: `abs(change%)`;
   - index, breadth and size cut: one card each per session.
2. **Mix pattern.** Repeating slots: `index, mover, mover, tide, sector, mover, tide, breadth, mover, sector, sizecut, …`
   - Each slot takes the next unused item from its pool. If that pool is empty, it falls through to movers.
3. **No repeats.**
   - A stock appears once per session, whatever its card type. This uses a `seen` set of ids.
   - The set is kept in `localStorage` as `feed.seen.<IST date>`, so reopening the app the same day doesn't show the same cards again.
4. **Pages.**
   - `offset` returns the next 40.
   - The "caught up" card is added after each page.
   - When every pool is empty: one final "That's every stock that moved today" card.
5. **Same output for the same input.** No `Math.random`, so the check can assert exact output and refreshing doesn't shuffle the feed.

Each card is a plain object, e.g.:

```
{ kind, id, title, story, stats: [[label, value]], open: '#/stock/SYM' | '#/index/CODE' | sector id, member?, chart?: {kind, sym, range} }
```

The NSE symbol for stock cards comes from the existing `symFor()` lookup. Until it arrives, the card's chart area shows a loading state.

---

## 5. How it's drawn (`app.js` + CSS)

- **Snap scrolling:**
  - `#feed { height: calc(100vh - top bar - tab bar); overflow-y: auto; scroll-snap-type: y mandatory }`;
  - each card is `scroll-snap-align: start` at 100% height.
  - This is native CSS, with no gesture library.
- **Limited DOM, so 200 cards don't slow the WebView:**
  - Only about 7 real card elements exist: the current one, plus 3 above and 3 below.
  - The others are empty spacers of the same height.
  - An `IntersectionObserver` shows which card is current and swaps content into and out of the spacers.
- **Lazy charts:**
  - A card's chart loads when it is within 2 cards of the screen.
  - Requests go through a small queue, at most 2 at a time, so a fast swipe doesn't fire 20 Moneycontrol requests.
  - Results go through the existing `barsFor()` cache.
  - Drawing uses the existing `drawChart()`, or `spark()` for index cards, with the theme colours.
- **Navigation:** a `#/feed` tab route. `scrollMem` already restores the scroll position when you come back from a stock screen. The feed keeps its card list in memory across tab switches.
- **Refresh:**
  - The refresh button and the existing 5-minute timer refetch sectors and indices.
  - Already-built cards get updated numbers in place: same ids, new prices.
  - The order doesn't change under your thumb. New cards are only built for pages you haven't reached.
- **Back button:** on Feed, back scrolls to the first card if you're not already there; otherwise it goes to the existing behaviour.

---

## 6. Files touched

| File | Change | Size (approx.) |
|---|---|---|
| `assets/lib.js` | `buildFeed`, the scorers and the mix pattern; export them for the check | +120 lines |
| `check.mjs` | Feed assertions (see below) | +40 lines |
| `assets/app.js` | `feedScreen`, a card renderer per kind, the limited-DOM window, the chart queue, Feed in `TABS`, `onBack` handling | +220 lines |
| `assets/index.html` | Snap container, card layout, the "caught up" card; all colours from theme variables | +60 lines |
| `MainActivity.java` | **None** in phase 1 (phase 2: add the RSS host) | 0 |
| `AndroidManifest.xml` | Version 1.6 / code 7 | 2 lines |
| `README.md`, `CONTEXT.md`, root `README.md` | Describe the Feed | docs |

---

## 7. Verification

`node mobile/check.mjs` gains these assertions:
- No stock id appears twice across pages 1–3.
- Every "against the tide" card's stock and sector moves really have opposite signs.
- The slot pattern holds, and an empty pool falls through to movers.
- The same input gives identical output.
- A "caught up" card follows every 40th card, and the last page ends with the final card.
- The large/mid/small averages in the size-cut card match a direct calculation.

Also:
- Build and `apksigner verify`, as now.
- **On a phone** (still not done for v1.5 either):
  - swipe speed;
  - that only about 7 card elements exist after 100 swipes;
  - that back from a stock screen lands on the same card;
  - that theme changes repaint the cards.

---

## 8. Not doing, and why

- **Buy/sell, price alerts, push notifications:** no login, and they belong to the web app's journal and alerts.
- **Personalisation by tracking what you dwell on:** that's the engagement-optimising part we're avoiding. The ranking is the same for everyone and explainable.
- **Autoplaying animation or sound:** not needed, and it drains the battery.
- **NSE/BSE-only data (announcements, bulk deals, shareholding):** those feeds refuse requests from outside a browser, as before.

---

## 9. Decisions for you

1. **Placement:** Feed as the **first tab** (recommended), or a button on Markets?
2. **Session cap:** a "caught up" card every **40** cards (recommended), a different number, or no cap?
3. **Phase 2 headlines** (ET RSS): yes or no? It's one more allowed host, and it has to be checked first.
4. **Save gesture:** add double-tap to save a stock to a **phone-only watchlist**? That would also mean a small Watchlist section on Markets. Recommended for later, not phase 1.

Phase 1 is about 450 lines across the 4 asset files, with no Java change. It follows the same build and check flow as v1.5.

---

## 10. Picking the 40 cards (detail)

### Where the data comes from

**Picking cards costs no extra network calls.** The 40 cards are chosen from two feeds the app already loads:

| Source | Gives | Calls |
|---|---|---|
| ET Markets `sectorperformance` (NSE) | Every listed stock: price, today's %, market cap, volume, sector. Every sector: move, advances and declines | 1 |
| Moneycontrol index quotes | NIFTY 50, SENSEX, BANK NIFTY, INDIA VIX | 4 |

Moneycontrol chart history is fetched only **after** a card is picked, as it nears the screen. It adds chart, 52-week and average-volume detail, and is never used to pick cards.

### Step 1: clean the pool
- Drop stocks with market cap under ₹500 Cr. Penny and illiquid stocks make noisy "top movers".
- Drop stocks with no price, a 0% move or zero volume.
- Count each stock once, even if ET lists it under two sectors.

### Step 2: score each candidate

| Pool | Score | Meaning |
|---|---|---|
| Movers | `abs(change%) × log10(mcap_cr + 10)` | A 4% move in a ₹5L Cr company beats a 9% move in a ₹600 Cr one |
| Against the tide | `abs(stock% − sector%) × log10(mcap_cr + 10)`, only where the stock and its sector have opposite signs | The most surprising stocks |
| Sectors | `abs(sector%) + abs(adv − dec) / (adv + dec)` | Big moves, or one-sided breadth |
| Size cut | none: one card | Average % of large, mid and small caps |

### Step 3: fill a fixed 40-slot template

```
 1  NIFTY 50 index           21-30  movers + tide, alternating
 2  market breadth           31  size cut (large vs mid vs small)
 3-12  movers (gain, loss, gain, loss …)   32-36  sectors
 13  sector                  37-39  SENSEX, BANK NIFTY, INDIA VIX
 14-20  tide + movers mixed  40  biggest surprise not yet shown
 → card 41: "You're caught up"
```

The rules while filling slots:
- **Alternate gainers and losers**, so the feed is never all red or all green. On a one-sided day, the side that runs out is filled from the other.
- **At most 3 stocks per sector** on a page, so one hot sector can't take over.
- **At least 5 mid or small caps** among the movers; the others would always be large caps.
- **A stock already seen today is skipped** (`feed.seen.<IST date>`).
- An empty slot falls through to the next-best mover.

### Step 4: keep it stable
- No randomness: the same data gives the same 40, so the check can assert exact output.
- A refresh updates the numbers on cards already shown and doesn't reorder them.

---

## 11. Opening a stock in other apps from the feed

Every stock card has the same buttons as the stock card on Sectors:

| Button | What happens | Status |
|---|---|---|
| **Open** (or tap the card) | The in-app stock screen: chart, stats, peers, research links | Built |
| **TradingView** | Opens the TradingView app at `NSE:<SYMBOL>`; the browser if it isn't installed | Built (`Native.open`) |
| **Dhan** | Copies the symbol and opens the Dhan app, ready to paste in its search (Dhan has no per-stock link) | Built (`Native.openDhan`) |

Optional extra apps, which each need a check on a phone first:
- **Groww:** `https://groww.in/stocks/<slug>` may open in the Groww app if the app claims those links. The slug is the company name, so it needs matching like Dhan's.
- **Zerodha Kite:** its chart links need Zerodha's internal instrument id, which the app doesn't have. It can only get "copy symbol and open Kite", the same as Dhan.

Which apps go on the card is your call. TradingView and Dhan come at no cost.
