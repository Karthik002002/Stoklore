// What every field on the Engine page's run and auto-tune forms does - the content behind each
// field's info icon. Pure data plus two small helpers (order, "· off" label), no React.
//
// Strategy params are keyed per strategy, not by name alone: `entry_z` means a Kalman-filter
// prediction error in kalman_pair and a Bollinger z-score in zscore_mr. The engine's `--list` only
// reports name=default, so this is written against the strategy sources (hft src/strategies/*.hpp)
// and has to be updated alongside them. A param missing here still renders - last, with no icon.

/** One info card. `what` is the mechanism, `effect` which way to turn it, `example` a concrete value. */
export type Help = {
  title: string
  what: string
  effect?: string
  example?: string
  /** 0 switches the feature off - the field reads "· off" while it's 0. */
  off?: boolean
}

const QTY_NOTE =
  'With Compound off this is the size of every trade. With Compound › Scale qty it is the starting size, scaled by how the account has grown; with All-in it is ignored.'

/** Per strategy, in the order the form lists them: entry, then exits/stops, then size. */
export const PARAM_HELP: Record<string, Record<string, Help>> = {
  ema_cross: {
    fast: {
      title: 'Fast EMA (bars)',
      what: 'Length of the quick exponential moving average. The strategy is long while the fast EMA is above the slow one and short while it is below; the crossing is the signal. A crossover always closes the old side.',
      effect: 'Smaller reacts sooner and crosses more often: more trades, more whipsaw in chop. Larger waits for a cleaner turn and enters later. Keep it below slow.',
      example: '9 on 5m bars ≈ the last 45 minutes.',
    },
    slow: {
      title: 'Slow EMA (bars)',
      what: 'Length of the trend baseline the fast EMA is compared against. No trade is taken until max(slow, rsi_len + 1) bars have been seen (warm-up).',
      effect: 'Larger follows a longer trend and flips side less often; smaller makes the system a short-term momentum trader.',
      example: '21 with fast 9 is the classic pair; 50 for a slower trend.',
    },
    rsi_len: {
      title: 'RSI length (bars)',
      what: "Lookback of the Wilder RSI used by the entry filter (rsi_lo..rsi_hi). The RSI only decides whether a NEW position may open - it never closes one that's still with the trend.",
      effect: 'Shorter makes RSI jumpier, so the filter opens and shuts more often; longer is smoother and filters less.',
      example: '14 is standard.',
    },
    rsi_lo: {
      title: 'RSI floor for entries',
      what: 'An entry (long or short) is only taken while RSI ≥ rsi_lo. If the EMAs cross while RSI is below it, the old side closes and the new side waits until RSI comes back into the band.',
      effect: 'Raise it to skip entries when momentum is washed out (a long into an oversold slide). 0 removes the floor.',
      example: '25 skips the most oversold bars; 40 is strict.',
    },
    rsi_hi: {
      title: 'RSI ceiling for entries',
      what: 'An entry is only taken while RSI ≤ rsi_hi - the same band check as rsi_lo, from above.',
      effect: 'Lower it to avoid chasing an overbought spike. 100 removes the ceiling; rsi_lo=0 and rsi_hi=100 turns the filter off.',
      example: '70 avoids buying the top of a stretched move.',
    },
    atr_stop: {
      title: 'ATR stop (× ATR)',
      what: 'Exit when the close is this many ATR(14) against the entry price, using the ATR at entry. Checked on each bar close and filled at the next open, so a gap can lose more than the stop.',
      effect: 'Smaller is tighter: smaller losses but more stop-outs on noise. Larger gives the trade room. 0 = off (only a crossover exits).',
      example: '2 on a stock with ATR ₹5 exits a long ₹10 below entry.',
      off: true,
    },
    stop_pct: {
      title: 'Percent stop (%)',
      what: 'Exit when the close is this % of the entry price against the position. Independent of volatility, unlike atr_stop; if both are set, whichever is hit first exits.',
      effect: 'Smaller = tighter. 0 = off.',
      example: '1 exits a long bought at ₹500 when a close prints at or below ₹495.',
      off: true,
    },
    trail_atr: {
      title: 'Trailing stop (× ATR)',
      what: 'Exit when the close falls this many ATR(14) back from the best close since entry (rises, for a short). Uses the current ATR, so it widens when the stock gets more volatile. Locks in part of a run instead of waiting for the crossover.',
      effect: 'Smaller locks profit sooner but cuts winners short; larger lets trends run. 0 = off.',
      example: '3 on a ₹5 ATR: a long that peaked at ₹560 exits on a close at or below ₹545.',
      off: true,
    },
    reentry: {
      title: 'Re-entry after a stop',
      what: 'What happens after any of the three stops fires. 0 = sit out until the next crossover. 1 = re-enter on the next bar if the EMAs still point the same way and RSI is inside the band.',
      effect: '1 keeps you in long trends after a shake-out, but can be stopped again and again in chop. Sweep 0,1 to see which this stock prefers.',
      example: '0 is the conservative default.',
    },
    qty: { title: 'Quantity (shares)', what: `Shares per position. ${QTY_NOTE}` },
  },
  kalman_pair: {
    entry_z: {
      title: 'Entry z',
      what: 'The Kalman filter predicts the second stock (y) from the first (x); z is the prediction error over its expected size. z < −entry_z buys y and sells x; z > +entry_z does the reverse. Run it with exactly two symbols. No entries in the first 100 bars or after 14:30.',
      effect: 'Higher waits for a bigger dislocation: fewer, better-paid trades. Lower trades smaller gaps more often.',
      example: '1 = one standard error away from the fitted relationship.',
    },
    exit_z: {
      title: 'Exit z',
      what: 'A long-y position exits once z rises above −exit_z; a short-y once z falls below +exit_z. Everything is flat from 15:00.',
      effect: '0 holds until the spread is back at fair value. A positive value takes profit earlier, before full reversion. Keep it below entry_z.',
      example: '0.5 exits a long entered at z = −1.2 once z is back to −0.5.',
    },
    delta: {
      title: 'Delta (hedge drift)',
      what: 'How fast the filter lets the hedge ratio (slope and intercept between the two stocks) change from bar to bar.',
      effect: 'Larger adapts quickly to a shifting relationship, but then the fit chases price and z stays near 0 (fewer entries). Smaller is close to a fixed regression. Sweep it by factors of 10.',
      example: '0.00001,0.0001,0.001',
    },
    ve: {
      title: 've (measurement noise)',
      what: 'How much bar-to-bar noise the filter expects in the spread. Prices are normalised to their first bar, so it does not depend on price level.',
      effect: 'Larger makes z smaller for the same gap (fewer entries at a given entry_z) and the hedge ratio update more slowly.',
      example: '0.00001 by default; sweep by factors of 10.',
    },
    flip: {
      title: 'Flip legs',
      what: 'x is the alphabetically first symbol and y the second; flip=1 swaps them. y is the leg traded in qty shares, x is the hedge.',
      effect: 'Changes which stock is predicted from which, so the fitted ratio and the trades differ. Try both.',
      example: '0 or 1',
    },
    qty: {
      title: 'Quantity (y shares)',
      what: `Shares of y per entry. x is sized by the hedge ratio at entry (slope × qty × y₀/x₀) and that size is frozen until exit. ${QTY_NOTE}`,
    },
  },
  zscore_mr: {
    lookback: {
      title: 'Lookback (bars)',
      what: 'Bars in the rolling mean and standard deviation: z = (close − mean) / std. The same window feeds the mean-reversion test (max_hl, min_r2). Nothing trades until lookback + 1 bars are in.',
      effect: 'Shorter reacts to recent swings; longer measures stretch against a slower average and trades less.',
      example: '20 = Bollinger bands on 20 bars.',
    },
    entry_z: {
      title: 'Entry z',
      what: 'Long when z < −entry_z, short when z > +entry_z, as long as |z| is still inside stop_z. No new entries after 14:30.',
      effect: 'Higher waits for a bigger stretch: fewer trades, each with more room to revert.',
      example: '2 = outside 2-sigma Bollinger bands.',
    },
    exit_z: {
      title: 'Exit z',
      what: 'A long exits once z ≥ −exit_z, a short once z ≤ +exit_z. Flat from 15:00.',
      effect: '0 exits at the mean. A positive value takes profit earlier; a negative one waits for an overshoot. Keep it below entry_z.',
      example: '0.5 closes a long once z is back to −0.5.',
    },
    stop_z: {
      title: 'Stop z',
      what: 'Exit if z keeps going to ±stop_z instead of reverting. After a stop there is no re-entry on that stock until z is back inside ±entry_z. A bar already past stop_z is never entered.',
      effect: 'Closer to entry_z cuts losers faster but stops out more. Must be above entry_z.',
      example: '3 with entry 2 gives one sigma of room.',
    },
    max_hl: {
      title: 'Max half-life (bars)',
      what: 'Entries only while the window looks mean reverting: a regression of each bar\'s change on the previous close gives λ, and the half-life −ln2/λ must be at most this many bars (λ must be negative).',
      effect: 'Lower demands faster reversion: fewer, quicker trades. 0 = off (λ < 0 and min_r2 still apply).',
      example: '20 = the gap should halve within 20 bars.',
      off: true,
    },
    min_r2: {
      title: 'Min R²',
      what: 'The same regression must explain at least this share of the variance before an entry is allowed - a fit-quality check on the mean-reversion test.',
      effect: 'Higher is stricter: fewer entries, only in clearly reverting stretches. 0 = no minimum.',
      example: '0.1',
    },
    risk: {
      title: 'Risk per trade (₹)',
      what: 'Sizes each entry so hitting stop_z loses about this much: shares = risk / ((stop_z − entry_z) × std), capped at qty.',
      effect: 'Volatile stretches get fewer shares, calm ones more. 0 = off, always qty.',
      example: '500 with a ₹4 std and 1 sigma to the stop → 125 shares (if qty allows).',
      off: true,
    },
    qty: { title: 'Quantity (shares)', what: `Shares per position, or the cap when risk is set. ${QTY_NOTE}` },
  },
}

/** The run and auto-tune forms' own fields. */
export const FIELD_HELP: Record<string, Help> = {
  strategy: {
    title: 'Strategy',
    what: "One of the strategies compiled into the engine (backtest --list). Its params appear below with their defaults; switching strategy clears what you typed for the old one's params.",
  },
  mode: {
    title: 'Mode',
    what: 'Backtest: one full backtest per param combination (max 200) with trades and equity. One at a time: each swept param walks its range while the others stay at their base, to see each param alone. Grid: every combination (max 20,000), summaries only, to see how params interact.',
    effect: 'Start with One at a time to find the sensitive params, then Grid the two that matter.',
  },
  symbols: {
    title: 'Symbols',
    what: 'The stocks to run on. A backtest or sweep runs them all together in one account, each traded on its own bars with the same params; auto-tune walks each stock separately and tunes its own params. kalman_pair needs exactly two, traded as a pair. Your watchlist is listed first; search reaches the whole stocks master.',
  },
  bars: {
    title: 'Bars',
    what: 'Bar size the strategy sees. 1m-4H come from the intraday minute dataset and every position is squared off by 15:15. 1D bars are positional: positions are held overnight and costs default to delivery.',
    effect: 'Smaller bars mean more signals and more cost per rupee of edge; the same param values mean different time spans on different bars.',
  },
  history: {
    title: 'History',
    what: 'Which stretch of bars to use: all available, the last N years (counted back from today), or a date range. A stock with no bars in the range is skipped and the run says so.',
    effect: 'More history tests more market regimes; a recent window tests what the stock does now.',
  },
  cost_bps: {
    title: 'Cost (bps per side)',
    what: 'A flat cost on every fill, entry and exit, in basis points of the traded value (1 bps = 0.01%). Stands in for brokerage, STT, charges and slippage.',
    effect: 'A strategy that only works at 0 has no edge. Default 3 for intraday, 12 for delivery (1D).',
    example: '3 bps on a ₹1,00,000 round trip ≈ ₹60.',
  },
  compound: {
    title: 'Compound',
    what: "Off: every trade uses the strategy's qty. On: the account's P&L so far feeds the next trade's size, starting from Capital.",
  },
  sizing: {
    title: 'Sizing',
    what: "Scale qty: the strategy's qty grows and shrinks with the account (+10% equity → 1.1× qty). All-in: every entry buys as many shares as the whole account pays for, ignoring qty.",
    effect: 'All-in shows the compounding ceiling; Scale qty keeps the strategy\'s own risk per trade.',
  },
  capital: {
    title: 'Capital (₹)',
    what: 'Starting account for compounding. In auto-tune the account carries from one test window to the next.',
  },
  label: { title: 'Label', what: 'Optional name shown on the run in lists and on its page, to find it again later.' },
  train: {
    title: 'Train sessions',
    what: 'Each walk-forward window tunes the param grid on this many sessions, then trades the pick on the next Test sessions it has not seen.',
    effect: 'Longer train = more trades to judge each cell by, but slower to adapt to a change in the stock.',
    example: '60 on intraday ≈ 3 months; 250 on 1D = a year.',
  },
  test: {
    title: 'Test sessions',
    what: 'Sessions traded with each window\'s pick before the walk moves on by the same amount. Test periods never overlap; stitched together they are the out-of-sample result.',
    effect: 'Shorter re-tunes more often (more windows, more compute).',
    example: '5 = re-tune weekly on intraday; 20 = monthly on 1D.',
  },
  min_trades: {
    title: 'Min trades',
    what: 'A grid cell with fewer trades than this on the train sessions is never picked - too few to trust its result.',
    effect: 'Higher avoids lucky cells but can leave a window with nothing to pick (it then sits flat).',
  },
  margin: {
    title: 'Switch margin',
    what: 'The current params are kept unless another cell scores this much better (0.15 = 15%), so the pick does not flip between near-equal cells every window.',
    effect: '0 always takes the best cell; higher is stickier.',
  },
}

export const paramHelp = (strategy: string | undefined, k: string): Help | undefined =>
  strategy ? PARAM_HELP[strategy]?.[k] : undefined

/** A strategy's param names in PARAM_HELP's order, unknown ones after them alphabetically. */
export const orderParams = (strategy: string | undefined, keys: string[]) => {
  const known = Object.keys((strategy && PARAM_HELP[strategy]) || {})
  const rank = (k: string) => (known.includes(k) ? known.indexOf(k) : known.length)
  return [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** "atr_stop · off" while a param that 0 disables is set to exactly 0, else the bare name. */
export const paramLabel = (strategy: string | undefined, k: string, text: string) =>
  paramHelp(strategy, k)?.off && text.trim() === '0' ? `${k} · off` : k
