// Sample data for the page stories. Not shipped; nothing in the app imports this.

export type StockRow = {
  symbol: string
  name: string
  sector: string
  ltp: number
  pct: number
  rs: number
  deliv: number
  delivAvg: number
  volX: number
  flag?: [string, 'success' | 'warning' | 'destructive' | 'secondary' | 'outline']
  results?: number
  asm?: string
}

export const STOCKS: StockRow[] = [
  {
    symbol: 'RELIANCE',
    name: 'Reliance Industries',
    sector: 'Oil & Gas',
    ltp: 2914.6,
    pct: 1.82,
    rs: 92,
    deliv: 54,
    delivAvg: 47,
    volX: 1.4,
    flag: ['Results ✓', 'success'],
  },
  {
    symbol: 'TATAMOTORS',
    name: 'Tata Motors',
    sector: 'Auto',
    ltp: 986.25,
    pct: 3.4,
    rs: 88,
    deliv: 62,
    delivAvg: 44,
    volX: 2.3,
    flag: ['Breakout', 'outline'],
  },
  {
    symbol: 'KAYNES',
    name: 'Kaynes Technology',
    sector: 'Electronics',
    ltp: 5480.75,
    pct: 4.02,
    rs: 95,
    deliv: 48,
    delivAvg: 41,
    volX: 3.1,
    flag: ['Bulk deal', 'warning'],
  },
  {
    symbol: 'HDFCBANK',
    name: 'HDFC Bank',
    sector: 'Banks',
    ltp: 1702.9,
    pct: 0.05,
    rs: 61,
    deliv: 49,
    delivAvg: 52,
    volX: 0.9,
    results: 4,
  },
  {
    symbol: 'TRENT',
    name: 'Trent',
    sector: 'Retail',
    ltp: 6840,
    pct: 2.61,
    rs: 90,
    deliv: 51,
    delivAvg: 45,
    volX: 1.6,
  },
  {
    symbol: 'INFY',
    name: 'Infosys',
    sector: 'IT',
    ltp: 1876.3,
    pct: -0.74,
    rs: 57,
    deliv: 58,
    delivAvg: 60,
    volX: 0.8,
  },
  {
    symbol: 'ZOMATO',
    name: 'Zomato',
    sector: 'Consumer Tech',
    ltp: 262.15,
    pct: -2.14,
    rs: 55,
    deliv: 32,
    delivAvg: 36,
    volX: 1.1,
  },
  {
    symbol: 'DIXON',
    name: 'Dixon Technologies',
    sector: 'Electronics',
    ltp: 15210.5,
    pct: -1.38,
    rs: 71,
    deliv: 41,
    delivAvg: 40,
    volX: 0.8,
    flag: ['Insider sell', 'outline'],
  },
  {
    symbol: 'BEL',
    name: 'Bharat Electronics',
    sector: 'Defence',
    ltp: 296.4,
    pct: 1.12,
    rs: 83,
    deliv: 46,
    delivAvg: 42,
    volX: 1.3,
  },
  {
    symbol: 'POLYCAB',
    name: 'Polycab India',
    sector: 'Capital Goods',
    ltp: 6922,
    pct: 0.44,
    rs: 76,
    deliv: 44,
    delivAvg: 45,
    volX: 0.9,
  },
  {
    symbol: 'IRFC',
    name: 'Indian Railway Finance',
    sector: 'Finance',
    ltp: 148.35,
    pct: 0.92,
    rs: 47,
    deliv: 40,
    delivAvg: 39,
    volX: 1.0,
  },
  {
    symbol: 'SUZLON',
    name: 'Suzlon Energy',
    sector: 'Capital Goods',
    ltp: 64.8,
    pct: -4.95,
    rs: 23,
    deliv: 18,
    delivAvg: 39,
    volX: 2.7,
    asm: 'ASM Stage I',
  },
]

export const INDICES = [
  { label: 'NIFTY 50', value: 24318.45, pct: 0.84 },
  { label: 'BANKNIFTY', value: 52104.1, pct: 0.41 },
  { label: 'MIDCAP 100', value: 56880.75, pct: -0.62 },
  { label: 'SMALLCAP 100', value: 18240.3, pct: -1.12 },
  { label: 'INDIA VIX', value: 13.42, pct: -3.1 },
  { label: 'USDINR', value: 84.12, pct: 0.05 },
]

export type Position = {
  symbol: string
  product: 'CNC' | 'MIS'
  qty: number
  avg: number
  ltp: number
  pct: number
  sl: number
  sector: string
  beta: number
}

export const POSITIONS: Position[] = [
  {
    symbol: 'TATAMOTORS',
    product: 'CNC',
    qty: 52,
    avg: 942.1,
    ltp: 986.25,
    pct: 3.4,
    sl: 960,
    sector: 'Auto',
    beta: 1.1,
  },
  {
    symbol: 'KAYNES',
    product: 'CNC',
    qty: 8,
    avg: 5312,
    ltp: 5480.75,
    pct: 4.02,
    sl: 5150,
    sector: 'Electronics',
    beta: 1.6,
  },
  {
    symbol: 'DIXON',
    product: 'CNC',
    qty: 6,
    avg: 14880,
    ltp: 15210.5,
    pct: -1.38,
    sl: 14400,
    sector: 'Electronics',
    beta: 1.4,
  },
  {
    symbol: 'INFY',
    product: 'MIS',
    qty: -40,
    avg: 1889,
    ltp: 1876.3,
    pct: -0.74,
    sl: 1902,
    sector: 'IT',
    beta: 0.8,
  },
  {
    symbol: 'SUZLON',
    product: 'CNC',
    qty: 600,
    avg: 66.9,
    ltp: 64.8,
    pct: -4.95,
    sl: 62.5,
    sector: 'Capital Goods',
    beta: 1.9,
  },
]

export type Holding = {
  symbol: string
  account: string
  qty: number
  avg: number
  ltp: number
  pct: number
  sector: string
}

export const HOLDINGS: Holding[] = [
  { symbol: 'TATAMOTORS', account: 'Zerodha', qty: 120, avg: 712.4, ltp: 986.25, pct: 3.4, sector: 'Auto' },
  {
    symbol: 'KAYNES',
    account: 'Zerodha',
    qty: 30,
    avg: 3810,
    ltp: 5480.75,
    pct: 4.02,
    sector: 'Electronics',
  },
  { symbol: 'HDFCBANK', account: 'Dhan', qty: 80, avg: 1520, ltp: 1702.9, pct: 0.05, sector: 'Banks' },
  { symbol: 'RELIANCE', account: 'Dhan', qty: 40, avg: 2480, ltp: 2914.6, pct: 1.82, sector: 'Oil & Gas' },
  {
    symbol: 'ZOMATO',
    account: 'Dhan',
    qty: 900,
    avg: 188.5,
    ltp: 262.15,
    pct: -2.14,
    sector: 'Consumer Tech',
  },
  {
    symbol: 'DIXON',
    account: 'Zerodha',
    qty: 10,
    avg: 16480,
    ltp: 15210.5,
    pct: -1.38,
    sector: 'Electronics',
  },
  { symbol: 'BEL', account: 'Zerodha', qty: 300, avg: 212.3, ltp: 296.4, pct: 1.12, sector: 'Defence' },
]

export const EVENTS = [
  {
    time: '11:38',
    symbol: 'KAYNES',
    text: 'Bulk deal: Goldman Sachs buys 4.1L shares @ ₹5,402',
    tag: 'bulk deal',
    tone: 'warning' as const,
  },
  {
    time: '11:02',
    symbol: 'TATAMOTORS',
    text: 'JLR Q2 retail sales up 9% YoY; EV order book at record',
    tag: 'news',
    tone: 'secondary' as const,
  },
  {
    time: '10:47',
    symbol: 'SUZLON',
    text: 'Moved to ASM Stage 1 framework by NSE',
    tag: 'surveillance',
    tone: 'destructive' as const,
  },
  {
    time: '09:30',
    symbol: 'HDFCBANK',
    text: 'Board meeting on 28 Nov to consider Q2 results',
    tag: 'results',
    tone: 'success' as const,
  },
  {
    time: 'Yday',
    symbol: 'DIXON',
    text: 'Promoter sold 0.8% via block deal',
    tag: 'insider',
    tone: 'outline' as const,
  },
  {
    time: 'Yday',
    symbol: 'TRENT',
    text: 'Zudio crosses 700 stores; same-store growth 11%',
    tag: 'news',
    tone: 'secondary' as const,
  },
]

export const SECTORS = [
  { label: 'BANKS', size: 32, change: 2.4 },
  { label: 'IT', size: 14, change: -1.1 },
  { label: 'OIL & GAS', size: 12, change: 0.6 },
  { label: 'AUTO', size: 8, change: 1.9 },
  { label: 'FMCG', size: 8, change: -0.4 },
  { label: 'PHARMA', size: 5, change: 0.2 },
  { label: 'METAL', size: 4, change: -2.3 },
  { label: 'CAP GOODS', size: 4, change: 1.2 },
  { label: 'POWER', size: 3.5, change: 0.9 },
  { label: 'REALTY', size: 1.5, change: 3.1 },
]

/** Deterministic random walk - same chart every render. */
export function walk(seed: number, n: number, drift = 0, start = 100, vol = 0.03) {
  let s = seed
  let v = start
  return Array.from({ length: n }, () => {
    s = (s * 16807) % 2147483647
    v *= 1 + (s / 2147483647 - 0.5 + drift) * vol
    return v
  })
}

export type Bar = { o: number; h: number; l: number; c: number; v: number }

export function bars(seed: number, n: number, start: number): Bar[] {
  let s = seed
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647
  let o = start
  return Array.from({ length: n }, () => {
    const c = o * (1 + (r() - 0.45) * 0.03)
    const b = {
      o,
      c,
      h: Math.max(o, c) * (1 + r() * 0.01),
      l: Math.min(o, c) * (1 - r() * 0.01),
      v: 0.3 + r(),
    }
    o = c
    return b
  })
}

export function novemberPnl() {
  const out: Record<string, number> = {}
  let s = 5
  for (let d = 1; d <= 24; d++) {
    const date = new Date(2026, 10, d)
    if (date.getDay() === 0 || date.getDay() === 6) continue
    s = (s * 16807) % 2147483647
    const r = s / 2147483647
    if (r < 0.12) continue
    out[`2026-11-${String(d).padStart(2, '0')}`] = Math.round((r - 0.42) * 9000)
  }
  return out
}
