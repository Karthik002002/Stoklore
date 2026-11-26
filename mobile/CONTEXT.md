# Stoklore Android app — full context

Everything about the `mobile/` app: what was asked, what was built, how it works, what is left.
State as of 2026-11-26, app version **2.0** (versionCode 11).

---

## 1. What was asked, in order

1. Build a simple standalone Android app of Stoklore's **Sector Performance** view.
   - Rules: no previews or dev servers, no Android Studio, a separate folder.
   - Don't touch the frontend or backend.
   - Don't commit or push.
   - `DATABASE_URL` is the live journal, so read only. The app never touches it.
   - Match the Terminal Dark theme.
2. "Just build the app, I will share the application": the APK gets built, not installed.
3. Name it **Stoklore**, use the website's logo, and add an opening animation. No other pages yet.
4. It's a standalone Stoklore app, not a "sector" app, so the folder moved to `mobile/`.
5. The stock card gets **Dhan** and **TradingView** buttons.
6. Dhan showed a 404 inside the app. Fixed: the button copies the symbol and opens the Dhan app.
7. "commit and push": pushed as commit `24c0d34` (version 1.4, the sector-only app).
8. Add screen navigation and every web-app research screen that needs **no login**. Don't commit.
9. Add colour **theme templates** and a **custom theme**, including Monochrome Black and White and other templates. Chart colours must not be hard-wired to green and red.

Items 8 and 9 are done in the working tree and **not committed**.

---

## 2. What the app is

A single-Activity **WebView** app. The UI is HTML/JS in `assets/`, loaded from `file:///android_asset/`.

- There is no backend and no login. Every screen reads public feeds (ET Markets, Moneycontrol) straight from the phone.
- HTTP goes through a Java bridge, not `fetch`. The bridge sends each site's own Origin and Referer headers, which avoids CORS, and it is limited to a short list of allowed hosts.

### Files

| File | Role |
|---|---|
| `AndroidManifest.xml` | `com.stoklore.app`, min SDK 26, target 34, INTERNET only. Its `<queries>` entries let the app see the Dhan app (`com.dhan.live`) and the `dhan://` scheme. |
| `src/com/stoklore/app/MainActivity.java` | The WebView and the `Native` bridge (see below). |
| `assets/index.html` | The shell: top bar, `#view`, bottom tabs, bottom sheet and intro, plus all CSS. Every colour is a CSS variable. |
| `assets/lib.js` | Pure data and maths: formatting, colour, themes, feed mappers, movers, chart bars, axis ticks, research links. No DOM, no network. |
| `assets/app.js` | Routing, all the screens, the canvas chart, the theme editor and tap handling. |
| `assets/logo.svg` | A copy of `frontend/public/favicon.svg`. |
| `res/` | The adaptive launcher icon (`drawable-xxxhdpi/ic_fg.png`, `mipmap-anydpi-v26/ic_launcher.xml`), plus the styles and splash background (`values`, `values-v31`). |
| `icon/launcher.svg` | Source for the launcher icon. |
| `check.mjs` | `node mobile/check.mjs`: asserts on `lib.js`. |
| `build.sh` | Builds `build/stoklore.apk`. |
| `README.md` | The user-facing description. |

### `Native` bridge (MainActivity)

- `get(id, url)`:
  - GETs `url` on a background thread, then calls `window.onNative(id, status, body)`. A failed request comes back as status `0`.
  - HTTPS only, and only to `etmarketsapis.indiatimes.com`, `etsearch.indiatimes.com`, `priceapi.moneycontrol.com` and `dhan.co`.
  - Sends Origin and Referer for `moneycontrol.com` or `economictimes.indiatimes.com`, a mobile Chrome User-Agent, and `Accept: application/json, text/javascript, */*; q=0.01`. ET's indices feed returns **406** without that Accept header.
- `open(pkg, url)`: opens `url` in app `pkg` if it's installed, otherwise in the browser. An empty `pkg` means the browser.
- `openDhan(symbol, webUrl)`: copies the symbol, launches the Dhan app (falling back to `dhan://Login`) and shows the toast "<SYM> copied - paste it in Dhan's search". Without the app it opens `webUrl` in the browser.
- `setBars(color, light)`: sets the status and navigation bar colour and icon contrast, plus the WebView background.
- Back button: runs `window.onBack()`. If the page returns `true`, it handled the press; otherwise the app exits.

---

## 3. Screens

Routes are hash URLs. The **tabs** use `location.replace`; **stack screens** use `location.hash`, which pushes a history entry. Animations: `push` slides in, `pop` slides back, `tab` fades.

| Route | Screen |
|---|---|
| `#/feed` | **Feed** (first tab, home): one full-screen card per swipe, 40 to a page then "You're caught up", themed pages after. See `FEED_PLAN.md` §10–12. |
| `#/holdings` | **Holdings** (second tab): holdings kept on the phone (`portfolio.json`), CSV/paste import with review, live value and P&L, alerts and notifications from the 15-minute `PortfolioJob`. See `HOLDINGS_PLAN.md`. |
| `#/markets` | Four index cards (NIFTY 50, SENSEX, BANK NIFTY, INDIA VIX), each with a quote and a 1D sparkline; tap for the index screen. Market breadth: advances and declines, sectors up, best and worst sector. **Movers**: top 15 gainers or losers, filtered by all, large, mid or small cap. **All indices**: NSE or BSE, with filter and sort. |
| `#/sectors` | The home page's Sector Performance panel. Summary line; sector map (size = market cap, colour = the day's move); per-sector move bar, five-way breadth bar, member strip and best/worst member. Tap a sector for its member tiles; tap a member for a card with price, change, market cap, share of sector and volume, plus **Chart & research**, **TradingView** and **Dhan**. Filter, NSE/BSE switch, three sort menus. |
| `#/search` | ET search over NSE companies, debounced at 250 ms. Shows live % where the sector feed has the stock. Recent stocks are remembered (up to 12). |
| `#/stock/<SYM>` | Quote, then the chart: 1D/5D/1M/6M/1Y/5Y ranges, line or candles, volume, and a drag crosshair showing OHLC and volume. Key stats: prev close, open, day high/low, 52W high/low, volume, 20-day average volume, market cap, 1Y change. The stock's sector and up to 8 peers; tapping the sector opens the Sectors tab with that sector expanded. Research links: Screener, TradingView (its app), ET Markets, Moneycontrol, NSE, Google Finance, Dhan. |
| `#/index/<code>` | The four card indices only: quote, chart, today's stats (open, prev close, high, low, 52W range, advances/declines) and returns (1W, 1M, 3M, YTD, 1Y, 3Y, 5Y). |
| `#/settings` | **Settings**: appearance (themes, section 4), fonts (system or Google Fonts, body and headings, any family by name, text size), chart defaults, feed filter, data, about. |

**Back button order:**
1. Close the open card.
2. Go back from a stock or index screen.
3. Fold open sectors.
4. On Feed past the first card, scroll to the top.
5. Switch to the Feed tab.
6. Exit.

**Refresh:** every 5 minutes while the screen is on, plus when the app returns from more than a minute in the background. Every screen except Theme and Search also has a refresh button.

**Opening animation:** the system splash, then the logo pops in, the wordmark letters rise one by one and a loading bar runs. The intro lifts once the first data arrives: at least 1.3 s, at most 8 s.

**Remembered on the phone** (localStorage):
- theme: `theme.id`, `theme.custom`
- chart: `chart.range` (default 6M), `chart.type` (default line)
- sectors: `sectors.exchange`, `sectors.mapSort`, `sectors.listSort`, `sectors.memberSort`
- markets: `markets.iex`, `markets.isort`
- search: `search.recent`

---

## 4. Themes

There are 12 tokens: `background`, `card`, `panel-head`, `muted`, `foreground`, `muted-foreground`, `border`, `input`, `accent`, `up`, `down`, `warning`.

**Templates** (`THEMES` in `lib.js`):
- The web app's four (from `frontend/src/design-system/tokens/themes.ts`): Terminal Dark (default), Terminal Light, Midnight, Amber Terminal.
- **Monochrome Black**: up `#f5f5f5`, down `#6e6e6e`.
- **Monochrome White**: up `#111111`, down `#a3a3a3`.
- **Ocean (colour-blind safe)**: up `#3b82f6` (blue), down `#f97316` (orange).
- **Dusk** and **Paper**.

**Custom:**
- Edit any token by hex code, `<input type=color>`, or one of 24 quick swatches.
- The first edit on a template copies that template into a custom theme. "Delete custom theme" goes back to its base template.
- Light or dark mode is worked out from the background's luminance.

**Where the colours are used:**
- `heat(pct, theme)` blends the up or down colour over the card colour. The blend deepens up to ±4%, and the text colour is picked for contrast.
- Breadth buckets, move bars, candles, the line and area fill, volume bars, the last-price tag, sparklines and every ▲/▼ number.
- The status and navigation bars.

**Preview:** the Theme screen shows a strip of heat tiles from −4% to +4%.

---

## 5. Data sources

| Use | Feed |
|---|---|
| Sectors, movers, breadth | `https://etmarketsapis.indiatimes.com/ET_Stats/sectorperformance?pagesize=100&pageno=1&marketcap=&exchange=NSE\|BSE` (root `searchresult`) |
| All indices | `https://etmarketsapis.indiatimes.com/ET_Stats/getAllIndices?exchange=nse\|bse&pagesize=200` (root `searchresult`; needs the JSON Accept header) |
| Search and NSE symbols | `https://etsearch.indiatimes.com/etspeeds/ethome.ep?ticker=<q>&matchCompanyName=true&outputtype=json` (array: `tagName`, `symbol`, `tagId`, `tagSeoName`, `marketCap`, `entityType`) |
| Index quote | `https://priceapi.moneycontrol.com/pricefeed/notapplicable/inidicesindia/<in;NSX \| in;SEN \| in;nbx \| in;IDXN>` (root `data`) |
| Chart bars | `https://priceapi.moneycontrol.com/techCharts/indianMarket/<stock\|index>/history?symbol=<SYM or in;NSX>&resolution=<5\|15\|1D\|1W>&from=&to=&countback=N&currencyCode=INR` → `{s, t, o, h, l, c, v}` |

**How ranges map to bars:**

| Range | Bar size | Bars |
|---|---|---|
| 1D | 5-min | 90, last IST session only |
| 5D | 15-min | 140 |
| 1M | daily | 23 |
| 6M | daily | 128 |
| 1Y | daily | 250 |
| 5Y | weekly | 262 |

The stock screen's stats come from the 1Y daily bars. The live price comes from the sector feed when the stock is in it.

**Movers:** NSE's gainers and losers feed is blocked, so movers are computed from ET's NSE sector feed. All member stocks are deduplicated and ranked by market cap: large is the top 100, mid is 101–250, small is the rest.

**ET's feed has no NSE symbol.** The app looks it up in ET search, matched on ET's company id, and caches the result per company.

### Blocked, so left out
- NSE `www.nseindia.com/api` returns 403. BSE `api.bseindia.com` returns 403. Yahoo `query1` returns 429. Moneycontrol autosuggest returns 403.
- I don't try to get around these blocks by imitating a browser.

### Web screens not in the app
- Journal, watchlists, alerts, and anything else behind a login.
- Earnings, events, top news, leaders, microcaps, scans, shareholding: they need Stoklore's own server or NSE/BSE feeds.

### Dhan
- No link opens one stock inside the app. Dhan's own site uses `dhan://Login`, and `dhan.co/stocks/...` shows a 404 inside the app.
- So the button copies the symbol and opens the app. Without the app it opens `https://dhan.co/stocks/<ET slug>-share-price/` in the browser, or `web.dhan.co` when there's no slug.

---

## 6. Build

```sh
cd mobile && ./build.sh        # → build/stoklore.apk
```

- Uses only the SDK command-line tools: aapt2 compile/link → javac `--release 8` → d8 → zip → zipalign → apksigner. No Gradle, no Android Studio.
- Needs:
  - the SDK at `~/Library/Android/sdk` (build-tools 37.0.0, `platforms/android-36/android.jar`);
  - JDK 17 at `/opt/homebrew/opt/openjdk@17`. Set `JAVA_HOME` to it, or apksigner reports "Unable to locate a Java Runtime".
- Signed with `~/.android/debug.keystore`, which the first build creates.
- Install with `adb install -r build/stoklore.apk`, or send the APK and allow "install unknown apps" on the phone.
- The phone (SDM782G-IDP) was never visible to ADB because USB debugging is off. You said you'll share the APK yourself.

---

## 7. Verification done (v1.5)

- `node --check` passes on `app.js` and `lib.js`.
- `node mobile/check.mjs` passes. It covers:
  - heat colours: themed, saturating, contrast text, nothing fixed to green or red;
  - every theme has every token;
  - custom-theme overrides;
  - movers cap buckets and direction;
  - chart bars: bad rows dropped, 1D kept to the last session;
  - axis ticks.
- Live feeds return 200 with the app's headers: ET indices for NSE and BSE, Moneycontrol index quote and 1D history, stock history, ET search.
- The APK builds and `apksigner verify` passes. It is about 79 KB.
- **Not verified:** nothing has run on a device or in a headless DOM (no jsdom in the repo). That covers the navigation, the chart and the theme editor. Test on a phone before sharing.

---

## 8. Repo rules followed

- No commit or push for the current work (requested). The working tree has the changes in `mobile/` and the root README pointer.
- When committing later, the repo's rules apply:
  - commit straight to `main`, with no Co-Authored-By trailer;
  - push only as Karthik002002 via the gh credential helper;
  - check `git ls-remote` against local HEAD and look for the malware commit's return before pushing.
- Docs were updated with the change: `mobile/README.md`, and the root `README.md` (about line 254).
- `graphify update .` was run.

---

## 9. Possible next steps

- Test on a phone: navigation, back button, chart crosshair, the custom colour picker, Dhan and TradingView handoff.
- Commit and push when asked.
- Possible additions:
  - charts for every ET index; this needs an ET → Moneycontrol code map;
  - a watchlist kept only on the phone;
  - home-screen widgets.
