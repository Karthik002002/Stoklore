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
// served from a made-up https origin so localStorage works (jsdom gives file: pages none)
const fs = require('fs'), ORIGIN = 'https://app.local/'
class Local extends ResourceLoader { fetch(url) { return url.startsWith(ORIGIN) ? Promise.resolve(fs.readFileSync(path.join(ASSETS, url.slice(ORIGIN.length)))) : Promise.reject(new Error('offline: ' + url)) } }
const vc = new VirtualConsole()
vc.on('jsdomError', (e) => { if (!/Could not load (link|img)|offline:|Not implemented: (HTMLCanvasElement|window.scrollTo)/.test(e.message)) errors.push('jsdomError: ' + e.message + (e.detail ? ' ' + (e.detail.stack || e.detail) : '')) })
vc.on('error', (e) => errors.push('console.error: ' + e))
const UA = 'Mozilla/5.0 (Linux; Android) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
;(async () => {
  const dom = await JSDOM.fromFile(path.join(ASSETS, 'index.html'), { url: ORIGIN + 'index.html',
    runScripts: 'dangerously', resources: new Local(), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.IntersectionObserver = class { observe() {} disconnect() {} }
      w.ReadableStream = require('stream/web').ReadableStream // pdf.js streams text; WebView has it, jsdom doesn't
      w.TextDecoder = TextDecoder
      w.DecompressionStream = DecompressionStream // .xlsx unzipping; WebView has it
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
        savePortfolio: (j) => { JSON.parse(j); files['portfolio.json'] = j; return '' },
        checkNow() {}, notifyState: () => 'off', requestNotify() {}, openBattery() {}, lockState: () => 'off', setLock() {},
        exportFile: (n, t) => { exported = t; w.onExported(true) },
      }
    },
  })
  const w = dom.window, d = w.document, $ = (s) => d.querySelector(s)
  const click = (s) => { const el = typeof s === 'string' ? $(s) : s; if (!el) throw new Error('no element ' + s); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) }
  const go = async (h, ms = 2500) => { w.location.hash = h; await sleep(ms) }
  const step = (name, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  · ' + extra : ''}`)

  await sleep(6000)
  // the author's credit on Settings → About (ONLY=about runs just this)
  await go('#/settings', 800)
  const sigOk = $('.signame')?.textContent === 'Karthik' && !!$('[data-ext="https://github.com/Karthik002002/Stoklore"]')
    && !d.querySelector('[data-ext^="mailto:"]') && !/linkedin/i.test($('#view').innerHTML)
  step('About: signature and GitHub repo only, no personal details', sigOk, $('.sigsub')?.textContent)
  if (process.env.ONLY === 'about') { console.log(errors.length ? errors.join('\n') : 'no script errors'); w.close(); process.exit(0) }
  await go('#/feed', 300)
  // Dhan's holdings exports (test/fixtures, personal lines replaced), shared to the app; ONLY=dhan runs just this
  const dhan = async (file, expect) => {
    w.onSharedFile(file, fs.readFileSync(path.join(ASSETS, '..', 'test', 'fixtures', file)).toString('base64'), null); await sleep(15000)
    const got = w.eval('hd.review ? hd.review.rows.map(r => r.name + "=" + (r.sym || "-") + ":" + r.status + ":" + r.qty + "@" + r.avg).join(" | ") : "no review"')
    step(`Dhan export ${file}`, expect.every((re) => re.test(got)) && !/Investment/.test(got), got)
    w.eval('hd.review = null'); await go('#/feed', 300)
  }
  await dhan('dhan-eq.csv', [/KRBL=KRBL:ok:3@400.4/, /Marico=MARICO:ok:1@874.35/, /Ginni Filaments=GINNIFILA:ok:22@44.45/])
  await dhan('dhan-etf.csv', [/\(NIFTYBEES\)=NIFTYBEES:ok:163@274.07/, /Liquid ETF=MF153725:ok:5@1058.58/])
  // .xlsx (Zerodha Console shape, two sheets) and an HTML table saved as .xls, shared to the app
  w.onSharedFile('holdings.xlsx', fs.readFileSync(path.join(ASSETS, '..', 'test', 'fixtures', 'holdings-sample.xlsx')).toString('base64'), null); await sleep(15000)
  const xl = w.eval('hd.review ? hd.review.rows.map(r => r.name + "=" + (r.sym || "-") + ":" + r.status + ":" + r.qty + "@" + r.avg).join(" | ") : "no review"')
  step('Excel workbook: every sheet imported', /TCS=TCS:ok:10@3450.5/.test(xl) && /NIFTYBEES=NIFTYBEES:ok:100@250/.test(xl) && /Parag Parikh[^|]*=MF\d+:ok:1234.567@72.9/.test(xl), xl)
  w.eval('hd.review = null'); await go('#/feed', 300)
  w.onSharedFile('export.xls', Buffer.from('<html><table><tr><th>Stock Symbol</th><th>Qty</th><th>Average Cost Price</th></tr><tr><td>INFY</td><td>2</td><td>1,400.00</td></tr></table></html>').toString('base64'), null); await sleep(9000)
  const hx = w.eval('hd.review ? hd.review.rows.map(r => r.name + "=" + (r.sym || "-") + ":" + r.status + ":" + r.qty + "@" + r.avg).join(" | ") : "no review"')
  step('HTML ".xls" export', /INFY=INFY:ok:2@1400/.test(hx), hx)
  w.eval('hd.review = null'); await go('#/feed', 300)
  if (process.env.ONLY === 'dhan') { console.log(errors.length ? errors.join('\n') : 'no script errors'); w.close(); process.exit(0) }
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

  // filter templates: a ready-made one, then one of your own, then used from Settings
  await go('#/feed', 1500)
  click('[data-act="feed-filter"]'); await sleep(300)
  click('[data-fx="tpl:b:Losers only"]'); await sleep(50); click('[data-fx="apply"]'); await sleep(500)
  const losers = w.eval('fd.cards.filter(c => c.member).every(c => c.member.change_pct < 0) && fd.cards.length > 5')
  step('template "Losers only" applied', losers && /Losers only/.test($('#top').textContent), $('#top small')?.textContent)
  click('[data-act="feed-filter"]'); await sleep(300)
  click('[data-fx="kinds:news"]'); click('[data-fx="caps:large"]'); await sleep(50)
  $('#ftname').value = 'Big news'; click('[data-fx="tsave"]'); await sleep(100)
  const saved = JSON.parse(w.localStorage.getItem('feed.templates') || '[]')
  step('own template saved', saved[0]?.name === 'Big news' && saved[0].filter.kinds.join() === 'losers,news' && saved[0].filter.caps.join() === 'large', JSON.stringify(saved[0]))
  w.eval('closeSheet()')
  await go('#/settings', 800)
  click(`[data-act="tpl-use"][data-v="${saved[0].id}"]`); await sleep(300)
  step('template used from Settings', w.eval('JSON.stringify(fd.filter)') === JSON.stringify(saved[0].filter) && /in use/.test($('#view').textContent))
  click('[data-act="tpl-use"][data-v="b:Gainers only"]'); await sleep(200)
  click(`[data-act="tpl-del"][data-v="${saved[0].id}"]`); await sleep(200)
  step('own template removed', JSON.parse(w.localStorage.getItem('feed.templates')).length === 0)
  // the top bar's beat label opens the picker and sets the interval
  await go('#/markets', 1500)
  step('top bar shows the beat', $('#rbeat')?.textContent === '5m', $('#rbeat')?.textContent)
  click('[data-act="beat-menu"]'); await sleep(100)
  click('[data-beat="30"]'); await sleep(100)
  step('beat picked from the top bar', w.localStorage.getItem('refresh.every') === '30' && $('#rbeat').textContent === '30s' && !$('#sheet').classList.contains('on'))
  await go('#/stock/TCS', 1500)
  step('stock screen has the control', !!$('#rbeat') && $('#rbeat').textContent === '30s')
  // auto-refresh: 15s beat (market hours faked open) reloads the screen on its own
  click('[data-act="beat-menu"]'); await sleep(100); click('[data-beat="15"]'); await sleep(100)
  w.marketOpen = () => true
  await go('#/markets', 3000)
  const at0 = w.eval('current.at'); await sleep(16500)
  step('auto-refresh every 15s', w.localStorage.getItem('refresh.every') === '15' && w.eval('current.at') > at0, `${(w.eval('current.at') - at0) / 1000}s later`)
  w.marketOpen = () => false; const at1 = w.eval('current.at'); await sleep(16000)
  step('15s beat sleeps while the market is shut', w.eval('current.at') === at1)
  await go('#/settings', 500); click('[data-act="refresh-every"][data-v="0"]'); await sleep(100)

  // fundamentals from screener.in: results, ratios, growth, every tab
  await go('#/stock/TCS', 9000)
  const txt = (id) => (d.getElementById(id)?.textContent || '').replace(/\s+/g, ' ')
  step('stock: latest results', /Latest results · \w{3} \d{4}/.test(txt('results')) && /Net profit/.test(txt('results')), txt('results').slice(0, 120))
  step('stock: fundamentals + growth + pros/cons', /Stock P\/E/.test(txt('fund')) && /Compounded Sales Growth/.test(txt('fund')) && /Pros/.test(txt('fund')))
  click('[data-stab="financials"]'); await sleep(200)
  const fin = (k) => { click(`[data-fin="${k}"]`); return d.querySelectorAll('#tab-financials .ftable tbody tr').length }
  const counts = ['quarters', 'annual', 'balance', 'cashflow', 'ratiosTable'].map(fin)
  step('stock: every financial statement', counts.every((n) => n > 3) && !d.getElementById('tab-financials').hidden, counts.join('/') + ' rows')
  click('[data-stab="holding"]'); await sleep(100)
  step('stock: shareholding', /Promoters/.test(txt('tab-holding')) && /vs year/.test(txt('tab-holding')), txt('tab-holding').slice(0, 90))
  click('[data-stab="filings"]'); await sleep(100)
  step('stock: filings', d.querySelectorAll('#tab-filings [data-ext]').length > 10, `${d.querySelectorAll('#tab-filings [data-ext]').length} links`)
  click('[data-stab="about"]'); await sleep(100)
  step('stock: about', /Tata Consultancy Services/.test(txt('tab-about')))
  click('[data-stab="overview"]'); await sleep(100)
  await go('#/stock/AVROIND', 9000)
  click('[data-stab="financials"]'); click('[data-fin="quarters"]'); await sleep(100)
  step('stock: mixed standalone / consolidated history', /S = standalone/.test(txt('tab-financials')) && /\(S\)/.test(txt('tab-financials')), txt('results').slice(0, 70))
  click('[data-stab="overview"]')

  // v2.4: a CSV opened with / shared to the app (the user's own file shape: ISIN in the symbol column)
  await go('#/feed', 500)
  const csv = 'Symbol,Quantity,Average price,Name\nGINNIFILA,22,,Ginni Filaments Ltd\nNIFTYBEES,163,,Nippon India ETF Nifty 50 BeES\nINF204KC1FU1,5,,Nippon India Nifty 1D Rate Liquid ETF\n'
  w.onSharedFile('stoklore-holdings.csv', Buffer.from(csv).toString('base64'), null); await sleep(12000)
  const sh = w.eval('hd.review ? hd.review.rows.map(r => r.name + "=" + (r.sym || "-") + ":" + r.status).join(" | ") : "no review"')
  step('shared CSV opens the review on Holdings', w.eval('current.name') === 'holdings' && /GINNIFILA=GINNIFILA:ok/.test(sh) && /NIFTYBEES=NIFTYBEES:ok/.test(sh) && /INF204KC1FU1=MF153725:ok/.test(sh), sh)
  click('[data-h="rcancel"]'); await sleep(200)

  // v2.3: CAS PDF (encrypted fixture), ETF + fund search, watchlist, filings, paste colour, privacy
  await go('#/holdings', 800)
  const pdf = fs.readFileSync(path.join(ASSETS, '..', 'test', 'fixtures', 'cas-sample.pdf'))
  w.__casBuf = w.Uint8Array.from(pdf).buffer
  w.__toasts = []; w.eval("{ const t0 = toast; toast = (m) => { window.__toasts.push(m); t0(m) } }")
  w.eval("casFile = { buf: window.__casBuf, name: 'cas-sample.pdf' }; casSheet()")
  $('#caspw').value = 'WRONG'; click('[data-h="casopen"]'); await sleep(6000)
  step('CAS: wrong password asks again', /Wrong password/.test($('#sheet').textContent), $('#sheet .down')?.textContent)
  $('#caspw').value = 'ABCDE1234F'; click('[data-h="casopen"]'); await sleep(15000)
  const cas = w.eval('hd.review ? hd.review.rows.map(r => (r.name || "").slice(0, 20) + "=" + (r.sym || "-") + ":" + r.status + ":" + r.qty).join(" | ") : "no review"')
  if (/no review/.test(cas)) console.log('  messages:', w.__toasts.join(' | '))
  step('CAS: holdings read and matched', /=GINNIFILA:ok:22/.test(cas) && /=MF140084:ok:163/.test(cas) && /=INFY:ok:12/.test(cas) && /PPFAS[^|]*=MF\d+:ok:1234.567/.test(cas) && !/SOLD OUT/.test(cas), cas)
  click('[data-h="rcancel"]'); await sleep(200)
  w.eval('holdForm(null)'); await sleep(100)
  $('#hq').value = 'NIFTYBEES'; $('#hq').dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(5000)
  step('add: ETF by symbol', /ETF \/ exchange symbol/.test($('#hres').textContent))
  $('#hq').value = 'parag parikh flexi'; $('#hq').dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(12000)
  step('add: mutual funds', d.querySelectorAll('#hres [data-h^="pickmf:"]').length > 0, $('#hres [data-h^="pickmf:"]')?.textContent.trim().slice(0, 60))
  click('#hres [data-h^="pickmf:"]'); await sleep(200)
  step('add: picking a fund asks for units', /Units/.test($('#sheet').textContent) && /Average NAV/.test($('#sheet').textContent))
  w.eval('closeSheet()')
  click('[data-h="paste"]'); await sleep(100)
  step('paste box uses the theme text colour', w.getComputedStyle($('#hpaste')).color !== 'rgb(0, 0, 0)' && w.getComputedStyle($('#hpaste')).color !== '', w.getComputedStyle($('#hpaste')).color)
  w.eval('closeSheet()')
  await go('#/stock/INFY', 3000)
  click('[data-act="watch"]'); await sleep(200)
  step('watchlist: star adds the stock', JSON.parse(files['portfolio.json']).watch.some((x) => x.sym === 'INFY') && $('#wbtn').classList.contains('on'))
  await go('#/holdings', 12000)
  step('watchlist shown on Holdings', /Watchlist/.test($('#view').textContent) && !!d.querySelector('[data-h="unwatch:INFY"]'))
  const pf2 = JSON.parse(files['portfolio.json'])
  step('filings: Screener ids resolved and listed', pf2.holdings.some((h) => h.scr) && /Filings & events/.test($('#view').textContent) && w.eval('hdF.list !== null'), `${pf2.holdings.filter((h) => h.scr).length} ids · ${w.eval('hdF.list && hdF.list.length')} filings`)
  click('[data-h="alert"]'); await sleep(100); click('[data-h="akind:pbelow"]'); await sleep(100); click('[data-h="asym:INFY"]'); await sleep(100)
  click('[data-h="asave"]'); await sleep(200)
  step('price alert on a watched stock', JSON.parse(files['portfolio.json']).alerts.some((a) => a.sym === 'INFY'))
  // portfolios: a second one, a stock in both kept apart, views and a portfolio-only alert
  click('[data-h="pfmanage"]'); await sleep(100)
  $('#pfnew').value = 'Family'; click('[data-h="pfadd"]'); await sleep(200)
  const fam = JSON.parse(files['portfolio.json']).portfolios.find((x) => x.name === 'Family')
  step('portfolio added and selected', !!fam && w.eval('hd.sel') === fam.id, JSON.stringify(fam))
  w.eval('closeSheet()')
  click('[data-h="paste"]'); await sleep(100); $('#hpaste').value = 'TCS 3 3000'; click('[data-h="pasted"]'); await sleep(6000)
  click('[data-h="rsave"]'); await sleep(4000)
  const hs = JSON.parse(files['portfolio.json']).holdings.filter((h) => h.sym === 'TCS')
  step('same stock in two portfolios kept apart', hs.length === 2 && hs.some((h) => h.pf === fam.id && h.qty === 3) && hs.some((h) => h.pf === 'main' && h.qty === 10), hs.map((h) => `${h.pf}:${h.qty}`).join(' '))
  step('portfolio view shows only its holdings', d.querySelectorAll('[data-h^="hold:"]').length === 1 && /Family/.test($('.pfbar').textContent))
  click('[data-h="pfsel:all"]'); await sleep(200)
  step('All adds them up', d.querySelectorAll('[data-h^="hold:"]').length === JSON.parse(files['portfolio.json']).holdings.length)
  click('[data-h="alert"]'); await sleep(100); click(`[data-h="apf:${fam.id}"]`); await sleep(100); click('[data-h="asave"]'); await sleep(200)
  step('alert on one portfolio', JSON.parse(files['portfolio.json']).alerts.some((x) => x.pf === fam.id && x.kind === 'below'))

  await go('#/settings', 800)
  step('settings: privacy + widget', /App lock/.test($('#view').textContent) && /Widgets/.test($('#view').textContent) && !!d.querySelector('[data-act="lock"][data-v="1"]'))

  // the sector map as each chart; a tap on a bar / bubble opens that sector
  await go('#/sectors', 4000)
  for (const [k, sel] of [['heat', '.tvcell'], ['grid', '.hcell'], ['bars', '.sbar'], ['breadth', '.sbar .stack'], ['bubbles', '#sbub'], ['tiles', '.tile']]) {
    click(`[data-act="schart"][data-v="${k}"]`); await sleep(300)
    step(`sector chart: ${k}`, d.querySelectorAll(sel).length > 0 && $(`[data-act="schart"][data-v="${k}"]`).classList.contains('on'), `${d.querySelectorAll(sel).length} parts`)
  }
  click('[data-act="schart"][data-v="bars"]'); await sleep(300)
  const firstBar = $('.sbar'); click(firstBar); await sleep(400)
  const cells0 = d.querySelectorAll('#zmap .tvcell').length, w0 = parseFloat($('#zmap').style.width)
  step('a bar opens the sector full screen', $('#zoom').classList.contains('on') && cells0 > 0, `${cells0} stocks`)
  click('[data-z="in"]'); await sleep(200)
  step('zoom in enlarges the map', w.eval('zm.z') > 1 && parseFloat($('#zmap').style.width) > w0, `z=${w.eval('zm.z')}`)
  click($('#zmap .tvcell')); await sleep(300)
  step('a stock in the zoomed sector opens its card', $('#sheet').classList.contains('on'))
  w.eval('closeSheet()'); click('[data-z="close"]'); await sleep(200)
  w.eval('sx.open.clear(); bubbleHits = [{ s: sx.data.rows[0], x: 50, y: 50, r: 20 }]')
  click('[data-act="schart"][data-v="bubbles"]'); await sleep(300)
  w.eval('bubbleHits = [{ s: sx.data.rows[0], x: 50, y: 50, r: 20 }]; bubbleTap({ clientX: 50, clientY: 50 })'); await sleep(300)
  step('a bubble tap opens its sector full screen', $('#zoom').classList.contains('on') && w.eval('zm.sid') === String(w.eval('sx.data.rows[0].id')))
  w.eval('closeZoom()')
  click('[data-act="schart"][data-v="tiles"]')

  for (const [h, re] of [['#/markets', /Market breadth/], ['#/sectors', /Heatmap/], ['#/settings', /Data & backup|Export backup/], ['#/search', /Type a company|Recent/], ['#/stock/TCS', /Key stats/], ['#/index/in%3BNSX', /Returns/]]) {
    await go(h, 5000)
    step(`screen ${h}`, re.test($('#view').textContent), $('#top h1')?.textContent.trim().slice(0, 40))
  }
  console.log(errors.length ? `\n${errors.length} ERRORS:\n` + errors.join('\n') : '\nno script errors')
  w.close(); process.exit(0)
})().catch((e) => { console.log('HARNESS FAIL', e); console.log(errors.join('\n')); process.exit(1) })
