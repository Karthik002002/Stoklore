// The shapes this app's data actually has, in one place.
//
// These describe rows as the API returns them (snake_case, straight off Postgres via
// app/core/db.py) rather than something prettier - renaming at the boundary would mean every
// component learning two vocabularies for one thing. Nullability follows the schema exactly: a
// column that is nullable in the database is nullable here, which is what makes the null checks
// scattered through the journal's maths type-checked rather than hopeful.
//
// Hand-written for now. When the API layer moves to TypeScript (phase 2), the response types get
// generated from the backend's own OpenAPI schema and these narrow to the derived shapes only.

export type Direction = 'long' | 'short'
export type TradeResult = 'profit' | 'loss' | 'neutral'
/** How the size taken compares to `ideal_risk_amount`. */
export type RiskStatus = 'good' | 'over' | 'under'
export type Session = 'Pre-open' | 'Morning' | 'Afternoon' | 'Close'
export type AccountKind = 'journal' | 'paper'

/** Market conditions at entry, frozen onto the trade when it is created (app/core/trade_context.py).
 *  Every field is optional: older trades predate the feature, and a filing whose bars were too thin
 *  to read carries `context_insufficient` instead of numbers. */
export interface TradeContext {
  trend?: 'up' | 'down' | 'chop' | null
  with_trend?: boolean | null
  vol_regime?: 'low' | 'normal' | 'high' | null
  atr?: number | null
  atr_pct?: number | null
  atr_percentile?: number | null
  /** How far the entry was from the 20-EMA, in ATRs. */
  extension_atr?: number | null
  extended?: boolean | null
  /** Where in the last 100 bars' range the entry sat, 0-1. */
  range_pos?: number | null
  vol_ratio?: number | null
  vol_spike?: {
    multiple?: number | null
    bars_ago?: number | null
    count?: number | null
    scanned?: number | null
    lookback?: number | null
    max_ratio?: number | null
  } | null
  /** Worst and best excursion after entry, in %, once a close date exists. */
  mae_pct?: number | null
  mfe_pct?: number | null
  /** The same excursions in R, once a planned risk exists to divide by. */
  mae_r?: number | null
  mfe_r?: number | null
  excursion_bars?: number | null
  /** How many prior bars the reading was computed from - named in the "too few bars" message. */
  bars_used?: number | null
  context_insufficient?: boolean | null
}

/** One row of `manual_trades` - the journal's only real table. P&L, R:R and return% are NOT here:
 *  they are derived on read (see manualTrades.ts) so an edit can never leave a stale number. */
export interface Trade {
  id: number
  symbol: string
  direction: Direction
  quantity: number
  entry_price: number
  exit_price: number | null
  stop_loss: number | null
  target: number | null
  is_open: boolean
  result: TradeResult | null
  emotion: string | null
  tags: string[]
  notes: string | null
  image_filename: string | null
  setup: string | null
  ideal_risk_amount: number | null
  account_id: number | null
  account_balance_at_trade: number | null
  /** When the position was taken. `traded_at` is the market date; `created_at` is when it was
   *  logged - a Bar Replay trade on 2013 bars journaled today differs in the two. */
  traded_at: string
  created_at: string
  entried_at: string | null
  exited_at: string | null
  trade_context: TradeContext | null
}

/** A trade account, with the cost rate card that makes gross and net comparable across accounts. */
export interface TradeAccount {
  id: number
  name: string
  kind: AccountKind
  strategy: string | null
  strategy_explanation: string | null
  opening_balance: number
  max_position_size: number | null
  max_position_size_type: 'currency' | 'percentage'
  max_position_count: number | null
  slippage_value: number
  slippage_type: 'per_share' | 'bps'
  brokerage_flat: number
  brokerage_pct: number
  other_charges_pct: number
  /** Volume-spike scan settings for the entry context (app/core/trade_context.py). */
  vol_spike_multiple: number
  vol_spike_lookback: number
  /** Warn after this many losses in a row; null = no alert. */
  loss_streak_alert: number | null
  created_at: string
}

/** One OHLCV candle, as the chart endpoints and the indicator library pass them around.
 *
 *  `time` is either a unix second (intraday) or a "YYYY-MM-DD" business day (daily) - both are
 *  valid lightweight-charts times, and the daily path stamps the date straight in. Anything that
 *  does arithmetic on it has to branch (see lib/replay.ts's barMs, which already does). */
export interface Bar {
  time: number | string
  /** Present on daily bars that came from `price_history` - VWAP resets on it. */
  date?: string
  open: number
  high: number
  low: number
  close: number
  volume?: number | null
}

/** A daily price row straight from `price_history` - dated rather than timestamped. */
export interface DailyBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume?: number | null
}

/** One row of `stocks_master`: what a ticker actually is. Shared by every symbol picker, so a
 *  symbol never reads as one thing in one search box and another elsewhere. */
export interface StockMasterRow {
  symbol: string
  name: string
  series: string | null
  listing_date: string | null
  isin: string | null
  /** 'MAIN' or 'SME' (NSE EMERGE) - derived from the series code at import time. */
  board: 'MAIN' | 'SME' | null
  /** SME scrips trade only in fixed lots; 1 on the main board. */
  market_lot: number | null
  face_value: number | null
}
