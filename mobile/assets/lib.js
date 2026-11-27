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
/** A filter from storage, a template or a backup -> only known kinds / sizes / moves, kinds in the feed's
 *  own order (the order a filtered feed rotates through them), sectors as short strings. */
function cleanFilter(f) {
  const has = (arr, v) => Array.isArray(arr) && arr.includes(v)
  return {
    kinds: FEED_KINDS.map(([k]) => k).filter((k) => has(f?.kinds, k)),
    caps: ['large', 'mid', 'small'].filter((c) => has(f?.caps, c)),
    sectors: [...new Set((Array.isArray(f?.sectors) ? f.sectors : []).filter((x) => typeof x === 'string' && x && x.length <= 40))].sort().slice(0, 60),
    minMove: FEED_MOVES.some(([v]) => v === f?.minMove) ? f.minMove : 0,
  }
}
const sameFilter = (a, b) => JSON.stringify(cleanFilter(a)) === JSON.stringify(cleanFilter(b))
// ready-made filter templates; the user's own are saved next to them (feed.templates)
const FEED_TEMPLATES = [
  ['Gainers only', { kinds: ['gainers'] }], ['Losers only', { kinds: ['losers'] }], ['Big moves 5%+', { kinds: ['gainers', 'losers'], minMove: 5 }],
  ['Headlines', { kinds: ['news'] }], ['Against the tide', { kinds: ['tide'] }], ['Large caps', { caps: ['large'] }],
  ['Small-cap movers', { kinds: ['gainers', 'losers'], caps: ['small'] }],
].map(([name, f]) => ({ id: `b:${name}`, name, builtin: true, filter: cleanFilter(f) }))
/** The user's saved templates (from storage or a backup) -> well-formed ones, at most 20. */
const cleanTemplates = (list) => (Array.isArray(list) ? list : []).filter((t) => t && typeof t.name === 'string' && t.name.trim())
  .slice(0, 20).map((t, i) => ({ id: typeof t.id === 'string' && /^u:[\w-]{1,30}$/.test(t.id) ? t.id : `u:${i}`, name: t.name.trim().slice(0, 30), filter: cleanFilter(t.filter) }))
/** Adds (or, with the same name, replaces) a template; newest first. */
function saveTemplate(list, name, filter, id) {
  const n = String(name || '').trim().slice(0, 30)
  if (!n || !filterOn(filter)) return cleanTemplates(list)
  const rest = cleanTemplates(list).filter((t) => t.name.toLowerCase() !== n.toLowerCase())
  return cleanTemplates([{ id, name: n, filter }, ...rest])
}

/** NSE's regular session, Mon-Fri 09:15-15:30 IST (holidays aside), at time `now` (ms). */
function marketOpen(now = Date.now()) {
  const d = new Date(now + 19800e3), m = d.getUTCHours() * 60 + d.getUTCMinutes(), day = d.getUTCDay()
  return day >= 1 && day <= 5 && m >= 9 * 60 + 15 && m <= 15 * 60 + 30
}
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

// ---- holdings: parsing an upload / paste, valuing it, cleaning untrusted JSON -------------------------
/** "₹1,20,000.50", "Rs. 3450", " 10 " -> number; anything else -> null. */
function parseNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = String(v ?? '').replace(/₹|rs\.?|inr|,|\s/gi, '')
  return /^-?\d+(\.\d+)?$/.test(t) ? +t : null
}
/** CSV / TSV / semicolon text -> rows of cells (quotes, "" escapes and CRLF handled). */
function splitCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)
  const sample = lines.filter((l) => l.trim()).slice(0, 5).join('\n')
  const delim = ['\t', ';', ','].map((d) => [d, sample.split(d).length]).sort((a, b) => b[1] - a[1])[0][0]
  const rows = []
  let row = [], cell = '', q = false
  const src = lines.join('\n')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (q) { if (c === '"' && src[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') q = false; else cell += c; continue }
    if (c === '"') q = true
    else if (c === delim) { row.push(cell.trim()); cell = '' }
    else if (c === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  row.push(cell.trim()); rows.push(row)
  return rows.filter((r) => r.some((x) => x !== ''))
}
// header names brokers use (Zerodha, Groww, Dhan, Upstox, Angel, spreadsheets)
// column names across Indian brokers' holdings exports: Zerodha (Kite, Console), Groww, Dhan, Upstox, Angel
// One, ICICI Direct, HDFC Securities, Kotak, Motilal Oswal, 5paisa, Fyers, Paytm Money, IIFL, Sharekhan, and
// CDSL / NSDL demat statements (test/fixtures + check.mjs cover each shape)
const HOLD_COLS = {
  sym: /^(symbol|stock symbol|trading ?symbol|tradingsymbol|instrument( name)?|scrip( name| code)?|stock( name)?|company( name)?|security( name)?|name|scheme( name)?|fund name|isin( code)?)$/,
  qty: /^(qty|quantity|quantity available|available qty|units|units held|balance units|shares|shares held|no of shares|net qty|net quantity|holding qty|holding quantity|holdings|total qty|total quantity|current qty|free qty|demat qty|(current|free|total|closing) bal(ance)?|balance)$/,
  avg: /^(avg|avg ?cost|average ?(buy ?|cost ?)?(price|cost|rate|nav)|avg ?(buy ?|cost ?)?(price|cost|rate|nav)|buy ?(price|avg|average|rate)|cost ?price|purchase ?(price|rate|nav)|avg ?purchase ?price)$/,
  value: /^(buy value|invested value|investment value|invested amount|amount invested|invested|cost value|total cost|purchase value|investment)$/,
  date: /^(date|buy date|purchase date|trade date|date of purchase)$/,
}
/** "NSE:TCS-EQ" (Fyers), "TCS-BE", "BSE:500570" -> "TCS": exchange prefixes and series suffixes off a symbol. */
const cleanSymbol = (v) => String(v || '').trim().replace(/^(NSE|BSE|NFO|MCX)[:_ ]\s*/i, '').replace(/-(EQ|BE|BZ|SM|ST|E1|IL|BL)$/i, '')
const SUMMARY_ROW = /^(total|grand total|investment|invested|current value|overall|net|summary|note|portfolio value)\b/i
/** "Nippon Nifty 50 ETF (NIFTYBEES)" -> "NIFTYBEES": a symbol a broker puts in brackets after the name. */
const bracketSymbol = (name) => (String(name || '').match(/\(([A-Z0-9&.\-]{2,20})\)\s*$/) || [])[1] || null
// headings carry units and footnotes: "Avg. Price (₹)", "Qty (Nos.)", "Average Price (Rs.)"
const normHead = (h) => String(h).toLowerCase().replace(/₹|\(rs\.?\)|\(inr\)|\(nos\.?\)|\bin rs\.?|\binr\b/g, ' ').replace(/[()*:#_.\[\]]/g, ' ').replace(/\s+/g, ' ').trim()
// ---- .xlsx: a zip of XML parts. Unzipped with the platform's DecompressionStream (Android WebView, Node
// 18+) and read with regexes - only cell values are taken. A password-protected workbook is an encrypted
// OLE file, not a zip: fileKind says so, and the user is asked to save it without the password. ----
const fileKind = (bytes) => {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (b[0] === 0x50 && b[1] === 0x4b) return 'zip'
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'ole' // encrypted .xlsx, or an old .xls
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf'
  return 'text'
}
async function inflateRaw(u8) {
  const stream = new ReadableStream({ start(c) { c.enqueue(u8); c.close() } }).pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader(), parts = []
  let n = 0
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length }
  const out = new Uint8Array(n); let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
/** The named entries of a zip (stored or deflated), as text. */
async function unzipText(bytes, want) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), out = new Map()
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('not a zip file')
  let p = dv.getUint32(eocd + 16, true)
  const count = dv.getUint16(eocd + 10, true), dec = new TextDecoder('utf-8')
  for (let k = 0; k < count && dv.getUint32(p, true) === 0x02014b50; k++) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true)
    const xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true)
    const name = dec.decode(b.subarray(p + 46, p + 46 + nl))
    if (want(name)) {
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true), raw = b.subarray(start, start + size)
      out.set(name, dec.decode(method === 0 ? raw : await inflateRaw(raw)))
    }
    p += 46 + nl + xl + cl
  }
  return out
}
const xmlText = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e.toLowerCase()])
/** Every sheet of an .xlsx -> CSV text, in workbook order: [{ name, csv }]. */
async function xlsxSheets(bytes) {
  const files = await unzipText(bytes, (n) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(n))
  const shared = [...(files.get('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1])).join(''))
  const attr = (tag, a) => (tag.match(new RegExp(`\\s${a}="([^"]*)"`)) || [])[1] // attribute order differs between writers
  const rels = new Map([...(files.get('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]))
  const sheets = [...(files.get('xl/workbook.xml') || '').matchAll(/<sheet\b[^>]*>/g)]
    .map((m) => ({ name: xmlText(attr(m[0], 'name')), path: `xl/${(rels.get(attr(m[0], 'r:id')) || '').replace(/^\/?xl\//, '')}` }))
  const list = sheets.length ? sheets : [...files.keys()].filter((n) => n.startsWith('xl/worksheets/')).sort().map((path) => ({ name: path, path }))
  const col = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
  const q = (v) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  return list.map(({ name, path }) => {
    const rows = [...(files.get(path) || '').matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
      const cells = []
      for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = (c[1].match(/r="([A-Z]+\d+)"/) || [])[1], type = (c[1].match(/t="([^"]+)"/) || [])[1], body = c[2] || ''
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1]
        const val = type === 's' ? shared[+v] ?? '' : type === 'inlineStr' ? xmlText((body.match(/<is>([\s\S]*?)<\/is>/) || [])[1]) : xmlText(v ?? '')
        cells[ref ? col(ref) : cells.length] = val
      }
      return [...cells].map((x) => q(x ?? '')).join(',')
    })
    return { name, csv: rows.join('\n') }
  }).filter((s) => s.csv.trim())
}

/** An HTML table (the ".xls" some brokers send is a web page) -> CSV text. */
function htmlTableCsv(html) {
  const q = (v) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  return [...String(html || '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((tr) =>
    [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => q(xmlText(c[1].replace(/<br\s*\/?>/gi, ' ')).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())).join(',')).join('\n')
}

/** File bytes -> text: UTF-8 (with or without BOM), or UTF-16 as spreadsheet "Unicode text" exports write it. */
function decodeText(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2))
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2))
  const sample = b.subarray(0, 200), zeros = sample.filter((x) => x === 0).length
  if (zeros > sample.length / 4) return new TextDecoder(sample[0] === 0 ? 'utf-16be' : 'utf-16le').decode(b)
  return new TextDecoder('utf-8').decode(b).replace(/^\uFEFF/, '')
}
/** Upload or paste -> { rows: [{ name, qty, avg, date, line }], skipped }. With a header row the columns
 *  are found by name; without one, each line is "<name or symbol> <qty> <avg price>". */
function parseHoldings(text) {
  // JSON too: [{ "symbol": "TCS", "quantity": 10, "avg": 3450 }, …] (or { "holdings": [...] })
  const t = String(text || '').trim()
  if (/^[[{]/.test(t)) {
    try {
      const j = JSON.parse(t), list = Array.isArray(j) ? j : Array.isArray(j?.holdings) ? j.holdings : []
      const pick = (o, ks) => { for (const k of ks) if (o?.[k] != null && o[k] !== '') return o[k] }
      const rows = list.map((o, i) => {
        const name = String(pick(o, ['symbol', 'sym', 'tradingsymbol', 'name', 'isin']) ?? '').trim(), qty = parseNum(pick(o, ['quantity', 'qty', 'units', 'shares']))
        const avg = parseNum(pick(o, ['avg', 'average', 'averagePrice', 'average_price', 'avgPrice', 'buyPrice', 'price', 'cost']))
        const isin = String(o?.isin || '').toUpperCase(), hint = typeof o?.name === 'string' && o.name !== name ? o.name : null
        return name && qty > 0 ? { name, qty, avg: avg != null && avg >= 0 ? avg : null, date: normDate(pick(o, ['date', 'buyDate', 'buy_date'])), line: i + 1,
          ...(/^IN[A-Z0-9]{10}$/.test(isin) ? { isin } : {}), ...(hint ? { hint } : {}) } : null
      })
      return { rows: rows.filter(Boolean), skipped: rows.filter((r) => !r).length }
    } catch { /* not JSON after all: read it as rows */ }
  }
  const table = splitCsv(text), rows = []
  let skipped = 0
  const hi = table.findIndex((r) => { const h = r.map(normHead); return h.some((x) => HOLD_COLS.sym.test(x)) && h.some((x) => HOLD_COLS.qty.test(x)) })
  if (hi >= 0) {
    const h = table[hi].map(normHead), col = {}
    for (const [k, re] of Object.entries(HOLD_COLS)) col[k] = h.findIndex((x) => re.test(x))
    // prefer a symbol column over a name column when both exist
    const symCol = h.findIndex((x) => /^(symbol|stock symbol|trading ?symbol|tradingsymbol|instrument( name)?)$/.test(x))
    if (symCol >= 0) col.sym = symCol
    // an ISIN column first (CDSL / NSDL) is not the name: use the security / company name, keep the ISIN aside
    else if (/^isin/.test(h[col.sym] || '')) { const alt = h.findIndex((x) => HOLD_COLS.sym.test(x) && !/^isin/.test(x)); if (alt >= 0) col.sym = alt }
    // a blank symbol falls back to the name, then the ISIN column (a fund or ETF a statement only knows by ISIN)
    const nameCol = h.findIndex((x, i) => i !== col.sym && /^(name|company( name)?|stock name|security( name)?|scheme( name)?|scrip name)$/.test(x))
    const isinCol = h.findIndex((x) => /^isin( code)?$/.test(x))
    table.slice(hi + 1).forEach((r, i) => {
      const hint = nameCol >= 0 ? (r[nameCol] || '').trim() : '', isinV = isinCol >= 0 ? (r[isinCol] || '').trim().toUpperCase() : ''
      const symV = col.sym === symCol ? cleanSymbol(r[col.sym]) : (r[col.sym] || '').trim()
      const name = symV || hint || isinV, qty = parseNum(r[col.qty])
      // no average column (Groww's mutual funds): the amount invested over the quantity
      const avg = col.avg >= 0 ? parseNum(r[col.avg]) : col.value >= 0 && qty > 0 && parseNum(r[col.value]) > 0 ? parseNum(r[col.value]) / qty : null
      // brokers end the table with totals ("Investment,3053.45,Current Value,…" in Dhan's export): not holdings
      if (!name || !(qty > 0) || SUMMARY_ROW.test(name)) { skipped++; return }
      rows.push({ name, qty, avg: avg != null && avg >= 0 ? avg : null, date: col.date >= 0 ? normDate(r[col.date]) : null, line: hi + i + 2,
        ...(/^IN[A-Z0-9]{10}$/.test(isinV) ? { isin: isinV } : {}), ...(hint && hint !== name ? { hint } : {}) })
    })
  } else {
    String(text || '').replace(/^\uFEFF/, '').split(/\r\n|\r|\n/).forEach((l, i) => {
      if (!l.trim()) return
      // a delimited line with headers we don't know ("GINNIFILA,22,,Ginni Filaments"): name first, then numbers
      const cells = l.split(/[,\t;]/).map((x) => x.replace(/^"|"$/g, '').trim())
      if (cells.length >= 2 && cells[0] && parseNum(cells[0]) == null) {
        const nums = cells.slice(1).map(parseNum)
        const qi = nums.findIndex((v) => v != null && v > 0)
        if (qi >= 0) {
          const avg = nums[qi + 1]
          rows.push({ name: cells[0], qty: nums[qi], avg: avg != null && avg >= 0 ? avg : null, date: null, line: i + 1 })
          return
        }
      }
      const toks = l.split(/[,\t;]|\s+/).map((x) => x.trim()).filter(Boolean)
      const nums = []
      while (toks.length > 1 && parseNum(toks.at(-1)) != null) nums.unshift(parseNum(toks.pop()))
      const name = toks.join(' ')
      if (!name || nums.length < 1 || !(nums[0] > 0)) { skipped++; return }
      rows.push({ name, qty: nums[0], avg: nums[1] != null && nums[1] >= 0 ? nums[1] : null, date: null, line: i + 1 })
    })
  }
  return { rows, skipped }
}
/** "2024-01-10", "10/01/2024", "10-Jan-2024" -> "2024-01-10"; else null. Day-first, as Indian statements are. */
function normDate(v) {
  const t = String(v || '').trim()
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = t.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -](\d{4})$/)
  const mon = m && ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase())
  return m && mon >= 0 ? `${m[3]}-${String(mon + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null
}
/** One row per symbol per portfolio: quantities add, the buy price is the quantity-weighted average, the
 *  earliest date stays. */
function mergeHoldings(list) {
  const by = new Map()
  for (const h of list) {
    const key = `${h.pf || 'main'}|${h.sym}`, o = by.get(key)
    if (!o) { by.set(key, { ...h }); continue }
    const qty = o.qty + h.qty
    o.avg = o.avg != null && h.avg != null ? (o.avg * o.qty + h.avg * h.qty) / qty : o.avg ?? h.avg
    o.qty = qty
    if (h.date && (!o.date || h.date < o.date)) o.date = h.date
  }
  return [...by.values()]
}
/** Holdings of one portfolio ('all' = every one). */
const inPortfolio = (holdings, pf) => pf === 'all' ? holdings : holdings.filter((h) => (h.pf || 'main') === pf)
const holdingId = (pf, sym) => `h${pf === 'main' || !pf ? '' : `${pf}-`}${sym}`
/** Value every holding at { price, prev } from priceOf(h) and total it. Unpriced holdings stay out of the
 *  totals and are counted as `missing`; P&L only covers holdings with both a price and a buy price. */
function valuePortfolio(holdings, priceOf) {
  const rows = holdings.map((h) => {
    const p = priceOf(h) || {}, price = p.price ?? null, prev = p.prev ?? null
    const invested = h.avg != null ? h.qty * h.avg : null, value = price != null ? h.qty * price : null
    const day = price != null && prev != null ? h.qty * (price - prev) : null
    return { ...h, price, prev, value, invested, pnl: value != null && invested != null ? value - invested : null,
      pnlPct: value != null && invested ? (value / invested - 1) * 100 : null, day, dayPct: price != null && prev ? (price / prev - 1) * 100 : null,
      sector: p.sector ?? null }
  })
  const sum = (k, rs) => rs.reduce((t, r) => t + (r[k] ?? 0), 0)
  const priced = rows.filter((r) => r.value != null), both = priced.filter((r) => r.pnl != null), dayRows = priced.filter((r) => r.day != null)
  const value = sum('value', priced), pnl = sum('pnl', both), base = sum('invested', both), day = sum('day', dayRows)
  const prevValue = sum('value', dayRows) - day
  return { rows, total: { value, invested: sum('invested', rows.filter((r) => r.invested != null)), pnl, pnlPct: base ? (pnl / base) * 100 : null,
    day, dayPct: prevValue ? (day / prevValue) * 100 : null, priced: priced.length, missing: rows.length - priced.length } }
}
/** Held since `date` (YYYY-MM-DD): days, long term (> 365 days, the equity LTCG line) and "1y 3m". */
function heldFor(date, now = Date.now()) {
  const t = Date.parse(`${date}T00:00:00+05:30`)
  if (!date || Number.isNaN(t)) return null
  const days = Math.max(0, Math.floor((now - t) / 864e5)), y = Math.floor(days / 365), m = Math.floor((days % 365) / 30.4)
  return { days, long: days > 365, text: y ? `${y}y ${m}m` : m ? `${m}m` : `${days}d` }
}
const ALERT_KINDS = [
  ['below', 'Portfolio falls to', '₹', false], ['above', 'Portfolio rises to', '₹', false],
  ['trail', 'Protect profit: give back no more than', '₹', false], ['dayloss', 'Down today by more than', '₹', false],
  ['pbelow', 'Stock falls to', '₹', true], ['pabove', 'Stock rises to', '₹', true], ['stockdrop', 'Any holding down today by', '%', false],
]
const NOTIFY = [['off', 'Off'], ['openclose', 'Open & close'], ['2h', 'Every 2 hours'], ['hourly', 'Every hour']]
const SYM_RE = /^[A-Z0-9&.\-]{1,20}$/
/** portfolio.json from an import or the device file -> only well-formed holdings and alerts. */
function cleanPortfolio(o) {
  const ok = (n) => typeof n === 'number' && Number.isFinite(n)
  const str = (v, n = 80) => typeof v === 'string' ? v.slice(0, n) : null
  const extra = (h) => ({ et: /^\d{1,12}$/.test(h.et || '') ? h.et : null, scr: /^\d{1,10}$/.test(String(h.scr ?? '')) ? String(h.scr) : null,
    isin: /^IN[A-Z0-9]{10}$/.test(h.isin || '') ? h.isin : null, kind: h.kind === 'mf' && /^\d{1,8}$/.test(String(h.code ?? '')) ? 'mf' : 'stock',
    code: h.kind === 'mf' && /^\d{1,8}$/.test(String(h.code ?? '')) ? String(h.code) : null })
  // portfolios: "main" always exists (everything from before portfolios lands there)
  const pfs = [{ id: 'main', name: 'My portfolio' }]
  for (const p of Array.isArray(o?.portfolios) ? o.portfolios : []) {
    const id = String(p?.id ?? ''), name = str(p?.name, 30)?.trim()
    if (id === 'main' && name) pfs[0].name = name
    else if (/^[a-z0-9]{1,12}$/.test(id) && name && !pfs.some((x) => x.id === id) && pfs.length < 20) pfs.push({ id, name })
  }
  const pfOf = (v) => pfs.some((x) => x.id === v) ? v : 'main'
  const holdings = (Array.isArray(o?.holdings) ? o.holdings : []).filter((h) => h && SYM_RE.test(h.sym) && ok(h.qty) && h.qty > 0 && (h.avg == null || (ok(h.avg) && h.avg >= 0)))
    .slice(0, 500).map((h) => { const pf = pfOf(h.pf); return { id: holdingId(pf, h.sym), pf, sym: h.sym, name: str(h.name) || h.sym, ...extra(h), qty: h.qty, avg: h.avg ?? null, date: normDate(h.date) } })
  const watch = (Array.isArray(o?.watch) ? o.watch : []).filter((w) => w && SYM_RE.test(w.sym) && !w.sym.startsWith('MF')).slice(0, 100)
    .map((w) => ({ sym: w.sym, name: str(w.name) || w.sym, ...extra({ ...w, kind: 'stock' }) })).filter((w, i, a) => a.findIndex((x) => x.sym === w.sym) === i)
  const syms = new Set([...holdings.map((h) => h.sym), ...watch.map((w) => w.sym)])
  const alerts = (Array.isArray(o?.alerts) ? o.alerts : []).filter((a) => a && ALERT_KINDS.some(([k]) => k === a.kind) && ok(a.value) && a.value > 0
    && (!ALERT_KINDS.find(([k]) => k === a.kind)[3] || syms.has(a.sym))).slice(0, 50)
    .map((a) => ({ id: str(a.id, 40) || `a${Math.round(a.value)}`, kind: a.kind, value: a.value, sym: SYM_RE.test(a.sym || '') ? a.sym : null,
      repeat: !!a.repeat, start: ok(a.start) ? a.start : null, created: ok(a.created) ? a.created : 0,
      pf: a.pf && a.pf !== 'all' && pfs.some((x) => x.id === a.pf) ? a.pf : null })) // a portfolio alert on one portfolio, or (null) on all
  return { v: 1, portfolios: pfs, holdings, watch, alerts, notify: NOTIFY.some(([k]) => k === o?.notify) ? o.notify : 'hourly', filings: o?.filings !== false }
}

// ---- treemap: squarified layout (Bruls, Huizing & van Wijk) - rectangles close to square, biggest first ----
/** values -> [{ i, x, y, w, h }] filling the w x h box at (x, y), area proportional to value (<= 0 left out).
 *  Biggest first unless keepOrder (a sorted heatmap: the given order runs top-left to bottom-right). */
function squarify(values, x, y, w, h, keepOrder = false) {
  const items = values.map((v, i) => ({ v: Math.max(+v || 0, 0), i })).filter((d) => d.v > 0)
  if (!keepOrder) items.sort((a, b) => b.v - a.v)
  const total = items.reduce((s, d) => s + d.v, 0)
  if (!total || w <= 0 || h <= 0) return []
  for (const d of items) d.a = (d.v * w * h) / total
  const out = []
  let row = []
  const worst = (r, side) => {
    const s = r.reduce((t, d) => t + d.a, 0), mx = Math.max(...r.map((d) => d.a)), mn = Math.min(...r.map((d) => d.a))
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn))
  }
  const layout = (r) => {
    const s = r.reduce((t, d) => t + d.a, 0)
    if (w >= h) { const cw = s / h; let cy = y; for (const d of r) { const ch = d.a / cw; out.push({ i: d.i, x, y: cy, w: cw, h: ch }); cy += ch } x += cw; w -= cw }
    else { const ch = s / w; let cx = x; for (const d of r) { const cw = d.a / ch; out.push({ i: d.i, x: cx, y, w: cw, h: ch }); cx += cw } y += ch; h -= ch }
  }
  for (const d of items) {
    const side = Math.min(w, h)
    if (!row.length || worst([...row, d], side) <= worst(row, side)) row.push(d)
    else { layout(row); row = [d] }
  }
  if (row.length) layout(row)
  return out
}

// ---- statements: a CAS PDF's text -> holdings. Works on the text, not a layout: every ISIN starts a
// block that runs to the next ISIN, and the block's holding is the first three numbers in it where
// units x price = value (within 0.5%) - true in CDSL, NSDL and CAMS / KFintech statements alike,
// whatever columns sit between (face value, free / lent balance, dates). A zero balance has no such
// triple and drops out. CAMS' "Total Cost Value" gives the average cost; demat statements carry none. ----
const ISIN_G = /\b(IN[EF][A-Z0-9]{8}\d)\b/g
/** pdf.js text items per page -> lines, top to bottom, left to right. */
function pdfLines(pages) {
  const out = []
  for (const items of pages) {
    const rows = [] // items on one baseline differ by a point or two: join neighbours within 2.5pt
    for (const it of items.filter((i) => i.str && i.str.trim()).sort((a, b) => b.y - a.y)) {
      const row = rows.at(-1)
      if (row && row.y - it.y <= 2.5) row.items.push(it); else rows.push({ y: it.y, items: [it] })
    }
    for (const r of rows) out.push(r.items.sort((a, b) => a.x - b.x).map((i) => i.str.trim()).join(' '))
  }
  return out
}
const numTokens = (t) => [...t.matchAll(/(?<![\w./-])-?\d[\d,]*(?:\.\d+)?(?![\w/-])/g)].map((m) => parseNum(m[0])).filter((v) => v != null)
function casHoldings(lines) {
  const marks = []
  lines.forEach((l, i) => { for (const m of l.matchAll(ISIN_G)) marks.push({ i, isin: m[1] }) })
  const by = new Map()
  marks.forEach((mk, k) => {
    const end = Math.min(marks[k + 1]?.i ?? lines.length, mk.i + 8)
    const first = lines[mk.i].slice(lines[mk.i].indexOf(mk.isin) + mk.isin.length)
    const block = [first, ...lines.slice(mk.i + 1, Math.max(end, mk.i + 1))].join(' ').replace(/(?:ISIN|Folio)\s*(?:No\.?)?\s*:?/gi, ' ')
    const nums = numTokens(block)
    let hit = null
    for (let a = 0; a < nums.length && !hit; a++) for (let b = a + 1; b < nums.length && !hit; b++) for (let c = b + 1; c < nums.length && !hit; c++) {
      const [u, p, v] = [nums[a], nums[b], nums[c]]
      if (u > 0 && p > 0 && v > 0 && Math.abs(u * p - v) <= Math.max(1, v * 0.005)) hit = { units: u, price: p, value: v }
    }
    if (!hit) return
    const cost = parseNum((block.match(/cost\s*value\s*:?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d+)?)/i) || [])[1])
    // the name: the ISIN line before / after the ISIN, without numbers and statement furniture
    const line = lines[mk.i].replace(mk.isin, ' ')
    const name = line.replace(/(\s+-?[\d,]+(?:\.\d+)?)+\s*$/, ' ') // the row's numeric columns, keeping "NIFTY 50"
      .replace(/\(Advisor[^)]*\)|Registrar\s*:.*$|\bISIN\s*:?|-\s*EQUITY SHARES?|\bNEW\b/gi, ' ')
      .replace(/\s+-\s*$|^\s*-\s+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\s*-$/, '')
    const o = by.get(mk.isin)
    if (o) { o.units += hit.units; o.value += hit.value; o.cost = o.cost != null && cost != null ? o.cost + cost : null }
    else by.set(mk.isin, { isin: mk.isin, name, units: hit.units, price: hit.price, value: hit.value, cost: cost ?? null })
  })
  return [...by.values()].map((h) => ({ ...h, avg: h.cost != null && h.units ? h.cost / h.units : null, kind: h.isin.startsWith('INF') ? 'mf' : 'stock' }))
}
/** AMFI's NAVAll.txt -> Map(ISIN -> { code, name, nav, date }), both ISIN columns. */
function parseAmfiNav(text) {
  const out = new Map()
  for (const line of String(text || '').split(/\r?\n/)) {
    const f = line.split(';')
    if (f.length < 6 || !/^\d+$/.test(f[0].trim())) continue
    const nav = parseNum(f.at(-2)), name = [f[3], f.length >= 8 ? f[4] : ''].map((x) => (x || '').trim()).filter(Boolean).join(' - ')
    for (const isin of [f[1], f[2]]) if (/^INF[A-Z0-9]{9}$/.test((isin || '').trim())) out.set(isin.trim(), { code: f[0].trim(), name, nav, date: f.at(-1).trim() })
  }
  return out
}
// ---- filings that matter to a holder (the job notifies on these; Portfolio.java keeps the same list) ----
const FILING_KINDS = [
  [/financial results|\bresults?\b/i, 'Results'], [/board meeting/i, 'Board meeting'], [/dividend/i, 'Dividend'], [/record date/i, 'Record date'],
  [/bonus/i, 'Bonus'], [/split|sub-?division/i, 'Split'], [/buy ?back/i, 'Buyback'], [/rights issue/i, 'Rights issue'],
  [/annual general meeting|\bagm\b/i, 'AGM'], [/merger|amalgamation|acquisition|demerger/i, 'Merger / acquisition'], [/credit rating/i, 'Credit rating'],
]
const FILING_NOISE = /newspaper|trading window|74\s*\(5\)|loss of share|duplicate share|compliances?-certificate|investor (meet|presentation)|analyst/i
const filingKind = (text) => FILING_NOISE.test(text || '') ? null : FILING_KINDS.find(([re]) => re.test(text || ''))?.[1] || null

// ---- fundamentals: screener.in's public company page (the web app's Fundamentals / Financials /
// Shareholding / Filings come from the same page). Parsed from a DOM Document, so DOMParser in the
// app and jsdom in test/smoke.cjs; only text and https links come out - nothing of the page is rendered.
const SCREENER = 'https://www.screener.in'
const screenerUrl = (sym) => `${SCREENER}/company/${encodeURIComponent(sym)}/consolidated/`
function parseScreener(doc) {
  const txt = (el) => (el?.textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
  const link = (h) => { try { const u = new URL(h, SCREENER); return u.protocol === 'https:' ? u.href : null } catch { return null } }
  const lines = (el) => { // text keeping the page's line breaks, footnote markers dropped
    if (!el) return ''
    const c = el.cloneNode(true)
    c.querySelectorAll('sup').forEach((x) => x.remove())
    c.querySelectorAll('br').forEach((x) => x.replaceWith('\n'))
    c.querySelectorAll('p, li').forEach((x) => x.append('\n'))
    return (c.textContent || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  }
  const table = (sel) => {
    const t = doc.querySelector(sel)
    if (!t) return null
    const periods = [...t.querySelectorAll('thead th')].slice(1).map(txt)
    const rows = [...t.querySelectorAll('tbody tr')].map((tr) => {
      const td = [...tr.querySelectorAll('td')], head = td[0]?.cloneNode(true)
      head?.querySelectorAll('.tooltip').forEach((x) => x.remove()) // "CFO/EBITDA" carries its explanation inline
      return { label: txt(head).replace(/\s*\+$/, ''), values: td.slice(1).map(txt) }
    }).filter((r) => r.label && r.values.some((v) => v) && !/^raw pdf$/i.test(r.label))
    return periods.length && rows.length ? { periods, rows } : null
  }
  const docsIn = (cls) => [...doc.querySelectorAll(`#documents .documents.${cls} li`)]
  const name = txt(doc.querySelector('h1'))
  return {
    name,
    ratios: [...doc.querySelectorAll('#top-ratios li')].map((li) => [txt(li.querySelector('.name')), txt(li.querySelector('.value'))]).filter(([n, v]) => n && v),
    about: lines(doc.querySelector('.company-profile .about')),
    keyPoints: lines(doc.querySelector('.company-profile .commentary')),
    pros: [...doc.querySelectorAll('#analysis .pros li')].map(txt).filter(Boolean),
    cons: [...doc.querySelectorAll('#analysis .cons li')].map(txt).filter(Boolean),
    quarters: table('#quarters table.data-table'), annual: table('#profit-loss table.data-table'),
    balance: table('#balance-sheet table.data-table'), cashflow: table('#cash-flow table.data-table'),
    ratiosTable: table('#ratios table.data-table'), shareholding: table('#quarterly-shp table'),
    growth: [...doc.querySelectorAll('#profit-loss table.ranges-table')].map((t) => ({
      title: txt(t.querySelector('th')), rows: [...t.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td')].map(txt)).filter((r) => r.length === 2),
    })).filter((g) => g.title && g.rows.length),
    announcements: [...doc.querySelectorAll('#company-announcements-tab li')].map((li) => {
      const a = li.querySelector('a'), d = a?.querySelector('div'), title = a ? txt(a.cloneNode(true).childNodes[0]) || txt(a).replace(txt(d), '').trim() : ''
      return { title, detail: txt(d).replace(/^[^-]*-\s*/, ''), date: li.querySelector('time')?.getAttribute('datetime') || null, url: link(a?.getAttribute('href')) }
    }).filter((x) => x.title && x.url).slice(0, 25),
    allAnnouncements: link(doc.querySelector('#company-announcements-tab a.button')?.getAttribute('href')),
    reports: docsIn('annual-reports').map((li) => { const a = li.querySelector('a'); return { title: txt(a), url: link(a?.getAttribute('href')) } }).filter((x) => x.title && x.url),
    ratings: docsIn('credit-ratings').map((li) => { const a = li.querySelector('a'); return { title: txt(a), detail: txt(li).replace(txt(a), '').trim(), url: link(a?.getAttribute('href')) } }).filter((x) => x.title && x.url),
    concalls: docsIn('concalls').map((li) => ({
      when: txt(li.querySelector('div')), links: [...li.querySelectorAll('a')].map((a) => ({ title: txt(a), url: link(a.getAttribute('href')) })).filter((x) => x.title && x.url),
    })).filter((x) => x.when && x.links.length),
    standalone: [...doc.querySelectorAll('#quarters thead th')].some((th) => /\(S\)/.test(th.textContent || '')),
  }
}
/** The latest quarter against a year before and the quarter before: Sales / Revenue, Operating profit,
 *  Net profit, EPS, OPM (banks report Revenue and Financing profit). */
function resultsSummary(q) {
  if (!q?.periods?.length) return null
  const n = q.periods.length - 1, num = (v) => parseNum(String(v ?? '').replace('%', ''))
  const pick = (re) => q.rows.find((r) => re.test(r.label))
  const items = [[/^(sales|revenue)/i, 'Sales'], [/^(operating|financing) profit/i, 'Operating profit'], [/^net profit/i, 'Net profit'], [/^eps/i, 'EPS (₹)'], [/^(opm|financing margin)/i, 'OPM %']]
    .map(([re, label]) => {
      const r = pick(re); if (!r) return null
      const now = num(r.values[n]), yr = num(r.values[n - 4]), qt = num(r.values[n - 1]), pct = label.endsWith('%')
      const g = (a, b) => a == null || b == null || b === 0 ? null : pct ? a - b : ((a - b) / Math.abs(b)) * 100
      return { label, value: now, yoy: g(now, yr), qoq: g(now, qt), points: pct }
    }).filter((x) => x && x.value != null)
  const sa = (i) => /\(S\)/.test(q.periods[i] || '')
  // a YoY / QoQ across a switch to consolidated accounts compares two different bases
  return items.length ? { period: q.periods[n].replace(/\s*\(S\)$/, ''), standalone: sa(n), mixed: n >= 4 && (sa(n) !== sa(n - 4) || sa(n) !== sa(n - 1)), items } : null
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

if (typeof module !== 'undefined') module.exports = { fmt, pctText, croreShort, hexRgb, isHex, luminance, heat, bucketColors, THEMES, THEME_TOKENS, resolveTheme, sectorRow, sectorSummary, sortRows, allStocks, movers, indexRow, mcQuote, mcHistoryUrl, mcBars, barStats, ticks, researchLinks, RANGES, feedPools, feedPage, barFacts, saneSector, rssItems, mergeNews, NEWS_EVERY, feedFiltered, filterOn, FEED_KINDS, FONTS, fontNameOk, fontStack, fontKind, googleFontUrl, squarify, pdfLines, casHoldings, parseAmfiNav, filingKind, parseScreener, resultsSummary, screenerUrl, cleanFilter, sameFilter, FEED_TEMPLATES, cleanTemplates, saveTemplate, marketOpen, parseNum, splitCsv, parseHoldings, decodeText, bracketSymbol, fileKind, xlsxSheets, htmlTableCsv, cleanSymbol, inPortfolio, holdingId, normDate, mergeHoldings, valuePortfolio, heldFor, cleanPortfolio, FEED_PAGE1, FEED_PAGE, FEED_THEMES }
