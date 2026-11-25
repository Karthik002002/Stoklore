# Stoklore — Android app

Stoklore's home-page **Sector Performance** panel as its own phone app: summary line, sector map
(size = market cap, colour = the day's move), every sector with its move bar, five-way breadth bar,
cap-weighted member strip and best/worst member; tap a sector for its member tiles, tap a member for
its price, change, mcap, share of sector and volume.
The stock card has **TradingView** and **Dhan** buttons. TradingView opens in its app when it is installed
(`com.tradingview.tradingviewapp`), else in the browser. Dhan has no link that opens one stock in its
app (its site's own "open app" link is `dhan://Login`, and `dhan.co/stocks/...` inside the app is a
404), so the Dhan button copies the NSE symbol and opens the Dhan app - paste it in Dhan's search.
Without the app it opens the stock's dhan.co page. TradingView
needs the NSE symbol, which ET's sector feed lacks: it is looked up in ET's search, matched on ET's
company id. Dhan's page is `dhan.co/stocks/<ET slug>-share-price/`, checked before it is offered;
a company ET still lists under an old name (e.g. Century Textiles, now ABREL) falls back to web.dhan.co. Filter, NSE/BSE, three sort menus (remembered),
refresh button, auto-refresh every 5 minutes. Back closes an opened sector first.

**Branding:** named Stoklore, with the website's logo (`frontend/public/favicon.svg`, copied to
`assets/logo.svg`) on the sidebar's drifting purple → blue tile. The launcher icon is
`res/drawable-xxxhdpi/ic_fg.png`, rendered from `icon/launcher.svg` with
`qlmanage -t -s 432 -o . icon/launcher.svg` (macOS). On open: the system splash, then an intro
(logo pops in, wordmark rises, loading bar) that lifts away once the first data arrives — at least
1.3 s, at most 8 s.

**Data:** straight from ET Markets (`etmarketsapis.indiatimes.com/ET_Stats/sectorperformance`), the
same feed `/api/sectors` uses — no Stoklore backend, so it works anywhere the phone has internet.
The request is made natively in `MainActivity.java` (ET's Origin/Referer headers, no CORS); the page
maps it the way `app/core/scraper.py::_sector_row` does. No member → NSE symbol mapping (that needs
Stoklore's stocks master), so tiles show price instead of symbol and there is no chart.

**Build:** `./build.sh` → `build/stoklore.apk`. SDK command-line tools only (aapt2, javac,
d8, zipalign, apksigner) — no Gradle, no Android Studio. Needs JDK 17 (`brew install openjdk@17`)
and the SDK at `$ANDROID_HOME` (default `~/Library/Android/sdk`). Signed with `~/.android/debug.keystore`
(created on first build). Install: `adb install -r build/stoklore.apk`, or send the APK
and open it on the phone (allow "install unknown apps").
