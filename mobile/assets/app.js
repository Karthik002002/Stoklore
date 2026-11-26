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
  theme: svg('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>'),
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
  const rows = ((await getJson(ET_SECTORS + ex)).searchresult || []).map(sectorRow)
  for (const s of rows) for (const m of s.members) memberIndex.set(String(m.id), m)
  return { rows, at: Date.now() }
}, force)
const indicesFor = (ex, force) => cached(`indices:${ex}`, 120e3, async () =>
  ((await getJson(`https://etmarketsapis.indiatimes.com/ET_Stats/getAllIndices?exchange=${ex.toLowerCase()}&pagesize=200`)).searchresult || []).map(indexRow), force)
const indexQuote = (code, force) => cached(`iq:${code}`, 30e3, async () =>
  mcQuote((await getJson(`https://priceapi.moneycontrol.com/pricefeed/notapplicable/inidicesindia/${encodeURIComponent(code)}`)).data), force)
const barsFor = (kind, sym, range, force) => cached(`bars:${kind}:${sym}:${range}`, range === '1D' || range === '5D' ? 60e3 : 600e3,
  async () => mcBars(await getJson(mcHistoryUrl(kind, sym, range)), range), force)
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

// ---- shell: top bar, tabs, routing -----------------------------------------------------------------
const TABS = [['feed', 'Feed', I.feed], ['markets', 'Markets', I.markets], ['sectors', 'Sectors', I.sectors], ['search', 'Search', I.search], ['settings', 'Theme', I.theme]]
const TAB_IDS = TABS.map((t) => t[0])
$('tabs').innerHTML = TABS.map(([id, label, ic]) => `<button data-tab="${id}">${ic}<span>${label}</span></button>`).join('')
const refreshBtn = `<button class="icon" id="refresh" data-act="refresh" aria-label="Refresh">${I.refresh}</button>`
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
  nav++; chart = null; closeSheet()
  current = { name: TAB_IDS.includes(name) || name === 'stock' || name === 'index' ? name : 'feed', refresh: null, at: Date.now() }
  document.body.classList.toggle('feed-on', current.name === 'feed')
  if (TAB_IDS.includes(current.name)) lastTab = current.name
  for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === lastTab)
  view.className = ''; void view.offsetWidth; view.className = dir
  if (current.name === 'stock' && arg) stockScreen(arg.toUpperCase())
  else if (current.name === 'index' && arg) indexScreen(arg)
  else if (current.name === 'sectors') sectorsScreen()
  else if (current.name === 'search') searchScreen()
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
  g.font = '10px ui-monospace, "Roboto Mono", monospace'; g.textBaseline = 'middle'
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
  c.load = async (force) => {
    c.bars = []; c.msg = 'Loading…'; c.hover = null; c.draw(); info.textContent = ''
    const range = c.range
    try { const b = await barsFor(kind, sym, range, force); if (tok !== nav || range !== c.range) return; c.bars = b; c.msg = b.length ? '' : 'No bars for this range' }
    catch (e) { if (tok !== nav) return; c.msg = `Chart unavailable (${e.message})` }
    c.draw(); summary()
  }
  const pick = (e) => {
    if (!c.bars.length) return
    const r = cv.getBoundingClientRect()
    c.hover = Math.max(0, Math.min(c.bars.length - 1, Math.floor((e.clientX - r.left) / ((r.width - AXIS) / c.bars.length))))
    c.draw()
    const b = c.bars[c.hover]
    info.innerHTML = `${esc(fullDate(b.t, c.range))} · O ${fmt(b.o)} H ${fmt(b.h)} L ${fmt(b.l)} C <b>${fmt(b.c)}</b>${b.v ? ` · V ${compact(b.v)}` : ''}`
  }
  const end = () => { if (c.hover == null) return; c.hover = null; c.draw(); summary() }
  cv.addEventListener('pointerdown', pick)
  cv.addEventListener('pointermove', (e) => { if (c.hover != null) pick(e) })
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) cv.addEventListener(ev, end)
  chart = c; c.load()
  return c
}
window.addEventListener('resize', () => { chart?.draw(); if (current.name === 'markets') paintSparks(); if (current.name === 'feed') repaintFeed() })
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
  setTop({ title: 'Stoklore', small: 'Markets', right: refreshBtn })
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
  setTop({ title: 'Sectors', small: 'ET Markets', right: refreshBtn,
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
  h += `<div class="map"><div class="bar-head"><span>Sector map · size = mcap</span>${sortSelect('map', sx.mapSort, SECTOR_SORTS)}</div><div class="tiles">`
  for (const s of sortRows(sectors, sx.mapSort, SECTOR_FIELDS)) {
    const cap = Math.max(s.mcap_cr ?? 0, 0)
    h += `<button class="tile${sx.open.has(s.id) ? ' open' : ''}" data-open="${esc(s.id)}" style="flex-grow:${Math.sqrt(Math.max(cap, 1))};flex-basis:${Math.min(10, 4 + Math.sqrt(cap) / 160)}rem;${tileStyle(s.change_pct)}"><p>${esc(s.name)}</p><p>${pctText(s.change_pct)}</p></button>`
  }
  h += `</div><div class="legend">breadth: ${BUCKET_LABELS.map((l, i) => `<span><i style="background:${bc[i]}"></i>${l}</span>`).join('')}</div></div>`
  h += `<div class="bar-head"><span>${shown.length} sectors</span>${sortSelect('list', sx.listSort, SECTOR_SORTS)}</div>`
  if (!shown.length) h += `<div class="state">No sector or company matches “${esc(sx.filter)}”.</div>`
  for (const s of shown) h += sectorHtml(s, maxMove, bc)
  view.innerHTML = h
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
const closeSheet = () => $('sheet').classList.remove('on')
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
  setTop({ title: 'Search', small: 'NSE stocks by name or symbol', sub: `<input class="in" id="q" type="search" placeholder="Reliance, TCS, HDFC Bank…" value="${esc(sr.q)}" autocomplete="off" spellcheck="false">` })
  renderSearch(); endIntro()
  if (!sr.q) setTimeout(() => { if (current.name === 'search') $('q')?.focus() }, 300)
}
async function runSearch() {
  const q = sr.q.trim(), seq = ++sr.seq
  if (!q) { sr.hits = null; renderSearch(); return }
  try { const hits = await etSearch(q); if (seq !== sr.seq) return; sr.hits = hits.filter((x) => x.entityType === 'company' && x.symbol); sr.err = null }
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
async function stockScreen(sym) {
  const tok = nav
  setTop({ title: sym, small: 'NSE', back: true })
  view.innerHTML = `<div class="quote" id="q"><div class="p">—</div><div class="c mute">Loading…</div></div>${chartBlock()}
    <div class="sec">Key stats</div><div class="panel"><div class="kv" id="stats">${kvHtml([['Prev close', '—'], ['Open', '—']])}</div></div>
    <div id="sect"></div>
    <div class="sec">Research</div><div class="links" id="rl">${linksHtml(sym, null)}</div>`
  mountChart('stock', sym)
  current.refresh = (f) => { chart?.load(f); paint(f) }
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
    if (meta) { setSmall(esc(meta.name)); remember(sym, meta.name); $('rl').innerHTML = linksHtml(sym, meta) }
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
  setTop({ title: meta.name, small: 'Moneycontrol', back: true })
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
  current.refresh = (f) => { chart?.load(f); paint(f) }
  paint()
}

// ---- Feed: one card per screen, 40 to a page, picked by lib.js feedPage from the sector feed --------------
// Only cards within 3 of the one on screen have content; the rest are empty, same-height slots.
const todayIST = () => new Date(Date.now() + 19800e3).toISOString().slice(0, 10)
const seenKey = () => `feed.seen.${todayIST()}`
const fd = { day: null, cards: [], page: 0, pools: null, seen: null, viewed: null, idx: 0, scrollTop: 0, done: false }
let feedObs = null
function feedReset() {
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k?.startsWith('feed.seen.') && k !== seenKey()) localStorage.removeItem(k) } } catch {}
  Object.assign(fd, { day: todayIST(), cards: [], page: 0, idx: 0, scrollTop: 0, done: false, viewed: new Set(store.json(seenKey(), [])) })
  fd.seen = new Set(fd.viewed) // what reached the screen earlier today is skipped
}
function nextPage() { // appends the next page that has anything, or the final card
  for (;;) {
    const r = feedPage(fd.pools, fd.page++, fd.seen)
    if (r.cards.length) { fd.cards.push(...r.cards); return }
    if (r.theme === 'rest') { fd.cards.push({ kind: 'final', id: 'final' }); fd.done = true; return }
  }
}
async function feedScreen() {
  const tok = nav
  setTop({ title: 'Feed', small: 'Today, one card at a time', right: refreshBtn })
  current.refresh = feedRefresh
  if (fd.day !== todayIST()) feedReset()
  view.innerHTML = '<div id="feed"></div>'
  if (!fd.cards.length) {
    $('feed').innerHTML = '<div class="state">Building your feed…</div>'
    spin(true)
    try { fd.pools = feedPools((await sectorsFor('NSE')).rows); if (!fd.cards.length) nextPage() }
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
  if (/^(s|sec):/.test(c.id) && !fd.viewed.has(c.id)) { fd.viewed.add(c.id); store.set(seenKey(), JSON.stringify([...fd.viewed])) }
  setSmall(`Card ${i + 1} of ${fd.cards.length}${fd.done ? '' : '+'}`)
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
async function feedRefresh(force) {
  spin(true)
  try { fd.pools = feedPools((await sectorsFor('NSE', force)).rows) } catch (e) { toast(`ET sectors: ${e.message}`) }
  spin(false)
  if (current.name === 'feed') repaintFeed() // same cards, today's numbers
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
  } else if (c.kind === 'end') {
    const s = sectorSummary(fd.pools?.sectors || []), last = +el.dataset.i === fd.cards.length - 1
    el.innerHTML = card(' style="justify-content:center;text-align:center"', `<div class="fk">${c.page === 0 ? 'Caught up' : esc(c.label)}</div>
      <div class="fname" style="font-size:24px">${c.page === 0 ? 'You\'re caught up' : `${esc(c.label)}: done`}</div>
      <div class="fstory">You saw ${c.shown} cards · <span class="up">${c.up} up</span> · <span class="down">${c.down} down</span>${c.sectors ? ` · ${c.sectors} sectors` : ''}</div>
      <div class="fstory mute">Today: <span class="up">${s.advance} ▲</span> <span class="down">${s.decline} ▼</span> · ${s.up} of ${(fd.pools?.sectors || []).length} sectors up${s.best ? ` · best ${esc(s.best.name)} ${pctSpan(s.best.change_pct)}` : ''}</div>
      <div class="btnrow" style="flex-direction:column;padding:12px 0 0"><button class="btn primary" data-act="feed-top">Back to top</button>
      ${last ? `<button class="btn" data-act="feed-more">Show more: ${esc(c.next)}</button>` : '<div class="mute">More below ↓</div>'}</div>`)
  } else if (c.kind === 'final') {
    el.innerHTML = card(' style="justify-content:center;text-align:center"', `<div class="fk">End of today</div>
      <div class="fname" style="font-size:22px">That's every stock that moved today</div>
      <div class="fstory mute">${fd.viewed.size} cards seen. Tomorrow's feed starts fresh.</div>
      <div class="btnrow" style="flex-direction:column;padding:12px 0 0"><button class="btn primary" data-act="feed-top">Back to top</button><button class="btn" data-act="feed-restart">Start today's feed over</button></div>`)
  }
}

// ---- Theme (Settings) ------------------------------------------------------------------------------------
let selTok = 'up'
function settingsScreen() {
  setTop({ title: 'Theme', small: 'Colours for every screen and chart' })
  renderSettings(); endIntro()
}
function renderSettings() {
  if (current.name !== 'settings') return
  const id = themeId(), custom = customTheme(), cur = resolveTheme(id, custom)
  const pv = (t) => `<div class="pv" style="background:${t.colors.background}"><i style="background:${t.colors.card};width:80%"></i><i style="background:${t.colors.accent};width:45%"></i>
    <div class="sw"><i style="background:${t.colors.up}"></i><i style="background:${t.colors.down}"></i><i style="background:${t.colors.foreground}"></i></div></div>`
  const list = [...THEMES, ...(custom ? [resolveTheme('custom', custom)] : [])]
  const tokLabel = THEME_TOKENS.find(([k]) => k === selTok)?.[1]
  view.innerHTML = `<div class="sec">Templates</div>
    <div class="themes">${list.map((t) => `<button class="theme${t.id === cur.id ? ' on' : ''}" data-theme="${t.id}">${pv(t)}<div class="nm">${esc(t.label)}</div></button>`).join('')}</div>
    <div class="sec">Preview</div>
    <div class="panel"><div class="tiles" style="padding:8px">${[-4, -2, -0.5, 0, 0.5, 2, 4].map((p) => `<div class="tile" style="flex:1;min-width:0;${tileStyle(p)}"><p>${pctText(p, 1)}</p></div>`).join('')}</div></div>
    <div class="sec">Custom colours<span class="act mute">${cur.id === 'custom' ? 'your theme' : `starts from ${esc(cur.label)}`}</span></div>
    <div class="panel">${THEME_TOKENS.map(([k, l]) => `<div class="tok${k === selTok ? ' on' : ''}" data-tok="${k}"><i class="cur" style="display:inline-block;background:${cur.colors[k]}"></i><span class="lbl">${l}</span>
      <input class="in hex" data-hex="${k}" value="${cur.colors[k]}" maxlength="7" autocomplete="off" spellcheck="false"><input type="color" data-color="${k}" value="${cur.colors[k]}"></div>`).join('')}</div>
    <div class="sec">Quick colours<span class="act mute" id="toklbl">for ${esc(tokLabel)}</span></div>
    <div class="swatches">${SWATCHES.map((c) => `<button data-swatch="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>
    ${custom ? '<div class="btnrow"><button class="btn" data-act="custom-reset">Delete custom theme</button></div>' : ''}
    <div class="sec">Chart</div><div class="btnrow">${typeSeg().replace('class="seg"', 'class="seg full"')}</div>
    <div class="sec">About</div>
    <div class="note">Stoklore's public market screens: index quotes and charts from Moneycontrol, sectors, movers, indices and search from ET Markets. Screens that need a login or Stoklore's own server (journal, watchlists, earnings, events, news, scans, shareholding) stay on the web app; NSE's and BSE's own feeds refuse apps outside a browser.</div>`
}

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
  if (q('#sheet')) return // taps inside the card keep it open
  if (sheetOn()) { closeSheet(); if (!q('[data-m]')) return }
  if ((el = q('[data-member]'))) return openMember(el.dataset.member, el)
  if ((el = q('[data-m]'))) {
    const [sid, i] = el.dataset.m.split(':'), s = sx.data?.rows.find((x) => String(x.id) === sid)
    if (s?.members[+i]) showMember(s, s.members[+i])
    return
  }
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
      case 'clear-recent': store.del('search.recent'); return renderSearch()
      case 'custom-reset': {
        const base = customTheme()?.base || 'terminal-dark'
        store.del('theme.custom'); if (themeId() === 'custom') store.set('theme.id', base)
        applyTheme(); return renderSettings()
      }
    }
  }
  if (q('.members')) return // gaps between an opened sector's tiles don't fold the row
  if ((el = q('[data-open]'))) {
    const id = el.dataset.open, fromMap = el.classList.contains('tile')
    if (sx.open.has(id)) sx.open.delete(id); else sx.open.add(id)
    if (fromMap && sx.open.has(id) && sx.filter) { sx.filter = ''; $('sfilter').value = '' }
    renderSectors()
    if (fromMap && sx.open.has(id)) document.getElementById(`sector-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
})
document.addEventListener('change', (e) => {
  const t = e.target, d = t.dataset || {}
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
  if (t.id === 'q') { sr.q = t.value; clearTimeout(sr.timer); sr.timer = setTimeout(runSearch, 250); return }
  if (t.dataset?.color && setColor(t.dataset.color, t.value)) { // live while the picker is open
    const row = t.closest('.tok'); row.querySelector('.cur').style.background = t.value; row.querySelector('.hex').value = t.value
  }
})

// every 5 minutes while on screen, and on coming back to the app after a minute away
setInterval(() => { if (!document.hidden && current.refresh) { current.at = Date.now(); current.refresh(true) } }, 300e3)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && current.refresh && Date.now() - current.at > 60e3) { current.at = Date.now(); current.refresh(true) }
})

applyTheme()
route()
