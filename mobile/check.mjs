// node mobile/check.mjs - asserts on assets/lib.js (the app's pure data + maths). No network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const L = createRequire(import.meta.url)('./assets/lib.js')

// heat: themed, deeper with the move, readable text on top
const dark = L.resolveTheme('terminal-dark'), mono = L.resolveTheme('mono-dark')
assert.notEqual(L.heat(3, dark.colors).bg, L.heat(-3, dark.colors).bg)
assert.notEqual(L.heat(1, dark.colors).bg, L.heat(4, dark.colors).bg)
assert.equal(L.heat(4, dark.colors).bg, L.heat(9, dark.colors).bg) // saturates at ±4%
assert.equal(L.heat(4, mono.colors).fg, '#0b0b0b') // near-white fill -> dark text
assert.ok(!/34, 197, 94|239, 68, 68/.test(L.heat(2, mono.colors).bg)) // no hard-coded green/red left

// themes: every preset has every token; custom overrides only valid hex over its base
for (const t of L.THEMES) for (const [k] of L.THEME_TOKENS) assert.ok(L.isHex(t.colors[k]), `${t.id}.${k}`)
const c = L.resolveTheme('custom', { base: 'mono-light', colors: { up: '#3b82f6', down: 'nope' } })
assert.equal(c.colors.up, '#3b82f6'); assert.equal(c.colors.down, L.resolveTheme('mono-light').colors.down); assert.equal(c.mode, 'light')
assert.equal(L.resolveTheme('missing').id, 'terminal-dark')

// movers: cap buckets by mcap rank, direction, size
const sectors = [{ members: Array.from({ length: 300 }, (_, i) => ({ id: i, mcap_cr: 1e6 - i, change_pct: (i % 7) - 3 })) }]
const all = L.allStocks(sectors)
assert.equal(all[99].cap, 'large'); assert.equal(all[100].cap, 'mid'); assert.equal(all[250].cap, 'small')
const g = L.movers(all, 'mid', 'gainers', 5)
assert.equal(g.length, 5); assert.ok(g.every((m) => m.cap === 'mid' && m.change_pct === 3))
assert.ok(L.movers(all, 'all', 'losers').every((m) => m.change_pct < 0))

// bars: bad rows dropped, 1D keeps the last IST session only
const day1 = Date.UTC(2026, 10, 25, 4) / 1000, day2 = Date.UTC(2026, 10, 26, 4) / 1000
const j = { s: 'ok', t: [day1, day2, day2 + 300, day2 + 600], o: [1, 2, 3, null], h: [1, 2, 3, 4], l: [1, 2, 3, 4], c: [1, 2, 3, 4], v: [1, 1, 1, 1] }
assert.equal(L.mcBars(j, '1M').length, 3)
assert.deepEqual(L.mcBars(j, '1D').map((b) => b.t), [day2, day2 + 300])
assert.deepEqual(L.mcBars({ s: 'no_data' }, '1D'), [])

// axis ticks: round steps inside the range
assert.deepEqual(L.ticks(101, 139, 4), [110, 120, 130])
assert.deepEqual(L.ticks(5, 5), [5])
// feed: 30 sectors x 40 stocks, moves spread both ways, sectors alternating up / down
const fsec = Array.from({ length: 30 }, (_, s) => {
  const members = Array.from({ length: 40 }, (_, i) => ({
    id: s * 100 + i, name: `S${s}M${i}`, sector: `Sec${s}`, sectorId: `sec${s}`, price: 100 + i,
    mcap_cr: 400 + ((s * 37 + i * 101) % 997) * 600, volume_k: i === 7 ? 0 : 50, change_pct: (((s * 13 + i * 7) % 21) - 10) / 2,
  }))
  const adv = members.filter((m) => m.change_pct > 0).length, dec = members.filter((m) => m.change_pct < 0).length
  return { id: `sec${s}`, name: `Sec${s}`, change_pct: s % 2 ? -0.6 - s / 50 : 0.4 + s / 40, advance: adv, decline: dec, members, mcap_cr: 1e5, mcap_change_cr: 1 }
})
assert.equal(L.FEED_PAGE1.length, 40)
const run = () => {
  const p = L.feedPools(fsec), seen = new Set(), pages = []
  for (let pg = 0; pg < 60; pg++) { const r = L.feedPage(p, pg, seen); pages.push(r); if (!r.cards.length && r.theme === 'rest') break }
  return { p, pages }
}
const { p: fp, pages } = run()
const ids = pages.flatMap((r) => r.cards.filter((c) => c.member).map((c) => c.id))
assert.equal(new Set(ids).size, ids.length, 'a stock repeats in the feed')
assert.ok(pages.at(-1).cards.length === 0 && pages.at(-1).theme === 'rest', 'feed never runs dry')
assert.equal(ids.length, fp.stocks.filter((m) => m.change_pct !== 0).length + fp.quiet.filter((m) => m.change_pct === 0).length, 'every moving stock is shown once')
assert.ok(fp.stocks.every((m) => m.mcap_cr >= 500 && m.volume_k > 0), 'pool not cleaned')
const p1 = pages[0].cards
assert.equal(p1.length, 41); assert.equal(p1.at(-1).kind, 'end'); assert.equal(p1[0].kind, 'index'); assert.equal(p1[1].kind, 'breadth')
for (const r of pages) {
  const per = {}
  for (const c of r.cards) if (c.member) per[c.member.sectorId] = (per[c.member.sectorId] || 0) + 1
  assert.ok(Object.values(per).every((n) => n <= 3), `page ${r.theme}: >3 from one sector`)
  for (const c of r.cards) if (c.kind === 'tide') assert.ok(c.member.change_pct * c.sector.change_pct < 0, 'tide card moves with its sector')
}
const mv1 = p1.filter((c) => c.kind === 'mover')
assert.ok(mv1.filter((c) => c.member.cap !== 'large').length >= 5, 'too few mid / small caps on page 1')
assert.ok(mv1.slice(0, 10).every((c, i) => (c.member.change_pct > 0) === (i % 2 === 0)), 'page 1 movers do not alternate gain / loss')
assert.equal(JSON.stringify(run().pages.map((r) => r.cards.map((c) => c.id))), JSON.stringify(pages.map((r) => r.cards.map((c) => c.id))), 'feed not deterministic')
const large = fp.stocks.filter((m) => m.cap === 'large')
assert.ok(Math.abs(fp.sizes[0].avg - large.reduce((t, m) => t + m.change_pct, 0) / large.length) < 1e-9)
// seen from earlier today is skipped
const seen2 = new Set(ids.slice(0, 20)), again = L.feedPage(L.feedPools(fsec), 0, seen2).cards
assert.ok(again.every((c) => !c.member || !ids.slice(0, 20).includes(c.id)))

// mover weight: a big company's smaller move outranks a small one's bigger move
const wp = L.feedPools([{ id: 'x', name: 'X', change_pct: 1, members: [
  { id: 1, sectorId: 'x', mcap_cr: 5e5, price: 1, volume_k: 1, change_pct: 4 }, { id: 2, sectorId: 'x', mcap_cr: 600, price: 1, volume_k: 1, change_pct: 9 }] }])
assert.equal(wp.movers[0].m.id, 1)
// a broken ET sector move (-100%) becomes the members' weighted move; tide needs a real stock move
const bad = L.saneSector({ change_pct: -100, members: [{ change_pct: 1, mcap_cr: 3 }, { change_pct: -1, mcap_cr: 1 }] })
assert.equal(bad.change_pct, 0.5)
assert.ok(fp.tide.every((x) => Math.abs(x.m.change_pct) >= 1))

// headlines: CDATA, entities, tags stripped, https only, newest first, one per story
const xml = `<rss><channel><item><title><![CDATA[Nifty &amp; Sensex <b>rise</b>]]></title><link>https://economictimes.indiatimes.com/a.cms</link>
  <enclosure url="https://img.etimg.com/a.jpg" type="image/jpeg"/><pubDate>Thu, 26 Nov 2026 07:35:38 +0530</pubDate><description><![CDATA[<img src="x"/>Up &#8377;5 &quot;today&quot;]]></description></item>
  <item><title>Old</title><link>https://economictimes.indiatimes.com/b.cms</link><pubDate>Wed, 25 Nov 2026 07:00:00 +0530</pubDate></item>
  <item><title>Bad link</title><link>javascript:alert(1)</link></item></channel></rss>`
const items = L.rssItems(xml, 'Markets')
assert.equal(items.length, 2)
assert.equal(items[0].title, 'Nifty & Sensex rise'); assert.equal(items[0].desc, 'Up ₹5 "today"')
assert.equal(items[0].img, 'https://img.etimg.com/a.jpg'); assert.equal(items[1].img, null)
assert.equal(items[0].time, Date.UTC(2026, 10, 26, 2, 5, 38))
const merged = L.mergeNews([[items[1]], items, [{ ...items[0], source: 'Stocks' }]])
assert.deepEqual(merged.map((n) => n.title), ['Nifty & Sensex rise', 'Old'])
// a headline after every 5th market card, none twice, the feed's other cards unchanged
const news = Array.from({ length: 12 }, (_, i) => ({ id: `n:${i}`, title: `H${i}`, link: `https://x/${i}`, time: i }))
const npools = L.feedPools(fsec, news), nseen = new Set()
const n1 = L.feedPage(npools, 0, nseen).cards, n2 = L.feedPage(npools, 1, nseen).cards
assert.deepEqual(n1.map((c, i) => c.kind === 'news' ? i : -1).filter((i) => i >= 0), [5, 11, 17, 23, 29, 35, 41, 47])
assert.equal(n1.at(-1).news, 8); assert.equal(n1.at(-1).shown, 40)
assert.deepEqual(n2.filter((c) => c.kind === 'news').map((c) => c.id), ['n:8', 'n:9', 'n:10', 'n:11'])
assert.deepEqual(n1.filter((c) => c.kind !== 'news').map((c) => c.id), pages[0].cards.map((c) => c.id))

// filter: only what was picked, rotating kinds, nothing twice, runs dry
const fall = (f) => { const seen = new Set(), out = []; for (let pg = 0; pg < 99; pg++) { const r = L.feedFiltered(npools, pg, seen, f); if (!r.cards.length) break; out.push(...r.cards) } return out }
assert.equal(L.filterOn({}), false); assert.equal(L.filterOn({ kinds: ['news'] }), true); assert.equal(L.filterOn({ minMove: 2 }), true)
const losers = fall({ kinds: ['losers'] }).filter((c) => c.kind !== 'end')
assert.ok(losers.length > 0 && losers.every((c) => c.member.change_pct < 0))
assert.equal(losers.length, fp.movers.filter((x) => x.m.change_pct < 0).length, 'not every loser')
const twoSec = fall({ sectors: ['sec1', 'sec2'], kinds: ['gainers', 'losers', 'sectors'] }).filter((c) => c.kind !== 'end')
assert.ok(twoSec.every((c) => c.member ? ['sec1', 'sec2'].includes(c.member.sectorId) : ['sec1', 'sec2'].includes(c.sector.id)))
assert.equal(twoSec.filter((c) => c.kind === 'sector').length, 2)
assert.ok(twoSec.slice(0, 3).map((c) => c.member ? (c.member.change_pct > 0 ? 'g' : 'l') : 's').join('') === 'gls', 'kinds do not rotate')
const big = fall({ caps: ['large'], minMove: 4 }).filter((c) => c.member && c.kind !== 'quiet')
assert.ok(big.length && big.every((c) => c.member.cap === 'large' && Math.abs(c.member.change_pct) >= 4))
const onlyNews = fall({ kinds: ['news'] })
assert.deepEqual(onlyNews.filter((c) => c.kind !== 'end').map((c) => c.id), news.map((n) => n.id))
const fids = fall({ kinds: ['gainers', 'tide'] }).filter((c) => c.member).map((c) => c.id)
assert.equal(new Set(fids).size, fids.length, 'filtered feed repeats a stock')
const ov = L.feedFiltered(npools, 0, new Set(), { kinds: ['overview', 'losers'] }).cards
assert.deepEqual(ov.slice(0, 3).map((c) => c.kind), ['index', 'breadth', 'size'])
assert.ok(!L.feedFiltered(npools, 1, new Set(), { kinds: ['overview'] }).cards.length, 'overview repeats after page 1')

// bar facts: 6M-high distance, streak, volume multiple
const fb = [10, 11, 12, 11, 12, 13, 14].map((c, i) => ({ t: i, o: c, h: c, l: c, c, v: 100 }))
const facts = L.barFacts(fb, 0.3)
assert.equal(facts.streak, 3); assert.equal(facts.fromHigh, 0); assert.equal(facts.volX, 3)
assert.equal(L.barFacts([...fb, { t: 9, o: 13, h: 13, l: 13, c: 13, v: 100 }], 0).streak, -1)
// fonts: only safe family names reach a URL / CSS; stacks fall back to the same kind
assert.ok(L.fontNameOk('Space Grotesk') && L.fontNameOk('Inter'))
for (const bad of ['', ' ', 'Inter"; } body { x', '../x', 'a'.repeat(60), 'Font<script>']) assert.ok(!L.fontNameOk(bad), bad)
assert.equal(L.fontStack('system-mono'), L.fontStack('nonsense"'))
assert.ok(L.fontStack('JetBrains Mono').startsWith('"JetBrains Mono", ui-monospace'))
assert.ok(L.fontStack('Playfair Display').includes('system-ui')); assert.equal(L.fontKind('Noto Serif'), 'serif'); assert.equal(L.fontKind('Ubuntu Mono'), 'mono')
assert.equal(L.googleFontUrl('Space Grotesk'), 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700&display=swap')
assert.equal(L.googleFontUrl('Lobster', false), 'https://fonts.googleapis.com/css2?family=Lobster&display=swap')
assert.ok(L.FONTS.every(([f]) => f.startsWith('system-') || L.fontNameOk(f)))
// holdings: numbers, CSV with headers (broker style), headerless paste, merge, value, held-for, cleaning
assert.equal(L.parseNum('₹1,20,000.50'), 120000.5); assert.equal(L.parseNum('Rs. 3450'), 3450); assert.equal(L.parseNum('abc'), null); assert.equal(L.parseNum(''), null)
const zer = 'Instrument,Qty.,Avg. cost,LTP,Cur. val,P&L\nTCS,10,"3,450.50",3600,36000,1495\n"M&M",5,2800,2900,14500,500\nTotal,,,,50500,1995\n'
const pz = L.parseHoldings(zer)
assert.deepEqual(pz.rows.map((r) => [r.name, r.qty, r.avg]), [['TCS', 10, 3450.5], ['M&M', 5, 2800]]); assert.equal(pz.skipped, 1)
const groww = 'Stock Name\tISIN\tQuantity\tAverage buy price\tBuy date\nTata Motors\tINE155A01022\t20\t712.4\t10/01/2024\n'
const pg = L.parseHoldings(groww)
assert.deepEqual(pg.rows[0], { name: 'Tata Motors', qty: 20, avg: 712.4, date: '2024-01-10', line: 2, isin: 'INE155A01022' })
const exp = L.parseHoldings('Symbol,ISIN,Quantity,Average price,Name\nGINNIFILA,INE424C01010,22,,Ginni Filaments Ltd\n,INF204KC1FU1,5,,Nippon India Liquid ETF\n')
assert.deepEqual(exp.rows.map((r) => [r.name, r.isin, r.hint, r.qty]), [['GINNIFILA', 'INE424C01010', 'Ginni Filaments Ltd', 22], ['Nippon India Liquid ETF', 'INF204KC1FU1', undefined, 5]])
// odd files: CR-only line ends, UTF-16 with BOM, headers we don't know
const userCsv = 'Symbol,Quantity,Average price,Name\nGINNIFILA,22,,Ginni Filaments Ltd\nNIFTYBEES,163,,Nippon India ETF Nifty 50 BeES\nINF204KC1FU1,5,,Nippon India Nifty 1D Rate Liquid ETF\n'
assert.equal(L.parseHoldings(userCsv.replace(/\n/g, '\r')).rows.length, 3, 'CR line ends')
const u16 = new Uint8Array([0xff, 0xfe, ...[...userCsv].flatMap((ch) => [ch.charCodeAt(0), 0])])
assert.equal(L.parseHoldings(L.decodeText(u16)).rows.length, 3, 'UTF-16 file')
assert.equal(L.decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])), 'A')
assert.deepEqual(L.parseHoldings('Scrip,Units held,Rate\nGINNIFILA,22,40.5\nTCS,"10",\n').rows.map((r) => [r.name, r.qty, r.avg]), [['GINNIFILA', 22, null], ['TCS', 10, null]], 'a bare "Rate" is a market price, not the buy price')
assert.deepEqual(L.parseHoldings('Code,Units,Cost\nGINNIFILA,22,40.5\n').rows.map((r) => [r.name, r.qty, r.avg]), [['GINNIFILA', 22, 40.5]], 'headers we don\'t know: name, then numbers')
assert.deepEqual(L.parseHoldings('[{"symbol":"GINNIFILA","quantity":22},{"symbol":"INF204KC1FU1","quantity":5,"name":"Liquid ETF"},{"symbol":"X"}]').rows.map((r) => [r.name, r.qty, r.hint]),
  [['GINNIFILA', 22, undefined], ['INF204KC1FU1', 5, 'Liquid ETF']], 'JSON paste')
// Dhan's holdings exports (personal lines replaced): "Avg. Buy Rate", a totals line after the table, symbols in brackets
const dhanEq = L.parseHoldings(readFileSync(new URL('./test/fixtures/dhan-eq.csv', import.meta.url), 'utf8'))
assert.deepEqual(dhanEq.rows.map((r) => [r.name, r.qty, r.avg]), [['KRBL', 3, 400.4], ['Marico', 1, 874.35], ['Ginni Filaments', 22, 44.45]], 'Dhan equity export')
const dhanEtf = L.parseHoldings(readFileSync(new URL('./test/fixtures/dhan-etf.csv', import.meta.url), 'utf8'))
assert.deepEqual(dhanEtf.rows.map((r) => [r.name, r.qty, r.avg]), [['Nippon Nifty 50 ETF (NIFTYBEES)', 163, 274.07], ['Nippon India Nifty 1D Rate Liquid ETF', 5, 1058.58]], 'Dhan ETF export')
assert.equal(L.bracketSymbol('Nippon Nifty 50 ETF (NIFTYBEES)'), 'NIFTYBEES'); assert.equal(L.bracketSymbol('Marico'), null)
const paste = L.parseHoldings('TCS 10 3450\nTata Motors, 20, 712.40\nINFY 3\n\nnonsense\n')
assert.deepEqual(paste.rows.map((r) => [r.name, r.qty, r.avg]), [['TCS', 10, 3450], ['Tata Motors', 20, 712.4], ['INFY', 3, null]]); assert.equal(paste.skipped, 1)
assert.equal(L.normDate('10-Jan-2024'), '2024-01-10'); assert.equal(L.normDate('2024-01-10T00:00'), '2024-01-10'); assert.equal(L.normDate('soon'), null)
const mh = L.mergeHoldings([{ sym: 'TCS', qty: 10, avg: 100, date: '2024-02-01' }, { sym: 'TCS', qty: 30, avg: 200, date: '2023-05-01' }, { sym: 'INFY', qty: 1, avg: 5 }])
assert.deepEqual(mh[0], { sym: 'TCS', qty: 40, avg: 175, date: '2023-05-01' }); assert.equal(mh.length, 2)
const pv = L.valuePortfolio([{ sym: 'A', qty: 10, avg: 100 }, { sym: 'B', qty: 5, avg: null }, { sym: 'C', qty: 1, avg: 50 }],
  (h) => ({ A: { price: 120, prev: 110 }, B: { price: 40, prev: 50 } })[h.sym])
assert.deepEqual([pv.total.value, pv.total.pnl, pv.total.day, pv.total.priced, pv.total.missing], [1400, 200, 50, 2, 1])
assert.equal(pv.total.pnlPct, 20); assert.equal(+pv.total.dayPct.toFixed(4), +(50 / 1350 * 100).toFixed(4)); assert.equal(pv.total.invested, 1050)
assert.equal(pv.rows[0].dayPct.toFixed(4), (120 / 110 * 100 - 100).toFixed(4))
const hf = L.heldFor('2024-01-10', Date.parse('2025-04-20T12:00:00+05:30')); assert.ok(hf.long && hf.text === '1y 3m', JSON.stringify(hf))
assert.equal(L.heldFor('2026-11-01', Date.parse('2026-11-26T12:00:00+05:30')).long, false); assert.equal(L.heldFor(null), null)
const cp = L.cleanPortfolio({ holdings: [{ sym: 'TCS', qty: 10, avg: 1, et: '8345' }, { sym: 'bad sym!', qty: 1 }, { sym: 'X', qty: -1 }, { sym: 'Y', qty: 1, avg: 'x' }],
  alerts: [{ kind: 'below', value: 1000 }, { kind: 'pbelow', value: 5, sym: 'NOPE' }, { kind: 'pabove', value: 5, sym: 'TCS' }, { kind: 'rm -rf', value: 1 }, { kind: 'above', value: NaN }], notify: 'spam' })
assert.deepEqual(cp.holdings.map((h) => h.sym), ['TCS']); assert.deepEqual(cp.alerts.map((a) => a.kind), ['below', 'pabove']); assert.equal(cp.notify, 'hourly')
assert.deepEqual(L.cleanPortfolio(null), { v: 1, portfolios: [{ id: 'main', name: 'My portfolio' }], holdings: [], watch: [], alerts: [], notify: 'hourly', filings: true })
// portfolios: main always there, unknown / bad ids fold into main, same stock in two portfolios kept apart
const mp = L.cleanPortfolio({ portfolios: [{ id: 'fam', name: 'Family' }, { id: 'BAD ID', name: 'x' }, { id: 'main', name: 'Mine' }],
  holdings: [{ sym: 'TCS', qty: 1, pf: 'fam' }, { sym: 'TCS', qty: 2 }, { sym: 'INFY', qty: 3, pf: 'gone' }],
  alerts: [{ kind: 'below', value: 5, pf: 'fam' }, { kind: 'above', value: 5, pf: 'gone' }] })
assert.deepEqual(mp.portfolios, [{ id: 'main', name: 'Mine' }, { id: 'fam', name: 'Family' }])
assert.deepEqual(mp.holdings.map((h) => [h.id, h.pf]), [['hfam-TCS', 'fam'], ['hTCS', 'main'], ['hINFY', 'main']])
assert.deepEqual(mp.alerts.map((a) => a.pf), ['fam', null])
assert.deepEqual(L.inPortfolio(mp.holdings, 'fam').map((h) => h.sym), ['TCS']); assert.equal(L.inPortfolio(mp.holdings, 'all').length, 3)
assert.equal(L.mergeHoldings([{ sym: 'TCS', qty: 1, pf: 'fam' }, { sym: 'TCS', qty: 2 }]).length, 2, 'different portfolios not merged')
// funds, watchlist, Screener ids: kept when well-formed, dropped when not
const cp2 = L.cleanPortfolio({ holdings: [{ sym: 'MF153725', qty: 5, kind: 'mf', code: '153725', isin: 'INF204KC1FU1', avg: 1000 }, { sym: 'TCS', qty: 1, scr: 3365, kind: 'mf' }],
  watch: [{ sym: 'INFY', scr: '1234' }, { sym: 'INFY' }, { sym: 'bad!' }, { sym: 'MF1' }], alerts: [{ kind: 'pbelow', sym: 'INFY', value: 1000 }], filings: false })
assert.deepEqual(cp2.holdings.map((h) => [h.sym, h.kind, h.code, h.scr, h.isin]), [['MF153725', 'mf', '153725', null, 'INF204KC1FU1'], ['TCS', 'stock', null, '3365', null]])
assert.deepEqual(cp2.watch.map((w) => w.sym), ['INFY']); assert.equal(cp2.alerts.length, 1, 'price alert on a watched stock'); assert.equal(cp2.filings, false)
// filter templates: cleaned, feed-ordered kinds, same-name replace, junk dropped; market hours
assert.deepEqual(L.cleanFilter({ kinds: ['news', 'gainers', 'evil'], caps: ['small', 'large', 'huge'], sectors: ['b', 'a', 'a', 5, 'x'.repeat(50)], minMove: 7 }),
  { kinds: ['gainers', 'news'], caps: ['large', 'small'], sectors: ['a', 'b'], minMove: 0 })
assert.deepEqual(L.cleanFilter(null), { kinds: [], caps: [], sectors: [], minMove: 0 })
assert.ok(L.sameFilter({ kinds: ['losers', 'gainers'] }, { kinds: ['gainers', 'losers'], caps: [] }))
assert.ok(L.FEED_TEMPLATES.length >= 5 && L.FEED_TEMPLATES.every((x) => L.filterOn(x.filter) && x.id.startsWith('b:')))
let tl = L.saveTemplate([], 'Banks down', { kinds: ['losers'], sectors: ['s1'] }, 'u:1')
tl = L.saveTemplate(tl, 'IT', { sectors: ['s2'] }, 'u:2')
tl = L.saveTemplate(tl, 'banks DOWN', { kinds: ['losers'], minMove: 2 }, 'u:3')
assert.deepEqual(tl.map((x) => x.name), ['banks DOWN', 'IT']); assert.equal(tl[0].filter.minMove, 2)
assert.equal(L.saveTemplate(tl, '   ', { kinds: ['news'] }, 'u:4').length, 2, 'blank name refused')
assert.equal(L.saveTemplate(tl, 'Nothing', {}, 'u:5').length, 2, 'empty filter refused')
assert.deepEqual(L.cleanTemplates([{ name: 'ok', id: 'u:abc', filter: { kinds: ['news'] } }, { name: '' }, null, { name: 'x', id: '<script>' }]).map((x) => x.id), ['u:abc', 'u:1'])
assert.equal(L.marketOpen(Date.parse('2026-11-26T10:00:00+05:30')), true)   // Thursday
assert.equal(L.marketOpen(Date.parse('2026-11-26T09:10:00+05:30')), false)
assert.equal(L.marketOpen(Date.parse('2026-11-26T15:31:00+05:30')), false)
assert.equal(L.marketOpen(Date.parse('2026-11-28T11:00:00+05:30')), false)  // Saturday
// latest results: YoY against 4 quarters back, QoQ against the one before, margins in points
const rq = { periods: ['Sep 2025', 'Dec 2025', 'Mar 2026', 'Jun 2026', 'Sep 2026'], rows: [
  { label: 'Sales', values: ['1,000', '1,050', '1,100', '1,150', '1,200'] }, { label: 'Net Profit', values: ['100', '90', '110', '-20', '150'] },
  { label: 'OPM %', values: ['20%', '21%', '22%', '23%', '25%'] }, { label: 'EPS in Rs', values: ['5', '', '', '', '6'] }] }
const rs = L.resultsSummary(rq)
assert.equal(rs.period, 'Sep 2026')
assert.deepEqual(rs.items.map((x) => [x.label, x.value, Math.round(x.yoy * 10) / 10, x.qoq == null ? null : Math.round(x.qoq * 10) / 10]),
  [['Sales', 1200, 20, 4.3], ['Net profit', 150, 50, 850], ['EPS (₹)', 6, 20, null], ['OPM %', 25, 5, 2]])
assert.equal(L.resultsSummary({ periods: ['Sep 2026 (S)'], rows: [{ label: 'Revenue', values: ['10'] }] }).standalone, true)
assert.equal(L.resultsSummary(null), null)
assert.equal(L.resultsSummary({ periods: ['Sep 2025 (S)', 'Dec 2025', 'Mar 2026', 'Jun 2026', 'Sep 2026'], rows: rq.rows }).mixed, true)
assert.equal(rs.mixed, false)
assert.equal(L.screenerUrl('M&M'), 'https://www.screener.in/company/M%26M/consolidated/')
// CAS statements: CDSL / NSDL / CAMS rows by units x price = value, a zero balance dropped, CAMS cost
const casLines = [
  'ISIN Security Current Bal Free Bal Lent Bal Market Price Value',
  'INE424C01010 GINNI FILAMENTS LIMITED - EQUITY SHARES 22.000 22.000 0.000 40.64 894.08',
  'INF204KB14I2 NIPPON INDIA ETF NIFTY 50 BEES 163.000 163.000 0.000 262.92 42,855.96',
  'INE000X01999 SOLD OUT COMPANY LTD 0.000 0.000 0.000 15.00 0.00',
  'INE009A01021 INFY INFOSYS LIMITED 5.00 12 1,480.25 17,763.00',
  'Folio No: 12345678 / 01',
  'PPFAS Flexi Cap Fund - Direct Plan Growth - ISIN: INF879O01027 (Advisor: DIRECT) Registrar : CAMS',
  'Closing Unit Balance: 1,234.567 NAV on 31-Oct-2026: INR 85.4321 Total Cost Value: 90,000.00 Market Value on 31-Oct-2026: INR 1,05,471.33',
]
const ch = L.casHoldings(casLines)
assert.deepEqual(ch.map((h) => [h.isin, h.units, h.price, h.kind]), [['INE424C01010', 22, 40.64, 'stock'], ['INF204KB14I2', 163, 262.92, 'mf'], ['INE009A01021', 12, 1480.25, 'stock'], ['INF879O01027', 1234.567, 85.4321, 'mf']])
assert.equal(ch[0].name, 'GINNI FILAMENTS LIMITED'); assert.equal(ch[1].name, 'NIPPON INDIA ETF NIFTY 50 BEES'); assert.equal(ch[2].name, 'INFY INFOSYS LIMITED'); assert.equal(ch[3].name, 'PPFAS Flexi Cap Fund - Direct Plan Growth')
assert.ok(Math.abs(ch[3].avg - 90000 / 1234.567) < 1e-9 && ch[0].avg === null)
assert.deepEqual(L.casHoldings(['INE424C01010 X 1 2 3', 'INE424C01010 X 2 2 4']).map((h) => h.units), [3], 'same ISIN twice adds up')
assert.deepEqual(L.pdfLines([[{ str: 'b', x: 50, y: 700 }, { str: 'a', x: 10, y: 701 }, { str: 'top', x: 0, y: 760 }, { str: ' ', x: 0, y: 650 }]]), ['top', 'a b'])
// AMFI NAV file: both formats, both ISIN columns
const nav = L.parseAmfiNav('Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date\n\nOpen Ended Schemes(Equity)\n153725;INF204KC1FU1;-;Nippon India Nifty 1D Rate Liquid ETF- Growth;Direct Plan;;1066.1175;26-Nov-2026\n100033;INF209K01165;INF209K01CE5;Aditya Birla Equity Advantage;81.2;26-Nov-2026\n')
assert.deepEqual(nav.get('INF204KC1FU1'), { code: '153725', name: 'Nippon India Nifty 1D Rate Liquid ETF- Growth - Direct Plan', nav: 1066.1175, date: '26-Nov-2026' })
assert.equal(nav.get('INF209K01CE5').code, '100033'); assert.equal(nav.size, 3)
// filings worth a notification
assert.equal(L.filingKind('Board Meeting Intimation for Financial Results for Q3'), 'Results')
assert.equal(L.filingKind('Corporate Action-Board approves Dividend'), 'Dividend')
assert.equal(L.filingKind('Announcement under Regulation 30 (LODR)-Newspaper Publication of results'), null)
assert.equal(L.filingKind('Closure of Trading Window'), null); assert.equal(L.filingKind('Change in Director'), null)
// .xlsx (Zerodha-style workbook: preamble rows, an Equity and a Mutual Funds sheet) and file kinds
const xbytes = new Uint8Array(readFileSync(new URL('./test/fixtures/holdings-sample.xlsx', import.meta.url)))
assert.equal(L.fileKind(xbytes), 'zip'); assert.equal(L.fileKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1])), 'ole'); assert.equal(L.fileKind(new TextEncoder().encode('%PDF-1.4')), 'pdf')
const sheets = await L.xlsxSheets(xbytes)
assert.deepEqual(sheets.map((x) => x.name), ['Equity', 'Mutual Funds'])
const xrows = sheets.flatMap((x) => L.parseHoldings(x.csv).rows)
assert.deepEqual(xrows.map((r) => [r.name, r.qty, r.avg, r.isin]), [['TCS', 10, 3450.5, 'INE467B01029'], ['M&M', 5, 2800, 'INE101A01026'], ['NIFTYBEES', 100, 250, 'INF204KB14I2'],
  ['Parag Parikh Flexi Cap Fund - Direct Plan Growth', 1234.567, 72.9, 'INF879O01027']])
// every broker shape (headers as they export them; values made up)
const broker = (csv) => L.parseHoldings(csv).rows.map((r) => [r.name, r.qty, r.avg == null ? null : Math.round(r.avg * 100) / 100])
assert.deepEqual(broker('Instrument,Qty.,Avg. cost,LTP,Cur. val,P&L,Net chg.,Day chg.\nTCS,10,3450.5,3600,36000,1495,4.3,-0.2'), [['TCS', 10, 3450.5]], 'Zerodha Kite')
assert.deepEqual(broker('Stock Name,ISIN,Quantity,Average buy price,Buy value,Closing price,Closing value,Unrealised P&L\nTata Motors,INE155A01022,20,712.4,14248,720,14400,152'), [['Tata Motors', 20, 712.4]], 'Groww stocks')
assert.deepEqual(broker('Scheme Name,AMC,Category,Sub-category,Folio No.,Source,Units,Invested Value,Current Value,Returns,XIRR\nParag Parikh Flexi Cap Fund Direct Growth,PPFAS,Equity,Flexi Cap,123/45,Groww,1234.567,90000,105471,15471,12.5%'),
  [['Parag Parikh Flexi Cap Fund Direct Growth', 1234.567, 72.9]], 'Groww mutual funds (invested / units)')
assert.deepEqual(broker('Instrument,Net Qty,Avg Price,LTP,Current Value,P&L\nINFY,12,1480.25,1500,18000,237'), [['INFY', 12, 1480.25]], 'Upstox')
assert.deepEqual(broker('Symbol,ISIN,Quantity,Average Price (₹),LTP (₹),P&L (₹)\nHDFCBANK,INE040A01034,7,1550,1600,350'), [['HDFCBANK', 7, 1550]], 'Angel One (₹ in headings)')
assert.deepEqual(broker('Stock Symbol,Company Name,ISIN Code,Qty,Average Cost Price,Current Market Price,Unrealized Profit/Loss\nRELIND,Reliance Industries,INE002A01018,4,2400,2500,400'), [['RELIND', 4, 2400]], 'ICICI Direct')
assert.deepEqual(broker('Stock Name,ISIN,Quantity,Avg Cost Price,Current Price,Market Value\nITC Ltd,INE154A01025,50,410.2,440,22000'), [['ITC Ltd', 50, 410.2]], 'HDFC Securities')
assert.deepEqual(broker('Scrip Name,ISIN,Holding Qty,Avg Rate,Market Rate,Market Value\nSBIN,INE062A01020,15,600,800,12000'), [['SBIN', 15, 600]], 'Motilal Oswal / 5paisa')
assert.deepEqual(broker('Symbol,Qty,Avg Price,LTP,P&L\nNSE:TCS-EQ,3,3000,3600,1800\nBSE:INFY-EQ,1,1400,1500,100'), [['TCS', 3, 3000], ['INFY', 1, 1400]], 'Fyers')
assert.deepEqual(broker('Stock Name,Quantity,Avg. Price,LTP,Invested Value\nWipro,8,410,450,3280'), [['Wipro', 8, 410]], 'Paytm Money')
assert.deepEqual(broker('ISIN,Security Name,Current Bal,Free Bal,Pledge Bal,Rate,Value\nINE424C01010,GINNI FILAMENTS LTD,22,22,0,40.64,894.08'), [['GINNI FILAMENTS LTD', 22, null]], 'CDSL demat CSV')
assert.deepEqual(broker(L.htmlTableCsv('<table><tr><th>Stock Symbol</th><th>Qty</th><th>Average Cost Price</th></tr><tr><td>TCS</td><td>2</td><td>3,100.00</td></tr><tr><td>Total</td><td>2</td><td></td></tr></table>')),
  [['TCS', 2, 3100]], 'an HTML table saved as .xls')
assert.equal(L.cleanSymbol('NSE:M&M-EQ'), 'M&M'); assert.equal(L.cleanSymbol('TCS-BE'), 'TCS')
// treemap layout: fills the box exactly, stays inside it, one rectangle per positive value, near-square
const sq = L.squarify([500, 300, 120, 50, 20, 8, 2, 0, -5], 10, 20, 300, 200)
assert.equal(sq.length, 7); assert.ok(Math.abs(sq.reduce((t, r) => t + r.w * r.h, 0) - 300 * 200) < 1e-6)
assert.ok(sq.every((r) => r.x >= 10 - 1e-9 && r.y >= 20 - 1e-9 && r.x + r.w <= 310 + 1e-9 && r.y + r.h <= 220 + 1e-9))
const sqBig = sq.find((r) => r.i === 0); assert.ok(Math.abs(sqBig.w * sqBig.h / 60000 - 500 / 1000) < 1e-9)
assert.ok(sq.filter((r) => r.i < 4).every((r) => Math.max(r.w / r.h, r.h / r.w) < 3), 'big tiles stay close to square')
assert.deepEqual(L.squarify([0, 0], 0, 0, 10, 10), [])
const ko = L.squarify([1, 5, 2], 0, 0, 90, 30, true)
assert.deepEqual(ko.map((r) => r.i), [0, 1, 2], 'keepOrder lays out in the given order'); assert.ok(Math.abs(ko.reduce((t, r) => t + r.w * r.h, 0) - 2700) < 1e-6)
console.log('mobile/check.mjs: all passed')
