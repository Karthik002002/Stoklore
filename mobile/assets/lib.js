// Pure data + maths for the app: no DOM, no network. Loaded by index.html before app.js, and by
// mobile/check.mjs, which asserts on it in Node. Everything here is a global (classic script).

// ---- formatting ---------------------------------------------------------------------------------
const fmt = (v, d = 2) => v == null || Number.isNaN(+v) ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
const pctText = (v, d = 2) => v == null || Number.isNaN(+v) ? '—' : `${v >= 0 ? '+' : ''}${fmt(v, d)}%`
const pctClass = (v) => v == null || v === 0 ? 'mute' : v > 0 ? 'up' : 'down'
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
/** Rupees crore, short: 5,86,347 Cr -> "5.86L Cr", 8,112 Cr -> "8,112 Cr" (frontend/src/lib/sectors.ts). */
const croreShort = (v) => v == null ? '—' : Math.abs(v) >= 1e5 ? `${(v / 1e5).toFixed(2)}L Cr` : `${Math.round(v).toLocaleString('en-IN')} Cr`
const num = (v) => v == null || v === '' || Number.isNaN(+v) ? null : +v

// ---- colour -------------------------------------------------------------------------------------
const hexRgb = (hex) => {
  let h = String(hex || '').replace('#', '').trim()
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return /^[0-9a-f]{6}$/i.test(h) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [128, 128, 128]
}
const isHex = (v) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v || '').trim())
const rgba = (hex, a) => `rgba(${hexRgb(hex).join(', ')}, ${a})`
/** Relative luminance 0..1 (WCAG). */
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** `fg` at alpha `a` laid over `bg`, as rgb. */
const blend = (fg, bg, a) => hexRgb(fg).map((c, i) => Math.round(c * a + hexRgb(bg)[i] * (1 - a)))

/** A day's % move as a fill: the theme's up colour for a gain, down for a loss, deeper the bigger the
 *  move, saturating at ±4% (frontend/src/lib/sectors.ts heatColor, with the colours made themeable).
 *  Returns { bg, fg }: the fill, and a text colour that stays readable on it. */
function heat(pct, t) {
  const flat = pct == null || Number.isNaN(pct) || pct === 0
  const a = flat ? 0.25 : 0.18 + 0.72 * Math.min(Math.abs(pct) / 4, 1)
  const col = flat ? t['muted-foreground'] : pct > 0 ? t.up : t.down
  const solid = blend(col, t.card, a)
  return { bg: `rgb(${solid.join(', ')})`, fg: luminance(solid) > 0.45 ? '#0b0b0b' : '#f5f5f5' }
}
/** The five breadth buckets (down >2% … up >2%) in the theme's colours. */
const bucketColors = (t) => [t.down, rgba(t.down, 0.55), rgba(t['muted-foreground'], 0.5), rgba(t.up, 0.55), t.up]
const BUCKET_LABELS = ['Down >2%', 'Down ≤2%', 'Unchanged', 'Up ≤2%', 'Up >2%']

// ---- themes: the web app's presets (frontend/src/design-system/tokens/themes.ts) + phone extras ----
const THEME_TOKENS = [
  ['background', 'Page'], ['card', 'Panel'], ['panel-head', 'Header / bars'], ['muted', 'Subtle fill'],
  ['foreground', 'Text'], ['muted-foreground', 'Muted text'], ['border', 'Hairline'], ['input', 'Control border'],
  ['accent', 'Accent'], ['up', 'Up / gain'], ['down', 'Down / loss'], ['warning', 'Warning'],
]
const THEMES = [
  { id: 'terminal-dark', label: 'Terminal Dark', mode: 'dark', colors: { background: '#0a0c0f', card: '#15181c', 'panel-head': '#101316', muted: '#1c1f24', foreground: '#d5d9de', 'muted-foreground': '#7d848d', border: '#23272c', input: '#30353b', accent: '#5b9cf5', up: '#2ebd85', down: '#ef5350', warning: '#e9b44c' } },
  { id: 'terminal-light', label: 'Terminal Light', mode: 'light', colors: { background: '#e9ebee', card: '#ffffff', 'panel-head': '#f7f8f9', muted: '#f0f1f3', foreground: '#262a30', 'muted-foreground': '#6b727c', border: '#dcdfe3', input: '#cdd1d6', accent: '#2f6fd6', up: '#0f9d6e', down: '#d8343f', warning: '#c98a12' } },
  { id: 'midnight', label: 'Midnight', mode: 'dark', colors: { background: '#060a12', card: '#0d1422', 'panel-head': '#0a101b', muted: '#131c2d', foreground: '#d6deeb', 'muted-foreground': '#7b8ba5', border: '#1c2638', input: '#2a3650', accent: '#7c8cff', up: '#3ddc97', down: '#ff5c7a', warning: '#ffc857' } },
  { id: 'amber', label: 'Amber Terminal', mode: 'dark', colors: { background: '#000000', card: '#0b0a08', 'panel-head': '#060504', muted: '#16130d', foreground: '#e8e2d0', 'muted-foreground': '#8a8068', border: '#262116', input: '#3a3222', accent: '#ffb000', up: '#4ade80', down: '#f87171', warning: '#ffb000' } },
  // black & white: gains bright, losses dim - direction still reads from the ▲▼ and the sign
  { id: 'mono-dark', label: 'Monochrome Black', mode: 'dark', colors: { background: '#000000', card: '#0a0a0a', 'panel-head': '#050505', muted: '#1a1a1a', foreground: '#f2f2f2', 'muted-foreground': '#8c8c8c', border: '#262626', input: '#3d3d3d', accent: '#ffffff', up: '#f5f5f5', down: '#6e6e6e', warning: '#bdbdbd' } },
  { id: 'mono-light', label: 'Monochrome White', mode: 'light', colors: { background: '#ffffff', card: '#ffffff', 'panel-head': '#f6f6f6', muted: '#efefef', foreground: '#0d0d0d', 'muted-foreground': '#6b6b6b', border: '#e3e3e3', input: '#c9c9c9', accent: '#000000', up: '#111111', down: '#a3a3a3', warning: '#555555' } },
  // blue up / orange down: tells gains from losses for red-green colour blindness
  { id: 'ocean', label: 'Ocean (colour-blind safe)', mode: 'dark', colors: { background: '#07121c', card: '#0c1b29', 'panel-head': '#091723', muted: '#122536', foreground: '#dbe7f0', 'muted-foreground': '#7f97ab', border: '#183044', input: '#24425c', accent: '#38bdf8', up: '#3b82f6', down: '#f97316', warning: '#facc15' } },
  { id: 'dusk', label: 'Dusk', mode: 'dark', colors: { background: '#141021', card: '#1d1730', 'panel-head': '#181328', muted: '#262040', foreground: '#e6dff7', 'muted-foreground': '#9488b3', border: '#2e2648', input: '#40365f', accent: '#c084fc', up: '#2dd4bf', down: '#fb7185', warning: '#fbbf24' } },
  { id: 'paper', label: 'Paper', mode: 'light', colors: { background: '#f4efe6', card: '#fbf8f2', 'panel-head': '#f0e9dc', muted: '#ebe3d4', foreground: '#2b2620', 'muted-foreground': '#7a6f60', border: '#e0d6c4', input: '#cfc3ae', accent: '#9a5b13', up: '#2f7d32', down: '#b3261e', warning: '#b7791f' } },
]
const SWATCHES = ['#000000', '#0a0c0f', '#15181c', '#1e293b', '#ffffff', '#f4efe6', '#d5d9de', '#7d848d', '#2ebd85', '#22c55e', '#3b82f6', '#38bdf8', '#5b9cf5', '#7c8cff', '#c084fc', '#2dd4bf', '#ef5350', '#f97316', '#fb7185', '#ffb000', '#facc15', '#6e6e6e', '#a3a3a3', '#f5f5f5']

/** The theme to paint with: a preset by id, or 'custom' (its own colours over a base preset). */
function resolveTheme(id, custom) {
  if (id === 'custom' && custom) {
    const base = THEMES.find((t) => t.id === custom.base) || THEMES[0]
    const colors = { ...base.colors }
    for (const [k] of THEME_TOKENS) if (isHex(custom.colors?.[k])) colors[k] = custom.colors[k]
    return { id: 'custom', label: 'Custom', mode: luminance(hexRgb(colors.background)) > 0.5 ? 'light' : 'dark', colors }
  }
  return THEMES.find((t) => t.id === id) || THEMES[0]
}

// ---- fonts: system stacks + Google Fonts, for body text and headings (Settings) ----------------------
const FONT_STACKS = { mono: 'ui-monospace, "Roboto Mono", "Droid Sans Mono", monospace', sans: 'system-ui, Roboto, "Noto Sans", sans-serif', serif: 'Georgia, "Noto Serif", serif' }
// [family, label, kind] - 'system-*' needs no download; the rest load from fonts.googleapis.com
const FONTS = [
  ['system-mono', 'System mono', 'mono'], ['system-sans', 'System sans', 'sans'], ['system-serif', 'System serif', 'serif'],
  ['JetBrains Mono', 'JetBrains Mono', 'mono'], ['IBM Plex Mono', 'IBM Plex Mono', 'mono'], ['Roboto Mono', 'Roboto Mono', 'mono'],
  ['Fira Code', 'Fira Code', 'mono'], ['Space Mono', 'Space Mono', 'mono'], ['Source Code Pro', 'Source Code Pro', 'mono'],
  ['Inter', 'Inter', 'sans'], ['Roboto', 'Roboto', 'sans'], ['Manrope', 'Manrope', 'sans'], ['IBM Plex Sans', 'IBM Plex Sans', 'sans'],
  ['Space Grotesk', 'Space Grotesk', 'sans'], ['DM Sans', 'DM Sans', 'sans'], ['Poppins', 'Poppins', 'sans'], ['Outfit', 'Outfit', 'sans'],
  ['Nunito', 'Nunito', 'sans'], ['Merriweather', 'Merriweather', 'serif'], ['Lora', 'Lora', 'serif'], ['IBM Plex Serif', 'IBM Plex Serif', 'serif'],
]
/** A Google Fonts family name: letters, digits, spaces. It goes into a URL and a CSS string, so nothing else. */
const fontNameOk = (n) => /^[A-Za-z0-9][A-Za-z0-9 ]{0,48}$/.test(String(n ?? '').trim())
const fontKind = (name) => name.startsWith('system-') ? name.slice(7)
  : FONTS.find((f) => f[0] === name)?.[2] || (/mono|code/i.test(name) ? 'mono' : /serif/i.test(name) && !/sans/i.test(name) ? 'serif' : 'sans')
const fontLabel = (name) => FONTS.find((f) => f[0] === name)?.[1] || name
/** The CSS font-family for a choice: the family first, then a system stack of the same kind. */
const fontStack = (name) => {
  if (!name || name.startsWith('system-') || !fontNameOk(name)) return FONT_STACKS[name?.slice(7)] || FONT_STACKS.mono
  return `"${name.trim()}", ${FONT_STACKS[fontKind(name)]}`
}
/** css2 URL; 400 + 700 when the family has them (the caller retries without weights if not). */
const googleFontUrl = (name, bold = true) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name.trim()).replace(/%20/g, '+')}${bold ? ':wght@400;700' : ''}&display=swap`

// ---- sectors: ET's feed -> Stoklore's shape (app/core/scraper.py::_sector_row) ------------------
function sectorRow(r) {
  const crore = (v) => v == null ? null : Math.round(v / 1e5) / 100
  const cons = r.sectorConstituents || []
  const members = cons.map((c) => ({
    name: c.companyName, slug: c.seoName, id: c.companyId, price: c.current, change_pct: c.percentChange,
    mcap_cr: c.marketCap, volume_k: c.volumeInThousand, sector: r.sectorName, sectorId: r.sectorId,
  })).sort((a, b) => (b.mcap_cr || 0) - (a.mcap_cr || 0))
  return {
    id: r.sectorId, name: r.sectorName, mcap_cr: crore(r.marketCap), mcap_change_cr: crore(r.marketCapChange),
    change_pct: r.marketCapPercentChange, advance: r.advance, decline: r.decline, unchanged: r.noChange,
    buckets: [r.countLessThanMinus2, r.countBetMinus2to0, r.countEq0, r.countBet0toPlus2, r.countGreaterThanPlus2].map((n) => n || 0),
    members, updated: cons.find((c) => c.updatedDateTime)?.updatedDateTime ?? null,
  }
}
const bucketShares = (b) => { const t = b.reduce((s, n) => s + (n || 0), 0); return b.map((n) => (t ? ((n || 0) / t) * 100 : 0)) }
const breadth = (s) => { const m = (s.advance ?? 0) + (s.decline ?? 0); return m ? (s.advance ?? 0) / m : null }
function sectorSummary(sectors) {
  const up = sectors.filter((s) => (s.change_pct ?? 0) > 0).length
  const down = sectors.filter((s) => (s.change_pct ?? 0) < 0).length
  const mcap = sectors.reduce((t, s) => t + (s.mcap_cr ?? 0), 0)
  const change = sectors.reduce((t, s) => t + (s.mcap_change_cr ?? 0), 0)
  const prev = mcap - change
  const ranked = sectors.filter((s) => s.change_pct != null).sort((a, b) => b.change_pct - a.change_pct)
  return {
    up, down, flat: sectors.length - up - down, mcap, change, changePct: prev > 0 ? (change / prev) * 100 : null,
    best: ranked[0] ?? null, worst: ranked.at(-1) ?? null,
    advance: sectors.reduce((t, s) => t + (s.advance ?? 0), 0), decline: sectors.reduce((t, s) => t + (s.decline ?? 0), 0),
  }
}

/** Sort with nulls last whichever way (frontend/src/lib/sortRows.ts). `value` = "key:asc|desc". */
function sortRows(rows, value, fields) {
  const [key, dir] = value.split(':'); const get = fields[key]; if (!get) return rows
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = get(a), y = get(b)
    if (x == null) return y == null ? 0 : 1
    if (y == null) return -1
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sign
  })
}

// ---- market movers: every stock in ET's sector feed, bucketed the SEBI way (rank by market cap:
// 1-100 large, 101-250 mid, the rest small). The web's movers table is NSE's per-index gainers/losers,
// which the phone can't fetch (NSE refuses non-browser clients) - this is the same day, cut by size. ----
function allStocks(sectors) {
  const seen = new Map()
  for (const s of sectors) for (const m of s.members) if (m.id && !seen.has(m.id)) seen.set(m.id, m)
  const list = [...seen.values()].sort((a, b) => (b.mcap_cr || 0) - (a.mcap_cr || 0))
  list.forEach((m, i) => { m.capRank = i + 1; m.cap = i < 100 ? 'large' : i < 250 ? 'mid' : 'small' })
  return list
}
function movers(stocks, cap = 'all', dir = 'gainers', n = 15) {
  const pool = stocks.filter((m) => m.change_pct != null && (cap === 'all' || m.cap === cap))
  const sign = dir === 'gainers' ? -1 : 1
  return pool.filter((m) => (dir === 'gainers' ? m.change_pct > 0 : m.change_pct < 0))
    .sort((a, b) => (a.change_pct - b.change_pct) * sign).slice(0, n)
}

// ---- indices (ET getAllIndices) ------------------------------------------------------------------
const indexRow = (r) => ({
  id: r.indexId, name: r.indexName, symbol: r.scripCode1GivenByExhange, value: r.currentIndexValue,
  change: r.netChange, change_pct: r.perChange, open: r.openIndexValue, high: r.highIndexValue, low: r.lowIndexValue,
  prev: r.closeIndexValue, hi52: r.fiftyTwoWeekHighIndexValue, lo52: r.fiftyTwoWeekLowIndexValue,
  advance: r.advances, decline: r.declines, unchanged: r.noChange, time: r.datetimeStr,
})

// ---- Moneycontrol: index quotes + chart bars -----------------------------------------------------
// The four index cards and their Moneycontrol keys (priceapi.moneycontrol.com, as on its own pages).
const MC_INDICES = [
  { code: 'in;NSX', name: 'NIFTY 50' }, { code: 'in;SEN', name: 'SENSEX' },
  { code: 'in;nbx', name: 'BANK NIFTY' }, { code: 'in;IDXN', name: 'INDIA VIX' },
]
function mcQuote(d) {
  if (!d) return null
  const pct = (k) => num(d[k])
  return {
    name: d.company, price: num(d.pricecurrent), change: num(d.pricechange), change_pct: num(d.pricepercentchange),
    open: num(d.OPEN), high: num(d.HIGH), low: num(d.LOW), prev: num(d.priceprevclose), hi52: num(d['52wkhi']), lo52: num(d['52wklow']),
    advance: num(d.adv), decline: num(d.decl), state: d.market_state, updated: d.lastupd,
    returns: [['1W', pct('cl1wPerChange')], ['1M', pct('cl1mPerChange')], ['3M', pct('cl3mPerChange')], ['YTD', pct('clYtdPerChange')],
      ['1Y', pct('cl1yPerChange')], ['3Y', pct('cl3yPerChange')], ['5Y', pct('cl5yPerChange')]],
  }
}
// UI range -> Moneycontrol resolution + bars back. 1D keeps only the latest session's bars.
const RANGES = {
  '1D': { res: '5', back: 90, days: 6 }, '5D': { res: '15', back: 140, days: 10 },
  '1M': { res: '1D', back: 23, days: 45 }, '6M': { res: '1D', back: 128, days: 200 },
  '1Y': { res: '1D', back: 250, days: 380 }, '5Y': { res: '1W', back: 262, days: 365 * 5 + 20 },
}
function mcHistoryUrl(kind, symbol, range, now = Math.floor(Date.now() / 1000)) {
  const r = RANGES[range]
  return `https://priceapi.moneycontrol.com/techCharts/indianMarket/${kind}/history?symbol=${encodeURIComponent(symbol)}&resolution=${r.res}&from=${now - r.days * 86400}&to=${now}&countback=${r.back}&currencyCode=INR`
}
/** Moneycontrol's {s, t[], o[], h[], l[], c[], v[]} -> bars. */
function mcBars(j, range) {
  if (!j || j.s !== 'ok' || !Array.isArray(j.t)) return []
  let bars = j.t.map((t, i) => ({ t, o: j.o[i], h: j.h[i], l: j.l[i], c: j.c[i], v: j.v?.[i] ?? 0 }))
    .filter((b) => b.o != null && b.h != null && b.l != null && b.c != null)
  if (range === '1D' && bars.length) {
    const day = (t) => new Date((t + 19800) * 1000).toISOString().slice(0, 10) // IST date
    const last = day(bars.at(-1).t)
    bars = bars.filter((b) => day(b.t) === last)
  }
  return bars
}
/** What a bar series says about itself: last, change over the series, range, average volume. */
function barStats(bars) {
  if (!bars.length) return null
  const first = bars[0], last = bars.at(-1)
  const hi = Math.max(...bars.map((b) => b.h)), lo = Math.min(...bars.map((b) => b.l))
  return { last: last.c, first: first.o, change: last.c - first.o, change_pct: first.o ? (last.c / first.o - 1) * 100 : null, hi, lo, avgVol: bars.reduce((s, b) => s + (b.v || 0), 0) / bars.length }
}
/** Nice round axis ticks between lo and hi, about `n` of them. */
function ticks(lo, hi, n = 4) {
  if (!(hi > lo)) return [lo]
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)
  const out = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10))
  return out
}

// ---- research links (frontend/src/components/StockLinks.tsx): only the ones keyed by the NSE
// symbol or by ET's own page - the rest need Stoklore's backend to look the page up ----
const researchLinks = (sym, et) => [
  { name: 'Screener', hint: 'Financials, ratios', url: `https://www.screener.in/company/${encodeURIComponent(sym)}/consolidated/` },
  { name: 'TradingView', hint: 'Chart, ideas', url: `https://www.tradingview.com/chart/?symbol=NSE:${encodeURIComponent(sym)}`, app: 'com.tradingview.tradingviewapp' },
  { name: 'ET Markets', hint: 'News, analysis', url: et?.seo && et?.id ? `https://economictimes.indiatimes.com/${et.seo}/stocks/companyid-${et.id}.cms` : 'https://economictimes.indiatimes.com/markets/stocks' },
  { name: 'Moneycontrol', hint: 'News, results', url: `https://www.moneycontrol.com/stocks/cptmarket/compsearchnew.php?topsearch_type=1&search_str=${encodeURIComponent(sym)}` },
  { name: 'NSE', hint: 'Quote, filings', url: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(sym)}` },
  { name: 'Google Finance', hint: 'Quick quote', url: `https://www.google.com/finance/quote/${encodeURIComponent(sym)}:NSE` },
]

// ---- the Feed: 40-card pages picked from the sector feed alone (FEED_PLAN.md §10) ----------------
// No randomness: the same data + the same `seen` gives the same cards.
const FEED_PAGE = 40, FEED_MIN_MCAP = 500, FEED_PER_SECTOR = 3, FEED_MIN_SMALLER = 5, NEWS_EVERY = 5
const FEED_THEMES = [['top', 'Top of the day'], ['sectors', 'Sector deep dive'], ['smaller', 'Mid and small caps'], ['quiet', 'Big and quiet'], ['rest', 'Everything else']]
// page 1: 2 + 10 movers + sector + 7 + 10 + size + 5 sectors + 3 indices + the biggest surprise left = 40
const FEED_PAGE1 = ['idx:in;NSX', 'breadth', ...Array(10).fill('mv'), 'sec', 'tide', 'mv', 'tide', 'mv', 'tide', 'mv', 'tide',
  ...Array(5).fill(['mv', 'tide']).flat(), 'size', 'sec', 'sec', 'sec', 'sec', 'sec', 'idx:in;SEN', 'idx:in;nbx', 'idx:in;IDXN', 'tide']
const capWord = { large: 'Large cap', mid: 'Mid cap', small: 'Small cap' }
// squared log: a 4% move in a 5L Cr company (130) outranks a 9% move in a 600 Cr one (70)
const sizeWeight = (m) => Math.log10((m.mcap_cr || 0) + 10) ** 2
const TIDE_MIN_MOVE = 1
/** ET's sector % is its market-cap change, which breaks for some sectors (REITs, InvITs show -100%).
 *  A move past ±20% is replaced by the members' mcap-weighted move. */
function saneSector(s) {
  if (s.change_pct != null && Math.abs(s.change_pct) <= 20) return s
  const ms = s.members.filter((m) => m.change_pct != null && m.mcap_cr > 0)
  const w = ms.reduce((t, m) => t + m.mcap_cr, 0)
  return { ...s, change_pct: w ? ms.reduce((t, m) => t + m.change_pct * m.mcap_cr, 0) / w : null, mcap_change_cr: null }
}

/** Everything a page draws from, scored once per data load. */
function feedPools(sectors, news = []) {
  sectors = sectors.map(saneSector)
  const all = allStocks(sectors)
  const stocks = all.filter((m) => (m.mcap_cr || 0) >= FEED_MIN_MCAP && m.price != null && m.change_pct != null && (m.volume_k || 0) > 0)
  const byId = new Map(sectors.map((s) => [s.id, s]))
  const desc = (a, b) => b.score - a.score
  const best = new Set(), worst = new Set()
  for (const s of sectors) {
    const r = s.members.filter((m) => m.change_pct != null).sort((a, b) => b.change_pct - a.change_pct)
    if (r.length > 1) { best.add(r[0].id); worst.add(r.at(-1).id) }
  }
  const sizes = ['large', 'mid', 'small'].map((cap) => {
    const g = stocks.filter((m) => m.cap === cap)
    return { cap, n: g.length, avg: g.length ? g.reduce((t, m) => t + m.change_pct, 0) / g.length : null }
  })
  return {
    sectors, stocks, byId, best, worst, sizes, news,
    movers: stocks.filter((m) => m.change_pct !== 0).map((m) => ({ m, score: Math.abs(m.change_pct) * sizeWeight(m) })).sort(desc),
    tide: stocks.map((m) => ({ m, s: byId.get(m.sectorId) })).filter(({ m, s }) => s?.change_pct != null && s.change_pct * m.change_pct < 0 && Math.abs(m.change_pct) >= TIDE_MIN_MOVE)
      .map((x) => ({ ...x, score: Math.abs(x.m.change_pct - x.s.change_pct) * sizeWeight(x.m) })).sort(desc),
    secs: sectors.filter((s) => s.change_pct != null).map((s) => {
      const n = (s.advance ?? 0) + (s.decline ?? 0)
      return { s, score: Math.abs(s.change_pct) + (n ? Math.abs((s.advance ?? 0) - (s.decline ?? 0)) / n : 0) }
    }).sort(desc),
    quiet: stocks.filter((m) => m.cap === 'large' && Math.abs(m.change_pct) <= 0.3).sort((a, b) => (b.mcap_cr || 0) - (a.mcap_cr || 0)),
  }
}
const dirWord = (v) => (v >= 0 ? 'up' : 'down')
function moverStory(p, m) {
  const where = `${capWord[m.cap] || 'Stock'} · ${m.sector}`
  if (p.best.has(m.id)) return `Best in ${m.sector} today · ${capWord[m.cap] || ''}`.trim()
  if (p.worst.has(m.id)) return `Worst in ${m.sector} today · ${capWord[m.cap] || ''}`.trim()
  return `${m.change_pct > 0 ? 'Among the day\'s biggest gainers' : 'Among the day\'s biggest losers'} · ${where}`
}
const tideStory = (m, s) => `${dirWord(m.change_pct) === 'up' ? 'Up' : 'Down'} ${fmt(Math.abs(m.change_pct))}% while ${s.name} is ${dirWord(s.change_pct)} ${fmt(Math.abs(s.change_pct))}%`
function sectorStory(s) {
  const r = s.members.filter((m) => m.change_pct != null).sort((a, b) => b.change_pct - a.change_pct)
  const lead = (s.change_pct ?? 0) >= 0 ? r[0] : r.at(-1)
  const n = (s.advance ?? 0) + (s.decline ?? 0)
  return `${s.advance ?? 0} of ${n} up${lead ? ` · ${(s.change_pct ?? 0) >= 0 ? 'led' : 'dragged'} by ${lead.name} ${pctText(lead.change_pct)}` : ''}`
}

/** Page `page` (0-based) of the feed. Adds what it picks to `seen` ('s:<company id>', 'sec:<sector id>').
 *  Returns { theme, label, cards } - cards end with an 'end' card, or are [] when the theme had nothing left. */
function feedPage(p, page, seen) {
  const [theme, label] = FEED_THEMES[Math.min(page, FEED_THEMES.length - 1)]
  const cards = [], perSector = new Map()
  let wantUp = true, smaller = 0
  const free = (m) => !seen.has(`s:${m.id}`) && (perSector.get(m.sectorId) || 0) < FEED_PER_SECTOR
  const take = (card) => {
    const m = card.member
    seen.add(`s:${m.id}`); perSector.set(m.sectorId, (perSector.get(m.sectorId) || 0) + 1)
    if (card.kind === 'mover' && m.cap !== 'large') smaller++
    cards.push({ id: `s:${m.id}`, ...card }); return true
  }
  const mover = (ok = () => true) => {
    const pool = p.movers.filter((x) => free(x.m) && ok(x.m))
    const hit = pool.find((x) => x.m.change_pct > 0 === wantUp) || pool[0] // alternate gain / loss while both last
    if (!hit) return false
    wantUp = !(hit.m.change_pct > 0)
    return take({ kind: 'mover', member: hit.m, story: moverStory(p, hit.m) })
  }
  const tide = () => {
    const hit = p.tide.find((x) => free(x.m))
    return hit ? take({ kind: 'tide', member: hit.m, sector: hit.s, story: tideStory(hit.m, hit.s) }) : false
  }
  const sec = () => {
    const hit = p.secs.find((x) => !seen.has(`sec:${x.s.id}`))
    if (!hit) return false
    seen.add(`sec:${hit.s.id}`); cards.push({ kind: 'sector', id: `sec:${hit.s.id}`, sector: hit.s, story: sectorStory(hit.s) }); return true
  }
  if (theme === 'top') {
    FEED_PAGE1.forEach((slot, i) => {
      if (slot.startsWith('idx:')) return cards.push({ kind: 'index', id: `idx:${slot.slice(4)}`, code: slot.slice(4) })
      if (slot === 'breadth') return cards.push({ kind: 'breadth', id: 'breadth', summary: sectorSummary(p.sectors) })
      if (slot === 'size') return cards.push({ kind: 'size', id: 'size', sizes: p.sizes })
      if (slot === 'tide') return tide() || mover()
      if (slot === 'sec') return sec() || mover()
      // keep enough mid / small caps: once the mover slots left only just cover the shortfall, take those only
      const moverSlotsLeft = FEED_PAGE1.slice(i).filter((s) => s === 'mv').length
      if (FEED_MIN_SMALLER - smaller >= moverSlotsLeft && mover((m) => m.cap !== 'large')) return
      mover()
    })
  } else if (theme === 'sectors') { while (cards.length < FEED_PAGE && sec());
  } else if (theme === 'smaller') { while (cards.length < FEED_PAGE && mover((m) => m.cap !== 'large'));
  } else if (theme === 'quiet') {
    for (const m of p.quiet) {
      if (cards.length >= FEED_PAGE) break
      if (free(m)) take({ kind: 'quiet', member: m, story: `Barely moved (${pctText(m.change_pct)}) · ${croreShort(m.mcap_cr)} · ${m.sector}` })
    }
  } else { while (cards.length < FEED_PAGE && (mover() || tide())); }
  const stockCards = cards.filter((c) => c.member)
  if (!stockCards.length && !cards.some((c) => c.kind === 'sector') && theme !== 'top') return { theme, label, cards: [] }
  const out = [], heads = (p.news || []).filter((n) => !seen.has(n.id))
  cards.forEach((c, i) => {
    out.push(c)
    if ((i + 1) % NEWS_EVERY === 0 && heads.length) { const n = heads.shift(); seen.add(n.id); out.push({ kind: 'news', id: n.id, news: n }) }
  })
  out.push({ kind: 'end', id: `end:${page}`, page, label, next: FEED_THEMES[Math.min(page + 1, FEED_THEMES.length - 1)][1],
    shown: cards.length, news: out.length - cards.length, up: stockCards.filter((c) => c.member.change_pct > 0).length,
    down: stockCards.filter((c) => c.member.change_pct < 0).length, sectors: cards.filter((c) => c.kind === 'sector').length })
  return { theme, label, cards: out }
}

// ---- Feed filter: what the user picked instead of the mixed feed. Cards rotate through the picked
// kinds (gainer, loser, tide, sector, …) so the stream stays varied; the per-sector and mid/small
// rules don't apply - "only Banks" means only Banks. ----
const FEED_KINDS = [['overview', 'Indices & breadth'], ['gainers', 'Gainers'], ['losers', 'Losers'], ['tide', 'Against the tide'],
  ['sectors', 'Sector cards'], ['quiet', 'Big and quiet'], ['news', 'Headlines']]
const FEED_MOVES = [[0, 'Any move'], [2, '2%+'], [5, '5%+'], [10, '10%+']]
const filterOn = (f) => !!(f && (f.kinds?.length || f.caps?.length || f.sectors?.length || f.minMove))
/** Page `page` of a filtered feed: { theme: 'filtered', label, cards } - [] when nothing (more) matches. */
function feedFiltered(p, page, seen, f) {
  const kinds = f.kinds?.length ? f.kinds : FEED_KINDS.map(([k]) => k)
  const inSector = (id) => !f.sectors?.length || f.sectors.includes(id)
  const okStock = (m, move = true) => (!f.caps?.length || f.caps.includes(m.cap)) && inSector(m.sectorId) && (!move || Math.abs(m.change_pct) >= (f.minMove || 0))
  const stock = (kind, m, extra) => ({ kind, id: `s:${m.id}`, member: m, ...extra })
  const pools = {
    gainers: p.movers.filter((x) => x.m.change_pct > 0 && okStock(x.m)).map((x) => stock('mover', x.m, { story: moverStory(p, x.m) })),
    losers: p.movers.filter((x) => x.m.change_pct < 0 && okStock(x.m)).map((x) => stock('mover', x.m, { story: moverStory(p, x.m) })),
    tide: p.tide.filter((x) => okStock(x.m)).map((x) => stock('tide', x.m, { sector: x.s, story: tideStory(x.m, x.s) })),
    sectors: p.secs.filter((x) => inSector(x.s.id))
      .map((x) => ({ kind: 'sector', id: `sec:${x.s.id}`, sector: x.s, story: sectorStory(x.s) })),
    quiet: p.quiet.filter((m) => okStock(m, false)).map((m) => stock('quiet', m, { story: `Barely moved (${pctText(m.change_pct)}) · ${croreShort(m.mcap_cr)} · ${m.sector}` })),
    news: (p.news || []).map((n) => ({ kind: 'news', id: n.id, news: n })),
  }
  const cards = []
  if (page === 0 && kinds.includes('overview')) {
    cards.push({ kind: 'index', id: 'idx:in;NSX', code: 'in;NSX' }, { kind: 'breadth', id: 'breadth' }, { kind: 'size', id: 'size', sizes: p.sizes })
    for (const code of ['in;SEN', 'in;nbx', 'in;IDXN']) cards.push({ kind: 'index', id: `idx:${code}`, code })
  }
  const order = kinds.filter((k) => pools[k]), at = Object.fromEntries(order.map((k) => [k, 0]))
  let main = 0
  for (let progress = true; main < FEED_PAGE && progress;) {
    progress = false
    for (const k of order) {
      if (main >= FEED_PAGE) break
      const pool = pools[k]
      while (at[k] < pool.length && seen.has(pool[at[k]].id)) at[k]++
      if (at[k] < pool.length) { const c = pool[at[k]++]; seen.add(c.id); cards.push(c); main++; progress = true }
    }
  }
  if (!main && !cards.length) return { theme: 'filtered', label: 'Your filter', cards: [] }
  const st = cards.filter((c) => c.member)
  cards.push({ kind: 'end', id: `end:${page}`, page, label: 'Your filter', next: 'more matching your filter', shown: main,
    news: cards.filter((c) => c.kind === 'news').length, up: st.filter((c) => c.member.change_pct > 0).length,
    down: st.filter((c) => c.member.change_pct < 0).length, sectors: cards.filter((c) => c.kind === 'sector').length })
  return { theme: 'filtered', label: 'Your filter', cards }
}

// ---- headlines: ET Markets' public RSS (phase 2). Title, summary, time and image only; the article
// itself opens in the browser ----
const ET_RSS = [
  ['Markets', 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms'],
  ['Stocks', 'https://economictimes.indiatimes.com/markets/stocks/news/rssfeeds/2146842.cms'],
  ['Earnings', 'https://economictimes.indiatimes.com/markets/stocks/earnings/rssfeeds/1808152121.cms'],
]
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const unxml = (v) => String(v ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m)
  .replace(/\s+/g, ' ').trim()
/** RSS 2.0 items -> { id, title, link, time, desc, img, source }. Only https links and images are kept. */
function rssItems(xml, source) {
  return [...String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const tag = (t) => unxml(it.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1])
    const link = tag('link') || tag('guid'), time = Date.parse(tag('pubDate')), img = it.match(/<enclosure[^>]*\surl="([^"]+)"/)?.[1]
    return { id: `n:${link}`, title: tag('title'), link, time: Number.isNaN(time) ? null : time, desc: tag('description'), img: /^https:\/\//.test(img || '') ? img : null, source }
  }).filter((n) => n.title && /^https:\/\//.test(n.link))
}
/** Several feeds -> one list, newest first, each story once. */
function mergeNews(lists) {
  const seen = new Set()
  return lists.flat().sort((a, b) => (b.time ?? 0) - (a.time ?? 0)).filter((n) => !seen.has(n.link) && seen.add(n.link))
}

/** What a stock card's 6M bars add: distance from the 6M high, the run of up / down closes, today's
 *  volume against the 20 sessions before it (volume_k is ET's, in thousands of shares). */
function barFacts(bars, volumeK) {
  if (!bars?.length) return null
  const last = bars.at(-1), hi = Math.max(...bars.map((b) => b.h))
  let streak = 0
  for (let i = bars.length - 1; i > 0; i--) {
    const d = Math.sign(bars[i].c - bars[i - 1].c)
    if (!d || (streak && Math.sign(streak) !== d)) break
    streak += d
  }
  const prior = bars.slice(-21, -1).filter((b) => b.v > 0)
  const avg = prior.length ? prior.reduce((t, b) => t + b.v, 0) / prior.length : 0
  const vol = volumeK ? volumeK * 1000 : last.v
  return { fromHigh: hi ? (last.c / hi - 1) * 100 : null, streak, volX: avg && vol ? vol / avg : null }
}

if (typeof module !== 'undefined') module.exports = { fmt, pctText, croreShort, hexRgb, isHex, luminance, heat, bucketColors, THEMES, THEME_TOKENS, resolveTheme, sectorRow, sectorSummary, sortRows, allStocks, movers, indexRow, mcQuote, mcHistoryUrl, mcBars, barStats, ticks, researchLinks, RANGES, feedPools, feedPage, barFacts, saneSector, rssItems, mergeNews, NEWS_EVERY, feedFiltered, filterOn, FEED_KINDS, FONTS, fontNameOk, fontStack, fontKind, googleFontUrl, FEED_PAGE1, FEED_PAGE, FEED_THEMES }
