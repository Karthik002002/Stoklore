# Stoklore — Android app

Stoklore's public market screens on the phone. Everything reads public feeds (ET Markets, Moneycontrol)
straight from the phone — no login, no Stoklore backend, works anywhere there is internet.

**Screens** (bottom tabs; stock and index screens slide in on top, Android back goes back):

- **Feed** (the first tab) — today's market one full-screen card at a time, swipe up for the next:
  index cards, market breadth, top gainers/losers (alternating, ranked by move × market cap, at most 3
  per sector, at least 5 mid/small caps), stocks moving against their sector, sector cards, small vs
  large caps, and after every 5th card a **headline** from ET Markets' public RSS (Markets, Stocks,
  Earnings: title, summary, time, image; tap to read it in the browser). Stock cards show a 6M chart, distance from the 6M high, the up/down streak and volume vs
  usual, with **Chart & research**, **TradingView** and **Dhan**. After 40 cards a "You're caught up"
  summary; **Show more** goes on with themed pages (sector deep dive, mid and small caps, big and
  quiet, everything else) until every stock that moved has been shown. Cards that reached the screen
  are skipped for the rest of the day. **Filter** (funnel on the Feed's top bar): show only some of
  indices & breadth, gainers, losers, against the tide, sector cards, big and quiet, headlines; only
  large / mid / small caps; only moves of 2%+ / 5%+ / 10%+; only one or several sectors. A filtered
  feed rotates through the picked kinds and shows everything that matches (not skipping today's
  seen cards); it is remembered until cleared. **Filter templates**: 7 ready-made (Gainers only,
  Losers only, Big moves 5%+, Headlines, Against the tide, Large caps, Small-cap movers) plus your own —
  "Save these choices as a template" in the filter, one tap to apply from the filter or Settings → Feed. Picked in `lib.js` (`feedPools`, `feedPage`) from the ET
  sector feed alone — no randomness, no tracking; design in [FEED_PLAN.md](FEED_PLAN.md).
- **Holdings** (second tab) — your holdings, kept on the phone only (no broker, no login). Add them by
  hand (search, quantity, average buy price, optional buy date), **upload a CSV** from any broker
  (columns found by name: Zerodha's `Instrument / Qty. / Avg. cost`, Groww's `Stock Name / Quantity /
  Average buy price`, …), or **paste rows** (`TCS 10 3450`). Every row is matched to an NSE symbol
  through ET search and shown for review (✓ matched, ? best guess, ✕ pick) before anything is saved;
  ETFs ET doesn't list are accepted when Moneycontrol has prices for the symbol; ISIN-only rows ask you
  to pick once. Live value, today's change, P&L, invested, today's movers in ₹, allocation by sector,
  holding period with a long-term marker; add to or replace what's there.
  **Notifications** (open 09:20, every hour or every 2 hours at :15, close 15:35, trading days only;
  "Send one now" to try it) and **alerts**: portfolio falls to / rises to ₹X, **protect profit** (give
  back no more than ₹X from the high since the alert was set), down more than ₹X today, a stock falls
  to / rises to ₹X, any holding down X% today. Each fires once per crossing and re-arms 0.5% back past
  its line ("every time") or only once; the notification lists what moved since the last check.
  Runs in a 15-minute Android job (`PortfolioJob`) even with the app closed; Android can delay it when
  the phone is idle ("Run on time" opens battery settings). Quantities and prices never leave the
  phone. Plan and choices: [HOLDINGS_PLAN.md](HOLDINGS_PLAN.md).
  v2.3: **CAS PDF import** — the password-protected consolidated account statement (CDSL, NSDL, CAMS,
  KFintech) opened on the phone with pdf.js (`assets/vendor`, Apache-2.0); the password (usually your
  PAN) is used once and dropped, the file is never stored or sent; holdings are read wherever units ×
  price = value, then matched in the same review. **Mutual funds** (by ISIN through AMFI's daily file,
  or search) priced at NAV from mfapi.in; **ETFs** found by exchange symbol everywhere (add, review,
  Search). **Watchlist** (☆ on a stock's page) with price alerts. **Filings & events** — results, board
  meetings, dividends, splits… for stocks you hold or watch, listed on Holdings and notified by the job
  every 2 hours (07:00–23:00). **App lock** (Settings → Privacy: fingerprint / face / screen lock) and a
  **home-screen widget** (value, today, P&L).
  v2.4–2.9: **multiple portfolios** (yours, family's, a strategy's: a switcher on Holdings with an
  **All** view, add / rename / delete under "+ / manage", imports and additions go into the chosen one,
  the same stock in two portfolios stays two holdings, a portfolio alert can watch one portfolio);
  files are read natively and can be **opened with / shared to Stoklore** (CSV, CAS PDF, backup);
  **JSON** in the paste box; broker exports like Dhan's (`Avg. Buy Rate`, totals lines after the
  table, `Name (SYMBOL)`, ETFs matched to their fund by name) — fixtures in `test/fixtures`; a
  "No holdings found" panel shows what the file contained; a crash is recorded and shown on the next
  launch, which runs in safe mode (no background job).
  v3.0: **Excel (.xlsx)** read on the phone (every sheet; unzipped with the platform's
  DecompressionStream, no library) and **every Indian broker's holdings export**: Zerodha Kite / Console,
  Groww (stocks; funds' average = invested ÷ units), Dhan, Upstox, Angel One, ICICI Direct, HDFC Securities,
  Kotak, Motilal Oswal, 5paisa, Fyers (`NSE:TCS-EQ`), Paytm Money, IIFL, Sharekhan, CDSL / NSDL demat CSVs;
  headings with ₹ / Rs. units; an ".xls" that is really an HTML table; a broker PDF without a password
  opens straight away (a CAS asks). A password-protected Excel file (or an old binary .xls) gets a clear
  "save it without the password as .xlsx or CSV" message. ETFs given by exchange symbol keep the live
  exchange price. **Sector map charts**: Tiles, Heatmap, Bars (diverging), Bubbles (move vs breadth, sized
  by market cap) and Breadth (advancing / unchanged / declining), switchable and remembered; tapping any
  of them opens the sector.
  Settings → About carries the author's signature card: Karthik · Stoklore, with links to the GitHub repo
  (github.com/Karthik002002/Stoklore); no other personal details.
  v3.1–3.2: the **Heatmap** is now TradingView-style — the 450 largest stocks as a squarified treemap (area
  = market cap, colour = the day's move) inside their sectors' blocks, with the sort and a size switch
  (market cap / equal); the old equal grid is **Grid**. Tapping a sector on any chart opens it **full
  screen**: every member as a zoomable heatmap (pinch, double-tap or − / + / fit; drag to move; names and
  prices appear as blocks grow), a stock opens its card. The app **reopens the last screen** (a stock or
  index screen on top of its tab). Fixed: the background job needed `ACCESS_NETWORK_STATE` to be scheduled
  (notifications and alerts never ran before 3.1); ET's broken REIT / InvIT sector moves are corrected on
  every screen.
- **Markets** — NIFTY 50, SENSEX, BANK NIFTY and INDIA VIX cards (quote + today's sparkline; tap for the
  index screen); market breadth (advances/declines, sectors up, best/worst sector); **movers** — top 15
  gainers/losers, all or by size (large = top 100 by market cap, mid = 101–250, small = the rest, the
  SEBI cut over every stock in ET's NSE sector feed); **all indices** for NSE or BSE with filter and sort.
- **Sectors** — the home page's Sector Performance panel: summary line, sector map (size = mcap, colour
  = the day's move), each sector's move bar, five-way breadth bar, member strip and best/worst; tap a
  sector for member tiles, tap a member for its card (price, change, mcap, share of sector, volume) with
  **Chart & research**, **TradingView** and **Dhan**. Filter, NSE/BSE, three sort menus (remembered).
- **Search** (magnifier on the top bars) — NSE companies by name or symbol (ET search), with live %
  where the sector feed has it; recent stocks are remembered.
- **Stock** (`#/stock/<NSE symbol>`) — quote, chart (1D 5D 1M 6M 1Y 5Y, line or candles, volume, drag
  for the crosshair's OHLC), key stats (prev close, day range, 52W range, volume, 20-day average,
  market cap, 1Y change), its sector and peers, and research links: Screener, TradingView, ET Markets,
  Moneycontrol, NSE, Google Finance, Dhan. Below the chart, tabs with the web app's fundamentals, read
  from screener.in's public company page (the same source as the web's Screener block):
  **Overview** — latest quarterly results (Sales, Operating profit, Net profit, EPS, OPM with YoY and
  QoQ; flags a switch between standalone and consolidated figures), Screener's key ratios (market cap,
  P/E, book value, dividend yield, ROCE, ROE, …), compounded growth (10Y/5Y/3Y/TTM sales, profit, stock
  price, ROE) and pros & cons; **Financials** — quarterly, annual P&L, balance sheet, cash flow and
  ratios as tables (label column pinned, scroll sideways, newest first in view) with Sales / Net profit
  (or borrowings / reserves, operating / free cash) bars; **Shareholding** — the latest split
  (promoters, FIIs, DIIs, government, public), change over a quarter and a year, every quarter;
  **Filings** — recent announcements (and all on BSE), earnings-call transcripts / presentations /
  recordings, annual reports, credit ratings, each opening in the browser; **About** — the company's
  description and key points. One fetch per stock, cached 6 hours (⟳ re-reads it).
- **Index** (`#/index/<code>`) — the four card indices: quote, the same chart, day stats, returns 1W–5Y.
- **Settings** (last tab; jump chips for each section):
  - **Appearance** — templates: the web app's Terminal Dark / Terminal Light / Midnight / Amber
    Terminal, plus Monochrome Black, Monochrome White, Ocean (blue up / orange down, colour-blind safe),
    Dusk and Paper. **Custom**: edit any of the 12 colours (hex, the colour picker, or a quick swatch);
    the first edit starts a custom theme from the template in use. Up/down colours drive every chart,
    heat tile, breadth bar and price change; the status and navigation bars follow the theme.
  - **Fonts** — separate fonts for body text & numbers and for headings & big numbers: system mono /
    sans / serif, or 18 Google Fonts (JetBrains Mono, IBM Plex Mono, Roboto Mono, Fira Code, Space Mono,
    Source Code Pro, Inter, Roboto, Manrope, IBM Plex Sans, Space Grotesk, DM Sans, Poppins, Outfit,
    Nunito, Merriweather, Lora, IBM Plex Serif), each chip shown in its own face. **Any Google Font**:
    type a family name; the app checks it exists on Google Fonts before using it and keeps it in the
    list. Loaded from `fonts.googleapis.com` on demand and cached; offline falls back to a system font
    of the same kind. Charts use the body font. **Text size** 90–120% (WebView text zoom).
  - **Chart** — default type and range. **Feed** — the filter, clear it, show today's seen cards again,
    filter templates (use / remove). **Data & backup** — export / restore a backup, **auto-refresh** (also on
    every top bar: ⟳ reloads now, the label next to it — e.g. `5m` — opens the picker; struck through
    while a short beat waits for the market to open)
    (Off, 15s, 30s, 1m, 5m — the default — or 15m; 15s–1m run only while NSE is open, and nothing
    reloads behind an open card or in the background; charts and headlines stay on screen while they
    reload), clear recent searches, reload all data. **About** — version and data sources.

**Not on the phone:** the journal, watchlists and anything else behind Stoklore's login; earnings, events,
news, leaders, microcaps, scans and shareholding (they need Stoklore's own server or NSE/BSE's feeds,
which refuse apps outside a browser).

**Dhan / TradingView:** TradingView opens in its app (`com.tradingview.tradingviewapp`) when installed,
else in the browser. Dhan has no link that opens one stock in its app (its site's own "open app" link
is `dhan://Login`; `dhan.co/stocks/...` inside the app is a 404), so the Dhan button copies the NSE
symbol and opens the Dhan app — paste it in Dhan's search. Without the app it opens the stock's dhan.co
page. ET's sector feed has no NSE symbol; it is looked up in ET's search, matched on ET's company id.

**Data:** ET Markets `ET_Stats/sectorperformance` (sectors, movers, breadth — the feed `/api/sectors`
uses), `ET_Stats/getAllIndices`, `etsearch` (search, symbols); Moneycontrol `priceapi` (index quotes,
chart bars for stocks and indices); ET Markets RSS on `economictimes.indiatimes.com` (Feed headlines); screener.in company pages
(stock fundamentals, parsed with DOMParser — only text and https links are taken). Requests are made natively in `MainActivity.java` (each site's
Origin/Referer, no CORS) and only to those hosts. Auto-refresh every 5 minutes on screen, and on coming
back to the app.

**Code:** `assets/index.html` (shell + CSS, colours are CSS variables), `assets/lib.js` (pure data,
maths, themes, feed picking, holdings parsing/valuation), `assets/app.js` (routing, screens, canvas
chart, settings, holdings), `src/.../MainActivity.java` (WebView + bridge: `get`, `open`, `openDhan`,
`setBars`, `setTextZoom`, `version`, `readFile` / `savePortfolio`, `checkNow`, `notifyState` /
`requestNotify`, `openBattery`, `exportFile`, the file picker, back), `Http.java` (the one network
path, host allowlist), `PortfolioJob.java` (the 15-minute job: prices, alerts, notifications;
`portfolio.json` is the page's, `portfolio_state.json` the job's) and `Portfolio.java` (its maths and
alert rules, no Android).

**Checks:** `node mobile/check.mjs` (lib.js), `mobile/test/check-java.sh` (Portfolio.java on a desktop
JDK), and `mobile/test/smoke.cjs` (the real app headless against live feeds; needs jsdom, see its header).

**Branding:** named Stoklore, with the website's logo (`frontend/public/favicon.svg`, copied to
`assets/logo.svg`) on the sidebar's drifting purple → blue tile. The launcher icon is
`res/drawable-xxxhdpi/ic_fg.png` (gradient to the edges, no inset tile; the mark sits inside Android's
66dp safe circle so round masks don't clip it), rendered from `icon/launcher.svg` with
`qlmanage -t -s 432 -o . icon/launcher.svg` (macOS). On open: the system splash, then an intro
(logo pops in, wordmark rises, loading bar) that lifts away once the first data arrives — at least
1.3 s, at most 8 s.

**Build:** `./build.sh` → `build/stoklore.apk`. SDK command-line tools only (aapt2 — which also
writes `R.java` — javac, d8, zipalign, apksigner; a compile error stops the build) — no Gradle, no Android Studio. Needs JDK 17 (`brew install openjdk@17`)
and the SDK at `$ANDROID_HOME` (default `~/Library/Android/sdk`). Signed with `~/.android/debug.keystore`
(created on first build). With a phone connected over USB, every build also copies the APK to the phone's
**Stoklore** folder (`/sdcard/Stoklore/stoklore-v<name>-<code>.apk`) and keeps the newest 5 there.
**Release:** `./release.sh` publishes the current version as a GitHub release (`mobile-v<versionName>`, the APK
attached, notes from [CHANGELOG.md](CHANGELOG.md)); only when you run it - most builds aren't released.
Install: `adb install -r build/stoklore.apk`, or send the APK
and open it on the phone (allow "install unknown apps").
