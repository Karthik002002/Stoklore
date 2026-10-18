import { ExternalLinkIcon, GlobeIcon } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/** Where to read about an NSE stock elsewhere. Sites with a symbol-keyed page link straight to it;
 *  the rest key pages by their own ids, so the backend looks the page up and redirects
 *  (GET /api/research-link/{site}/{symbol}). */
const SOURCES: { name: string; hint: string; url: (s: string) => string }[] = [
  {
    name: 'Screener',
    hint: 'Financials, ratios',
    url: (s) => `https://www.screener.in/company/${s}/consolidated/`,
  },
  {
    name: 'Moneycontrol',
    hint: 'News, results',
    url: (s) => `/api/research-link/moneycontrol/${s}`,
  },
  {
    name: 'ET Markets',
    hint: 'News, analysis',
    url: (s) => `/api/research-link/et/${s}`,
  },
  {
    name: 'TradingView',
    hint: 'Chart, ideas',
    url: (s) => `https://www.tradingview.com/chart/?symbol=NSE:${s}`,
  },
  {
    name: 'NSE',
    hint: 'Quote, filings',
    url: (s) => `https://www.nseindia.com/get-quotes/equity?symbol=${s}`,
  },
  { name: 'Tickertape', hint: 'Scorecard', url: (s) => `/api/research-link/tickertape/${s}` },
  { name: 'Trendlyne', hint: 'Forecasts, DVM', url: (s) => `/api/research-link/trendlyne/${s}` },
  {
    name: 'Google Finance',
    hint: 'Quick quote',
    url: (s) => `https://www.google.com/finance/quote/${s}:NSE`,
  },
]

export default function StockLinks({ symbol }: { symbol: string }) {
  const s = encodeURIComponent(symbol.toUpperCase())
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Research ${symbol} on other sites`}
        title="Research on other sites"
        className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
      >
        <GlobeIcon className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1">
        <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground uppercase">
          {symbol} elsewhere
        </p>
        {SOURCES.map((src) => (
          <a
            key={src.name}
            href={src.url(s)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-foreground/10"
          >
            <span className="flex-1">{src.name}</span>
            <span className="text-[10px] text-muted-foreground">{src.hint}</span>
            <ExternalLinkIcon className="size-3 text-muted-foreground" />
          </a>
        ))}
      </PopoverContent>
    </Popover>
  )
}
