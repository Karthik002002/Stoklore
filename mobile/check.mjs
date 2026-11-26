// node mobile/check.mjs - asserts on assets/lib.js (the app's pure data + maths). No network.
import assert from 'node:assert/strict'
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

// bar facts: 6M-high distance, streak, volume multiple
const fb = [10, 11, 12, 11, 12, 13, 14].map((c, i) => ({ t: i, o: c, h: c, l: c, c, v: 100 }))
const facts = L.barFacts(fb, 0.3)
assert.equal(facts.streak, 3); assert.equal(facts.fromHigh, 0); assert.equal(facts.volX, 3)
assert.equal(L.barFacts([...fb, { t: 9, o: 13, h: 13, l: 13, c: 13, v: 100 }], 0).streak, -1)
console.log('mobile/check.mjs: all passed')
