// Headless run of the real app (assets/index.html + lib.js + app.js) against the live ET / Moneycontrol feeds,
// with a JS stand-in for the Java bridge: boots the Feed, imports holdings by paste (symbol matching, an ETF,
// an ISIN), saves, values them live, adds alerts, exports and re-imports a backup, then opens every screen.
// Needs jsdom, kept out of the repo:  npm i --prefix /tmp/stoklore-smoke jsdom@24.1.3
//   NODE_PATH=/tmp/stoklore-smoke/node_modules node mobile/test/smoke.cjs mobile/assets
// Canvas, IntersectionObserver and fonts are stubbed, so it checks behaviour and script errors, not looks.
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom')
const path = require('path')
const ASSETS = process.argv[2]
const errors = [], files = {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let exported = null
class Local extends ResourceLoader { fetch(url, o) { return url.startsWith('file:') ? super.fetch(url, o) : Promise.reject(new Error('offline: ' + url)) } }
const vc = new VirtualConsole()
vc.on('jsdomError', (e) => { if (!/Could not load (link|img)|offline:|Not implemented: (HTMLCanvasElement|window.scrollTo)/.test(e.message)) errors.push('jsdomError: ' + e.message + (e.detail ? ' ' + (e.detail.stack || e.detail) : '')) })
vc.on('error', (e) => errors.push('console.error: ' + e))
const UA = 'Mozilla/5.0 (Linux; Android) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
;(async () => {
  const dom = await JSDOM.fromFile(path.join(ASSETS, 'index.html'), {
    runScripts: 'dangerously', resources: new Local(), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.IntersectionObserver = class { observe() {} disconnect() {} }
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (t, k) => k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}, set: () => true })
      w.Element.prototype.scrollIntoView = () => {}
      w.Element.prototype.scrollTo = () => {}
      w.scrollTo = () => {}
      w.document.fonts = { load: async () => [] }
      w.addEventListener('error', (e) => errors.push('window.error: ' + e.message + ' @' + e.lineno))
      w.Native = {
        get(id, url) {
          const site = url.includes('moneycontrol') ? 'https://www.moneycontrol.com' : 'https://economictimes.indiatimes.com'
          fetch(url, { headers: { Accept: 'application/json, text/javascript, */*; q=0.01', Origin: site, Referer: site + '/', 'User-Agent': UA } })
            .then(async (r) => w.onNative(id, r.status, r.status === 200 ? await r.text() : ''), (e) => w.onNative(id, 0, String(e)))
        },
        open() {}, openDhan() {}, setBars() {}, setTextZoom() {}, version: () => '2.0',
        readFile: (n) => files[n] || '{}',
        savePortfolio: (j) => { JSON.parse(j); files['portfolio.json'] = j; return true },
        checkNow() {}, notifyState: () => 'off', requestNotify() {}, openBattery() {},
        exportFile: (n, t) => { exported = t; w.onExported(true) },
      }
    },
  })
  const w = dom.window, d = w.document, $ = (s) => d.querySelector(s)
  const click = (s) => { const el = typeof s === 'string' ? $(s) : s; if (!el) throw new Error('no element ' + s); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) }
  const go = async (h, ms = 2500) => { w.location.hash = h; await sleep(ms) }
  const step = (name, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`)

  await sleep(6000)
  step('boot: Feed built from live ET data', $('#feed')?.children.length > 40, `${$('#feed')?.children.length} card slots, first: ${$('#feed .fk')?.textContent}`)
  step('tabs', [...d.querySelectorAll('#tabs button')].map((b) => b.textContent).join(',') === 'Feed,Holdings,Markets,Sectors,Settings')

  await go('#/holdings', 800)
  step('holdings: empty state', /Your holdings, live/.test($('#view').textContent))
  click('[data-h="paste"]'); await sleep(100)
  $('#hpaste').value = 'TCS 10 3450\nTata Motors, 20, 712.40\nNIFTYBEES 100 250\nINE009A01021 5 1400\nHDFC Bank 7\n'
  click('[data-h="pasted"]'); await sleep(7000)
  const rv = w.eval('hd.review.rows.map(r => r.name + "=" + (r.sym || "-") + ":" + r.status).join(" | ")')
  step('import review matched rows', /TCS=TCS:ok/.test(rv) && /HDFC Bank=HDFCBANK/.test(rv) && /INE009A01021=-:pick/.test(rv), rv)
  click('[data-h="rsave"]'); await sleep(9000)
  const pf = JSON.parse(files['portfolio.json'] || '{}')
  step('saved portfolio.json', pf.holdings?.length === 4, pf.holdings?.map((h) => `${h.sym}×${h.qty}@${h.avg}`).join(', '))
  const tot = w.eval('JSON.stringify(hd.val && hd.val.total)')
  step('valued live', JSON.parse(tot)?.priced >= 3, tot)
  step('holdings screen rendered', /Current value/.test($('#view').textContent) && d.querySelectorAll('[data-h^="hold:"]').length === JSON.parse(files['portfolio.json']).holdings.length)

  click('[data-h="alert"]'); await sleep(100)
  const suggested = $('#aval')?.value
  click('[data-h="asave"]'); await sleep(100)
  click('[data-h="alert"]'); await sleep(100); click('[data-h="akind:pbelow"]'); await sleep(100); click('[data-h="asave"]'); await sleep(100)
  const al = JSON.parse(files['portfolio.json']).alerts
  step('alerts saved', al.length === 2 && al[0].kind === 'below' && al[1].kind === 'pbelow' && al[1].sym, `suggested ${suggested}; ${al.map((a) => a.kind + ':' + (a.sym || '') + ':' + a.value).join(', ')}`)
  click('[data-h="notify:2h"]'); await sleep(100)
  step('notify setting saved', JSON.parse(files['portfolio.json']).notify === '2h')

  click(d.querySelector('[data-h^="hold:"]')); await sleep(200)
  step('holding card opens', $('#sheet').classList.contains('on') && /Chart/.test($('#sheet').textContent))
  w.eval('closeSheet()')

  click('[data-h="export"]'); await sleep(200)
  const bk = JSON.parse(exported || '{}')
  step('backup export', bk.app === 'stoklore' && bk.portfolio.holdings.length === 4 && bk.portfolio.alerts.length === 2, Object.keys(bk.settings || {}).join(','))
  files['portfolio.json'] = '{}'; w.eval('hd.pf = null')
  w.eval(`importBackup(${JSON.stringify(exported)})`); await sleep(2000)
  step('backup import', JSON.parse(files['portfolio.json']).holdings.length === 4)

  w.eval('feedReset(); fd.cards = []'); await go('#/feed', 6000)
  step('feed: holdings card second', w.eval('fd.cards[1] && fd.cards[1].kind') === 'holdings')

  for (const [h, re] of [['#/markets', /Market breadth/], ['#/sectors', /Sector map/], ['#/settings', /Data & backup|Export backup/], ['#/search', /Type a company|Recent/], ['#/stock/TCS', /Key stats/], ['#/index/in%3BNSX', /Returns/]]) {
    await go(h, 5000)
    step(`screen ${h}`, re.test($('#view').textContent), $('#top h1')?.textContent.trim().slice(0, 40))
  }
  console.log(errors.length ? `\n${errors.length} ERRORS:\n` + errors.join('\n') : '\nno script errors')
  w.close(); process.exit(0)
})().catch((e) => { console.log('HARNESS FAIL', e); console.log(errors.join('\n')); process.exit(1) })
