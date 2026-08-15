import { Badge } from '@/components/ui/badge'

// "What is this ticker, exactly" - shared by every symbol search in the app (SymbolCombobox,
// StockMasterCombobox, the replay quick-switcher, Settings > Manage stocks) so a symbol never
// reads as one thing in one picker and another somewhere else.
//
// The SME badge leads because it is the fact that changes how the scrip trades: EMERGE names move
// only in fixed market lots, on a much thinner book, and are frequently missing from the intraday
// dataset (bar replay falls back to Yahoo's shallower history for them). Series is shown only when
// it isn't plain EQ - stamping "EQ" on 2,000 rows is noise, but BE/BZ/SM/ST are worth knowing.
export function StockBadges({ stock, showExchange = false, showLot = false, className = '' }) {
  const sme = stock?.board === 'SME'
  const series = stock?.series && stock.series !== 'EQ' ? stock.series : null
  const lot = showLot && stock?.market_lot > 1 ? stock.market_lot : null
  if (!sme && !series && !lot && !showExchange) return null
  return (
    <span className={`flex shrink-0 items-center gap-1 ${className}`}>
      {showExchange && (
        <Badge variant="outline" className="px-1 py-0 text-[10px] font-normal text-muted-foreground">
          NSE
        </Badge>
      )}
      {sme && (
        <Badge
          variant="outline"
          className="border-amber-500/60 px-1 py-0 text-[10px] text-amber-600 dark:text-amber-400"
        >
          SME
        </Badge>
      )}
      {series && (
        <Badge variant="outline" className="px-1 py-0 text-[10px] font-normal">
          {series}
        </Badge>
      )}
      {lot && <span className="text-[10px] text-muted-foreground">lot {lot}</span>}
    </span>
  )
}

/** Second line for the roomier pickers: ISIN, listing date, and the lot an SME scrip trades in. */
export function StockSubline({ stock }) {
  const bits = [
    stock?.isin,
    stock?.listing_date ? `listed ${stock.listing_date}` : null,
    stock?.board === 'SME' && stock?.market_lot ? `lot ${stock.market_lot}` : null,
  ].filter(Boolean)
  if (!bits.length) return null
  return <span className="truncate text-[10px] text-muted-foreground">{bits.join(' · ')}</span>
}
