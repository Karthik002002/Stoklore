// Stoklore on the phone: screens, routing, chart, theme. Data + maths are in lib.js.
// Every screen reads public feeds only (ET Markets, Moneycontrol) through MainActivity.get - no login,
// no Stoklore backend. Routes are hash URLs: #/markets #/sectors #/search #/settings are the tabs,
// #/stock/<NSE symbol> and #/index/<Moneycontrol code> are pushed on top of them.

const $ = (id) => document.getElementById(id)
const view = $('view')
const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v } catch { return d } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch {} },
  del: (k) => { try { localStorage.removeItem(k) } catch {} },
  json: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } },
}
const clock = () => new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
const compact = (v) => v >= 1e7 ? `${(v / 1e7).toFixed(2)}Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(2)}L` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : String(Math.round(v || 0))
const errState = (e) => `<div class="state">${esc(e?.message || e)}</div>`
const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`
const I = {
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  refresh: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  markets: svg('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>'),
  sectors: svg('<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  star: svg('<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>'),
  starOn: svg('<path fill="currentColor" d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  fit: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  wallet: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>'),
  filter: svg('<path d="M3 5h18l-7 8v6l-4 2v-8z"/>'),
  feed: svg('<rect x="5" y="3" width="14" height="13" rx="2"/><path d="M8 20h8"/><path d="M10 23h4"/>'),
}
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600)
}

// ---- network: MainActivity.get (sends each site's Origin/Referer; a page fetch would hit CORS) ----
const pending = new Map(); let nextReq = 0
window.onNative = (id, status, body) => { pending.get(id)?.({ status, body }); pending.delete(id) }
const nget = (url) => new Promise((resolve) => {
  if (!window.Native) return resolve({ status: 0, body: 'No native bridge - open this inside the app.' })
  const id = String(++nextReq); pending.set(id, resolve); Native.get(id, url)
})
async function getJson(url) {
  const r = await nget(url)
  if (r.status !== 200) throw new Error(r.status ? `HTTP ${r.status}` : `offline? ${r.body}`)
  return JSON.parse(r.body)
}
const cache = new Map()
function cached(key, ttl, fn, force) {
  const c = cache.get(key)
  if (!force && c && Date.now() - c.at < ttl) return c.p
  const p = fn(); cache.set(key, { at: Date.now(), p })
  p.catch(() => { if (cache.get(key)?.p === p) cache.delete(key) })
  return p
}
const ET_SECTORS = 'https://etmarketsapis.indiatimes.com/ET_Stats/sectorperformance?pagesize=100&pageno=1&marketcap=&exchange='
const memberIndex = new Map() // ET company id -> latest sector-feed row
const sectorsFor = (ex, force) => cached(`sectors:${ex}`, 240e3, async () => {
  // saneSector: ET's sector % breaks for REITs / InvITs (-100%); every screen gets the members' weighted move instead
  const rows = ((await getJson(ET_SECTORS + ex)).searchresult || []).map(sectorRow).map(saneSector)
  for (const s of rows) for (const m of s.members) memberIndex.set(String(m.id), m)
  return { rows, at: Date.now() }
}, force)
const indicesFor = (ex, force) => cached(`indices:${ex}`, 120e3, async () =>
  ((await getJson(`https://etmarketsapis.indiatimes.com/ET_Stats/getAllIndices?exchange=${ex.toLowerCase()}&pagesize=200`)).searchresult || []).map(indexRow), force)
const indexQuote = (code, force) => cached(`iq:${code}`, 30e3, async () =>
  mcQuote((await getJson(`https://priceapi.moneycontrol.com/pricefeed/notapplicable/inidicesindia/${encodeURIComponent(code)}`)).data), force)
const barsFor = (kind, sym, range, force) => cached(`bars:${kind}:${sym}:${range}`, range === '1D' || range === '5D' ? 60e3 : 600e3,
  async () => mcBars(await getJson(mcHistoryUrl(kind, sym, range)), range), force)
// headlines: the three ET RSS feeds merged; one failing feed just drops out, all failing -> no headlines
const newsFor = (force) => cached('news', 300e3, async () => mergeNews((await Promise.allSettled(ET_RSS.map(async ([src, url]) => {
  const r = await nget(url); if (r.status !== 200) throw new Error(`HTTP ${r.status}`); return rssItems(r.body, src)
}))).filter((x) => x.status === 'fulfilled').map((x) => x.value)), force)
const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60e3)); return !t ? '' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago` }
// funds: AMFI's daily file maps ISIN -> scheme (imports only); mfapi gives a scheme's last two NAVs and search
const amfiMap = () => cached('amfi', 12 * 3600e3, async () => {
  const r = await nget('https://portal.amfiindia.com/spages/NAVAll.txt')
  if (r.status !== 200) throw new Error(r.status ? `AMFI answered HTTP ${r.status}` : 'offline?')
  return parseAmfiNav(r.body)
})
const mfNavFor = (code, force) => cached(`mfnav:${code}`, 3 * 3600e3, async () => {
  const d = (await getJson(`https://api.mfapi.in/mf/${encodeURIComponent(code)}`)).data || []
  if (!d.length) throw new Error('no NAV')
  return { price: parseNum(d[0].nav), prev: d[1] ? parseNum(d[1].nav) : null, date: d[0].date }
}, force)
const mfSearch = (q) => cached(`mfs:${q.toLowerCase()}`, 600e3, () => getJson(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(q)}`).then((j) => Array.isArray(j) ? j : []))
/** An exchange symbol ET's company search doesn't know (ETFs, some SME stocks), if Moneycontrol prices it. */
const symbolHit = async (q) => {
  const sym = String(q || '').trim().toUpperCase().replace(/\s+/g, '')
  return SYM_RE.test(sym) && (await barsFor('stock', sym, '1M').catch(() => [])).length ? sym : null
}
const etSearch = (q) => cached(`s:${q.toLowerCase()}`, 600e3, () =>
  getJson(`https://etsearch.indiatimes.com/etspeeds/ethome.ep?ticker=${encodeURIComponent(q)}&matchCompanyName=true&outputtype=json`).then((j) => Array.isArray(j) ? j : []))

// ET's sector feed has no NSE symbol; ET's search has it, matched on ET's company id
const symCache = new Map()
function symFor(m) {
  if (!symCache.has(m.id)) {
    const p = (async () => {
      for (const q of [m.name, (m.slug || '').replace(/-/g, ' ')]) {
        if (!q) continue
        const hit = (await etSearch(q).catch(() => [])).find((x) => String(x.tagId) === String(m.id) && x.symbol)
        if (hit) return hit.symbol
      }
      return null
    })()
    p.then((s) => { if (!s) symCache.delete(m.id) }) // a miss (or offline) is retried next time
    symCache.set(m.id, p)
  }
  return symCache.get(m.id)
}
const dhanUrl = (slug) => slug ? `https://dhan.co/stocks/${slug}-share-price/` : 'https://web.dhan.co/'

// ---- theme: CSS variables + the system bars; heat / chart colours read T ---------------------------
let T = THEMES[0].colors
const themeId = () => store.get('theme.id', 'terminal-dark')
const customTheme = () => store.json('theme.custom', null)
function applyTheme() {
  const th = resolveTheme(themeId(), customTheme())
  T = th.colors
  for (const [k] of THEME_TOKENS) document.documentElement.style.setProperty(`--${k}`, T[k])
  try { window.Native?.setBars(T['panel-head'], th.mode === 'light') } catch {}
  return th
}
const norm = (v) => { v = String(v || '').trim().toLowerCase(); if (!v.startsWith('#')) v = `#${v}`; return /^#[0-9a-f]{3}$/.test(v) ? `#${[...v.slice(1)].map((c) => c + c).join('')}` : v }
/** Editing a colour on a preset starts a custom theme from that preset's colours. */
function setColor(k, v) {
  v = norm(v); if (!isHex(v)) return false
  const id = themeId(); let c = customTheme()
  if (id !== 'custom' || !c) { const cur = resolveTheme(id, c); c = { base: id === 'custom' ? 'terminal-dark' : id, colors: { ...cur.colors } } }
  c.colors[k] = v
  store.set('theme.custom', JSON.stringify(c)); store.set('theme.id', 'custom'); applyTheme()
  return true
}

// ---- fonts: Google Fonts loaded on demand (a <link> per family), system stacks as the fallback -------------
const fontPick = (slot) => store.get(`font.${slot}`, slot === 'body' ? 'system-mono' : 'system-sans')
const customFonts = () => store.json('font.custom', []).filter(fontNameOk)
const loadedFonts = new Map() // family -> Promise<boolean: the font is usable>
function loadFont(name) {
  if (!name || name.startsWith('system-')) return Promise.resolve(true)
  if (!fontNameOk(name)) return Promise.resolve(false)
  if (!loadedFonts.has(name)) {
    const p = new Promise((resolve) => {
      const add = (bold) => {
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = googleFontUrl(name, bold)
        l.onload = () => document.fonts.load(`16px "${name}"`).then((f) => resolve(f.length > 0), () => resolve(false))
        l.onerror = () => { l.remove(); if (bold) add(false); else resolve(false) } // 400 = no such family (or offline)
        document.head.appendChild(l)
      }
      add(true); setTimeout(() => resolve(false), 10000)
    })
    p.then((ok) => { if (!ok) loadedFonts.delete(name) }) // retried next time
    loadedFonts.set(name, p)
  }
  return loadedFonts.get(name)
}
let canvasFont = FONT_STACKS.mono
function applyFonts() {
  const body = fontPick('body'), head = fontPick('head'), r = document.documentElement.style
  r.setProperty('--font-body', fontStack(body)); r.setProperty('--font-head', fontStack(head))
  canvasFont = fontStack(body)
  try { window.Native?.setTextZoom(+store.get('font.zoom', '100')) } catch {}
  Promise.all([loadFont(body), loadFont(head)]).then(() => { // canvases don't re-render on their own
    chart?.draw()
    if (current.name === 'feed') repaintFeed()
    if (current.name === 'markets') paintSparks()
  })
}

// ---- shell: top bar, tabs, routing -----------------------------------------------------------------
const TABS = [['feed', 'Feed', I.feed], ['holdings', 'Holdings', I.wallet], ['markets', 'Markets', I.markets], ['sectors', 'Sectors', I.sectors], ['settings', 'Settings', I.gear]]
const searchBtn = `<button class="icon" data-push="search" aria-label="Search">${I.search}</button>`
const TAB_IDS = TABS.map((t) => t[0])
$('tabs').innerHTML = TABS.map(([id, label, ic]) => `<button data-tab="${id}">${ic}<span>${label}</span></button>`).join('')
// the top bar's refresh control: ⟳ reloads now, the label beside it is the auto-refresh beat (tap to change)
const beatState = () => { const sec = refreshEvery(); return { sec, label: REFRESH.find(([x]) => x === sec)[1], paused: sec > 0 && sec < 300 && !marketOpen() } }
const refreshBtn = () => { const b = beatState(); return `<div class="rgroup"><button class="icon" id="refresh" data-act="refresh" aria-label="Refresh now">${I.refresh}</button><button class="rbeat${b.sec ? '' : ' off'}${b.paused ? ' paused' : ''}" id="rbeat" data-act="beat-menu" aria-label="Auto-refresh: ${b.label}">${b.label}</button></div>` }
function updateBeat() {
  const el = $('rbeat'); if (!el) return
  const b = beatState()
  el.textContent = b.label; el.classList.toggle('off', !b.sec); el.classList.toggle('paused', b.paused)
}
function beatMenu() {
  const b = beatState()
  $('sheet').innerHTML = `<h3>Auto-refresh</h3><div class="mute" style="font-size:11px">How often the screen reloads on its own${b.paused ? ' · paused now - NSE is closed' : ''}.</div>
    <div class="fchips" style="margin-top:8px">${REFRESH.map(([x, l]) => `<button data-beat="${x}" class="${x === b.sec ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="note" style="padding:6px 0">15s, 30s and 1m run only while NSE is open (Mon-Fri 09:15-15:30 IST); 5m and 15m run all day. Nothing reloads while a card is open or the app is in the background.</div>
    <div class="btnrow fxbtns"><button class="btn primary" data-beat="now">Refresh now</button></div>`
  $('sheet').classList.add('on')
}
function beatTap(el) {
  const v = el.dataset.beat
  closeSheet()
  if (v === 'now') return current.refresh?.(true)
  store.set('refresh.every', v); startAutoRefresh(); updateBeat()
  toast(+v ? `Auto-refresh every ${REFRESH.find(([x]) => x === +v)[1]}${+v < 300 && !marketOpen() ? ' (starts when NSE opens)' : ''}` : 'Auto-refresh off')
  if (current.name === 'settings') renderSettings()
}
const spin = (on) => $('refresh')?.classList.toggle('spin', on)
function setTop({ title, small = '', back = false, right = '', sub = '' }) {
  $('top').innerHTML = `<div class="bar">${back ? `<button class="back" data-back aria-label="Back">${I.back}</button>` : '<div class="logo"><img src="logo.svg" alt=""></div>'}
    <h1>${esc(title)}<small id="top-small">${small}</small></h1>${right}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`
}
const setSmall = (html) => { const s = $('top-small'); if (s) s.innerHTML = html }

let nav = 0, navDir = null, current = { name: '' }, lastTab = 'feed', chart = null
const scrollMem = {}
function goTab(t) {
  if (location.hash === `#/${t}`) { window.scrollTo({ top: 0, behavior: 'smooth' }); return }
  navDir = 'tab'; location.replace(`#/${t}`)
}
function push(path) { navDir = 'push'; location.hash = `#/${path}` }
function route() {
  const [name, ...rest] = (location.hash.replace(/^#\/?/, '') || 'feed').split('/')
  const arg = decodeURIComponent(rest.join('/'))
  const dir = navDir || 'pop'; navDir = null
  nav++; chart = null; closeSheet(); closeZoom()
  current = { name: TAB_IDS.includes(name) || ['stock', 'index', 'search'].includes(name) ? name : 'feed', refresh: null, at: Date.now() }
  document.body.classList.toggle('feed-on', current.name === 'feed')
  if (TAB_IDS.includes(current.name)) lastTab = current.name
  store.set('nav.last', location.hash || '#/feed'); store.set('nav.tab', lastTab)
  for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === lastTab)
  view.className = ''; void view.offsetWidth; view.className = dir
  if (current.name === 'stock' && arg) stockScreen(arg.toUpperCase())
  else if (current.name === 'index' && arg) indexScreen(arg)
  else if (current.name === 'sectors') sectorsScreen()
  else if (current.name === 'search') searchScreen()
  else if (current.name === 'holdings') holdingsScreen()
  else if (current.name === 'settings') settingsScreen()
  else if (current.name === 'markets') marketsScreen()
  else feedScreen()
  window.scrollTo(0, dir === 'pop' ? scrollMem[location.hash || '#/feed'] || 0 : 0)
}
window.addEventListener('hashchange', (e) => {
  scrollMem[new URL(e.oldURL).hash || '#/feed'] = window.scrollY
  if (current.name === 'feed' && $('feed')) fd.scrollTop = $('feed').scrollTop
  route()
})
window.onBack = () => {
  if (sheetOn()) { closeSheet(); return true }
  if (zoomOn()) { closeZoom(); return true }
  if (current.name === 'holdings' && hd.review) { hd.review = null; renderHoldings(); return true }
  if (!TAB_IDS.includes(current.name)) { history.back(); return true }
  if (current.name === 'sectors' && sx.open.size) { sx.open.clear(); renderSectors(); return true }
  if (current.name === 'feed' && fd.idx > 0) { $('feed')?.scrollTo({ top: 0, behavior: 'smooth' }); return true }
  if (current.name !== 'feed') { goTab('feed'); return true }
  return false
}

// ---- opening animation -------------------------------------------------------------------------------
const introStart = Date.now()
function endIntro() {
  if (!document.body.classList.contains('booting')) return
  setTimeout(() => { document.body.classList.remove('booting'); $('intro').classList.add('done') }, Math.max(0, 1300 - (Date.now() - introStart)))
}
document.querySelector('#intro .word').innerHTML = [...'Stoklore'].map((c, i) => `<span style="animation-delay:${0.3 + i * 0.05}s">${c}</span>`).join('')
setTimeout(endIntro, 8000) // never stuck on the intro when the feeds are slow or offline

// ---- shared rows -------------------------------------------------------------------------------------
const pctSpan = (v) => `<span class="${pctClass(v)}">${pctText(v)}</span>`
const stockRow = (m, lead = '') => `<button class="li" data-member="${esc(m.id)}">${lead}<div class="grow"><div class="t1">${esc(m.name)}</div>
  <div class="t2">${esc(m.sector || '')}${m.cap ? `<span class="pill">${m.cap}</span>` : ''}</div></div>
  <div class="r"><div class="b">₹${fmt(m.price)}</div><div class="t2">${pctSpan(m.change_pct)}</div></div></button>`
async function openMember(id, el) {
  const m = memberIndex.get(String(id)); if (!m) return
  el?.classList.add('busy')
  const sym = await symFor(m)
  el?.classList.remove('busy')
  if (sym) push(`stock/${encodeURIComponent(sym)}`); else toast(`No NSE symbol found for ${m.name}`)
}

// ---- chart (canvas): line or candles, volume, right axis, last-price tag, touch crosshair ----------
const IST = (o) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...o })
const F = { time: IST({ hour: '2-digit', minute: '2-digit', hour12: false }), day: IST({ day: '2-digit', month: 'short' }), mon: IST({ month: 'short', year: '2-digit' }),
  full: IST({ day: '2-digit', month: 'short', year: 'numeric' }), fullT: IST({ day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) }
const xLabel = (t, r) => (r === '1D' ? F.time : r === '1Y' || r === '5Y' ? F.mon : F.day).format(new Date(t * 1000))
const fullDate = (t, r) => (r === '1D' || r === '5D' ? F.fullT : F.full).format(new Date(t * 1000))
const onColor = (hex) => luminance(hexRgb(hex)) > 0.45 ? '#0b0b0b' : '#f5f5f5'
const AXIS = 54
function drawChart(cv, bars, o) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight
  if (!W) return
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H)
  g.font = `10px ${canvasFont}`; g.textBaseline = 'middle'
  if (!bars.length) { g.fillStyle = T['muted-foreground']; g.textAlign = 'center'; g.fillText(o.msg || 'No data', W / 2, H / 2); return }
  const top = 8, volH = 40, xH = 16, pw = W - AXIS, ph = H - top - volH - xH
  let lo = Math.min(...bars.map((b) => b.l)), hi = Math.max(...bars.map((b) => b.h))
  const pad = (hi - lo || hi * 0.01 || 1) * 0.06; lo -= pad; hi += pad
  const n = bars.length, step = pw / n, X = (i) => (i + 0.5) * step, Y = (v) => top + ((hi - v) / (hi - lo)) * ph
  g.lineWidth = 1; g.strokeStyle = T.border; g.fillStyle = T['muted-foreground']; g.textAlign = 'left'
  for (const v of ticks(lo, hi, 4)) { const y = Math.round(Y(v)) + 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(pw, y); g.stroke(); g.fillText(fmt(v, v >= 1000 ? 0 : 2), pw + 6, y) }
  g.textAlign = 'center'
  const every = Math.max(1, Math.ceil(n / 4))
  for (let i = Math.floor(every / 2); i < n; i += every) g.fillText(xLabel(bars[i].t, o.range), Math.min(Math.max(X(i), 26), pw - 26), H - xH / 2)
  const vmax = Math.max(...bars.map((b) => b.v || 0))
  if (vmax > 0) bars.forEach((b, i) => {
    const h = ((b.v || 0) / vmax) * (volH - 6); g.fillStyle = rgba(b.c >= b.o ? T.up : T.down, 0.35)
    g.fillRect(X(i) - Math.max(step * 0.35, 0.5), top + ph + volH - h, Math.max(step * 0.7, 1), h)
  })
  const last = bars.at(-1).c, col = last >= bars[0].o ? T.up : T.down
  if (o.type === 'candle') {
    const bw = Math.max(1, step * 0.62)
    bars.forEach((b, i) => {
      const c = b.c >= b.o ? T.up : T.down, x = Math.round(X(i)) + 0.5
      g.strokeStyle = c; g.fillStyle = c; g.beginPath(); g.moveTo(x, Y(b.h)); g.lineTo(x, Y(b.l)); g.stroke()
      const y1 = Y(Math.max(b.o, b.c)), y2 = Y(Math.min(b.o, b.c)); g.fillRect(X(i) - bw / 2, y1, bw, Math.max(1, y2 - y1))
    })
  } else {
    g.beginPath(); bars.forEach((b, i) => (i ? g.lineTo(X(i), Y(b.c)) : g.moveTo(X(i), Y(b.c))))
    g.strokeStyle = col; g.lineWidth = 1.6; g.stroke(); g.lineWidth = 1
    g.lineTo(X(n - 1), top + ph); g.lineTo(X(0), top + ph); g.closePath()
    const gr = g.createLinearGradient(0, top, 0, top + ph); gr.addColorStop(0, rgba(col, 0.28)); gr.addColorStop(1, rgba(col, 0)); g.fillStyle = gr; g.fill()
  }
  const ly = Y(last)
  g.setLineDash([3, 3]); g.strokeStyle = rgba(col, 0.8); g.beginPath(); g.moveTo(0, ly); g.lineTo(pw, ly); g.stroke(); g.setLineDash([])
  g.fillStyle = col; g.fillRect(pw + 1, ly - 8, AXIS - 1, 16); g.fillStyle = onColor(col); g.textAlign = 'left'; g.fillText(fmt(last, last >= 1000 ? 1 : 2), pw + 5, ly)
  if (o.hover != null) {
    const b = bars[o.hover], x = X(o.hover)
    g.strokeStyle = T['muted-foreground']; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x, top); g.lineTo(x, top + ph + volH); g.stroke(); g.setLineDash([])
    g.fillStyle = T.foreground; g.beginPath(); g.arc(x, Y(b.c), 3, 0, 7); g.fill()
    // the bar's values as a tooltip beside the crosshair (flips side near the right edge)
    const rows = [[fullDate(b.t, o.range), T['muted-foreground']], [`O ${fmt(b.o)}   H ${fmt(b.h)}`, T.foreground],
      [`L ${fmt(b.l)}   C ${fmt(b.c)}`, b.c >= b.o ? T.up : T.down], ...(b.v ? [[`Vol ${compact(b.v)}`, T['muted-foreground']]] : [])]
    g.font = `11px ${canvasFont}`; g.textAlign = 'left'; g.textBaseline = 'top'
    const tw = Math.max(...rows.map(([t]) => g.measureText(t).width)) + 16, th = rows.length * 15 + 9
    let tx = x + 12
    if (tx + tw > pw - 2) tx = x - 12 - tw
    tx = Math.max(2, tx)
    const ty = top + 4
    g.fillStyle = rgba(T['panel-head'], 0.94); g.strokeStyle = T.border; g.lineWidth = 1
    g.beginPath(); if (g.roundRect) g.roundRect(tx, ty, tw, th, 6); else g.rect(tx, ty, tw, th); g.fill(); g.stroke()
    rows.forEach(([t, c], i) => { g.fillStyle = c; g.fillText(t, tx + 8, ty + 6 + i * 15) })
    g.textBaseline = 'middle'
  }
}
const chartRange = () => RANGES[store.get('chart.range', '6M')] ? store.get('chart.range', '6M') : '6M'
const chartType = () => store.get('chart.type', 'line')
const typeSeg = () => `<div class="seg">${[['line', 'Line'], ['candle', 'Candles']].map(([t, l]) => `<button data-ctype="${t}" class="${t === chartType() ? 'on' : ''}">${l}</button>`).join('')}</div>`
const chartBlock = () => `<div class="chips" id="ranges">${Object.keys(RANGES).map((r) => `<button data-range="${r}" class="${r === chartRange() ? 'on' : ''}">${r}</button>`).join('')}</div>
  <div class="chartbox"><canvas></canvas></div><div class="chartinfo" id="cinfo"></div><div class="ctype">${typeSeg()}</div>`
function mountChart(kind, sym) {
  const cv = view.querySelector('.chartbox canvas'), info = $('cinfo'), tok = nav
  const c = { bars: [], range: chartRange(), hover: null, msg: 'Loading…' }
  const summary = () => { const s = barStats(c.bars); info.innerHTML = s ? `${c.range} ${pctSpan(s.change_pct)} · H ${fmt(s.hi)} · L ${fmt(s.lo)}` : '' }
  c.draw = () => drawChart(cv, c.bars, { range: c.range, type: chartType(), hover: c.hover, msg: c.msg })
  c.load = async (force, quiet) => { // quiet (auto-refresh): keep the chart up while the new bars load
    if (!quiet || !c.bars.length) { c.bars = []; c.msg = 'Loading…'; c.hover = null; c.draw(); info.textContent = '' }
    const range = c.range
    try { const b = await barsFor(kind, sym, range, force); if (tok !== nav || range !== c.range) return; if (quiet && !b.length) return; c.bars = b; c.msg = b.length ? '' : 'No bars for this range' }
    catch (e) { if (tok !== nav || (quiet && c.bars.length)) return; c.msg = `Chart unavailable (${e.message})` }
    if (c.hover == null) { c.draw(); summary() } // mid-drag, the next move redraws
  }
  const pick = (e) => {
    if (!c.bars.length) return
    const r = cv.getBoundingClientRect()
    c.hover = Math.max(0, Math.min(c.bars.length - 1, Math.floor((e.clientX - r.left) / ((r.width - AXIS) / c.bars.length))))
    c.draw() // the bar's OHLC is drawn as a tooltip on the chart; the line below keeps the range summary
  }
  const end = () => { if (c.hover == null) return; c.hover = null; c.draw(); summary() }
  cv.addEventListener('pointerdown', pick)
  cv.addEventListener('pointermove', (e) => { if (c.hover != null) pick(e) })
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) cv.addEventListener(ev, end)
  chart = c; c.load()
  return c
}
window.addEventListener('resize', () => { if (zoomOn()) renderZoom(); chart?.draw(); if (current.name === 'sectors' && sx.chart === 'bubbles') drawBubbles(); if (current.name === 'sectors' && sx.chart === 'heat') drawTreemap(); if (current.name === 'markets') paintSparks(); if (current.name === 'feed') repaintFeed() })
function spark(cv, bars, up) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight
  if (!W || bars.length < 2) return
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0)
  const cs = bars.map((b) => b.c), lo = Math.min(...cs), hi = Math.max(...cs), col = up ? T.up : T.down
  const X = (i) => (i / (cs.length - 1)) * W, Y = (v) => 2 + (hi > lo ? (hi - v) / (hi - lo) : 0.5) * (H - 4)
  g.beginPath(); cs.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)))); g.strokeStyle = col; g.lineWidth = 1.4; g.stroke()
  g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fillStyle = rgba(col, 0.15); g.fill()
}

// ---- Markets ---------------------------------------------------------------------------------------
const mk = { dir: 'gainers', cap: 'all', iex: store.get('markets.iex', 'NSE'), isort: store.get('markets.isort', 'change:desc'), ifilter: '', stocks: null, sum: null, indices: null, cards: {} }
const cardId = (code) => `ic-${code.replace(/[^a-z0-9]/gi, '')}`
const ISORTS = [['change:desc', 'Top gainers'], ['change:asc', 'Top losers'], ['value:desc', 'Value'], ['name:asc', 'Name A → Z']]
function marketsScreen() {
  setTop({ title: 'Stoklore', small: 'Markets', right: searchBtn + refreshBtn() })
  view.innerHTML = `<div class="cards">${MC_INDICES.map((x) => `<button class="icard" id="${cardId(x.code)}" data-push="index/${encodeURIComponent(x.code)}"><div class="n">${esc(x.name)}</div><div class="p">—</div><div class="c mute">…</div><canvas></canvas></button>`).join('')}</div>
    <div class="sec">Market breadth<span class="act mute">NSE · ET sectors</span></div><div class="panel" id="mbreadth"><div class="state">Loading…</div></div>
    <div class="sec">Movers<span class="act"><div class="seg">${[['gainers', 'Gainers'], ['losers', 'Losers']].map(([v, l]) => `<button data-act="mdir" data-v="${v}" class="${v === mk.dir ? 'on' : ''}">${l}</button>`).join('')}</div></span></div>
    <div class="chips">${[['all', 'All'], ['large', 'Large cap'], ['mid', 'Mid cap'], ['small', 'Small cap']].map(([v, l]) => `<button data-act="mcap" data-v="${v}" class="${v === mk.cap ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="panel" id="mmovers"><div class="state">Loading…</div></div>
    <div class="note">Every stock in ET's NSE sector feed, by market cap: large = top 100, mid = 101–250, small = the rest.</div>
    <div class="sec">All indices<span class="act"><div class="seg">${['NSE', 'BSE'].map((e) => `<button data-act="iex" data-v="${e}" class="${e === mk.iex ? 'on' : ''}">${e}</button>`).join('')}</div></span></div>
    <div class="sub"><input class="in" id="ifilter" placeholder="Filter indices" value="${esc(mk.ifilter)}"><select class="sel" data-sort="isort">${ISORTS.map(([v, l]) => `<option value="${v}"${v === mk.isort ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="panel" id="mindices"><div class="state">Loading…</div></div>`
  if (mk.sum) { renderBreadth(); renderMovers() }
  if (mk.indices) renderIndices()
  paintSparks()
  current.refresh = loadMarkets
  loadMarkets()
}
function paintCard(code) {
  const el = $(cardId(code)), d = mk.cards[code]; if (!el || !d) return
  const q = d.q
  el.querySelector('.p').textContent = q ? fmt(q.price) : '—'
  el.querySelector('.c').innerHTML = q ? `<span class="${pctClass(q.change)}">${q.change >= 0 ? '+' : ''}${fmt(q.change)} (${pctText(q.change_pct)})</span>` : '<span class="mute">unavailable</span>'
}
function paintSparks() {
  for (const x of MC_INDICES) { const el = $(cardId(x.code)), d = mk.cards[x.code]; if (el && d?.bars) spark(el.querySelector('canvas'), d.bars, (d.q?.change ?? 0) >= 0) }
}
function loadMarkets(force) {
  const tok = nav; let left = 3
  spin(true)
  const done = () => { endIntro(); if (--left || tok !== nav) return; spin(false); setSmall(`Markets · ${clock()}`) }
  Promise.all(MC_INDICES.map(async (x) => {
    const [q, b] = await Promise.allSettled([indexQuote(x.code, force), barsFor('index', x.code, '1D', force)])
    mk.cards[x.code] = { q: q.value, bars: b.value || [] }
    if (tok === nav) { paintCard(x.code); paintSparks() }
  })).then(done)
  sectorsFor('NSE', force).then((d) => {
    mk.stocks = allStocks(d.rows); mk.sum = sectorSummary(d.rows)
    if (tok === nav) { renderBreadth(); renderMovers() }
  }).catch((e) => { if (tok === nav && !mk.sum) { $('mbreadth').innerHTML = errState(`ET sectors: ${e.message}`); $('mmovers').innerHTML = '' } }).finally(done)
  loadIndices(force).finally(done)
}
function loadIndices(force) {
  const tok = nav, ex = mk.iex
  return indicesFor(ex, force).then((rows) => { if (ex !== mk.iex) return; mk.indices = rows; if (tok === nav) renderIndices() })
    .catch((e) => { if (tok === nav && ex === mk.iex) $('mindices').innerHTML = errState(`ET indices: ${e.message}`) })
}
function renderBreadth() {
  const el = $('mbreadth'), s = mk.sum; if (!el || !s) return
  const tot = s.advance + s.decline || 1
  el.innerHTML = `<button class="li" data-tab="sectors" style="display:block">
    <div style="display:flex;justify-content:space-between;gap:8px"><span><span class="up b">${s.advance} ▲</span> <span class="down b">${s.decline} ▼</span> <span class="mute">stocks</span></span><span class="mute">${s.up} of ${s.up + s.down + s.flat} sectors up ›</span></div>
    <div class="breadthbar"><div style="width:${(s.advance / tot) * 100}%;background:var(--up)"></div><div style="width:${(s.decline / tot) * 100}%;background:var(--down)"></div></div>
    <div class="t2" style="margin-top:6px">${s.best ? `Best ${esc(s.best.name)} ${pctSpan(s.best.change_pct)}` : ''}${s.worst ? ` · Worst ${esc(s.worst.name)} ${pctSpan(s.worst.change_pct)}` : ''}</div></button>`
}
function renderMovers() {
  const el = $('mmovers'); if (!el || !mk.stocks) return
  const list = movers(mk.stocks, mk.cap, mk.dir, 15)
  el.innerHTML = list.length ? list.map((m, i) => stockRow(m, `<span class="rank">${i + 1}</span>`)).join('') : `<div class="state">No ${mk.dir} right now.</div>`
}
function renderIndices() {
  const el = $('mindices'); if (!el || !mk.indices) return
  const q = mk.ifilter.trim().toLowerCase()
  const rows = sortRows(mk.indices.filter((r) => !q || (r.name || '').toLowerCase().includes(q)), mk.isort, { change: (r) => r.change_pct, value: (r) => r.value, name: (r) => r.name })
  el.innerHTML = rows.length ? rows.map((r) => `<div class="li"><div class="grow"><div class="t1">${esc(r.name)}</div><div class="t2">${r.advance != null ? `<span class="up">${r.advance}▲</span> <span class="down">${r.decline}▼</span> · ` : ''}H ${fmt(r.high)} · L ${fmt(r.low)}</div></div>
    <div class="r"><div class="b">${fmt(r.value)}</div><div class="t2">${pctSpan(r.change_pct)}</div></div></div>`).join('') : '<div class="state">No index matches.</div>'
}

// ---- Sectors (the web home page's Sector Performance panel) -----------------------------------------
const SECTOR_FIELDS = { mcap: (s) => s.mcap_cr, chgcr: (s) => s.mcap_change_cr, change: (s) => s.change_pct, breadth, members: (s) => s.members.length, name: (s) => s.name }
const MEMBER_FIELDS = { mcap: (m) => m.mcap_cr, change: (m) => m.change_pct, volume: (m) => m.volume_k, price: (m) => m.price, name: (m) => m.name }
const SECTOR_SORTS = [
  ['mcap:desc', 'Market cap · largest first'], ['mcap:asc', 'Market cap · smallest first'],
  ['change:desc', 'Change · top gainers first'], ['change:asc', 'Change · top losers first'],
  ['chgcr:desc', 'Δ Mcap · biggest gain first'], ['chgcr:asc', 'Δ Mcap · biggest loss first'],
  ['breadth:desc', 'Breadth · most advancing first'], ['breadth:asc', 'Breadth · most declining first'],
  ['members:desc', 'Members · most first'], ['members:asc', 'Members · fewest first'],
  ['name:asc', 'Name · A → Z'], ['name:desc', 'Name · Z → A'],
]
const MEMBER_SORTS = [
  ['mcap:desc', 'Market cap · largest first'], ['mcap:asc', 'Market cap · smallest first'],
  ['change:desc', 'Change · top gainers first'], ['change:asc', 'Change · top losers first'],
  ['volume:desc', 'Volume · highest first'], ['volume:asc', 'Volume · lowest first'],
  ['price:desc', 'Price · highest first'], ['price:asc', 'Price · lowest first'],
  ['name:asc', 'Name · A → Z'], ['name:desc', 'Name · Z → A'],
]
const sx = {
  exchange: store.get('sectors.exchange', 'NSE'), mapSort: store.get('sectors.mapSort', 'mcap:desc'),
  listSort: store.get('sectors.listSort', 'change:desc'), memberSort: store.get('sectors.memberSort', 'mcap:desc'),
  filter: '', open: new Set(), data: null, error: null, focus: null,
}
const sortSelect = (name, value, options) => `<select class="sel" data-sort="${name}">${options.map(([v, t]) => `<option value="${v}"${v === value ? ' selected' : ''}>${t}</option>`).join('')}</select>`
const tileStyle = (pct) => { const h = heat(pct, T); return `background:${h.bg};color:${h.fg}` }
function sectorsScreen() {
  setTop({ title: 'Sectors', small: 'ET Markets', right: searchBtn + refreshBtn(),
    sub: `<input class="in" id="sfilter" placeholder="Filter sectors or companies" value="${esc(sx.filter)}"><div class="seg">${['NSE', 'BSE'].map((e) => `<button data-act="sex" data-v="${e}" class="${e === sx.exchange ? 'on' : ''}">${e}</button>`).join('')}</div>` })
  renderSectors()
  current.refresh = loadSectors
  loadSectors()
}
async function loadSectors(force) {
  const tok = nav, ex = sx.exchange
  spin(true)
  try { const d = await sectorsFor(ex, force); if (ex !== sx.exchange) return; sx.data = d; sx.error = null }
  catch (e) { if (ex !== sx.exchange) return; sx.error = `ET sectors: ${e.message}` }
  endIntro()
  if (tok !== nav) return
  spin(false); renderSectors()
  if (sx.focus) { document.getElementById(`sector-${sx.focus}`)?.scrollIntoView({ block: 'start' }); sx.focus = null }
}
function renderSectors() {
  if (current.name !== 'sectors') return
  const sectors = sx.data?.rows
  setSmall(`ET Markets · ${sx.exchange}${sx.data ? ` · ${esc(sectors[0]?.updated ?? clock())}` : ''}`)
  if (!sectors) { view.innerHTML = sx.error ? errState(sx.error) : '<div class="state">Loading sectors…</div>'; return }
  const sum = sectorSummary(sectors)
  const maxMove = Math.max(0, ...sectors.map((s) => Math.abs(s.change_pct ?? 0)))
  const needle = sx.filter.trim().toLowerCase()
  const shown = sortRows(needle ? sectors.filter((s) => s.name.toLowerCase().includes(needle) || s.members.some((m) => (m.name || '').toLowerCase().includes(needle))) : sectors, sx.listSort, SECTOR_FIELDS)
  const bc = bucketColors(T)
  let h = sx.error ? `<div class="err">${esc(sx.error)} · showing the last answer</div>` : ''
  h += `<div class="summary">
    <span><span class="up">${sum.up} ▲</span> <span class="down">${sum.down} ▼</span>${sum.flat > 0 ? ` <span class="mute">${sum.flat} ─</span>` : ''}<span class="mute"> sectors</span></span>
    <span><span class="mute">mcap </span>${croreShort(sum.mcap)} <span class="${pctClass(sum.changePct)}">${pctText(sum.changePct)} (${sum.change >= 0 ? '+' : ''}${croreShort(sum.change)})</span></span>
    ${sum.best ? `<span><span class="mute">best </span>${esc(sum.best.name)} <span class="up">${pctText(sum.best.change_pct)}</span></span>` : ''}
    ${sum.worst ? `<span><span class="mute">worst </span>${esc(sum.worst.name)} ${pctSpan(sum.worst.change_pct)}</span>` : ''}
  </div>`
  h += sectorChart(sectors, bc)
  h += `<div class="bar-head"><span>${shown.length} sectors</span>${sortSelect('list', sx.listSort, SECTOR_SORTS)}</div>`
  if (!shown.length) h += `<div class="state">No sector or company matches “${esc(sx.filter)}”.</div>`
  for (const s of shown) h += sectorHtml(s, maxMove, bc)
  view.innerHTML = h
  if (sx.chart === 'bubbles') requestAnimationFrame(drawBubbles)
  if (sx.chart === 'heat') requestAnimationFrame(drawTreemap)
}
// ---- the sector map, as one of five charts (Settings-free: the choice is remembered on the phone) ----
sx.tsize = store.get('sectors.tsize', 'mcap') === 'equal' ? 'equal' : 'mcap'
const SCHARTS = [['heat', 'Heatmap'], ['tiles', 'Tiles'], ['grid', 'Grid'], ['bars', 'Bars'], ['bubbles', 'Bubbles'], ['breadth', 'Breadth']]
sx.chart = SCHARTS.some(([k]) => k === store.get('sectors.chart', 'heat')) ? store.get('sectors.chart', 'heat') : 'heat'
const heatLegend = () => `<div class="legend">${[-4, -2, -0.5, 0, 0.5, 2, 4].map((p) => `<span><i style="background:${heat(p, T).bg}"></i>${pctText(p, 1)}</span>`).join('')}</div>`
function sectorChart(sectors, bc) {
  const list = sortRows(sectors, sx.mapSort, SECTOR_FIELDS), open = (s) => sx.open.has(s.id) ? ' open' : ''
  const maxMove = Math.max(0.5, ...sectors.map((s) => Math.abs(s.change_pct ?? 0)))
  const what = { heat: 'stocks by market cap, grouped by sector · tap a stock or a sector', tiles: 'sectors, size = market cap, colour = move', grid: 'every sector the same size, colour = move', bars: 'today\'s move, gainers right',
    bubbles: 'move → · breadth ↑ · size = market cap', breadth: 'advancing vs declining stocks' }[sx.chart]
  let body
  if (sx.chart === 'heat') {
    body = `<div class="tvmap" id="tvmap"></div>${heatLegend()}`
  } else if (sx.chart === 'grid') {
    body = `<div class="hgrid">${list.map((s) => `<button class="hcell${open(s)}" data-open="${esc(s.id)}" data-map style="${tileStyle(s.change_pct)}"><span>${esc(s.name)}</span><b>${pctText(s.change_pct)}</b></button>`).join('')}</div>${heatLegend()}`
  } else if (sx.chart === 'bars') {
    body = `<div class="sbars">${list.map((s) => {
      const w = Math.min(Math.abs(s.change_pct ?? 0) / maxMove, 1) * 50, up = (s.change_pct ?? 0) >= 0
      return `<button class="sbar${open(s)}" data-open="${esc(s.id)}" data-map><span class="nm">${esc(s.name)}</span><span class="track"><i class="mid"></i><i class="fill" style="width:${w}%;${up ? 'left:50%' : 'right:50%'};background:${up ? 'var(--up)' : 'var(--down)'}"></i></span><span class="${pctClass(s.change_pct)} pc">${pctText(s.change_pct)}</span></button>`
    }).join('')}</div>`
  } else if (sx.chart === 'bubbles') {
    body = `<div class="sbub"><canvas id="sbub"></canvas></div><div class="legend"><span>← falling · rising →</span><span>↑ more stocks advancing</span><span>tap a bubble</span></div>`
  } else if (sx.chart === 'breadth') {
    body = `<div class="sbars">${sortRows(sectors, sx.mapSort, SECTOR_FIELDS).map((s) => {
      const a = s.advance ?? 0, d = s.decline ?? 0, u = s.unchanged ?? 0, n = a + d + u || 1
      return `<button class="sbar${open(s)}" data-open="${esc(s.id)}" data-map><span class="nm">${esc(s.name)}</span><span class="track stack"><i style="width:${(a / n) * 100}%;background:var(--up)"></i><i style="width:${(u / n) * 100}%;background:var(--muted-foreground);opacity:.5"></i><i style="width:${(d / n) * 100}%;background:var(--down)"></i></span><span class="pc"><span class="up">${a}</span>/<span class="down">${d}</span></span></button>`
    }).join('')}</div>`
  } else {
    body = `<div class="tiles">${list.map((s) => {
      const cap = Math.max(s.mcap_cr ?? 0, 0)
      return `<button class="tile${open(s)}" data-open="${esc(s.id)}" style="flex-grow:${Math.sqrt(Math.max(cap, 1))};flex-basis:${Math.min(10, 4 + Math.sqrt(cap) / 160)}rem;${tileStyle(s.change_pct)}"><p>${esc(s.name)}</p><p>${pctText(s.change_pct)}</p></button>`
    }).join('')}</div><div class="legend">breadth: ${BUCKET_LABELS.map((l, i) => `<span><i style="background:${bc[i]}"></i>${l}</span>`).join('')}</div>`
  }
  return `<div class="map"><div class="chips schips">${SCHARTS.map(([k, l]) => `<button data-act="schart" data-v="${k}" class="${sx.chart === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="bar-head"><span>${esc(what)}</span>${sx.chart === 'bubbles' ? '' : sortSelect('map', sx.mapSort, SECTOR_SORTS)}</div>
    ${sx.chart === 'heat' ? `<div class="btnrow" style="padding:2px 10px 6px"><div class="seg full">${[['mcap', 'Size: market cap'], ['equal', 'Size: equal']].map(([k, l]) => `<button data-act="tsize" data-v="${k}" class="${sx.tsize === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>` : ''}${body}</div>`
}
/** TradingView-style heatmap: the 450 largest stocks as a squarified treemap (area = market cap, colour = the
 *  day's move), each inside its sector's block (area = the sector's market cap) under a header. */
const shortName = (n) => String(n || '').replace(/\b(ltd|limited|corporation|corp|company|co)\b\.?/gi, '').replace(/\s+/g, ' ').trim()
const tvLabel = (name, pct, w, h) => {
  if (w < 26 || h < 14) return ''
  const fs = Math.max(8, Math.min(17, Math.sqrt(w * h) / 6.5, w / 6.2, h / 2.6)) // fits narrow / flat blocks too
  return `<span style="font-size:${fs.toFixed(1)}px">${esc(shortName(name))}</span>${h > fs * 2.3 ? `<span style="font-size:${Math.max(8, fs * 0.78).toFixed(1)}px;font-weight:400">${pctText(pct, 2)}</span>` : ''}`
}
function drawTreemap() {
  const box = $('tvmap'), sectors = sx.data?.rows
  if (!box || !sectors) return
  const W = box.clientWidth || window.innerWidth - 16 // before layout (or headless), the screen's width
  if (!W) return
  const H = Math.max(440, Math.round(W * 1.4))
  box.style.height = `${H}px`
  const top = new Set(allStocks(sectors).filter((m) => (m.mcap_cr || 0) > 0).slice(0, 450).map((m) => m.id))
  // blocks in the chosen sort order (top-left first), sized by market cap or all equal
  const secs = sortRows(sectors.filter((s) => (s.mcap_cr || 0) > 0), sx.mapSort, SECTOR_FIELDS)
  const keepOrder = !(sx.mapSort === 'mcap:desc' && sx.tsize === 'mcap')
  let html = ''
  for (const r of squarify(secs.map((s) => sx.tsize === 'equal' ? 1 : s.mcap_cr), 0, 0, W, H, keepOrder)) {
    const s = secs[r.i], head = r.w > 44 && r.h > 32 ? 15 : 0
    const ms = s.members.map((m, i) => ({ m, i })).filter((x) => top.has(x.m.id) && (x.m.mcap_cr || 0) > 0)
    const inner = squarify(ms.map((x) => x.m.mcap_cr), 1, head + 1, r.w - 2, r.h - head - 2)
    html += `<div class="tvsec${sx.open.has(s.id) ? ' open' : ''}" style="left:${r.x.toFixed(1)}px;top:${r.y.toFixed(1)}px;width:${r.w.toFixed(1)}px;height:${r.h.toFixed(1)}px">`
    if (head) html += `<button class="tvhead" data-open="${esc(s.id)}" data-map>${esc(s.name)} <span>${pctText(s.change_pct, 1)}</span></button>`
    if (!inner.length) html += `<button class="tvcell" data-open="${esc(s.id)}" data-map style="left:1px;top:${head + 1}px;width:${(r.w - 2).toFixed(1)}px;height:${(r.h - head - 2).toFixed(1)}px;${tileStyle(s.change_pct)}">${tvLabel(s.name, s.change_pct, r.w, r.h - head)}</button>`
    for (const q of inner) {
      const { m, i } = ms[q.i]
      html += `<button class="tvcell" data-m="${esc(s.id)}:${i}" style="left:${q.x.toFixed(1)}px;top:${q.y.toFixed(1)}px;width:${q.w.toFixed(1)}px;height:${q.h.toFixed(1)}px;${tileStyle(m.change_pct)}">${tvLabel(m.name, m.change_pct, q.w, q.h)}</button>`
    }
    html += '</div>'
  }
  box.innerHTML = html
}
/** Bubbles: x = today's move, y = share of stocks advancing, area = market cap, colour = move. */
let bubbleHits = []
function drawBubbles() {
  const cv = $('sbub'), sectors = sx.data?.rows
  if (!cv || !sectors) return
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight
  if (!W) return
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H)
  const pad = 26, maxMove = Math.max(0.5, ...sectors.map((s) => Math.abs(s.change_pct ?? 0))) * 1.1
  const maxCap = Math.max(1, ...sectors.map((s) => s.mcap_cr ?? 0))
  const X = (v) => pad + ((v + maxMove) / (2 * maxMove)) * (W - 2 * pad), Y = (b) => H - pad - b * (H - 2 * pad)
  g.strokeStyle = T.border; g.lineWidth = 1; g.setLineDash([3, 3])
  g.beginPath(); g.moveTo(X(0), pad / 2); g.lineTo(X(0), H - pad / 2); g.moveTo(pad / 2, Y(0.5)); g.lineTo(W - pad / 2, Y(0.5)); g.stroke(); g.setLineDash([])
  g.font = `10px ${canvasFont}`; g.fillStyle = T['muted-foreground']; g.textAlign = 'left'; g.textBaseline = 'middle'
  g.fillText(pctText(-maxMove / 1.1, 1), 4, H - 10); g.textAlign = 'right'; g.fillText(pctText(maxMove / 1.1, 1), W - 4, H - 10)
  g.textAlign = 'left'; g.fillText('100% up', 4, pad / 2); g.fillText('0% up', 4, Y(0) + 8)
  bubbleHits = sectors.filter((s) => s.change_pct != null).map((s) => {
    const n = (s.advance ?? 0) + (s.decline ?? 0), b = n ? (s.advance ?? 0) / n : 0.5
    return { s, x: X(s.change_pct), y: Y(b), r: 5 + 22 * Math.sqrt(Math.max(s.mcap_cr ?? 0, 0) / maxCap) }
  }).sort((a, b) => b.r - a.r) // big first, small drawn on top
  for (const p of bubbleHits) {
    g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fillStyle = heat(p.s.change_pct, T).bg; g.globalAlpha = 0.85; g.fill(); g.globalAlpha = 1
    g.strokeStyle = sx.open.has(p.s.id) ? T.foreground : T.border; g.lineWidth = sx.open.has(p.s.id) ? 2 : 1; g.stroke()
  }
  g.fillStyle = T.foreground; g.textAlign = 'center'
  for (const p of [...bubbleHits].sort((a, b) => b.r - a.r).slice(0, 9)) g.fillText(p.s.name.length > 12 ? `${p.s.name.slice(0, 11)}…` : p.s.name, p.x, p.y - p.r - 6)
}
// ---- a sector, full screen: all its stocks as a heatmap; pinch / double-tap / +− to zoom, drag to move ----
const zm = { sid: null, z: 1 }
const zoomOn = () => $('zoom')?.classList.contains('on')
function openZoom(sid) {
  const s = sx.data?.rows.find((x) => String(x.id) === String(sid))
  if (!s) return
  zm.sid = String(s.id); zm.z = 1
  let el = $('zoom')
  if (!el) { el = document.createElement('div'); el.id = 'zoom'; document.body.appendChild(el); bindZoom(el) }
  const n = s.members.length, a = s.advance ?? 0, d = s.decline ?? 0
  el.innerHTML = `<div class="zbar"><div class="grow"><div class="t1">${esc(s.name)} <span class="${pctClass(s.change_pct)}">${pctText(s.change_pct)}</span></div>
      <div class="t2">${n} stocks · <span class="up">${a}▲</span> <span class="down">${d}▼</span> · mcap ${croreShort(s.mcap_cr)} · pinch or double-tap to zoom</div></div>
    <button class="icon" data-z="out" aria-label="Zoom out">${I.minus}</button><button class="icon" data-z="in" aria-label="Zoom in">${I.plus}</button><button class="icon" data-z="fit" aria-label="Fit to screen">${I.fit}</button><button class="icon" data-z="close" aria-label="Close">${I.close}</button></div>
    <div class="zview" id="zview"><div class="zmap" id="zmap"></div></div>
    <div class="zfoot">${heatLegend()}<div class="btnrow" style="padding:4px 0 0"><button class="btn" data-z="list">Open in the sector list</button></div></div>`
  el.classList.add('on')
  requestAnimationFrame(() => renderZoom())
}
const closeZoom = () => $('zoom')?.classList.remove('on')
function renderZoom() {
  const s = sx.data?.rows.find((x) => String(x.id) === zm.sid), v = $('zview'), map = $('zmap')
  if (!s || !v || !map) return
  const W = (v.clientWidth || window.innerWidth) * zm.z, H = (v.clientHeight || window.innerHeight * 0.7) * zm.z
  map.style.width = `${W}px`; map.style.height = `${H}px`
  const ms = s.members.map((m, i) => ({ m, i })).filter((x) => (x.m.mcap_cr || 0) > 0)
  map.innerHTML = squarify(ms.map((x) => x.m.mcap_cr), 0, 0, W, H).map((q) => {
    const { m, i } = ms[q.i], fs = Math.max(8, Math.min(22, Math.sqrt(q.w * q.h) / 6.5, q.w / 6.2, q.h / 3.4))
    const price = q.h > fs * 3.6 && m.price != null ? `<span style="font-size:${Math.max(8, fs * 0.7).toFixed(1)}px;font-weight:400;opacity:.85">₹${fmt(m.price)}</span>` : ''
    return `<button class="tvcell" data-m="${esc(s.id)}:${i}" style="left:${q.x.toFixed(1)}px;top:${q.y.toFixed(1)}px;width:${q.w.toFixed(1)}px;height:${q.h.toFixed(1)}px;${tileStyle(m.change_pct)}">${tvLabel(m.name, m.change_pct, q.w, q.h)}${price}</button>`
  }).join('')
}
/** Zoom to z keeping the point (cx, cy) of the view (view pixels) where it is. */
function zoomAt(z, cx, cy) {
  const v = $('zview'); if (!v) return
  const nz = Math.max(1, Math.min(8, z)), ox = (v.scrollLeft + cx) / zm.z, oy = (v.scrollTop + cy) / zm.z
  zm.z = nz; renderZoom()
  v.scrollLeft = ox * nz - cx; v.scrollTop = oy * nz - cy
}
function bindZoom(el) {
  const pts = new Map()
  let pinch = null, lastTap = 0
  const view = () => $('zview'), rel = (e) => { const r = view().getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  el.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#zview')) return
    pts.set(e.pointerId, rel(e))
    if (pts.size === 2) {
      const [a, b] = [...pts.values()]
      pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, k: 1 }
      $('zmap').style.transformOrigin = `${view().scrollLeft + pinch.cx}px ${view().scrollTop + pinch.cy}px`
    }
  })
  el.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return
    pts.set(e.pointerId, rel(e))
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()]
      pinch.k = Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0
      $('zmap').style.transform = `scale(${Math.max(1 / zm.z, Math.min(8 / zm.z, pinch.k))})` // live, then re-laid out at the end
    }
  })
  const end = (e) => {
    pts.delete(e.pointerId)
    if (pinch && pts.size < 2) {
      const p = pinch; pinch = null
      $('zmap').style.transform = ''
      zoomAt(zm.z * p.k, p.cx, p.cy)
    }
  }
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end)
  el.addEventListener('click', (e) => { // double-tap: zoom in there (or back to fit when far in)
    if (!e.target.closest('#zview')) return
    const now = Date.now(), p = rel(e)
    if (now - lastTap < 300) { zoomAt(zm.z >= 4 ? 1 : zm.z * 2, p.x, p.y); lastTap = 0; e.stopPropagation(); return }
    lastTap = now
  }, true)
}
function zoomTap(el) {
  const v = $('zview'), cx = (v?.clientWidth || 0) / 2, cy = (v?.clientHeight || 0) / 2
  switch (el.dataset.z) {
    case 'in': return zoomAt(zm.z * 1.6, cx, cy)
    case 'out': return zoomAt(zm.z / 1.6, cx, cy)
    case 'fit': return zoomAt(1, 0, 0)
    case 'close': return closeZoom()
    case 'list': { const id = zm.sid; closeZoom(); sx.open.add(id); renderSectors(); return document.getElementById(`sector-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  }
}

function bubbleTap(e) {
  const cv = $('sbub'), r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top
  const hit = [...bubbleHits].reverse().find((p) => (p.x - x) ** 2 + (p.y - y) ** 2 <= (p.r + 4) ** 2)
  if (hit) openZoom(hit.s.id)
}
function toggleSector(id, fromMap) {
  if (fromMap) return openZoom(id) // a tap on any chart opens the sector full screen
  if (sx.open.has(id)) sx.open.delete(id); else sx.open.add(id)
  if (fromMap && sx.open.has(id) && sx.filter) { sx.filter = ''; $('sfilter').value = '' }
  renderSectors()
  if (fromMap && sx.open.has(id)) document.getElementById(`sector-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function sectorHtml(s, maxMove, bc) {
  const open = sx.open.has(s.id)
  const ranked = s.members.filter((m) => m.change_pct != null).sort((a, b) => b.change_pct - a.change_pct)
  const best = ranked[0], worst = ranked.length > 1 ? ranked.at(-1) : null
  const w = s.change_pct == null || !maxMove ? 0 : Math.min(Math.abs(s.change_pct) / maxMove, 1) * 50
  const fill = w > 0 ? `<div class="fill" style="width:${w}%;${s.change_pct >= 0 ? `left:50%;background:${rgba(T.up, 0.75)}` : `right:50%;background:${rgba(T.down, 0.75)}`}"></div>` : ''
  const shares = bucketShares(s.buckets)
  const strip = s.members.slice(0, 40).map((m, i) => `<div data-m="${esc(s.id)}:${i}" style="flex-grow:${Math.max(m.mcap_cr ?? 0, 1)};background:${heat(m.change_pct, T).bg}"></div>`).join('')
  let h = `<div class="row${open ? ' open' : ''}" id="sector-${esc(s.id)}" data-open="${esc(s.id)}">
    <div class="r1"><span class="chev">›</span><span class="nm">${esc(s.name)} <span class="mute" style="font-weight:400;font-size:11px">${s.members.length}</span></span><span class="chg ${pctClass(s.change_pct)}">${pctText(s.change_pct)}</span></div>
    <div class="r2"><span><span class="mute">mcap </span>${croreShort(s.mcap_cr)}</span><span class="${pctClass(s.mcap_change_cr)}">${s.mcap_change_cr == null ? '—' : `${s.mcap_change_cr >= 0 ? '+' : ''}${croreShort(s.mcap_change_cr)}`}</span></div>
    <div class="grid">
      <div class="changebar"><div class="mid"></div>${fill}</div>
      <div class="breadth">${shares.map((x, i) => x > 0 ? `<div style="width:${x}%;background:${bc[i]}"></div>` : '').join('')}</div>
      <span></span>
      <span style="font-size:11px"><span class="up">${s.advance ?? 0}▲</span> <span class="down">${s.decline ?? 0}▼</span>${(s.unchanged ?? 0) > 0 ? ` <span class="mute">${s.unchanged}─</span>` : ''}</span>
    </div>
    <div class="strip">${strip}</div>
    <div class="bw">
      ${best ? `<p><span class="up">▲ ${pctText(best.change_pct)}</span> ${esc(best.name)}</p>` : ''}
      ${worst ? `<p>${pctSpan(worst.change_pct).replace('">', '">▼ ')} ${esc(worst.name)}</p>` : ''}
    </div>`
  if (open) h += membersHtml(s)
  return h + '</div>'
}
function membersHtml(s) {
  const members = sortRows(s.members, sx.memberSort, MEMBER_FIELDS)
  const up = members.filter((m) => (m.change_pct ?? 0) > 0).length
  const down = members.filter((m) => (m.change_pct ?? 0) < 0).length
  let h = `<div class="members"><div class="meta"><span>${members.length} members · <span class="up">${up} up</span> · <span class="down">${down} down</span></span><span style="margin-left:auto">${sortSelect('member', sx.memberSort, MEMBER_SORTS)}</span></div><div class="tiles">`
  for (const m of members) {
    const cap = Math.max(m.mcap_cr ?? 0, 0)
    h += `<button class="tile" data-m="${esc(s.id)}:${s.members.indexOf(m)}" style="flex-grow:${Math.sqrt(Math.max(cap, 1))};flex-basis:${Math.min(12, 4.5 + Math.sqrt(cap) / 60)}rem;${tileStyle(m.change_pct)}"><p>${esc(m.name)}</p><p><span>${pctText(m.change_pct)}</span><span>₹${fmt(m.price)}</span></p></button>`
  }
  return h + '</div></div>'
}

// ---- bottom card: a sector member, with chart / TradingView / Dhan ------------------------------------
const sheetOn = () => $('sheet').classList.contains('on')
const closeSheet = () => $('sheet').classList.remove('on', 'big')
const tvUrl = (sym) => `https://www.tradingview.com/chart/?symbol=NSE:${encodeURIComponent(sym)}`
const TV_APP = 'com.tradingview.tradingviewapp'
function memberLinks(m, sym, note) {
  if (!sym) return `<button class="go" disabled style="grid-column:span 2">${note}</button>`
  return `<button class="go primary" style="grid-column:span 2" data-push="stock/${encodeURIComponent(sym)}">Chart &amp; research<span>NSE:${esc(sym)}</span></button>
    <button class="go" data-ext="${esc(tvUrl(sym))}" data-pkg="${TV_APP}">TradingView<span>opens the app</span></button>
    <button class="go" data-app="dhan" data-sym="${esc(sym)}" data-url="${esc(dhanUrl(m.slug))}">Dhan<span>copies symbol</span></button>`
}
function showMember(s, m) {
  const sheet = $('sheet')
  sheet.dataset.for = m.id
  sheet.innerHTML = `<h3>${esc(m.name)}</h3><div class="mute">${esc(s.name)}<span id="sym"></span></div>
    <div class="kv2"><span>Price</span><span>₹${fmt(m.price)}</span>
    <span>Change</span>${pctSpan(m.change_pct)}
    <span>Mcap</span><span>${croreShort(m.mcap_cr)}</span>
    <span>Share of sector</span><span>${s.mcap_cr && m.mcap_cr ? `${fmt((m.mcap_cr / s.mcap_cr) * 100, 1)}%` : '—'}</span>
    <span>Volume</span><span>${m.volume_k == null ? '—' : `${fmt(m.volume_k, 2)}K`}</span></div>
    <div class="links" id="links">${memberLinks(m, null, 'Finding NSE symbol…')}</div>`
  sheet.classList.add('on')
  symFor(m).then((sym) => {
    if (sheet.dataset.for !== String(m.id) || !sheetOn()) return
    $('links').innerHTML = memberLinks(m, sym, 'No NSE symbol found')
    if (sym) $('sym').textContent = ` · ${sym}`
  })
}

// ---- Search ----------------------------------------------------------------------------------------
const sr = { q: '', hits: null, err: null, timer: 0, seq: 0 }
function searchScreen() {
  setTop({ title: 'Search', small: 'NSE stocks by name or symbol', back: true, sub: `<input class="in" id="q" type="search" placeholder="Reliance, TCS, HDFC Bank…" value="${esc(sr.q)}" autocomplete="off" spellcheck="false">` })
  renderSearch(); endIntro()
  if (!sr.q) setTimeout(() => { if (current.name === 'search') $('q')?.focus() }, 300)
}
async function runSearch() {
  const q = sr.q.trim(), seq = ++sr.seq
  if (!q) { sr.hits = null; renderSearch(); return }
  try {
    const [hits, sym] = await Promise.all([etSearch(q), symbolHit(q)])
    if (seq !== sr.seq) return
    sr.hits = hits.filter((x) => x.entityType === 'company' && x.symbol)
    if (sym && !sr.hits.some((x) => x.symbol.toUpperCase() === sym)) sr.hits.unshift({ symbol: sym, tagName: 'ETF / exchange symbol (Moneycontrol prices)', tagId: '' })
    sr.err = null
  }
  catch (e) { if (seq !== sr.seq) return; sr.err = `ET search: ${e.message}` }
  renderSearch()
}
function renderSearch() {
  if (current.name !== 'search') return
  const row = (sym, name, right) => `<button class="li" data-push="stock/${encodeURIComponent(sym)}"><div class="grow"><div class="t1">${esc(name)}</div><div class="t2">NSE:${esc(sym)}</div></div><div class="r">${right}</div><span class="chev">›</span></button>`
  if (!sr.q.trim()) {
    const recent = store.json('search.recent', [])
    view.innerHTML = recent.length
      ? `<div class="sec">Recent<span class="act"><button class="pill" data-act="clear-recent">clear</button></span></div><div class="panel">${recent.map((r) => row(r.sym, r.name, '')).join('')}</div>`
      : '<div class="state">Type a company name or NSE symbol.</div>'
    return
  }
  if (sr.err) { view.innerHTML = errState(sr.err); return }
  if (!sr.hits) { view.innerHTML = '<div class="state">Searching…</div>'; return }
  view.innerHTML = sr.hits.length ? `<div class="panel" style="margin-top:10px">${sr.hits.map((x) => {
    const m = memberIndex.get(String(x.tagId))
    return row(x.symbol, x.tagName, `${m ? `<div class="b">₹${fmt(m.price)}</div><div class="t2">${pctSpan(m.change_pct)}</div>` : `<div class="t2">${croreShort(num(x.marketCap))}</div>`}`)
  }).join('')}</div>` : `<div class="state">No NSE company matches “${esc(sr.q)}”.</div>`
}
function remember(sym, name) {
  const list = store.json('search.recent', []).filter((r) => r.sym !== sym)
  list.unshift({ sym, name }); store.set('search.recent', JSON.stringify(list.slice(0, 12)))
}

// ---- Stock: quote, chart, stats, sector + peers, research links -----------------------------------------
const kvHtml = (pairs) => pairs.map(([k, v]) => `<div><span>${k}</span>${v}</div>`).join('')
function linksHtml(sym, meta) {
  return researchLinks(sym, meta).map((l) => `<button class="go" data-ext="${esc(l.url)}" data-pkg="${l.app || ''}">${l.name}<span>${l.hint}</span></button>`).join('')
    + `<button class="go" data-app="dhan" data-sym="${esc(sym)}" data-url="${esc(dhanUrl(meta?.seo))}">Dhan<span>copies symbol</span></button>`
}
// ---- fundamentals on the stock screen: screener.in's public page, parsed by lib.js parseScreener ----
const STABS = [['overview', 'Overview'], ['financials', 'Financials'], ['holding', 'Shareholding'], ['filings', 'Filings'], ['about', 'About']]
const FINS = [['quarters', 'Quarterly'], ['annual', 'Annual P&L'], ['balance', 'Balance sheet'], ['cashflow', 'Cash flow'], ['ratiosTable', 'Ratios']]
const sv = { tab: store.get('stock.tab', 'overview'), fin: store.get('stock.fin', 'quarters'), data: null, sym: null }
const screenerFor = (sym, force) => cached(`scr:${sym}`, 6 * 3600e3, async () => {
  const r = await nget(screenerUrl(sym))
  if (r.status !== 200) throw new Error(r.status === 404 ? 'this company isn\'t on Screener' : r.status ? `Screener answered HTTP ${r.status}` : 'offline?')
  return parseScreener(new DOMParser().parseFromString(r.body, 'text/html'))
}, force)
const negCls = (v) => /^-/.test(String(v).trim()) ? ' class="down"' : ''
function finTable(t, note = '') {
  return `<div class="tscroll"><table class="ftable"><thead><tr><th></th>${t.periods.map((p) => `<th>${esc(p)}</th>`).join('')}</tr></thead>
    <tbody>${t.rows.map((r) => `<tr><td>${esc(r.label)}</td>${r.values.map((v) => `<td${negCls(v)}>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${note}`
}
/** Bars for one row of a table (last 12 periods), each period's height against the largest. */
function miniBars(t, re, label) {
  const r = t?.rows.find((x) => re.test(x.label)); if (!r) return ''
  const vals = r.values.map((v) => parseNum(String(v).replace('%', ''))).slice(-12), per = t.periods.slice(-12)
  const max = Math.max(...vals.map((v) => Math.abs(v ?? 0))) || 1, last = vals.at(-1)
  return `<div class="mbar"><div class="mbh"><span>${label}</span><span class="b">${last == null ? '—' : fmt(last, 0)}</span></div>
    <div class="mbars">${vals.map((v, i) => `<i title="${esc(per[i])}: ${v ?? '—'}" class="${(v ?? 0) < 0 ? 'neg' : ''}" style="height:${Math.max(2, (Math.abs(v ?? 0) / max) * 100)}%"></i>`).join('')}</div>
    <div class="mbx"><span>${esc(per[0] || '')}</span><span>${esc(per.at(-1) || '')}</span></div></div>`
}
function renderFundamentals(sym, d, err) {
  if (current.name !== 'stock' || sv.sym !== sym) return
  const scrLink = `<button class="pill" data-ext="${esc(screenerUrl(sym))}" data-pkg="">open on Screener</button>`
  const fail = `<div class="state">Fundamentals unavailable - ${esc(err?.message || 'no data')}.<br><br>${scrLink}</div>`
  if (!d) { for (const id of ['fund', 'tab-financials', 'tab-holding', 'tab-filings', 'tab-about']) if ($(id)) $(id).innerHTML = id === 'fund' ? `<div class="note">${esc(err?.message || 'No fundamentals')} · ${scrLink}</div>` : fail; return }
  const basis = d.standalone ? 'standalone' : 'consolidated'
  // overview: latest results, Screener's ratios, growth, pros / cons
  const rs = resultsSummary(d.quarters)
  const chg = (x, pts) => x == null ? '<span class="mute">—</span>' : pts ? `<span class="${pctClass(x)}">${x >= 0 ? '+' : '−'}${fmt(Math.abs(x), 1)} pts</span>` : pctSpan(x)
  $('results').innerHTML = rs ? `<div class="sec">Latest results · ${esc(rs.period)}<span class="act mute">${rs.standalone ? 'standalone' : 'consolidated'} · ₹ Cr</span></div>
    <div class="panel rgrid"><span class="mute">Quarter</span><span class="mute">${esc(rs.period)}</span><span class="mute">YoY</span><span class="mute">QoQ</span>
    ${rs.items.map((x) => `<span>${esc(x.label)}</span><span class="b">${x.points ? `${fmt(x.value, 0)}%` : fmt(x.value, x.label.startsWith('EPS') ? 2 : 0)}</span><span>${chg(x.yoy, x.points)}</span><span>${chg(x.qoq, x.points)}</span>`).join('')}</div>
    ${rs.mixed ? '<div class="note">The company switched between standalone and consolidated figures in this window, so the change compares two different bases.</div>' : ''}` : ''
  $('fund').innerHTML = `${d.ratios.length ? `<div class="sec">Fundamentals<span class="act">${scrLink}</span></div><div class="panel"><div class="kv">${kvHtml(d.ratios.map(([n, v]) => [esc(n), esc(v)]))}</div></div>` : ''}
    ${d.growth.length ? `<div class="sec">Growth</div><div class="ggrid">${d.growth.map((g) => `<div class="panel gcard"><div class="fk">${esc(g.title)}</div>${g.rows.map(([k, v]) => `<div class="gr"><span class="mute">${esc(k.replace(/:$/, ''))}</span><span${negCls(v)}>${esc(v)}</span></div>`).join('')}</div>`).join('')}</div>` : ''}
    ${d.pros.length || d.cons.length ? `<div class="sec">Pros &amp; cons<span class="act mute">Screener's machine read</span></div><div class="panel pc">
      ${d.pros.map((x) => `<p><span class="up">▲</span> ${esc(x)}</p>`).join('')}${d.cons.map((x) => `<p><span class="down">▼</span> ${esc(x)}</p>`).join('')}</div>` : ''}`
  renderFin()
  // shareholding: the latest split, the change over a quarter and a year, the table
  const sh = d.shareholding
  if (sh) {
    const n = sh.periods.length - 1, holders = sh.rows.filter((r) => !/shareholders/i.test(r.label))
    const val = (r, i) => parseNum(String(r.values[i] ?? '').replace('%', ''))
    const pal = [T.accent, T.up, T.warning, T['muted-foreground'], T.down]
    const dd = (a, b) => a == null || b == null ? '<span class="mute">—</span>' : `<span class="${pctClass(a - b)}">${a - b >= 0 ? '+' : '−'}${fmt(Math.abs(a - b), 2)}</span>`
    $('tab-holding').innerHTML = `<div class="sec">Shareholding · ${esc(sh.periods[n])}<span class="act mute">% of shares</span></div>
      <div class="panel" style="padding:10px"><div class="breadthbar" style="height:14px;margin:0">${holders.map((r, i) => `<div style="width:${val(r, n) ?? 0}%;background:${pal[i % pal.length]}"></div>`).join('')}</div>
      <div class="legend" style="padding:8px 0 0">${holders.map((r, i) => `<span><i style="background:${pal[i % pal.length]}"></i>${esc(r.label)} ${esc(r.values[n])}</span>`).join('')}</div></div>
      <div class="panel rgrid"><span class="mute">Holder</span><span class="mute">Now</span><span class="mute">vs qtr</span><span class="mute">vs year</span>
      ${holders.map((r) => `<span>${esc(r.label)}</span><span class="b">${esc(r.values[n])}</span><span>${dd(val(r, n), val(r, n - 1))}</span><span>${dd(val(r, n), val(r, n - 4))}</span>`).join('')}</div>
      <div class="sec">Every quarter</div>${finTable(sh)}`
  } else $('tab-holding').innerHTML = '<div class="state">No shareholding pattern on Screener.</div>'
  // filings: announcements, concalls, annual reports, credit ratings - all open in the browser
  const day = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
  $('tab-filings').innerHTML = `<div class="sec">Announcements${d.allAnnouncements ? `<span class="act"><button class="pill" data-ext="${esc(d.allAnnouncements)}" data-pkg="">all on BSE</button></span>` : ''}</div>
    <div class="panel">${d.announcements.length ? d.announcements.map((a) => `<button class="li" data-ext="${esc(a.url)}" data-pkg=""><div class="grow"><div class="t1" style="white-space:normal">${esc(a.title)}</div><div class="t2" style="white-space:normal">${esc(day(a.date))}${a.detail ? ` · ${esc(a.detail)}` : ''}</div></div></button>`).join('') : '<div class="state">None recently.</div>'}</div>
    ${d.concalls.length ? `<div class="sec">Earnings calls</div><div class="panel">${d.concalls.slice(0, 12).map((c) => `<div class="li"><div class="grow t1">${esc(c.when)}</div>${c.links.map((l) => `<button class="pill" data-ext="${esc(l.url)}" data-pkg="">${esc(l.title)}</button>`).join('')}</div>`).join('')}</div>` : ''}
    ${d.reports.length ? `<div class="sec">Annual reports</div><div class="panel">${d.reports.slice(0, 8).map((r) => `<button class="li" data-ext="${esc(r.url)}" data-pkg=""><div class="grow t1">${esc(r.title)}</div><span class="chev">›</span></button>`).join('')}</div>` : ''}
    ${d.ratings.length ? `<div class="sec">Credit ratings</div><div class="panel">${d.ratings.slice(0, 6).map((r) => `<button class="li" data-ext="${esc(r.url)}" data-pkg=""><div class="grow t1" style="white-space:normal">${esc(r.title)}</div><span class="chev">›</span></button>`).join('')}</div>` : ''}
    <div class="note">Documents open in your browser (BSE, the company, rating agencies).</div>`
  $('tab-about').innerHTML = `<div class="sec">About ${esc(d.name)}</div><div class="panel prose">${esc(d.about || 'No description on Screener.')}</div>
    ${d.keyPoints ? `<div class="sec">Key points</div><div class="panel prose">${esc(d.keyPoints)}</div>` : ''}
    <div class="note">From screener.in (${basis} figures) · ${scrLink}</div>`
}
function renderFin() {
  const box = $('tab-financials'), d = sv.data; if (!box || !d) return
  const t = d[sv.fin], basis = d.standalone ? 'standalone' : 'consolidated'
  box.innerHTML = `<div class="chips">${FINS.map(([k, l]) => `<button data-fin="${k}" class="${k === sv.fin ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${!t ? '<div class="state">Not on Screener for this company.</div>' : `
    ${sv.fin === 'quarters' || sv.fin === 'annual' ? `<div class="panel mbarbox">${miniBars(t, /^(sales|revenue)/i, 'Sales')}${miniBars(t, /^net profit/i, 'Net profit')}</div>` : ''}
    ${sv.fin === 'balance' ? `<div class="panel mbarbox">${miniBars(t, /^borrowings/i, 'Borrowings')}${miniBars(t, /^reserves/i, 'Reserves')}</div>` : ''}
    ${sv.fin === 'cashflow' ? `<div class="panel mbarbox">${miniBars(t, /^cash from operating/i, 'Operating cash')}${miniBars(t, /^free cash/i, 'Free cash flow')}</div>` : ''}
    ${finTable(t, `<div class="note">₹ Cr unless marked · ${basis}${d.standalone ? ' (S = standalone)' : ''} · scroll sideways for older periods · screener.in</div>`)}`}`
  const sc = box.querySelector('.tscroll'); if (sc) sc.scrollLeft = sc.scrollWidth // newest periods first in view
}
function showStab(tab) {
  sv.tab = STABS.some(([k]) => k === tab) ? tab : 'overview'
  for (const [k] of STABS) { const el = $(`tab-${k}`); if (el) el.hidden = k !== sv.tab }
  for (const b of $('stabs')?.children || []) b.classList.toggle('on', b.dataset.stab === sv.tab)
  if (sv.tab === 'financials') { const sc = $('tab-financials')?.querySelector('.tscroll'); if (sc) sc.scrollLeft = sc.scrollWidth }
}

async function stockScreen(sym) {
  const tok = nav
  sv.sym = sym; sv.data = null; sv.meta = null
  const watching = portfolio().watch.some((w) => w.sym === sym)
  setTop({ title: sym, small: 'NSE', back: true, right: `<button class="icon${watching ? ' on' : ''}" id="wbtn" data-act="watch" data-v="${esc(sym)}" aria-label="Watchlist">${watching ? I.starOn : I.star}</button>${refreshBtn()}` })
  const wait = '<div class="state">Loading fundamentals…</div>'
  view.innerHTML = `<div class="quote" id="q"><div class="p">—</div><div class="c mute">Loading…</div></div>${chartBlock()}
    <div class="chips stabs" id="stabs">${STABS.map(([k, l]) => `<button data-stab="${k}">${l}</button>`).join('')}</div>
    <div id="tab-overview"><div id="results"></div>
      <div class="sec">Key stats</div><div class="panel"><div class="kv" id="stats">${kvHtml([['Prev close', '—'], ['Open', '—']])}</div></div>
      <div id="fund"><div class="note">Loading fundamentals…</div></div>
      <div id="sect"></div>
      <div class="sec">Research</div><div class="links" id="rl">${linksHtml(sym, null)}</div></div>
    <div id="tab-financials" hidden>${wait}</div><div id="tab-holding" hidden>${wait}</div><div id="tab-filings" hidden>${wait}</div><div id="tab-about" hidden>${wait}</div>`
  showStab(sv.tab)
  mountChart('stock', sym)
  const fundamentals = (force) => screenerFor(sym, force).then((d) => { if (tok !== nav) return; sv.data = d; renderFundamentals(sym, d) }, (e) => { if (tok === nav) renderFundamentals(sym, null, e) })
  fundamentals()
  current.refresh = (f, auto) => { chart?.load(f, auto); paint(f); if (f && !auto) fundamentals(true) } // statements move quarterly: only ⟳ re-reads them
  const paint = async (force) => {
    const [metaR, dailyR, secR] = await Promise.allSettled([
      etSearch(sym).then((hits) => hits.find((x) => (x.symbol || '').toUpperCase() === sym && x.entityType === 'company')),
      barsFor('stock', sym, '1Y', force), sectorsFor('NSE', force)])
    if (tok !== nav) return
    const hit = metaR.value, meta = hit && { id: hit.tagId, seo: hit.tagSeoName, name: hit.tagName, mcap: num(hit.marketCap) }
    const d = dailyR.value || [], last = d.at(-1), prev = d.at(-2)
    const rows = secR.value?.rows || []
    const m = meta && rows.flatMap((s) => s.members).find((x) => String(x.id) === String(meta.id))
    const s = m && rows.find((x) => x.id === m.sectorId)
    if (meta) { setSmall(esc(meta.name)); remember(sym, meta.name); $('rl').innerHTML = linksHtml(sym, meta); sv.meta = meta }
    const price = m?.price ?? last?.c, pct = m?.change_pct ?? (last && prev ? (last.c / prev.c - 1) * 100 : null)
    const chg = price != null && pct != null ? price - price / (1 + pct / 100) : null
    $('q').innerHTML = price == null
      ? `<div class="p">—</div><div class="c mute">${esc(dailyR.reason?.message || 'No quote for this symbol')}</div>`
      : `<div class="p">₹${fmt(price)}</div><div class="c ${pctClass(pct)}">${chg >= 0 ? '+' : ''}${fmt(chg)} (${pctText(pct)})</div>
        <div class="when">${m ? `ET Markets · ${esc(s?.updated || clock())}` : `Last close · Moneycontrol`}</div>`
    const yr = d.slice(-250), v20 = d.slice(-20)
    $('stats').innerHTML = kvHtml([
      ['Prev close', fmt(prev?.c)], ['Open', fmt(last?.o)], ['Day high', fmt(last?.h)], ['Day low', fmt(last?.l)],
      ['52W high', yr.length ? fmt(Math.max(...yr.map((b) => b.h))) : '—'], ['52W low', yr.length ? fmt(Math.min(...yr.map((b) => b.l))) : '—'],
      ['Volume', last?.v ? compact(last.v) : '—'], ['Avg vol (20D)', v20.length ? compact(v20.reduce((t, b) => t + (b.v || 0), 0) / v20.length) : '—'],
      ['Market cap', croreShort(m?.mcap_cr ?? meta?.mcap)], ['1Y change', yr.length > 1 ? pctSpan((yr.at(-1).c / yr[0].c - 1) * 100) : '—'],
    ])
    if (s) {
      const peers = s.members.filter((x) => x.id !== m.id).slice(0, 8)
      $('sect').innerHTML = `<div class="sec">Sector</div><div class="panel"><button class="li" data-act="opensector" data-v="${esc(s.id)}"><div class="grow"><div class="t1">${esc(s.name)}</div>
        <div class="t2">${s.members.length} stocks · mcap ${croreShort(s.mcap_cr)} · ${m.capRank ? `#${m.capRank} by mcap` : `${fmt(m.mcap_cr && s.mcap_cr ? (m.mcap_cr / s.mcap_cr) * 100 : null, 1)}% of sector`}</div></div>
        <div class="r">${pctSpan(s.change_pct)}</div><span class="chev">›</span></button></div>
        ${peers.length ? `<div class="sec">Peers</div><div class="panel">${peers.map((p) => stockRow(p)).join('')}</div>` : ''}`
    }
    endIntro()
  }
  paint()
}

// ---- Index: Moneycontrol quote + chart (the four index cards) ---------------------------------------------
async function indexScreen(code) {
  const tok = nav, meta = MC_INDICES.find((x) => x.code === code) || { code, name: code }
  setTop({ title: meta.name, small: 'Moneycontrol', back: true, right: refreshBtn() })
  view.innerHTML = `<div class="quote" id="q"><div class="p">—</div><div class="c mute">Loading…</div></div>${chartBlock()}
    <div class="sec">Today</div><div class="panel"><div class="kv" id="stats"></div></div>
    <div class="sec">Returns</div><div class="panel"><div class="kv" id="rets"></div></div>`
  mountChart('index', code)
  const paint = async (force) => {
    try {
      const q = await indexQuote(code, force); if (tok !== nav) return
      $('q').innerHTML = `<div class="p">${fmt(q.price)}</div><div class="c ${pctClass(q.change)}">${q.change >= 0 ? '+' : ''}${fmt(q.change)} (${pctText(q.change_pct)})</div><div class="when">${esc(q.state || '')} · ${esc(q.updated || '')}</div>`
      $('stats').innerHTML = kvHtml([['Open', fmt(q.open)], ['Prev close', fmt(q.prev)], ['High', fmt(q.high)], ['Low', fmt(q.low)], ['52W high', fmt(q.hi52)], ['52W low', fmt(q.lo52)],
        ...(q.advance != null ? [['Advances', `<span class="up">${q.advance}</span>`], ['Declines', `<span class="down">${q.decline}</span>`]] : [])])
      $('rets').innerHTML = kvHtml(q.returns.map(([k, v]) => [k, pctSpan(v)]))
    } catch (e) { if (tok === nav) $('q').innerHTML = `<div class="p">—</div><div class="c down">${esc(e.message)}</div>` }
    endIntro()
  }
  current.refresh = (f, auto) => { chart?.load(f, auto); paint(f) }
  paint()
}

// ---- Feed: one card per screen, 40 to a page, picked by lib.js feedPage from the sector feed --------------
// Only cards within 3 of the one on screen have content; the rest are empty, same-height slots.
const todayIST = () => new Date(Date.now() + 19800e3).toISOString().slice(0, 10)
const seenKey = () => `feed.seen.${todayIST()}`
const storedFilter = () => { const f = store.json('feed.filter', null); return filterOn(f) ? cleanFilter(f) : null }
const fd = { day: null, cards: [], page: 0, pools: null, seen: null, viewed: null, idx: 0, scrollTop: 0, done: false, filter: storedFilter() }
let feedObs = null
function feedReset() {
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k?.startsWith('feed.seen.') && k !== seenKey()) localStorage.removeItem(k) } } catch {}
  Object.assign(fd, { day: todayIST(), cards: [], page: 0, idx: 0, scrollTop: 0, done: false, viewed: new Set(store.json(seenKey(), [])) })
  // the mixed feed skips what reached the screen earlier today; a filter shows everything that matches
  fd.seen = filterOn(fd.filter) ? new Set() : new Set(fd.viewed)
}
function nextPage() { // appends the next page that has anything, or the final card
  if (filterOn(fd.filter)) {
    const r = feedFiltered(fd.pools, fd.page++, fd.seen, fd.filter)
    if (r.cards.length) fd.cards.push(...r.cards)
    else { fd.cards.push({ kind: 'final', id: 'final', filtered: true }); fd.done = true }
    return
  }
  for (;;) {
    const first = fd.page === 0, r = feedPage(fd.pools, fd.page++, fd.seen)
    if (first && portfolio().holdings.length) r.cards.splice(1, 0, { kind: 'holdings', id: 'holdings' })
    if (r.cards.length) { fd.cards.push(...r.cards); return }
    if (r.theme === 'rest') { fd.cards.push({ kind: 'final', id: 'final' }); fd.done = true; return }
  }
}
async function feedScreen() {
  const tok = nav
  setTop({ title: 'Feed', small: 'Today, one card at a time', right: `<button class="icon${filterOn(fd.filter) ? ' on' : ''}" id="ffilter" data-act="feed-filter" aria-label="Filter">${I.filter}</button>${searchBtn}${refreshBtn()}` })
  current.refresh = feedRefresh
  if (fd.day !== todayIST()) feedReset()
  view.innerHTML = '<div id="feed"></div>'
  if (!fd.cards.length) {
    $('feed').innerHTML = '<div class="state">Building your feed…</div>'
    spin(true)
    try { const [d, n] = await Promise.all([sectorsFor('NSE'), newsFor().catch(() => [])]); fd.pools = feedPools(d.rows, n); if (!fd.cards.length) nextPage() }
    catch (e) { endIntro(); if (tok === nav) { spin(false); $('feed').innerHTML = errState(`ET sectors: ${e.message}`) } return }
    if (tok !== nav) return
    spin(false)
  }
  mountFeed(); endIntro()
}
function mountFeed() {
  const box = $('feed'); if (!box) return
  box.innerHTML = ''
  feedObs?.disconnect()
  feedObs = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) setCurrent(+e.target.dataset.i) }, { root: box, threshold: 0.6 })
  addSlots(0)
  box.scrollTop = fd.scrollTop
  setCurrent(Math.round(fd.scrollTop / (box.clientHeight || 1)))
}
function addSlots(from) {
  const box = $('feed')
  for (let i = from; i < fd.cards.length; i++) {
    const el = document.createElement('section'); el.className = 'fcard'; el.dataset.i = i
    box.appendChild(el); feedObs.observe(el)
  }
}
function setCurrent(i) {
  const box = $('feed'); if (!box || !fd.cards[i]) return
  fd.idx = i
  for (const el of box.children) {
    const d = Math.abs(+el.dataset.i - i)
    if (d <= 3 && !el.dataset.on) fillCard(el)
    else if (d > 5 && el.dataset.on) { el.innerHTML = ''; delete el.dataset.on }
  }
  const c = fd.cards[i]
  if (/^(s|sec|n):/.test(c.id) && !fd.viewed.has(c.id)) { fd.viewed.add(c.id); store.set(seenKey(), JSON.stringify([...fd.viewed])) }
  setSmall(`${filterOn(fd.filter) ? `${esc(filterName(fd.filter))} · ` : ''}Card ${i + 1} of ${fd.cards.length}${fd.done ? '' : '+'}`)
}
const repaintFeed = () => { for (const el of $('feed')?.children || []) if (el.dataset.on) fillCard(el) }
function feedMore() {
  const from = fd.cards.length
  nextPage(); addSlots(from)
  const box = $('feed'); box.scrollTo({ top: from * box.clientHeight, behavior: 'smooth' })
  repaintFeed() // the end card's button changes to "more below"
}
function feedRestart() {
  store.del(seenKey()); feedReset(); nextPage(); mountFeed()
}
async function feedRefresh(force, auto) {
  spin(true)
  try { const [d, n] = await Promise.all([sectorsFor('NSE', force), newsFor(force && !auto).catch(() => fd.pools?.news || [])]); fd.pools = feedPools(d.rows, n) }
  catch (e) { toast(`ET sectors: ${e.message}`) }
  spin(false)
  if (current.name === 'feed') repaintFeed() // same cards, today's numbers
}

// ---- feed filter: a card of chips over the tab bar; Apply rebuilds the feed from the top ----------------
let fdraft = null
const userTemplates = () => cleanTemplates(store.json('feed.templates', []))
const allTemplates = () => [...userTemplates(), ...FEED_TEMPLATES]
/** A template's name when the filter is exactly one, else what it shows. */
const filterName = (f) => (filterOn(f) && allTemplates().find((t) => sameFilter(t.filter, f))?.name) || filterLabel(f)
function applyFeedFilter(f) {
  fd.filter = filterOn(f) ? cleanFilter(f) : null
  if (fd.filter) store.set('feed.filter', JSON.stringify(fd.filter)); else store.del('feed.filter')
  closeSheet(); $('ffilter')?.classList.toggle('on', !!fd.filter)
  feedReset()
  if (current.name === 'feed') { nextPage(); mountFeed() } else renderSettings()
}
const filterLabel = (f) => {
  if (!filterOn(f)) return 'Everything'
  const names = new Map((fd.pools?.sectors || []).map((x) => [x.id, x.name]))
  return [
    f.kinds?.length ? f.kinds.map((k) => FEED_KINDS.find(([v]) => v === k)?.[1]).join(', ') : '',
    f.caps?.length ? f.caps.map((c) => capWord[c]).join(', ') : '',
    f.sectors?.length ? (f.sectors.length > 2 ? `${f.sectors.length} sectors` : f.sectors.map((id) => names.get(id) || id).join(', ')) : '',
    f.minMove ? `${f.minMove}%+ moves` : '',
  ].filter(Boolean).join(' · ')
}
function openFilter() {
  fdraft = JSON.parse(JSON.stringify(fd.filter || { kinds: [], caps: [], sectors: [], minMove: 0 }))
  for (const k of ['kinds', 'caps', 'sectors']) fdraft[k] ||= []
  renderFilter(); $('sheet').classList.add('on', 'big')
}
function renderFilter() {
  const sh = $('sheet'), top = sh.scrollTop
  const chip = (fx, on, label) => `<button data-fx="${esc(fx)}" class="${on ? 'on' : ''}">${esc(label)}</button>`
  const secs = [...(fd.pools?.sectors || [])].sort((a, b) => a.name.localeCompare(b.name))
  const tpls = allTemplates()
  sh.innerHTML = `<h3>Filter your feed</h3><div class="mute" style="font-size:11px">Nothing picked in a row = all of it. ${esc(filterLabel(fdraft))}</div>
    <div class="fxh">Templates</div><div class="fchips">${tpls.map((t) => chip(`tpl:${t.id}`, sameFilter(t.filter, fdraft) && filterOn(fdraft), t.builtin ? t.name : `★ ${t.name}`)).join('')}</div>
    <div class="fxh">Show</div><div class="fchips">${FEED_KINDS.map(([k, l]) => chip(`kinds:${k}`, fdraft.kinds.includes(k), l)).join('')}</div>
    <div class="fxh">Company size</div><div class="fchips">${['large', 'mid', 'small'].map((c) => chip(`caps:${c}`, fdraft.caps.includes(c), capWord[c])).join('')}</div>
    <div class="fxh">Move at least</div><div class="fchips">${FEED_MOVES.map(([v, l]) => chip(`move:${v}`, (fdraft.minMove || 0) === v, l)).join('')}</div>
    <div class="fxh">Sectors${fdraft.sectors.length ? ` · ${fdraft.sectors.length} picked <button class="pill" data-fx="sectors-none">clear</button>` : ''}</div>
    <div class="fchips">${secs.map((x) => chip(`sectors:${x.id}`, fdraft.sectors.includes(x.id), x.name)).join('')}</div>
    <div class="note" style="padding:0 0 8px">Sizes, sectors and moves apply to stock cards; headlines are never filtered by sector.</div>
    <div class="fxh">Save these choices as a template</div>
    <div style="display:flex;gap:6px;margin:6px 0 4px"><input class="in" id="ftname" maxlength="30" placeholder="${esc(filterOn(fdraft) ? filterLabel(fdraft).slice(0, 30) : 'Pick something above first')}" autocomplete="off"><button class="btn" style="flex:none;padding:0 14px" data-fx="tsave">Save</button></div>
    <div class="btnrow fxbtns"><button class="btn" data-fx="reset">Show everything</button><button class="btn primary" data-fx="apply">Apply</button></div>`
  sh.scrollTop = top
}
function filterTap(el) {
  const [k, v] = el.dataset.fx.split(/:(.*)/s)
  if (k === 'apply' || k === 'reset') return applyFeedFilter(k === 'reset' ? null : fdraft)
  if (k === 'tpl') { const t = allTemplates().find((x) => x.id === v); if (t) fdraft = cleanFilter(t.filter) }
  else if (k === 'tsave') {
    if (!filterOn(fdraft)) return toast('Pick something first')
    const name = ($('ftname').value || filterLabel(fdraft)).trim()
    store.set('feed.templates', JSON.stringify(saveTemplate(userTemplates(), name, fdraft, `u:${Date.now().toString(36)}`)))
    toast(`Saved "${name.slice(0, 30)}"`)
  } else if (k === 'sectors-none') fdraft.sectors = []
  else if (k === 'move') fdraft.minMove = +v
  else { const list = fdraft[k]; const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); else list.push(v) }
  renderFilter()
}

// charts: at most 2 requests in flight, so a fast swipe doesn't fire twenty
const chartQueue = []; let chartsActive = 0
function queued(fn) {
  return new Promise((res, rej) => { chartQueue.push([fn, res, rej]); pumpCharts() })
}
function pumpCharts() {
  while (chartsActive < 2 && chartQueue.length) {
    const [fn, res, rej] = chartQueue.shift(); chartsActive++
    fn().then(res, rej).finally(() => { chartsActive--; pumpCharts() })
  }
}
const live = (m) => memberIndex.get(String(m.id)) || m
const liveSector = (s) => fd.pools?.byId.get(s.id) || s
const stillOn = (el, c) => el.dataset.on && fd.cards[+el.dataset.i] === c
function drawCardChart(el, c, kind, sym, range) {
  queued(() => barsFor(kind, sym, range)).then((bars) => {
    if (!stillOn(el, c)) return
    const cv = el.querySelector('.fchart canvas'); if (!cv) return
    drawChart(cv, bars, { range, type: chartType(), msg: 'No chart data' })
    const f = el.querySelector('[data-facts]')
    if (f && c.member) {
      const x = barFacts(bars, live(c.member).volume_k)
      f.innerHTML = x ? [
        x.fromHigh > -0.5 ? 'At its 6M high' : `${fmt(-x.fromHigh, 1)}% below its 6M high`,
        x.streak > 1 ? `${x.streak} up days in a row` : x.streak < -1 ? `${-x.streak} down days in a row` : '',
        x.volX >= 2 ? `<span class="acc b">${fmt(x.volX, 1)}× its usual volume</span>` : x.volX ? `${fmt(x.volX, 1)}× usual volume` : '',
      ].filter(Boolean).join(' · ') : ''
    }
  }).catch(() => { if (stillOn(el, c)) { const cv = el.querySelector('.fchart canvas'); if (cv) drawChart(cv, [], { msg: 'Chart unavailable' }) } })
}
const KICKER = { mover: (m) => (m.change_pct > 0 ? 'Top gainer' : 'Top loser'), tide: () => 'Against the tide', quiet: () => 'Big and quiet' }
function fillCard(el) {
  const c = fd.cards[+el.dataset.i]; if (!c) return
  el.dataset.on = '1'
  const card = (attrs, body) => `<div class="fin"${attrs}>${body}</div>`
  if (c.member) {
    const m = live(c.member), s = c.sector ? liveSector(c.sector) : fd.pools?.byId.get(m.sectorId)
    el.innerHTML = card(` data-member="${esc(m.id)}"`, `<div class="fk">${KICKER[c.kind](m)} · ${esc(m.sector)}</div>
      <div class="fname">${esc(m.name)}</div>
      <div class="fbig">₹${fmt(m.price)} ${pctSpan(m.change_pct)}</div>
      <div class="fstory">${esc(c.story)}</div>
      <div class="fchart"><canvas></canvas></div><div class="ffacts" data-facts>6M chart loading…</div>
      <div class="kv fkv">${kvHtml([['Market cap', croreShort(m.mcap_cr)], ['Size', `${capWord[m.cap] || '—'}${m.capRank ? ` · #${m.capRank}` : ''}`],
        ['Volume', m.volume_k == null ? '—' : `${compact(m.volume_k * 1000)}`], ['Sector today', s ? pctSpan(s.change_pct) : '—']])}</div>
      <div class="links fl" data-links>${memberLinks(m, null, 'Finding NSE symbol…')}</div>`)
    symFor(m).then((sym) => {
      if (!stillOn(el, c)) return
      el.querySelector('[data-links]').innerHTML = memberLinks(m, sym, 'No NSE symbol found')
      if (sym) drawCardChart(el, c, 'stock', sym, '6M')
      else el.querySelector('[data-facts]').textContent = ''
    })
  } else if (c.kind === 'index') {
    const name = MC_INDICES.find((x) => x.code === c.code)?.name || c.code
    el.innerHTML = card(` data-push="index/${encodeURIComponent(c.code)}"`, `<div class="fk">Index · today</div><div class="fname">${esc(name)}</div>
      <div class="fbig" data-q>—</div><div class="fstory" data-s>Loading…</div><div class="fchart"><canvas></canvas></div>
      <div class="kv fkv" data-kv></div><div class="links fl"><button class="go primary" style="grid-column:span 2" data-push="index/${encodeURIComponent(c.code)}">Open ${esc(name)}<span>chart, stats, returns</span></button></div>`)
    indexQuote(c.code).then((q) => {
      if (!stillOn(el, c)) return
      el.querySelector('[data-q]').innerHTML = `${fmt(q.price)} ${pctSpan(q.change_pct)}`
      el.querySelector('[data-s]').innerHTML = `${q.change >= 0 ? '+' : ''}${fmt(q.change)} today${q.advance != null ? ` · <span class="up">${q.advance} up</span> / <span class="down">${q.decline} down</span>` : ''} · ${esc((q.state || '').toLowerCase())}`
      el.querySelector('[data-kv]').innerHTML = kvHtml([['Day range', `${fmt(q.low)} – ${fmt(q.high)}`], ['52W range', `${fmt(q.lo52)} – ${fmt(q.hi52)}`], ...q.returns.filter(([k]) => k === '1M' || k === '1Y').map(([k, v]) => [`${k} return`, pctSpan(v)])])
    }).catch((e) => { if (stillOn(el, c)) el.querySelector('[data-s]').textContent = e.message })
    drawCardChart(el, c, 'index', c.code, '1D')
  } else if (c.kind === 'breadth') {
    const ss = fd.pools?.sectors || [], s = sectorSummary(ss), tot = s.advance + s.decline || 1
    el.innerHTML = card('', `<div class="fk">Market breadth · NSE</div><div class="fname">${s.up} of ${ss.length} sectors up</div>
      <div class="fbig"><span class="up">${s.advance.toLocaleString('en-IN')} ▲</span> <span class="down">${s.decline.toLocaleString('en-IN')} ▼</span></div>
      <div class="breadthbar" style="height:12px"><div style="width:${(s.advance / tot) * 100}%;background:var(--up)"></div><div style="width:${(s.decline / tot) * 100}%;background:var(--down)"></div></div>
      <div class="fstory">${s.best ? `Best: ${esc(s.best.name)} ${pctSpan(s.best.change_pct)}` : ''}${s.worst ? ` · Worst: ${esc(s.worst.name)} ${pctSpan(s.worst.change_pct)}` : ''}</div>
      <div class="tiles ftiles">${sortRows(ss, 'mcap:desc', SECTOR_FIELDS).map((x) => `<button class="tile" data-act="opensector" data-v="${esc(x.id)}" style="flex-grow:${Math.sqrt(Math.max(x.mcap_cr ?? 1, 1))};${tileStyle(x.change_pct)}"><p>${esc(x.name)}</p><p>${pctText(x.change_pct)}</p></button>`).join('')}</div>`)
  } else if (c.kind === 'sector') {
    const s = liveSector(c.sector), bc = bucketColors(T)
    const r = s.members.filter((m) => m.change_pct != null).sort((a, b) => b.change_pct - a.change_pct)
    const row = (m) => stockRow(live(m))
    el.innerHTML = card('', `<div class="fk">Sector · ${s.members.length} stocks</div><div class="fname">${esc(s.name)}</div>
      <div class="fbig">${pctSpan(s.change_pct)}</div><div class="fstory">${esc(c.story)}</div>
      <div class="breadth">${bucketShares(s.buckets || [0, 0, 0, 0, 0]).map((x, i) => x > 0 ? `<div style="width:${x}%;background:${bc[i]}"></div>` : '').join('')}</div>
      <div class="tiles ftiles">${s.members.slice(0, 30).map((m) => `<button class="tile" data-member="${esc(m.id)}" style="flex-grow:${Math.sqrt(Math.max(m.mcap_cr ?? 1, 1))};${tileStyle(m.change_pct)}"><p>${esc(m.name)}</p><p>${pctText(m.change_pct)}</p></button>`).join('')}</div>
      <div class="panel flist">${r.slice(0, 2).map(row).join('')}${r.length > 3 ? r.slice(-2).map(row).join('') : ''}</div>
      <div class="links fl"><button class="go primary" style="grid-column:span 2" data-act="opensector" data-v="${esc(s.id)}">Open in Sectors<span>every member, sorts, breadth</span></button></div>`)
  } else if (c.kind === 'size') {
    const max = Math.max(0.5, ...c.sizes.map((x) => Math.abs(x.avg ?? 0)))
    const small = c.sizes.find((x) => x.cap === 'small'), large = c.sizes.find((x) => x.cap === 'large')
    el.innerHTML = card('', `<div class="fk">By size · average move</div><div class="fname">Small vs large caps</div>
      <div class="fstory">Small caps ${pctSpan(small?.avg)} vs large caps ${pctSpan(large?.avg)} on average</div>
      <div class="fsizes">${c.sizes.map((x) => `<div class="fsz"><div class="b">${capWord[x.cap]}<span class="mute"> · ${x.n} stocks</span></div>
        <div class="changebar" style="height:14px"><div class="mid"></div><div class="fill" style="width:${(Math.abs(x.avg ?? 0) / max) * 50}%;${(x.avg ?? 0) >= 0 ? 'left:50%;background:var(--up)' : 'right:50%;background:var(--down)'}"></div></div>
        <div class="fbig" style="font-size:18px">${pctSpan(x.avg)}</div></div>`).join('')}</div>
      <div class="note" style="padding:0">Large = top 100 by market cap, mid = 101–250, small = the rest (₹500 Cr and up).</div>`)
  } else if (c.kind === 'holdings') {
    const t = hd.val?.total, rows = (hd.val?.rows || []).filter((r) => r.day != null).sort((a, b) => b.day - a.day)
    if (!hd.val) priceHoldings().then(() => { if (stillOn(el, c)) fillCard(el) })
    el.innerHTML = card(' data-tab="holdings"', `<div class="fk">Your holdings · on this phone</div><div class="fname">${t ? inr(t.value) : 'Pricing…'}</div>
      <div class="fbig">${t ? `<span class="${pctClass(t.day)}">${sinr(t.day)}</span> <span style="font-size:15px">${pctSpan(t.dayPct)} today</span>` : ''}</div>
      <div class="fstory">${t ? `P&amp;L <span class="${pctClass(t.pnl)}">${sinr(t.pnl)} (${pctText(t.pnlPct)})</span> on ${inr(t.invested)} invested` : ''}</div>
      <div class="panel flist">${[...rows.slice(0, 2), ...rows.slice(-2).filter((r) => r.day < 0 && !rows.slice(0, 2).includes(r))].map((r) =>
        `<div class="li"><div class="grow"><div class="t1">${esc(r.sym)}</div><div class="t2">${pctSpan(r.dayPct)}</div></div><div class="r b ${pctClass(r.day)}">${sinr(r.day)}</div></div>`).join('')}</div>
      <div class="links fl" style="margin-top:auto"><button class="go primary" style="grid-column:span 2" data-tab="holdings">Open Holdings<span>alerts, notifications, every position</span></button></div>`)
  } else if (c.kind === 'news') {
    const n = c.news, desc = n.desc && n.desc.length > 240 ? `${n.desc.slice(0, 237)}…` : n.desc
    el.innerHTML = card(` data-ext="${esc(n.link)}" data-pkg=""`, `<div class="fk">Headline · ET ${esc(n.source)}${n.time ? ` · ${ago(n.time)}` : ''}</div>
      ${n.img ? `<div class="fimg"><img src="${esc(n.img)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></div>` : ''}
      <div class="fname">${esc(n.title)}</div><div class="fstory mute">${esc(desc || '')}</div>
      <div class="links fl" style="margin-top:auto"><button class="go primary" style="grid-column:span 2" data-ext="${esc(n.link)}" data-pkg="">Read on ET Markets<span>opens in the browser</span></button></div>`)
  } else if (c.kind === 'end') {
    const s = sectorSummary(fd.pools?.sectors || []), last = +el.dataset.i === fd.cards.length - 1
    el.innerHTML = card(' style="justify-content:center;text-align:center"', `<div class="fk">${c.page === 0 ? 'Caught up' : esc(c.label)}</div>
      <div class="fname" style="font-size:24px">${c.page === 0 ? 'You\'re caught up' : `${esc(c.label)}: done`}</div>
      <div class="fstory">You saw ${c.shown} cards${c.news ? ` and ${c.news} headlines` : ''} · <span class="up">${c.up} up</span> · <span class="down">${c.down} down</span>${c.sectors ? ` · ${c.sectors} sectors` : ''}</div>
      <div class="fstory mute">Today: <span class="up">${s.advance} ▲</span> <span class="down">${s.decline} ▼</span> · ${s.up} of ${(fd.pools?.sectors || []).length} sectors up${s.best ? ` · best ${esc(s.best.name)} ${pctSpan(s.best.change_pct)}` : ''}</div>
      <div class="btnrow" style="flex-direction:column;padding:12px 0 0"><button class="btn primary" data-act="feed-top">Back to top</button>
      ${last ? `<button class="btn" data-act="feed-more">Show more: ${esc(c.next)}</button>` : '<div class="mute">More below ↓</div>'}</div>`)
  } else if (c.kind === 'final' && c.filtered) {
    const none = fd.cards.length === 1
    el.innerHTML = card(' style="justify-content:center;text-align:center"', `<div class="fk">Your filter · ${esc(filterName(fd.filter))}</div>
      <div class="fname" style="font-size:22px">${none ? 'Nothing matches this filter right now' : 'That\'s everything matching your filter'}</div>
      <div class="btnrow" style="flex-direction:column;padding:12px 0 0">${none ? '' : '<button class="btn primary" data-act="feed-top">Back to top</button>'}
      <button class="btn${none ? ' primary' : ''}" data-act="feed-filter">Change filter</button><button class="btn" data-act="feed-clear">Clear filter</button></div>`)
  } else if (c.kind === 'final') {
    el.innerHTML = card(' style="justify-content:center;text-align:center"', `<div class="fk">End of today</div>
      <div class="fname" style="font-size:22px">That's every stock that moved today</div>
      <div class="fstory mute">${fd.viewed.size} cards seen. Tomorrow's feed starts fresh.</div>
      <div class="btnrow" style="flex-direction:column;padding:12px 0 0"><button class="btn primary" data-act="feed-top">Back to top</button><button class="btn" data-act="feed-restart">Start today's feed over</button></div>`)
  }
}

// ---- Holdings: kept in portfolio.json on the phone (MainActivity / PortfolioJob), valued live --------------
// The page owns portfolio.json; the background job reads it every 15 minutes for notifications and alerts
// and keeps its own portfolio_state.json, which the page only reads (alert status, history).
const hd = { pf: null, val: null, prices: new Map(), review: null, sort: store.get('holdings.sort', 'value:desc'), del: null, form: null, alert: null,
  sel: store.get('holdings.pf', 'all') } // the portfolio on screen: 'all' or a portfolio id
const pfName = (id) => portfolio().portfolios.find((p) => p.id === id)?.name || 'My portfolio'
const selPf = () => { const pf = portfolio(); if (hd.sel !== 'all' && !pf.portfolios.some((p) => p.id === hd.sel)) hd.sel = 'all'; return hd.sel }
/** Values for the portfolio on screen (hd.val is always every portfolio - the feed card, the widget's view). */
const shownVal = () => !hd.val ? null : selPf() === 'all' ? hd.val : valuePortfolio(inPortfolio(portfolio().holdings, hd.sel), priceOf)
const inr = (v, d = 0) => v == null || Number.isNaN(v) ? '—' : `${v < 0 ? '−' : ''}₹${fmt(Math.abs(v), d)}`
const sinr = (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}${inr(v)}`
const qtyText = (q) => Number.isInteger(q) ? q.toLocaleString('en-IN') : fmt(q, 3)
function portfolio() {
  if (!hd.pf) {
    let raw = null
    try { raw = JSON.parse(window.Native ? Native.readFile('portfolio.json') : store.get('portfolio.dev', 'null')) } catch {}
    hd.pf = cleanPortfolio(raw)
  }
  return hd.pf
}
function savePortfolio(pf) {
  hd.pf = cleanPortfolio(pf)
  hd.val = hd.val ? valuePortfolio(hd.pf.holdings, priceOf) : null // revalue from the prices already loaded
  const text = JSON.stringify(hd.pf)
  // Native.savePortfolio answers "" when saved, else why not (an older build answered true / false)
  let err = ''
  try {
    const r = window.Native ? Native.savePortfolio(text) : (store.set('portfolio.dev', text), '')
    err = r === true || r === '' || r == null ? '' : r === false ? 'unknown error' : String(r)
  } catch (e) { err = e?.message || String(e) }
  if (err) toast(`Could not save on the phone: ${err}`)
  return !err
}
const jobState = () => { try { return JSON.parse(window.Native?.readFile('portfolio_state.json') || '{}') } catch { return {} } }
/** Live { price, prev, sector } for a holding: ET's sector feed when it carries the company, else the last
 *  two Moneycontrol daily closes (ETFs, SME stocks). */
const priceOf = (h) => {
  const m = h.et && memberIndex.get(String(h.et))
  if (m && m.price != null) return { price: m.price, prev: m.change_pct != null ? m.price / (1 + m.change_pct / 100) : null, sector: m.sector }
  return hd.prices.get(h.sym)
}
async function priceHoldings(force) {
  const pf = portfolio()
  try { await sectorsFor('NSE', force) } catch {}
  const today = todayIST()
  const all = [...pf.holdings, ...pf.watch.filter((w) => !pf.holdings.some((h) => h.sym === w.sym))]
  await Promise.all(all.filter((h) => h.kind === 'mf' || !(h.et && memberIndex.get(String(h.et)))).map((h) => h.kind === 'mf'
    ? mfNavFor(h.code, force).then((p) => hd.prices.set(h.sym, p)).catch(() => {})
    : queued(() => barsFor('stock', h.sym, '1M', force)).then((bars) => {
      const last = bars.at(-1), prior = bars.at(-2)
      if (!last) return
      const lastDay = new Date((last.t + 19800) * 1000).toISOString().slice(0, 10)
      hd.prices.set(h.sym, { price: last.c, prev: lastDay === today ? prior?.c ?? null : last.c })
    }).catch(() => {})))
  hd.val = valuePortfolio(pf.holdings, priceOf)
  return hd.val
}

function holdingsScreen() {
  setTop({ title: 'Holdings', small: 'On this phone only', right: `<button class="icon" data-push="search" aria-label="Search">${I.search}</button><button class="icon" data-h="add" aria-label="Add a stock">${I.plus}</button>${refreshBtn()}` })
  current.refresh = loadHoldings
  renderHoldings(); loadHoldings(); endIntro()
}
async function loadHoldings(force) {
  const pf = portfolio()
  if (!pf.holdings.length && !pf.watch.length) return
  spin(true)
  await priceHoldings(force)
  spin(false)
  if (current.name === 'holdings' && !hd.review && !sheetOn()) renderHoldings()
  resolveScr().then(() => loadFilings(force))
}

// ---- filings & events for what you hold or watch (Screener's per-company announcements) ----
const hdF = { list: null }
const filingsFor = (scr, force) => cached(`fil:${scr}`, 30 * 60e3, async () => {
  const r = await nget(`https://www.screener.in/announcements/recent/${encodeURIComponent(scr)}/`)
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`)
  const doc = new DOMParser().parseFromString(r.body, 'text/html'), sq = (t) => (t || '').replace(/\s+/g, ' ').trim()
  return [...doc.querySelectorAll('li')].map((li) => {
    const a = li.querySelector('a'), href = a?.getAttribute('href') || ''
    return { title: sq(a?.childNodes[0]?.textContent), detail: sq(a?.querySelector('div')?.textContent).replace(/^[^-]*-\s*/, ''),
      date: li.querySelector('time')?.getAttribute('datetime') || null, url: /^https:\/\//.test(href) ? href : null }
  }).filter((x) => x.title && x.url)
}, force)
async function loadFilings(force) {
  const pf = portfolio(), seen = new Set(), out = []
  const targets = [...pf.holdings, ...pf.watch].filter((h) => h.scr && h.kind !== 'mf' && !seen.has(h.scr) && seen.add(h.scr))
  await Promise.all(targets.map((h) => queued(() => filingsFor(h.scr, force)).then((list) => {
    for (const f of list) { const kind = filingKind(`${f.title} ${f.detail}`); if (kind) out.push({ ...f, sym: h.sym, kind }) }
  }).catch(() => {})))
  hdF.list = out.sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 20)
  if (current.name === 'holdings' && !hd.review && !sheetOn()) renderHoldings()
}
/** Screener's company id for each stock you hold or watch (its filings are keyed by it), once each. */
let scrBusy = false
async function resolveScr() {
  if (scrBusy) return
  scrBusy = true
  try {
    const pf = portfolio()
    let changed = false
    for (const h of [...pf.holdings, ...pf.watch]) {
      if (h.scr || h.kind === 'mf') continue
      const hits = await queued(() => getJson(`https://www.screener.in/api/company/search/?q=${encodeURIComponent(h.sym)}&v=3&fts=1`)).catch(() => [])
      const hit = (Array.isArray(hits) ? hits : []).find((x) => x.id && String(x.url || '').toUpperCase().startsWith(`/COMPANY/${h.sym}/`))
      if (hit) { h.scr = String(hit.id); changed = true }
    }
    if (changed) savePortfolio(pf)
  } finally { scrBusy = false }
}
const filingsHtml = () => {
  const pf = portfolio()
  if (!pf.holdings.some((h) => h.kind !== 'mf') && !pf.watch.length) return ''
  return `<div class="sec">Filings &amp; events<span class="act mute">your stocks · Screener</span></div>
    <div class="panel">${hdF.list == null ? '<div class="state" style="padding:14px">Loading…</div>' : hdF.list.length
    ? hdF.list.map((f) => `<button class="li" data-ext="${esc(f.url)}" data-pkg=""><div class="grow"><div class="t1">${esc(f.sym)} · ${esc(f.kind)}</div>
      <div class="t2" style="white-space:normal">${esc(f.title)}${f.date ? ` · ${esc(new Date(f.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }))}` : ''}</div></div><span class="chev">›</span></button>`).join('')
    : '<div class="state" style="padding:14px">No results, board meetings, dividends or similar filings lately.</div>'}</div>`
}
const watchHtml = () => {
  const pf = portfolio()
  if (!pf.watch.length) return `<div class="sec">Watchlist</div><div class="note">Tap ☆ on any stock's page to follow it here - with price alerts and its filings below.</div>`
  return `<div class="sec">Watchlist<span class="act mute">${pf.watch.length}</span></div><div class="panel">${pf.watch.map((w) => {
    const p = priceOf(w), pct = p?.price != null && p.prev ? (p.price / p.prev - 1) * 100 : null
    return `<div class="li"><div class="grow" data-push="stock/${encodeURIComponent(w.sym)}"><div class="t1">${esc(w.sym)}</div><div class="t2">${esc(w.name)}</div></div>
      <div class="r" data-push="stock/${encodeURIComponent(w.sym)}"><div class="b">${p?.price != null ? `₹${fmt(p.price)}` : '—'}</div><div class="t2">${pctSpan(pct)}</div></div><button class="pill" data-h="unwatch:${esc(w.sym)}">×</button></div>`
  }).join('')}</div>`
}
function toggleWatch(sym, name, et) {
  const pf = portfolio(), on = pf.watch.some((w) => w.sym === sym)
  savePortfolio({ ...pf, watch: on ? pf.watch.filter((w) => w.sym !== sym) : [...pf.watch, { sym, name: name || sym, et: et || null }] })
  toast(on ? `${sym} removed from your watchlist` : `${sym} added to your watchlist (Holdings tab)`)
  return !on
}
const H_SORTS = [['value:desc', 'Value'], ['pnl:desc', 'P&L ₹'], ['pnlPct:desc', 'P&L %'], ['dayPct:desc', 'Today %'], ['dayPct:asc', 'Today % (losers)'], ['sym:asc', 'Symbol A → Z']]
const ALERT_TEXT = (a) => {
  const k = ALERT_KINDS.find(([x]) => x === a.kind)
  return `${a.pf ? `${pfName(a.pf)}: ` : ''}${k[1]}${a.sym ? ` · ${a.sym}` : ''} ${k[2] === '%' ? `${a.value}%` : inr(a.value, a.kind.startsWith('p') ? 2 : 0)}`
}
/** The portfolio switcher: All, each portfolio, Manage. */
const pfBar = () => {
  const pf = portfolio()
  return `<div class="chips pfbar">${[['all', 'All'], ...pf.portfolios.map((p) => [p.id, p.name])].map(([id, n]) =>
    `<button data-h="pfsel:${esc(id)}" class="${selPf() === id ? 'on' : ''}">${esc(n)}${id === 'all' ? '' : ` <span class="mute">${inPortfolio(pf.holdings, id).length}</span>`}</button>`).join('')}
    <button data-h="pfmanage">+ / manage</button></div>`
}
function pfManage() {
  const pf = portfolio()
  $('sheet').innerHTML = `<h3>Portfolios</h3><div class="mute" style="font-size:11px">Keep yours, family's or a strategy's holdings apart. "All" adds them up; alerts can watch one or all.</div>
    <div class="panel" style="margin:8px 0">${pf.portfolios.map((p) => `<div class="li"><input class="in" data-pfname="${esc(p.id)}" value="${esc(p.name)}" maxlength="30">
      <span class="mute" style="flex:none">${inPortfolio(pf.holdings, p.id).length}</span>
      ${p.id === 'main' ? '' : `<button class="pill" data-h="pfdel:${esc(p.id)}">${hd.del === `pf:${p.id}` ? 'tap again' : 'delete'}</button>`}</div>`).join('')}</div>
    <div class="fxh">New portfolio</div><div style="display:flex;gap:6px;margin:6px 0"><input class="in" id="pfnew" maxlength="30" placeholder="e.g. Family, Long term, Trading"><button class="btn" style="flex:none;padding:0 14px" data-h="pfadd">Add</button></div>
    <div class="note" style="padding:0 0 8px">Deleting a portfolio moves its holdings into ${esc(pfName('main'))}; nothing is lost. Names save as you type.</div>
    <div class="btnrow fxbtns"><button class="btn primary" data-h="close">Done</button></div>`
  $('sheet').classList.add('on', 'big')
}
function renderHoldings() {
  if (current.name !== 'holdings') return
  if (hd.review) return renderReview()
  const pf = portfolio(), top = window.scrollY
  setSmall(pf.holdings.length ? `${selPf() === 'all' ? `${pf.holdings.length} holdings` : esc(pfName(hd.sel))} · on this phone only` : 'On this phone only')
  if (!pf.holdings.length) {
    view.innerHTML = `<div class="panel" style="margin-top:12px;padding:14px"><div class="fname">Your holdings, live</div>
      <div class="fstory" style="margin:6px 0 12px">Add what you hold once - symbol, quantity, buy price. The app values it live, sends an update at the open, every hour and at the close, and warns you when your own limits are hit. Nothing leaves this phone; there is no broker login.</div>
      <div class="links fl"><button class="go primary" data-h="add">Add a stock<span>search, quantity, price</span></button><button class="go" data-h="upload">Upload CSV / Excel<span>from your broker</span></button>
      <button class="go" data-h="paste">Paste rows<span>"TCS 10 3450"</span></button><button class="go" data-h="cas">Import CAS PDF<span>password-protected, read on the phone</span></button>
      <button class="go" data-h="restore" style="grid-column:span 2">Restore a backup<span>Stoklore .json</span></button></div></div>
      ${watchHtml()}${filingsHtml()}
      <div class="note">CAS: the consolidated account statement from CDSL, NSDL, CAMS or KFintech - every stock, ETF and fund across your brokers. It's opened on this phone with its password (usually your PAN); neither is kept. CSV: any broker's holdings export works when it has a symbol (or name) column and a quantity column; the average / buy price column is used when there. Zerodha: Console → Portfolio → Holdings → Download → CSV. Groww, Dhan, Upstox: Holdings → Download. Excel files: save as CSV first.</div>`
    return window.scrollTo(0, 0)
  }
  const v = shownVal(), t = v?.total, st = jobState(), mine = inPortfolio(pf.holdings, selPf()), multi = pf.portfolios.length > 1
  const rows = v ? sortRows(v.rows, hd.sort, { value: (r) => r.value, pnl: (r) => r.pnl, pnlPct: (r) => r.pnlPct, dayPct: (r) => r.dayPct, sym: (r) => r.sym }) : mine
  const dayRows = (v?.rows || []).filter((r) => r.day != null && Math.abs(r.day) >= 1).sort((a, b) => b.day - a.day)
  const ups = dayRows.filter((r) => r.day > 0).slice(0, 3), downs = dayRows.filter((r) => r.day < 0).slice(-3).reverse()
  const bySector = new Map()
  for (const r of v?.rows || []) if (r.value != null) bySector.set(r.sector || 'Other', (bySector.get(r.sector || 'Other') || 0) + r.value)
  const alloc = [...bySector].sort((a, b) => b[1] - a[1]), allocTop = alloc.slice(0, 7)
  if (alloc.length > 7) allocTop.push(['Other', alloc.slice(7).reduce((s, x) => s + x[1], 0)])
  const palette = [T.accent, T.up, T.warning, T.down, T['muted-foreground'], T.foreground, T.border, T.input]
  const notify = pf.notify, perm = window.Native ? Native.notifyState() : 'off', astate = st.alerts || {}
  view.innerHTML = `${multi ? pfBar() : ''}${!mine.length ? `<div class="panel" style="margin-top:10px;padding:14px"><div class="t1">Nothing in ${esc(pfName(hd.sel))} yet</div>
      <div class="links fl" style="margin-top:10px"><button class="go primary" data-h="add">Add a stock</button><button class="go" data-h="upload">Upload CSV / Excel</button><button class="go" data-h="paste">Paste rows</button><button class="go" data-h="cas">Import CAS PDF</button></div></div>` : ''}
    <div class="panel hsum"${mine.length ? '' : ' hidden'}>
      <div class="fk">${multi ? `${esc(selPf() === 'all' ? 'All portfolios' : pfName(hd.sel))} · ` : ''}Current value${t?.missing ? ` · ${t.missing} without a price` : ''}</div>
      <div class="fbig">${t ? inr(t.value) : '…'}</div>
      <div class="kv">${kvHtml([['Today', t ? `<span class="${pctClass(t.day)}">${sinr(t.day)} (${pctText(t.dayPct)})</span>` : '…'],
        ['P&L', t ? `<span class="${pctClass(t.pnl)}">${sinr(t.pnl)} (${pctText(t.pnlPct)})</span>` : '…'],
        ['Invested', t ? inr(t.invested) : '…'], ['Holdings', mine.length]])}</div></div>
    ${multi ? '' : `<div class="note" style="padding:6px 10px 0">Keep family's or a strategy's holdings apart: <button class="pill" data-h="pfmanage">add a portfolio</button></div>`}
    ${ups.length || downs.length ? `<div class="sec">Today's movers</div><div class="panel">${[...ups, ...downs].map((r) => `<button class="li" ${r.kind === 'mf' ? `data-h="hold:${esc(r.id)}"` : `data-push="stock/${encodeURIComponent(r.sym)}"`}><div class="grow"><div class="t1">${esc(r.sym)}</div><div class="t2">${pctSpan(r.dayPct)}</div></div><div class="r ${pctClass(r.day)} b">${sinr(r.day)}</div></button>`).join('')}</div>` : ''}
    ${allocTop.length && t?.value ? `<div class="sec">By sector</div><div class="panel" style="padding:10px"><div class="breadthbar" style="height:12px;margin:0">${allocTop.map(([, x], i) => `<div style="width:${(x / t.value) * 100}%;background:${palette[i % palette.length]}"></div>`).join('')}</div>
      <div class="legend" style="padding:8px 0 0">${allocTop.map(([n, x], i) => `<span><i style="background:${palette[i % palette.length]}"></i>${esc(n)} ${fmt((x / t.value) * 100, 1)}%</span>`).join('')}</div></div>` : ''}
    <div class="sec">Holdings<span class="act"><select class="sel" data-sort="hsort">${H_SORTS.map(([k, l]) => `<option value="${k}"${k === hd.sort ? ' selected' : ''}>${l}</option>`).join('')}</select></span></div>
    <div class="panel">${rows.map((r) => {
      const held = heldFor(r.date)
      return `<button class="li" data-h="hold:${esc(r.id)}"><div class="grow"><div class="t1">${r.kind === 'mf' ? '<span class="pill" style="margin:0 4px 0 0">MF</span>' : ''}${esc(r.kind === 'mf' ? r.name : r.sym)} <span class="mute" style="font-weight:400">${qtyText(r.qty)} × ${r.avg != null ? `₹${fmt(r.avg)}` : '—'}</span></div>
        <div class="t2">${multi && selPf() === 'all' ? `${esc(pfName(r.pf))} · ` : ''}${esc(r.name)}${held ? ` · ${held.text}${held.long ? ' <span class="pill">LT</span>' : ''}` : ''}</div></div>
        <div class="r"><div class="b">${r.value != null ? inr(r.value) : '—'}</div><div class="t2">${r.pnl != null ? `<span class="${pctClass(r.pnl)}">${sinr(r.pnl)}</span>` : ''}${r.dayPct != null ? ` · ${pctSpan(r.dayPct)}` : ''}</div></div></button>`
    }).join('')}</div>
    ${watchHtml()}${filingsHtml()}
    <div class="sec">Alerts<span class="act"><button class="pill" data-h="alert">+ add</button></span></div>
    <div class="panel">${pf.alerts.length ? pf.alerts.map((a) => {
      const s = astate[a.id], status = !s ? 'Watching from the next check' : s.done ? 'Fired · done' : s.armed === false ? 'Fired · re-arms when it moves back' : 'Watching'
      return `<div class="li"><div class="grow"><div class="t1" style="white-space:normal">${esc(ALERT_TEXT(a))}</div><div class="t2">${status}${s?.last ? ` · last ${ago(s.last)}` : ''} · ${a.repeat ? 'every time' : 'once'}</div></div><button class="pill" data-h="adel:${esc(a.id)}">remove</button></div>`
    }).join('') : '<div class="state" style="padding:16px">No alerts. Add one: "tell me if my holdings fall to ₹1,08,000", "don\'t let me give back more than ₹10,000 of profit", "any stock down 5% today".</div>'}</div>
    ${(st.log || []).length ? `<div class="note" style="padding-top:6px">Last alert: ${esc(st.log.at(-1).msg)} (${ago(st.log.at(-1).t)})</div>` : ''}
    <div class="sec">Notifications</div>
    <div class="btnrow"><div class="seg full">${NOTIFY.map(([k, l]) => `<button data-h="notify:${k}" class="${notify === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="panel"><div class="li"><div class="grow"><div class="t1">${perm === 'on' ? 'Notifications are on' : 'Notifications are off for Stoklore'}</div>
      <div class="t2">${notify === 'off' ? 'Only alerts will notify you' : 'Open (09:20), ' + (notify === 'hourly' ? 'every hour, ' : notify === '2h' ? 'every 2 hours, ' : '') + 'close (15:35), trading days'}</div></div>
      ${perm === 'on' ? '' : '<button class="pill" data-h="perm">allow</button>'}</div>
      <div class="li"><div class="grow"><div class="t1">Filings &amp; results alerts</div><div class="t2" style="white-space:normal">Results, board meetings, dividends, splits… for stocks you hold or watch, checked every 2 hours</div></div>
      <button class="pill" data-h="filings">${pf.filings ? 'on' : 'off'}</button></div></div>
    <div class="btnrow" style="padding-top:8px"><button class="btn" data-h="now">Send one now</button><button class="btn" data-h="battery">Run on time</button></div>
    <div class="note">Android checks every 15 minutes at best and can run late when the phone is idle; "Run on time" opens battery settings - set Stoklore to Unrestricted. Alerts are a nudge to look, not a stop-loss.</div>
    <div class="sec">Manage</div>
    <div class="btnrow"><button class="btn" data-h="upload">Upload CSV / Excel</button><button class="btn" data-h="paste">Paste rows</button></div>
    <div class="btnrow"><button class="btn" data-h="cas">Import CAS PDF</button></div>
    <div class="btnrow"><button class="btn" data-h="export">Export backup</button><button class="btn" data-h="clear">${hd.del === 'all' ? 'Tap again: delete' : selPf() === 'all' ? 'Delete all' : `Delete all in ${esc(pfName(hd.sel))}`}</button></div>`
  window.scrollTo(0, top)
}

// ---- adding by hand: search ET, then quantity, price, date ----
function holdForm(h) {
  hd.form = h ? { ...h } : { sym: null, name: null, et: null, qty: null, avg: null, date: null, pf: selPf() === 'all' ? 'main' : hd.sel }
  renderForm(); $('sheet').classList.add('on', 'big')
}
function renderForm() {
  const f = hd.form, mf = f.kind === 'mf'
  $('sheet').innerHTML = `<h3>${f.id ? `Edit ${esc(f.sym)}` : 'Add a stock'}</h3>
    ${f.id ? `<div class="mute">${esc(f.name)}</div>` : `<div class="fxh">Stock</div>
    <input class="in hin" id="hq" placeholder="Company, NSE symbol, ETF or mutual fund" autocomplete="off" spellcheck="false" value="${esc(f.sym && !mf ? `${f.sym}` : '')}">
    <div id="hres" class="hres">${f.sym ? `<div class="mute">Picked: <b>${esc(mf ? 'Mutual fund' : f.sym)}</b> · ${esc(f.name)}</div>` : ''}</div>`}
    ${portfolio().portfolios.length > 1 ? `<div class="fxh">Portfolio</div><div class="fchips">${portfolio().portfolios.map((p) => `<button data-h="fpf:${esc(p.id)}" class="${(f.pf || 'main') === p.id ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div>` : ''}
    <div class="fxh">${mf ? 'Units' : 'Quantity'}</div><input class="in hin" id="hqty" inputmode="decimal" value="${f.qty ?? ''}" placeholder="${mf ? 'e.g. 1234.567' : 'e.g. 10'}">
    <div class="fxh">${mf ? 'Average NAV / cost per unit (₹)' : 'Average buy price (₹)'}</div><input class="in hin" id="havg" inputmode="decimal" value="${f.avg ?? ''}" placeholder="e.g. 3450.50">
    <div class="fxh">Buy date (optional - for holding period and long-term status)</div><input class="in hin" id="hdate" type="date" value="${f.date || ''}">
    <div class="btnrow fxbtns"><button class="btn" data-h="close">Cancel</button><button class="btn primary" data-h="save">Save</button></div>`
}
let hqTimer = 0
async function holdSearch(q) {
  const box = $('hres'); if (!box) return
  if (!q.trim()) { box.innerHTML = ''; return }
  try {
    const Q = q.trim()
    const [et, sym, funds] = await Promise.all([etSearch(Q).catch(() => []), symbolHit(Q), Q.length >= 3 ? mfSearch(Q).catch(() => []) : []])
    const hits = et.filter((x) => x.entityType === 'company' && x.symbol).slice(0, 6)
    if ($('hq')?.value !== q) return
    const rows = [
      ...(sym && !hits.some((x) => x.symbol.toUpperCase() === sym) ? [`<button class="li" data-h="pick:${esc(sym)}||${esc(sym)}"><div class="grow"><div class="t1">${esc(sym)}</div><div class="t2">ETF / exchange symbol · priced from Moneycontrol</div></div></button>`] : []),
      ...hits.map((x) => `<button class="li" data-h="pick:${esc(x.symbol)}|${esc(x.tagId)}|${esc(x.tagName)}"><div class="grow"><div class="t1">${esc(x.symbol)}</div><div class="t2">${esc(x.tagName)}</div></div></button>`),
      ...funds.slice(0, 6).map((x) => `<button class="li" data-h="pickmf:${esc(x.schemeCode)}|${esc(x.schemeName)}"><div class="grow"><div class="t1"><span class="pill" style="margin:0 4px 0 0">MF</span>${esc(x.schemeName)}</div><div class="t2">Mutual fund · priced at NAV</div></div></button>`),
    ]
    box.innerHTML = rows.length ? rows.join('') : '<div class="mute">No NSE company, ETF or fund matches.</div>'
  } catch (e) { box.innerHTML = `<div class="down">${esc(e.message)}</div>` }
}
function saveForm() {
  const f = hd.form, qty = parseNum($('hqty').value), avg = parseNum($('havg').value)
  if (!f.sym) return toast('Pick a stock from the search results')
  if (!(qty > 0)) return toast('Quantity must be more than 0')
  if ($('havg').value.trim() && !(avg >= 0)) return toast('Buy price must be a number')
  const fpf = f.pf || 'main'
  const h = { id: holdingId(fpf, f.sym), pf: fpf, sym: f.sym, name: f.name, et: f.et, kind: f.kind || 'stock', code: f.code || null, isin: f.isin || null, scr: f.scr || null, qty, avg: avg ?? null, date: $('hdate').value || null }
  const pf = portfolio(), others = pf.holdings.filter((x) => x.id !== f.id && x.id !== h.id)
  const same = !f.id && pf.holdings.find((x) => x.id === h.id)
  // adding a stock you already hold adds to it (quantity-weighted price), editing replaces it
  const list = same ? [...others, ...mergeHoldings([same, h])] : [...others, h]
  if (!savePortfolio({ ...pf, holdings: list })) return
  closeSheet(); toast(same ? `Added to your ${f.kind === 'mf' ? 'fund' : f.sym}` : `${f.kind === 'mf' ? f.name : f.sym} saved`); loadHoldings(); renderHoldings()
}
function holdSheet(id) {
  const r = (hd.val?.rows || []).find((x) => x.id === id) || portfolio().holdings.find((x) => x.id === id)
  if (!r) return
  const held = heldFor(r.date)
  hd.del = null
  $('sheet').innerHTML = `<h3>${esc(r.kind === 'mf' ? r.name : r.sym)}</h3><div class="mute">${esc(r.kind === 'mf' ? 'Mutual fund' : r.name)}</div>
    <div class="kv2"><span>${r.kind === 'mf' ? 'Units' : 'Quantity'}</span><span>${qtyText(r.qty)}</span><span>Buy price</span><span>${r.avg != null ? `₹${fmt(r.avg)}` : '—'}</span>
    <span>Invested</span><span>${inr(r.invested)}</span><span>Price</span><span>${r.price != null ? `₹${fmt(r.price)}` : '—'}</span>
    <span>Value</span><span>${inr(r.value)}</span><span>P&amp;L</span><span class="${pctClass(r.pnl)}">${r.pnl != null ? `${sinr(r.pnl)} (${pctText(r.pnlPct)})` : '—'}</span>
    <span>Today</span><span class="${pctClass(r.day)}">${r.day != null ? `${sinr(r.day)} (${pctText(r.dayPct)})` : '—'}</span>
    ${held ? `<span>Held</span><span>${held.text}${held.long ? ' · long term' : ' · short term'}</span>` : ''}</div>
    <div class="links">${r.kind === 'mf' ? `<div class="note" style="grid-column:span 2;padding:0">Mutual fund · priced at its latest NAV (AMFI / mfapi.in); funds move once a day.</div>`
      : `<button class="go primary" style="grid-column:span 2" data-push="stock/${encodeURIComponent(r.sym)}">Chart &amp; research<span>NSE:${esc(r.sym)}</span></button>`}
    <button class="go" data-h="edit:${esc(r.id)}">Edit<span>quantity, price, date</span></button><button class="go" data-h="del:${esc(r.id)}" id="hdel">Delete<span>from this phone</span></button></div>`
  $('sheet').classList.add('on')
}

// ---- import: CSV upload or paste -> review (match each row to an NSE symbol) -> save ----
// files: Android's picker through MainActivity.pickFile (read natively, handed back as base64) - the
// WebView's own <input type=file> doesn't work on every phone; the input stays as the browser fallback
const picks = new Map()
let pickSeq = 0
const b64bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
window.onPicked = (id, name, b64, err) => {
  const cb = picks.get(id); picks.delete(id)
  if (err) return toast(err)
  if (cb && b64 != null) cb(name || 'file', b64bytes(b64))
}
function pickFile(accept, onData, binary = false) {
  const limit = binary ? 25e6 : 2e6
  const hand = (name, bytes) => {
    if (bytes.length > limit) return toast('That file is too big for a holdings list')
    onData(binary ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) : decodeText(bytes), name)
  }
  if (window.Native?.pickFile) {
    const id = String(++pickSeq)
    picks.set(id, hand)
    return Native.pickFile(id)
  }
  const inp = document.createElement('input')
  inp.type = 'file'; inp.accept = accept; inp.style.display = 'none'
  document.body.appendChild(inp)
  inp.onchange = () => {
    const f = inp.files?.[0]; inp.remove(); if (!f) return
    const rd = new FileReader()
    rd.onload = () => hand(f.name, new Uint8Array(rd.result))
    rd.onerror = () => toast('Could not read the file')
    rd.readAsArrayBuffer(f)
  }
  inp.click()
}
/** A file opened with / shared to Stoklore: a CAS PDF, a Stoklore backup, or a holdings CSV / text list. */
window.onSharedFile = (name, b64, err) => {
  if (err) return toast(err)
  if (b64 == null) return
  const bytes = b64bytes(b64), head = new TextDecoder('latin1').decode(bytes.slice(0, 5))
  if (current.name !== 'holdings') { navDir = 'tab'; location.replace('#/holdings') }
  setTimeout(() => importBytes(bytes, name), 300)
}
/** Any holdings file: a CAS PDF, an Excel workbook (every sheet), a Stoklore backup, or CSV / text rows. */
async function importBytes(bytes, name) {
  const kind = fileKind(bytes)
  // a PDF: try it without a password first (broker statements often have none); a CAS then asks for it
  if (kind === 'pdf') { casFile = { buf: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), name }; toast('Reading the PDF…'); return casOpen('') }
  if (kind === 'ole') return noRows('', name, 'This Excel file is password-protected (or an old .xls). Open it in Excel or Google Sheets, remove the password, save it as .xlsx or CSV and upload that.')
  if (kind === 'zip') {
    let sheets
    try { sheets = await xlsxSheets(bytes) } catch (e) { return toast(`Couldn't read that Excel file: ${e.message}`) }
    const rows = sheets.flatMap((sh) => parseHoldings(sh.csv).rows)
    return rows.length ? reviewRows(rows, name) : noRows(sheets.map((sh) => sh.csv).join('\n\n'), name)
  }
  const text = decodeText(bytes)
  if (/"app"\s*:\s*"stoklore"/.test(text.slice(0, 200))) return importBackup(text)
  if (/<table/i.test(text.slice(0, 20000))) return startReview(htmlTableCsv(text), name) // an ".xls" that is really a web page
  startReview(text, name)
}

// ---- CAS PDF: opened on the phone with pdf.js (assets/vendor, Apache-2.0); the password is used for this
// one read and dropped, the file is never stored or sent. lib.js casHoldings reads the holdings out. ----
let pdfjsP = null, casFile = null
function loadPdfJs() {
  if (!pdfjsP) pdfjsP = new Promise((resolve, reject) => {
    const add = (src) => new Promise((ok, no) => { const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = () => no(new Error('PDF reader missing')); document.head.appendChild(el) })
    // the worker script loaded on the page itself: pdf.js then reads in-page (a file:// page can't start a worker)
    add('vendor/pdf.min.js').then(() => add('vendor/pdf.worker.min.js')).then(() => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'
      resolve(window.pdfjsLib)
    }, (e) => { pdfjsP = null; reject(e) })
  })
  return pdfjsP
}
function casSheet(err) {
  $('sheet').innerHTML = `<h3>Open your CAS</h3><div class="mute" style="font-size:11px">${esc(casFile.name)}<br>CDSL / NSDL: the password is your PAN in capitals. CAMS / KFintech: the one you chose when you asked for it. It's used once on this phone - never saved or sent.</div>
    <input class="in hin" id="caspw" type="password" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="PDF password">
    ${err ? `<div class="down" style="margin-top:6px;font-size:11px">${esc(err)}</div>` : ''}
    <div class="btnrow fxbtns"><button class="btn" data-h="cascancel">Cancel</button><button class="btn primary" data-h="casopen" id="casgo">Open</button></div>`
  $('sheet').classList.add('on', 'big')
  setTimeout(() => $('caspw')?.focus(), 150)
}
async function casOpen(password) {
  const pw = password ?? $('caspw')?.value ?? '', go = $('casgo')
  if (go) { go.disabled = true; go.textContent = 'Reading…' }
  let found
  try {
    const lib = await loadPdfJs()
    const doc = await lib.getDocument({ data: new Uint8Array(casFile.buf.slice(0)), password: pw, isEvalSupported: false }).promise
    const pages = []
    for (let i = 1; i <= Math.min(doc.numPages, 80); i++) {
      pages.push((await (await doc.getPage(i)).getTextContent()).items.map((t) => ({ str: t.str, x: t.transform[4], y: t.transform[5] })))
    }
    doc.destroy()
    found = casHoldings(pdfLines(pages))
  } catch (e) {
    if (e?.name === 'PasswordException') return casSheet(e.code === 2 && pw ? 'Wrong password - try again' : '')
    casFile = null; closeSheet()
    return toast(`Couldn't read that PDF: ${e?.message || e}`)
  }
  const name = casFile.name
  casFile = null
  if (!found.length) { closeSheet(); return toast('No holdings found in this PDF - a CAS or broker holdings statement lists ISIN, quantity, price and value') }
  reviewRows(found.map((h, i) => ({ name: h.name || h.isin, hint: h.name, isin: h.isin, kind: h.kind, qty: h.units, avg: h.avg, date: null, line: i + 1 })), name)
}
function pasteSheet() {
  $('sheet').innerHTML = `<h3>Paste rows</h3><div class="mute" style="font-size:11px">One stock per line: symbol or name, quantity, buy price. Or paste straight from a spreadsheet with its header row.</div>
    <textarea class="in hin" id="hpaste" rows="8" placeholder="TCS 10 3450&#10;Tata Motors, 20, 712.40&#10;INFY 5 1480" style="height:auto;padding:8px;font:inherit"></textarea>
    <div class="btnrow fxbtns"><button class="btn" data-h="close">Cancel</button><button class="btn primary" data-h="pasted">Check rows</button></div>`
  $('sheet').classList.add('on', 'big')
}
const ISIN_RE = /^IN[A-Z0-9]{10}$/
const squash = (s) => String(s || '').toLowerCase().replace(/\b(ltd|limited|the|inc|co)\b|[^a-z0-9]/g, '')
async function startReview(text, from) {
  const { rows, skipped } = parseHoldings(text)
  if (!rows.length) return noRows(text, from)
  reviewRows(rows, from, skipped)
}
/** Nothing recognised: show what actually arrived (so a bad file is obvious) and let it be fixed as a paste. */
function noRows(text, from, why) {
  const lines = String(text || '').split(/\r\n|\r|\n/).filter((l) => l.trim())
  $('sheet').innerHTML = `<h3>No holdings found</h3><div class="mute" style="font-size:11px">${esc(from || 'pasted text')} · ${why ? esc(why) : `${String(text || '').length} characters, ${lines.length} lines. Each row needs a symbol or name and a quantity.`}</div>
    <div class="fxh">What the file contains</div><pre class="prose panel" style="margin:6px 0;max-height:30vh;overflow:auto;white-space:pre-wrap;font-size:11px">${esc(lines.slice(0, 8).join('\n') || '(empty)')}</pre>
    <div class="btnrow fxbtns"><button class="btn" data-h="close">Close</button><button class="btn primary" data-h="fixpaste">Fix it as paste</button></div>`
  hd.badText = String(text || '').slice(0, 20000)
  $('sheet').classList.add('on', 'big')
}
async function reviewRows(rows, from, skipped = 0) {
  closeSheet()
  const into = selPf() === 'all' ? 'main' : hd.sel
  hd.review = { from, skipped, pf: into, mode: inPortfolio(portfolio().holdings, into).length ? 'add' : 'replace', rows: rows.map((r, i) => ({ ...r, i, status: 'wait' })) }
  renderReview()
  let next = 0
  const work = async () => {
    while (next < hd.review?.rows.length) {
      const r = hd.review.rows[next++]
      try { await resolveRow(r) } catch { r.status = 'pick' }
      if (current.name === 'holdings' && hd.review) renderReview()
    }
  }
  await Promise.all([work(), work(), work()])
}
/** One import row -> a holding: funds (and ETFs a statement lists by ISIN) through AMFI's ISIN list; stocks by
 *  exact symbol, then name (ET search), then an exchange symbol Moneycontrol prices. */
async function resolveRow(r) {
  const isin = r.isin || (ISIN_RE.test(r.name.toUpperCase()) ? r.name.toUpperCase() : null)
  if (isin?.startsWith('INF') || r.kind === 'mf') {
    // an ETF given by its exchange symbol (NIFTYBEES) keeps the live exchange price; a fund goes by its NAV
    const asSym = r.name.trim().toUpperCase()
    if (!ISIN_RE.test(asSym) && SYM_RE.test(asSym) && await symbolHit(asSym)) return Object.assign(r, { sym: asSym, et: null, isin, kind: 'stock', label: 'ETF · exchange price', status: 'ok' })
    const m = isin && (await amfiMap().catch(() => null))?.get(isin)
    if (m) return Object.assign(r, { sym: `MF${m.code}`, kind: 'mf', code: m.code, et: null, isin, label: `${m.name} · NAV ₹${fmt(m.nav)}`, status: 'ok' })
  }
  // a symbol the broker put in brackets: "Nippon Nifty 50 ETF (NIFTYBEES)" (Dhan)
  const br = bracketSymbol(r.name)
  if (br) {
    const h = (await etSearch(br).catch(() => [])).find((x) => x.entityType === 'company' && (x.symbol || '').toUpperCase() === br)
    if (h) return Object.assign(r, { sym: br, et: String(h.tagId), isin, label: h.tagName, status: 'ok' })
    if (await symbolHit(br)) return Object.assign(r, { sym: br, et: null, isin, label: `${r.name.replace(/\s*\([^)]*\)\s*$/, '')} · exchange price`, status: 'ok' })
  }
  // a CAS / NSDL row reads "INFY INFOSYS LIMITED": try its first word as a symbol before the name
  const name = (isin && r.name.toUpperCase() === isin ? r.hint || '' : r.name).replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\b(LIMITED|LTD\.?|EQUITY SHARES?)\b/gi, ' ').replace(/\s+/g, ' ').trim()
  if (!name) return Object.assign(r, { status: 'pick' })
  const first = name.split(' ')[0].toUpperCase()
  if (name.includes(' ') && SYM_RE.test(first)) {
    const h = (await etSearch(first).catch(() => [])).find((x) => x.entityType === 'company' && (x.symbol || '').toUpperCase() === first)
    if (h) return Object.assign(r, { sym: first, et: String(h.tagId), isin, label: h.tagName, status: 'ok' })
  }
  const hits = (await etSearch(name).catch(() => [])).filter((x) => x.entityType === 'company' && x.symbol)
  const exact = hits.find((x) => x.symbol.toUpperCase() === name.toUpperCase())
  const byName = hits.find((x) => squash(x.tagName) === squash(name) || squash(x.tagName).startsWith(squash(name)))
  if (exact || byName) { const h = exact || byName; return Object.assign(r, { sym: h.symbol.toUpperCase(), et: String(h.tagId), isin, label: h.tagName, status: 'ok' }) }
  // an ETF / fund by name only ("Nippon India Nifty 1D Rate Liquid ETF"): the fund whose name starts the same
  if (/\b(etf|fund|bees|index|liquid|gold|silver|nifty|sensex)\b/i.test(name)) {
    const f = await fundByName(name)
    if (f) return Object.assign(r, { sym: `MF${f.code}`, kind: 'mf', code: f.code, et: null, isin, label: `${f.name} · priced at NAV`, status: f.sure ? 'ok' : 'guess' })
  }
  const asSym = name.toUpperCase().replace(/\s+/g, '')
  // not an ET company (ETFs, some SME stocks): a symbol Moneycontrol has prices for is good enough
  if (SYM_RE.test(asSym) && await symbolHit(asSym)) return Object.assign(r, { sym: asSym, et: null, isin, label: 'ETF / priced from Moneycontrol', status: 'ok' })
  const hit = hits[0]
  if (hit) return Object.assign(r, { sym: hit.symbol.toUpperCase(), et: String(hit.tagId), isin, label: hit.tagName, status: 'guess' })
  r.status = 'pick'
  if (isin && !r.isin) r.isin = isin
}
/** The fund a broker's name means: the one whose name starts with it (sure), else the most words in common. */
async function fundByName(name) {
  const list = await mfSearch(name).catch(() => [])
  if (!list.length) return null
  const q = squash(name), words = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1)
  const sure = list.find((x) => squash(x.schemeName).startsWith(q))
  if (sure) return { code: String(sure.schemeCode), name: sure.schemeName, sure: true }
  const score = (x) => words.filter((w) => x.schemeName.toLowerCase().includes(w)).length
  const best = [...list].sort((a, b) => score(b) - score(a) || a.schemeName.length - b.schemeName.length)[0]
  return score(best) >= Math.max(2, words.length - 1) ? { code: String(best.schemeCode), name: best.schemeName, sure: false } : null
}
function renderReview() {
  const rv = hd.review, top = window.scrollY
  const ready = rv.rows.filter((r) => r.sym && r.status !== 'drop').length, waiting = rv.rows.some((r) => r.status === 'wait')
  const icon = { ok: '<span class="up">✓</span>', guess: '<span class="acc">?</span>', pick: '<span class="down">✕</span>', wait: '<span class="mute">…</span>', drop: '<span class="mute">–</span>' }
  view.innerHTML = `<div class="sec">Review ${rv.rows.length} rows${rv.from ? ` · ${esc(rv.from)}` : ''}</div>
    <div class="note" style="padding-bottom:6px">✓ matched · <span class="acc">?</span> best guess - tap to check · <span class="down">✕</span> tap to pick the stock${rv.skipped ? ` · ${rv.skipped} lines skipped (no name or quantity)` : ''}</div>
    ${portfolio().portfolios.length > 1 ? `<div class="fxh" style="padding:0 10px">Into portfolio</div><div class="chips">${portfolio().portfolios.map((p) => `<button data-h="rpf:${esc(p.id)}" class="${rv.pf === p.id ? 'on' : ''}">${esc(p.name)}</button>`).join('')}</div>` : ''}
    ${inPortfolio(portfolio().holdings, rv.pf).length ? `<div class="btnrow"><div class="seg full"><button data-h="rmode:add" class="${rv.mode === 'add' ? 'on' : ''}">Add to ${esc(pfName(rv.pf))}</button><button data-h="rmode:replace" class="${rv.mode === 'replace' ? 'on' : ''}">Replace ${esc(pfName(rv.pf))}</button></div></div>` : ''}
    <div class="panel">${rv.rows.map((r) => `<button class="li" data-h="rrow:${r.i}"${r.status === 'drop' ? ' style="opacity:.45"' : ''}>${icon[r.status]}
      <div class="grow"><div class="t1">${esc(r.name)} <span class="mute" style="font-weight:400">${qtyText(r.qty)} × ${r.avg != null ? `₹${fmt(r.avg)}` : '—'}</span></div>
      <div class="t2">${r.sym ? `${esc(r.sym)} · ${esc(r.label || '')}` : r.status === 'wait' ? 'matching…' : 'no match - tap to pick'}</div></div>
      <span class="pill" data-h="rdrop:${r.i}">${r.status === 'drop' ? 'keep' : 'skip'}</span></button>`).join('')}</div>
    <div class="btnrow" style="padding-top:10px"><button class="btn" data-h="rcancel">Cancel</button><button class="btn primary" data-h="rsave"${!ready || waiting ? ' disabled' : ''}>${waiting ? 'Matching…' : `Save ${ready} holdings`}</button></div>`
  setSmall('Review before saving')
  window.scrollTo(0, top)
}
function pickSheet(i) {
  const r = hd.review.rows[i]
  hd.form = { review: i, sym: r.sym, name: r.label }
  $('sheet').innerHTML = `<h3>Which stock is "${esc(r.name)}"?</h3>
    <input class="in hin" id="hq" placeholder="Company, NSE symbol, ETF or mutual fund" autocomplete="off" spellcheck="false" value="${esc(ISIN_RE.test(r.name) ? r.hint || '' : r.name)}">
    <div id="hres" class="hres"></div><div class="btnrow fxbtns"><button class="btn" data-h="close">Cancel</button></div>`
  $('sheet').classList.add('on', 'big')
  holdSearch($('hq').value)
}
function saveReview() {
  const rv = hd.review, pf = portfolio()
  const rows = rv.rows.filter((r) => r.sym && r.status !== 'drop').map((r) => ({ id: holdingId(rv.pf, r.sym), pf: rv.pf, sym: r.sym, name: (r.kind === 'mf' ? (r.label || '').replace(/ · NAV .*$/, '') : r.label) || r.name,
    et: r.et, kind: r.kind === 'mf' ? 'mf' : 'stock', code: r.code || null, isin: r.isin || null, qty: r.qty, avg: r.avg, date: r.date }))
  const list = mergeHoldings(rv.mode === 'add' ? [...pf.holdings, ...rows] : [...pf.holdings.filter((h) => h.pf !== rv.pf), ...rows])
  if (!savePortfolio({ ...pf, holdings: list, alerts: rv.mode === 'add' ? pf.alerts : pf.alerts.filter((a) => !a.sym || list.some((h) => h.sym === a.sym)) })) return
  hd.review = null; toast(`Saved ${rows.length} rows · ${list.length} holdings`); renderHoldings(); loadHoldings()
}

// ---- alerts ----
function alertSheet() {
  if (!hd.alert) hd.alert = { kind: 'below', sym: portfolio().holdings[0]?.sym || null, repeat: true, value: null, pf: selPf() === 'all' ? null : hd.sel }
  const t = hd.val && (hd.alert.pf ? valuePortfolio(inPortfolio(portfolio().holdings, hd.alert.pf), priceOf) : hd.val)?.total
  const a = hd.alert, k = ALERT_KINDS.find(([x]) => x === a.kind), w = portfolio().watch.find((x) => x.sym === a.sym)
  const r = (hd.val?.rows || []).find((x) => x.sym === a.sym) || (w && { ...w, ...priceOf(w) })
  const round = (v) => v >= 1000 ? Math.round(v / 100) * 100 : Math.round(v * 100) / 100
  const sugg = !t ? null : { below: t.value * 0.9, above: t.value * 1.1, trail: Math.max(t.pnl * 0.25, t.value * 0.05), dayloss: t.value * 0.02,
    pbelow: r?.price * 0.95, pabove: r?.price * 1.05, stockdrop: 5 }[a.kind]
  const hint = { below: `Now ${inr(t?.value)}`, above: `Now ${inr(t?.value)}`, trail: `Watches the highest value from now (${inr(t?.value)}) and tells you once it falls this much below it`,
    dayloss: `Today ${sinr(t?.day)}`, pbelow: r ? `${a.sym} now ₹${fmt(r.price)}` : '', pabove: r ? `${a.sym} now ₹${fmt(r.price)}` : '', stockdrop: 'Each holding is reported once a day' }[a.kind]
  $('sheet').innerHTML = `<h3>New alert</h3>
    <div class="fchips">${ALERT_KINDS.map(([x, l]) => `<button data-h="akind:${x}" class="${a.kind === x ? 'on' : ''}">${l.replace(': give back no more than', '')}</button>`).join('')}</div>
    ${k[3] ? `<div class="fxh">Stock (holdings and watchlist)</div><div class="fchips">${[...portfolio().holdings, ...portfolio().watch].filter((h, i, all) => all.findIndex((x) => x.sym === h.sym) === i).map((h) => `<button data-h="asym:${esc(h.sym)}" class="${a.sym === h.sym ? 'on' : ''}">${esc(h.kind === 'mf' ? h.name.slice(0, 24) : h.sym)}</button>`).join('')}</div>` : ''}
    ${!k[3] && portfolio().portfolios.length > 1 ? `<div class="fxh">Portfolio</div><div class="fchips">${[[null, 'All'], ...portfolio().portfolios.map((p) => [p.id, p.name])].map(([id, n]) => `<button data-h="apf:${esc(id || '')}" class="${(a.pf || null) === id ? 'on' : ''}">${esc(n)}</button>`).join('')}</div>` : ''}
    <div class="fxh">${esc(k[1])} (${k[2]})</div><input class="in hin" id="aval" inputmode="decimal" value="${a.value ?? (sugg != null && Number.isFinite(sugg) ? round(sugg) : '')}">
    <div class="mute" style="font-size:11px;margin-top:4px">${esc(hint || '')}</div>
    <div class="fxh">Notify</div><div class="seg full"><button data-h="arep:0" class="${!a.repeat ? 'on' : ''}">Once</button><button data-h="arep:1" class="${a.repeat ? 'on' : ''}">Every time it crosses</button></div>
    <div class="btnrow fxbtns"><button class="btn" data-h="close">Cancel</button><button class="btn primary" data-h="asave">Save alert</button></div>`
  $('sheet').classList.add('on', 'big')
}
function saveAlert() {
  const a = hd.alert, value = parseNum($('aval').value), pf = portfolio()
  if (!(value > 0)) return toast('Enter an amount above 0')
  if (ALERT_KINDS.find(([x]) => x === a.kind)[3] && !a.sym) return toast('Pick the stock')
  const alert = { id: `a${Date.now().toString(36)}`, kind: a.kind, value, sym: ALERT_KINDS.find(([x]) => x === a.kind)[3] ? a.sym : null,
    repeat: a.repeat, created: Date.now(), pf: ALERT_KINDS.find(([x]) => x === a.kind)[3] ? null : a.pf || null,
    start: (a.pf ? hd.val && valuePortfolio(inPortfolio(pf.holdings, a.pf), priceOf) : hd.val)?.total.value ?? null }
  if (!savePortfolio({ ...pf, alerts: [...pf.alerts, alert] })) return
  hd.alert = null; closeSheet(); renderHoldings(); toast('Alert saved - checked every 15 minutes in market hours')
  if (window.Native && Native.notifyState() !== 'on') Native.requestNotify()
}

// ---- backup: holdings, alerts and settings in one file ----
const BACKUP_KEYS = /^(theme\.|font\.|chart\.|sectors\.|markets\.|search\.recent$|feed\.filter$|feed\.templates$|refresh\.every$|holdings\.sort$|holdings\.pf$)/
function exportBackup() {
  const settings = {}
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (BACKUP_KEYS.test(k)) settings[k] = localStorage.getItem(k) } } catch {}
  const text = JSON.stringify({ app: 'stoklore', kind: 'backup', v: 1, exported: new Date().toISOString(), settings, portfolio: portfolio() }, null, 1)
  if (window.Native) Native.exportFile(`stoklore-backup-${todayIST()}.json`, text)
  else toast('Export works inside the app')
}
window.onExported = (ok) => toast(ok ? 'Backup saved' : 'Backup not saved')
function importBackup(text) {
  let o
  try { o = JSON.parse(text) } catch { return toast('That file is not a Stoklore backup') }
  if (o?.app !== 'stoklore' || o.kind !== 'backup') return toast('That file is not a Stoklore backup')
  let n = 0
  for (const [k, v] of Object.entries(o.settings || {})) if (BACKUP_KEYS.test(k) && typeof v === 'string' && v.length < 20000) { store.set(k, v); n++ }
  const pf = cleanPortfolio(o.portfolio)
  if (pf.holdings.length && !savePortfolio(pf)) return
  fd.filter = storedFilter(); hd.sort = store.get('holdings.sort', 'value:desc'); startAutoRefresh()
  applyTheme(); applyFonts()
  toast(`Restored ${pf.holdings.length} holdings, ${pf.alerts.length} alerts and ${n} settings`)
  route()
}

window.onLockState = () => renderSettings()
window.onNotifyState = () => { if (current.name === 'holdings' && !hd.review && !sheetOn()) renderHoldings() }
window.onCheckNow = (r) => toast(r === 'ok' ? 'Sent - check your notifications' : `Not sent: ${r}`)

/** Every data-h tap (Holdings screen and its cards). */
function holdTap(el) {
  const [k, v] = el.dataset.h.split(/:(.*)/s)
  const pf = portfolio()
  switch (k) {
    case 'add': return holdForm(null)
    case 'edit': return holdForm(pf.holdings.find((h) => h.id === v))
    case 'close': hd.alert = null; return closeSheet()
    case 'save': return saveForm()
    case 'pick': case 'pickmf': {
      const mf = k === 'pickmf', parts = v.split('|')
      const pick = mf ? { sym: `MF${parts[0]}`, code: parts[0], kind: 'mf', et: null, name: parts.slice(1).join('|') }
        : { sym: parts[0].toUpperCase(), code: null, kind: 'stock', et: parts[1] || null, name: parts.slice(2).join('|') }
      if (hd.form?.review != null) {
        Object.assign(hd.review.rows[hd.form.review], { sym: pick.sym, et: pick.et, kind: pick.kind, code: pick.code, label: pick.name, status: 'ok' })
        closeSheet(); return renderReview()
      }
      const qty = $('hqty')?.value, avg = $('havg')?.value, date = $('hdate')?.value
      Object.assign(hd.form, pick, { qty: parseNum(qty), avg: parseNum(avg), date: date || null })
      renderForm() // labels change between a stock (quantity) and a fund (units)
      return $('hqty').focus()
    }
    case 'cas': return pickFile('.pdf,application/pdf', (buf, name) => importBytes(new Uint8Array(buf), name), true)
    case 'casopen': return casOpen($('caspw').value)
    case 'cascancel': casFile = null; return closeSheet()
    case 'unwatch': toggleWatch(v); return renderHoldings()
    case 'filings': savePortfolio({ ...pf, filings: !pf.filings }); return renderHoldings()
    case 'hold': return holdSheet(v)
    case 'del':
      if (hd.del !== v) { hd.del = v; const b = $('hdel'); if (b) b.innerHTML = 'Tap again to delete<span>can\'t be undone</span>'; return }
      savePortfolio({ ...pf, holdings: pf.holdings.filter((h) => h.id !== v), alerts: pf.alerts.filter((a) => !a.sym || a.sym !== pf.holdings.find((h) => h.id === v)?.sym) })
      hd.del = null; closeSheet(); return renderHoldings()
    case 'clear': {
      if (hd.del !== 'all') { hd.del = 'all'; return renderHoldings() }
      hd.del = null
      const keep = selPf() === 'all' ? [] : pf.holdings.filter((h) => h.pf !== hd.sel)
      savePortfolio({ ...pf, holdings: keep, alerts: keep.length ? pf.alerts : [] }); hd.val = null; loadHoldings(); return renderHoldings()
    }
    case 'pfsel': hd.sel = v; store.set('holdings.pf', v); return renderHoldings()
    case 'pfmanage': hd.del = null; return pfManage()
    case 'pfadd': {
      const name = ($('pfnew').value || '').trim().slice(0, 30)
      if (!name) return toast('Give the portfolio a name')
      if (pf.portfolios.length >= 20) return toast('20 portfolios at most')
      const id = `p${Date.now().toString(36).slice(-7)}`
      if (!savePortfolio({ ...pf, portfolios: [...pf.portfolios, { id, name }] })) return
      hd.sel = id; store.set('holdings.pf', id); toast(`${name} added - add or import its holdings`); pfManage(); return renderHoldings()
    }
    case 'pfdel': {
      if (hd.del !== `pf:${v}`) { hd.del = `pf:${v}`; return pfManage() }
      hd.del = null
      const moved = pf.holdings.map((h) => h.pf === v ? { ...h, pf: 'main', id: holdingId('main', h.sym) } : h)
      if (!savePortfolio({ ...pf, portfolios: pf.portfolios.filter((p) => p.id !== v), holdings: mergeHoldings(moved), alerts: pf.alerts.map((a) => a.pf === v ? { ...a, pf: null } : a) })) return
      if (hd.sel === v) { hd.sel = 'all'; store.set('holdings.pf', 'all') }
      hd.val = null; loadHoldings(); pfManage(); return renderHoldings()
    }
    case 'fpf': { const q = $('hqty')?.value, av = $('havg')?.value, dt = $('hdate')?.value; Object.assign(hd.form, { pf: v, qty: parseNum(q), avg: parseNum(av), date: dt || null }); return renderForm() }
    case 'rpf': hd.review.pf = v; hd.review.mode = inPortfolio(pf.holdings, v).length ? 'add' : 'replace'; return renderReview()
    case 'apf': hd.alert.pf = v || null; hd.alert.value = parseNum($('aval').value); return alertSheet()
    case 'upload': return pickFile('.csv,.txt,.tsv,.xlsx,text/*', (buf, name) => importBytes(new Uint8Array(buf), name), true)
    case 'paste': return pasteSheet()
    case 'pasted': return startReview($('hpaste').value, 'pasted')
    case 'fixpaste': pasteSheet(); $('hpaste').value = hd.badText || ''; return
    case 'restore': return pickFile('.json,application/json', importBackup)
    case 'export': return exportBackup()
    case 'rmode': hd.review.mode = v; return renderReview()
    case 'rrow': return pickSheet(+v)
    case 'rdrop': { const r = hd.review.rows[+v]; r.status = r.status === 'drop' ? (r.sym ? 'ok' : 'pick') : 'drop'; return renderReview() }
    case 'rcancel': hd.review = null; return renderHoldings()
    case 'rsave': return saveReview()
    case 'alert': hd.alert = null; return alertSheet()
    case 'akind': hd.alert.kind = v; hd.alert.value = null; return alertSheet()
    case 'asym': hd.alert.sym = v; hd.alert.value = null; return alertSheet()
    case 'arep': hd.alert.repeat = v === '1'; hd.alert.value = parseNum($('aval').value); return alertSheet()
    case 'asave': return saveAlert()
    case 'adel': savePortfolio({ ...pf, alerts: pf.alerts.filter((a) => a.id !== v) }); return renderHoldings()
    case 'notify':
      savePortfolio({ ...pf, notify: v }); renderHoldings()
      if (v !== 'off' && window.Native && Native.notifyState() !== 'on') Native.requestNotify()
      return
    case 'perm': return window.Native?.requestNotify()
    case 'now':
      if (!pf.holdings.length) return toast('Add holdings first')
      if (window.Native && Native.notifyState() !== 'on') { toast('Allow notifications first'); return Native.requestNotify() }
      toast('Pricing your holdings…'); return window.Native?.checkNow()
    case 'battery': return window.Native?.openBattery()
  }
}

// ---- Settings: appearance, fonts, chart, feed, data, about -------------------------------------------------
let selTok = 'up'
const SET_SECTIONS = [['appearance', 'Appearance'], ['fonts', 'Fonts'], ['chart', 'Chart'], ['feed', 'Feed'], ['privacy', 'Privacy'], ['data', 'Data & backup'], ['about', 'About']]
function settingsScreen() {
  setTop({ title: 'Settings', small: 'Theme, fonts, chart, feed',
    sub: `<div class="chips setnav">${SET_SECTIONS.map(([id, l]) => `<button data-act="set-jump" data-v="${id}">${l}</button>`).join('')}</div>` })
  renderSettings(); endIntro()
  loadFont('Great Vibes') // the signature on About
  for (const [f] of FONTS) loadFont(f) // so each font chip shows in its own face
  for (const f of customFonts()) loadFont(f)
}
function renderSettings() {
  if (current.name !== 'settings') return
  const id = themeId(), custom = customTheme(), cur = resolveTheme(id, custom)
  const pv = (t) => `<div class="pv" style="background:${t.colors.background}"><i style="background:${t.colors.card};width:80%"></i><i style="background:${t.colors.accent};width:45%"></i>
    <div class="sw"><i style="background:${t.colors.up}"></i><i style="background:${t.colors.down}"></i><i style="background:${t.colors.foreground}"></i></div></div>`
  const list = [...THEMES, ...(custom ? [resolveTheme('custom', custom)] : [])]
  const tokLabel = THEME_TOKENS.find(([k]) => k === selTok)?.[1]
  let lock = 'unavailable'
  try { lock = window.Native?.lockState?.() || 'unavailable' } catch {}
  const zoom = +store.get('font.zoom', '100'), fonts = [...FONTS.map(([f]) => f), ...customFonts()]
  const fontRow = (slot, label) => `<div class="fxh setpad">${label}</div><div class="fchips setpad">${fonts.map((n) =>
    `<button data-font="${slot}:${esc(n)}" class="${fontPick(slot) === n ? 'on' : ''}" style="font-family:${esc(fontStack(n))}">${esc(fontLabel(n))}</button>`).join('')}</div>`
  const top = window.scrollY
  view.innerHTML = `<div class="sec" id="set-appearance">Appearance · templates</div>
    <div class="themes">${list.map((t) => `<button class="theme${t.id === cur.id ? ' on' : ''}" data-theme="${t.id}">${pv(t)}<div class="nm">${esc(t.label)}</div></button>`).join('')}</div>
    <div class="sec">Preview</div>
    <div class="panel"><div class="tiles" style="padding:8px">${[-4, -2, -0.5, 0, 0.5, 2, 4].map((p) => `<div class="tile" style="flex:1;min-width:0;${tileStyle(p)}"><p>${pctText(p, 1)}</p></div>`).join('')}</div></div>
    <div class="sec">Custom colours<span class="act mute">${cur.id === 'custom' ? 'your theme' : `starts from ${esc(cur.label)}`}</span></div>
    <div class="panel">${THEME_TOKENS.map(([k, l]) => `<div class="tok${k === selTok ? ' on' : ''}" data-tok="${k}"><i class="cur" style="display:inline-block;background:${cur.colors[k]}"></i><span class="lbl">${l}</span>
      <input class="in hex" data-hex="${k}" value="${cur.colors[k]}" maxlength="7" autocomplete="off" spellcheck="false"><input type="color" data-color="${k}" value="${cur.colors[k]}"></div>`).join('')}</div>
    <div class="sec">Quick colours<span class="act mute" id="toklbl">for ${esc(tokLabel)}</span></div>
    <div class="swatches">${SWATCHES.map((c) => `<button data-swatch="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>
    ${custom ? '<div class="btnrow"><button class="btn" data-act="custom-reset">Delete custom theme</button></div>' : ''}

    <div class="sec" id="set-fonts">Fonts</div>
    <div class="panel fontprev"><div class="fph">NIFTY 50 · Reliance Industries</div><div>25,884.50 <span class="up">+65.25 (+0.25%)</span> · ₹1,412.30 <span class="down">−1.08%</span></div></div>
    ${fontRow('body', 'Body text & numbers')}${fontRow('head', 'Headings & big numbers')}
    <div class="sec">Any Google Font</div>
    <div class="sub"><input class="in" id="fontname" placeholder="e.g. Ubuntu Mono, Lexend, Playfair Display" autocomplete="off" autocapitalize="words" spellcheck="false"></div>
    <div class="btnrow"><button class="btn" data-act="font-add" data-v="body">Use for body</button><button class="btn" data-act="font-add" data-v="head">Use for headings</button></div>
    ${customFonts().length ? '<div class="btnrow"><button class="btn" data-act="font-forget">Forget my added fonts</button></div>' : ''}
    <div class="note">Type the family name as it appears on fonts.google.com. Fonts download once and are cached; offline, the app falls back to a system font of the same kind.</div>
    <div class="sec">Text size</div>
    <div class="btnrow"><div class="seg full">${[90, 100, 110, 120].map((z) => `<button data-act="font-zoom" data-v="${z}" class="${zoom === z ? 'on' : ''}">${z}%</button>`).join('')}</div></div>

    <div class="sec" id="set-chart">Chart</div>
    <div class="fxh setpad">Default type</div><div class="btnrow" style="padding-top:6px">${typeSeg().replace('class="seg"', 'class="seg full"')}</div>
    <div class="fxh setpad">Default range</div><div class="chips" id="ranges">${Object.keys(RANGES).map((r) => `<button data-range="${r}" class="${r === chartRange() ? 'on' : ''}">${r}</button>`).join('')}</div>

    <div class="sec" id="set-feed">Feed</div>
    <div class="panel"><div class="li"><div class="grow"><div class="t1">Filter</div><div class="t2">${esc(filterLabel(fd.filter))}</div></div></div></div>
    <div class="btnrow"><button class="btn" data-act="feed-filter">Edit filter</button>${filterOn(fd.filter) ? '<button class="btn" data-act="feed-clear">Clear filter</button>' : ''}</div>
    <div class="btnrow"><button class="btn" data-act="feed-unsee">Show today's seen cards again</button></div>
    <div class="fxh setpad">Filter templates</div>
    <div class="panel" style="margin-top:6px">${allTemplates().map((t) => `<div class="li"><div class="grow"><div class="t1">${t.builtin ? '' : '★ '}${esc(t.name)}${fd.filter && sameFilter(fd.filter, t.filter) ? ' <span class="pill" style="color:var(--accent);border-color:var(--accent)">in use</span>' : ''}</div><div class="t2">${esc(filterLabel(t.filter))}</div></div>
      <button class="pill" data-act="tpl-use" data-v="${esc(t.id)}">use</button>${t.builtin ? '' : `<button class="pill" data-act="tpl-del" data-v="${esc(t.id)}">remove</button>`}</div>`).join('')}</div>
    <div class="note" style="padding-top:6px">Save your own from the Feed's filter (funnel) - "Save these choices as a template". ★ = yours.</div>

    <div class="sec" id="set-privacy">Privacy &amp; widget</div>
    <div class="panel"><div class="li"><div class="grow"><div class="t1">App lock ${lock === 'on' ? '<span class="pill" style="color:var(--accent);border-color:var(--accent)">on</span>' : ''}</div>
      <div class="t2" style="white-space:normal">${lock === 'unavailable' ? 'Set a screen lock (PIN, pattern or fingerprint) on the phone first' : 'Fingerprint, face or your screen lock when Stoklore opens, and after 30 seconds away. Hides the app in the recent-apps preview.'}</div></div>
      ${lock === 'unavailable' ? '' : `<button class="pill" data-act="lock" data-v="${lock === 'on' ? '0' : '1'}">${lock === 'on' ? 'turn off' : 'turn on'}</button>`}</div></div>
    <div class="note">Home-screen widget: long-press an empty spot on your home screen → Widgets → Stoklore. It shows your holdings' value, today's change and P&amp;L, refreshed by the background check (about every 15 minutes in market hours); tap it to open Holdings.</div>

    <div class="sec" id="set-data">Data</div>
    <div class="btnrow"><button class="btn" data-h="export">Export backup</button><button class="btn" data-h="restore">Restore backup</button></div>
    <div class="note" style="padding-bottom:8px">One .json file with your holdings, alerts and every setting here - keep it in Drive or send it to yourself, and restore it on a new phone.</div>
    <div class="fxh setpad">Auto-refresh</div>
    <div class="btnrow" style="padding-top:6px"><div class="seg full">${REFRESH.map(([sec, l]) => `<button data-act="refresh-every" data-v="${sec}" class="${refreshEvery() === sec ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="note" style="padding-bottom:8px">Feed, Holdings, Markets, Sectors and the stock / index screens reload on this beat. 15s-1m run only while NSE is open (Mon-Fri 09:15-15:30 IST) - the data doesn't move otherwise; nothing reloads while a card is open or the app is in the background.</div>
    <div class="btnrow"><button class="btn" data-act="clear-recent">Clear recent searches</button><button class="btn" data-act="clear-cache">Reload all data</button></div>
    <div class="note">Feeds refresh every 5 minutes on screen. Holdings and settings stay on this phone; only stock symbols go to ET and Moneycontrol for prices.</div>

    <div class="sec" id="set-about">About</div>
    <div class="panel sig">
      <div class="signame">Karthik</div>
      <div class="sigline"></div>
      <div class="sigsub">Stoklore ${esc(appVersion())}</div>
      <div class="links fl" style="margin-top:12px">
        <button class="go primary" style="grid-column:span 2" data-ext="${CREDIT.repo}" data-pkg="">GitHub · Karthik002002/Stoklore<span>the source, issues, releases</span></button>
      </div>
    </div>
    <div class="panel"><div class="li"><div class="grow"><div class="t1">Updates</div><div class="t2" style="white-space:normal">${portfolio().updates ? 'Checks GitHub for a new release daily and tells you (in the app and as a notification)' : 'Automatic checks are off'}</div></div>
      <button class="pill" data-act="upd-auto">${portfolio().updates ? 'on' : 'off'}</button></div></div>
    <div class="btnrow"><button class="btn" data-act="upd-check">Check for updates</button></div>
    <div class="note">Stoklore ${esc(appVersion())} · public market screens: index quotes and charts from Moneycontrol; sectors, movers, indices, search and headlines from ET Markets. Screens that need a login or Stoklore's own server (journal, watchlists, earnings, events, scans, shareholding) stay on the web app; NSE's and BSE's own feeds refuse apps outside a browser.</div>`
  window.scrollTo(0, top)
}
// the author's credit on Settings → About: the GitHub repo only, no personal details
const CREDIT = { repo: 'https://github.com/Karthik002002/Stoklore' }
// ---- app updates: GitHub's newest published release of this app (lib.js latestRelease / newerVersion) ----
const installedVersion = () => { try { return window.Native?.version?.() || '' } catch { return '' } }
async function checkUpdate(manual) {
  const installed = installedVersion()
  let rel
  try { rel = latestRelease(await getJson(RELEASES_API)) } catch (e) { if (manual) toast(`Couldn't check for updates: ${e.message}`); return }
  store.set('update.checked', String(Date.now()))
  if (!rel || !newerVersion(rel.version, installed)) { if (manual) toast(`You're on the latest version${installed ? ` (${installed})` : ''}`); return }
  if (!manual && store.get('update.skip', '') === rel.version) return
  // release notes as plain text: markdown marks and links stripped, the install / checksum footer left out
  const notes = rel.notes.split(/\n---\n/)[0].replace(/\*\*|`|#+ /g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim().slice(0, 1200)
  $('sheet').innerHTML = `<h3>Stoklore ${esc(rel.version)} is available</h3><div class="mute" style="font-size:11px">You have ${esc(installed || 'an older version')}.</div>
    ${notes ? `<pre class="prose panel" style="margin:8px 0;max-height:38vh;overflow:auto;white-space:pre-wrap;font-size:11px">${esc(notes)}</pre>` : ''}
    <div class="note" style="padding:0 0 8px">Downloads in the background - tap the "download complete" notification to install it over this version; your holdings and settings stay.</div>
    <div class="btnrow fxbtns"><button class="btn" data-act="upd-later" data-v="${esc(rel.version)}">Later</button>${rel.apk && window.Native?.downloadUpdate
      ? `<button class="btn primary" data-act="upd-dl" data-url="${esc(rel.apk)}" data-v="${esc(rel.version)}">Download ${esc(rel.version)}</button>`
      : `<button class="btn primary" data-ext="${esc(rel.apk || rel.url)}" data-pkg="">Download ${esc(rel.version)}</button>`}</div>`
  $('sheet').classList.add('on', 'big')
}
window.onUpdateTap = () => checkUpdate(true) // the update notification was tapped
const appVersion = () => { try { return `v${window.Native?.version() || ''}` } catch { return '' } }

// ---- taps and inputs ----------------------------------------------------------------------------------
const extOpen = (pkg, url) => window.Native ? Native.open(pkg || '', url) : window.open(url)
document.addEventListener('click', (e) => {
  const t = e.target
  if (t.closest('select, input')) return
  const q = (sel) => t.closest(sel)
  let el
  if ((el = q('[data-ext]'))) return extOpen(el.dataset.pkg, el.dataset.ext)
  if ((el = q('[data-app="dhan"]'))) return window.Native ? Native.openDhan(el.dataset.sym, el.dataset.url) : window.open(el.dataset.url)
  if ((el = q('[data-push]'))) return push(el.dataset.push)
  if (q('[data-back]')) return history.back()
  if ((el = q('[data-tab]'))) return goTab(el.dataset.tab)
  if ((el = q('[data-fx]'))) return filterTap(el)
  if ((el = q('[data-beat]'))) return beatTap(el)
  if ((el = q('[data-z]'))) return zoomTap(el)
  if ((el = q('[data-act="upd-later"]'))) { store.set('update.skip', el.dataset.v); return closeSheet() } // inside the card
  if ((el = q('[data-act="upd-dl"]'))) { // inside the card; the browser if the download manager refuses
    const err = Native.downloadUpdate(el.dataset.url, `stoklore-v${el.dataset.v}.apk`)
    if (err) { toast(`Opening in the browser (${err})`); extOpen('', el.dataset.url) } else toast('Downloading - tap the notification when it finishes to install')
    return closeSheet()
  }
  if ((el = q('[data-h]')) && !el.disabled) return holdTap(el)
  if (q('#sheet')) return // taps inside the card keep it open
  if (sheetOn()) { closeSheet(); if (!q('[data-m]')) return }
  if ((el = q('[data-member]'))) return openMember(el.dataset.member, el)
  if ((el = q('[data-m]'))) {
    const [sid, i] = el.dataset.m.split(':'), s = sx.data?.rows.find((x) => String(x.id) === sid)
    if (s?.members[+i]) showMember(s, s.members[+i])
    return
  }
  if ((el = q('[data-stab]'))) { store.set('stock.tab', el.dataset.stab); return showStab(el.dataset.stab) }
  if ((el = q('[data-fin]'))) { sv.fin = el.dataset.fin; store.set('stock.fin', sv.fin); return renderFin() }
  if ((el = q('[data-range]'))) {
    store.set('chart.range', el.dataset.range)
    for (const b of $('ranges').children) b.classList.toggle('on', b === el)
    if (chart) { chart.range = el.dataset.range; chart.load() }
    return
  }
  if ((el = q('[data-ctype]'))) {
    store.set('chart.type', el.dataset.ctype)
    for (const b of el.parentNode.children) b.classList.toggle('on', b === el)
    return chart?.draw()
  }
  if ((el = q('[data-font]'))) {
    const [slot, name] = el.dataset.font.split(/:(.*)/s)
    store.set(`font.${slot}`, name); applyFonts(); return renderSettings()
  }
  if ((el = q('[data-theme]'))) { store.set('theme.id', el.dataset.theme); applyTheme(); return renderSettings() }
  if ((el = q('[data-swatch]'))) { setColor(selTok, el.dataset.swatch); return renderSettings() }
  if ((el = q('[data-tok]'))) {
    selTok = el.dataset.tok
    for (const r of view.querySelectorAll('.tok')) r.classList.toggle('on', r === el)
    $('toklbl').textContent = `for ${THEME_TOKENS.find(([k]) => k === selTok)[1]}`
    return
  }
  if ((el = q('[data-act]'))) {
    const v = el.dataset.v
    switch (el.dataset.act) {
      case 'refresh': return current.refresh?.(true)
      case 'beat-menu': return beatMenu()
      case 'schart': sx.chart = v; store.set('sectors.chart', v); return renderSectors()
      case 'tsize': sx.tsize = v; store.set('sectors.tsize', v); return renderSectors()
      case 'watch': {
        const on = toggleWatch(v, sv.sym === v ? sv.meta?.name : null, sv.sym === v ? sv.meta?.id : null)
        el.classList.toggle('on', on); el.innerHTML = on ? I.starOn : I.star
        return
      }
      case 'lock': return window.Native?.setLock(v === '1')
      case 'upd-check': toast('Checking for updates…'); return checkUpdate(true)
      case 'upd-auto': { const pf = portfolio(); savePortfolio({ ...pf, updates: !pf.updates }); return renderSettings() }
      case 'mdir': mk.dir = v; for (const b of el.parentNode.children) b.classList.toggle('on', b === el); return renderMovers()
      case 'mcap': mk.cap = v; for (const b of el.parentNode.children) b.classList.toggle('on', b === el); return renderMovers()
      case 'iex':
        if (v === mk.iex) return
        mk.iex = v; store.set('markets.iex', v); mk.indices = null; $('mindices').innerHTML = '<div class="state">Loading…</div>'
        for (const b of el.parentNode.children) b.classList.toggle('on', b === el)
        return loadIndices()
      case 'sex':
        if (v === sx.exchange) return
        sx.exchange = v; store.set('sectors.exchange', v); sx.data = null; sx.error = null; sx.open.clear()
        for (const b of el.parentNode.children) b.classList.toggle('on', b === el)
        renderSectors(); return loadSectors()
      case 'opensector':
        sx.exchange = 'NSE'; store.set('sectors.exchange', 'NSE'); sx.filter = ''; sx.open.add(v); sx.focus = v
        return goTab('sectors')
      case 'feed-top': return $('feed')?.scrollTo({ top: 0, behavior: 'smooth' })
      case 'feed-more': return feedMore()
      case 'feed-restart': return feedRestart()
      case 'feed-filter':
        if (fd.pools) return openFilter()
        return sectorsFor('NSE').then((d) => { fd.pools = feedPools(d.rows, []); openFilter() }, (e) => toast(`ET sectors: ${e.message}`))
      case 'feed-unsee': store.del(seenKey()); feedReset(); return toast('The feed starts fresh next time you open it')
      case 'clear-cache': cache.clear(); return toast('Cached data cleared - screens reload fresh')
      case 'tpl-use': { const tp = allTemplates().find((x) => x.id === v); if (tp) { applyFeedFilter(tp.filter); toast(`Feed: ${tp.name}`) } return }
      case 'tpl-del': store.set('feed.templates', JSON.stringify(userTemplates().filter((x) => x.id !== v))); return renderSettings()
      case 'refresh-every': store.set('refresh.every', v); startAutoRefresh(); updateBeat(); toast(+v ? `Refreshing every ${REFRESH.find(([x]) => x === +v)[1]}` : 'Auto-refresh off'); return renderSettings()
      case 'set-jump': return document.getElementById(`set-${v}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      case 'font-zoom': store.set('font.zoom', v); applyFonts(); return renderSettings()
      case 'font-forget':
        for (const slot of ['body', 'head']) if (customFonts().includes(fontPick(slot))) store.del(`font.${slot}`)
        store.del('font.custom'); applyFonts(); return renderSettings()
      case 'font-add': {
        const name = ($('fontname')?.value || '').trim().replace(/\s+/g, ' ')
        if (!fontNameOk(name)) return toast('Letters, numbers and spaces only, e.g. Space Grotesk')
        el.disabled = true; el.textContent = 'Checking Google Fonts…'
        return loadFont(name).then((ok) => {
          if (!ok) { toast(`"${name}" isn't on Google Fonts (or you're offline)`); return renderSettings() }
          if (!FONTS.some(([f]) => f === name)) store.set('font.custom', JSON.stringify([name, ...customFonts().filter((f) => f !== name)].slice(0, 12)))
          store.set(`font.${v}`, name); applyFonts(); renderSettings(); toast(`${name} is now your ${v === 'body' ? 'body' : 'heading'} font`)
        })
      }
      case 'feed-clear': fdraft = null; return filterTap({ dataset: { fx: 'reset' } })
      case 'clear-recent': store.del('search.recent'); renderSearch(); return renderSettings()
      case 'custom-reset': {
        const base = customTheme()?.base || 'terminal-dark'
        store.del('theme.custom'); if (themeId() === 'custom') store.set('theme.id', base)
        applyTheme(); return renderSettings()
      }
    }
  }
  if (q('.members')) return // gaps between an opened sector's tiles don't fold the row
  if ((el = q('#sbub'))) return bubbleTap(e)
  if ((el = q('[data-open]'))) return toggleSector(el.dataset.open, el.classList.contains('tile') || el.dataset.map != null)
})
document.addEventListener('change', (e) => {
  const t = e.target, d = t.dataset || {}
  if (d.pfname) { // renaming a portfolio (Manage portfolios)
    const pf = portfolio(), name = t.value.trim().slice(0, 30)
    if (name) { savePortfolio({ ...pf, portfolios: pf.portfolios.map((p) => p.id === d.pfname ? { ...p, name } : p) }); renderHoldings() }
    return
  }
  if (d.sort === 'hsort') { hd.sort = t.value; store.set('holdings.sort', t.value); return renderHoldings() }
  if (d.sort === 'isort') { mk.isort = t.value; store.set('markets.isort', t.value); return renderIndices() }
  if (d.sort) {
    const key = { map: 'mapSort', list: 'listSort', member: 'memberSort' }[d.sort]
    sx[key] = t.value; store.set(`sectors.${key}`, t.value); return renderSectors()
  }
  if (d.color || d.hex) { if (!setColor(d.color || d.hex, t.value)) toast('Colours are #rrggbb, e.g. #2ebd85'); renderSettings() }
})
document.addEventListener('input', (e) => {
  const t = e.target
  if (t.id === 'sfilter') { sx.filter = t.value; return renderSectors() }
  if (t.id === 'ifilter') { mk.ifilter = t.value; return renderIndices() }
  if (t.id === 'hq') { clearTimeout(hqTimer); hqTimer = setTimeout(() => holdSearch(t.value), 250); return }
  if (t.id === 'q') { sr.q = t.value; clearTimeout(sr.timer); sr.timer = setTimeout(runSearch, 250); return }
  if (t.dataset?.color && setColor(t.dataset.color, t.value)) { // live while the picker is open
    const row = t.closest('.tok'); row.querySelector('.cur').style.background = t.value; row.querySelector('.hex').value = t.value
  }
})

// every 5 minutes while on screen, and on coming back to the app after a minute away
const REFRESH = [[0, 'Off'], [15, '15s'], [30, '30s'], [60, '1m'], [300, '5m'], [900, '15m']]
const refreshEvery = () => { const v = +store.get('refresh.every', '300'); return REFRESH.some(([x]) => x === v) ? v : 300 }
let refreshTimer = 0
/** Re-arms the auto-refresh beat from Settings. Short beats skip while the market is shut; no beat reloads
 *  behind an open card (a form you're typing in) or while the app is in the background. */
function startAutoRefresh() {
  clearInterval(refreshTimer)
  const sec = refreshEvery()
  if (!sec) return
  refreshTimer = setInterval(() => {
    updateBeat() // "paused" turns on / off as the market closes / opens
    if (document.hidden || !current.refresh || sheetOn() || (sec < 300 && !marketOpen())) return
    current.at = Date.now(); current.refresh(true, true)
  }, sec * 1000)
}
startAutoRefresh()
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && current.refresh && Date.now() - current.at > 60e3) { current.at = Date.now(); current.refresh(true, true) }
})

applyTheme()
applyFonts()
// open where you left off (a notification's #/holdings wins); a pushed screen is restored on top of its tab
if (!location.hash) {
  const last = store.get('nav.last', ''), tab = store.get('nav.tab', 'feed')
  try {
    if (/^#\/(stock|index|search)(\/|$)/.test(last)) { history.replaceState(null, '', `#/${TAB_IDS.includes(tab) ? tab : 'feed'}`); history.pushState(null, '', last) }
    else if (/^#\/[a-z]+$/.test(last) && TAB_IDS.includes(last.slice(2))) history.replaceState(null, '', last)
  } catch {}
  lastTab = TAB_IDS.includes(tab) ? tab : 'feed'
}
route()
// a newer release on GitHub? checked at most every 12 hours (the background job also checks daily and notifies)
try {
  if (portfolio().updates && Date.now() - +store.get('update.checked', '0') > 12 * 3600e3) setTimeout(() => { if (!sheetOn()) checkUpdate(false) }, 5000)
} catch {}
// the last crash (MainActivity records it): shown once, so it can be screenshotted and fixed
try {
  const crash = window.Native?.lastCrash?.()
  if (crash) setTimeout(() => {
    $('sheet').innerHTML = `<h3>Stoklore crashed last time</h3><div class="mute" style="font-size:11px">This launch skipped the background check to be safe. Screenshot this and send it - it says exactly what broke.</div>
      <pre class="prose panel" style="margin:6px 0;max-height:45vh;overflow:auto;white-space:pre-wrap;font-size:10px">${esc(crash.slice(0, 4000))}</pre>
      <div class="btnrow fxbtns"><button class="btn primary" data-h="close">OK</button></div>`
    $('sheet').classList.add('on', 'big')
  }, 1800)
} catch {}
