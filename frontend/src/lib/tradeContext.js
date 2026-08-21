// Reading the trade_context snapshot the backend stored at trade creation (see trade_context.py).
//
// Nothing here computes market data - it only interprets what was captured. The snapshot is a
// point-in-time fact; recomputing any of it in the browser would defeat the entire reason it's
// stored.
//
// Every accessor branches on KEY PRESENCE, never on falsiness. The backend deliberately omits
// keys it couldn't compute rather than writing zeros, because 0.0 is a real and very different
// reading from "unknown" - `mae_pct: 0` means the trade never went against you.
// Relative import with the extension, no '@/' alias - tradeStats.js imports this file, and its
// selfcheck runs under plain `node` with no bundler to resolve either.
import { expectedR } from './manualTrades.js'

export function hasContext(t) {
  const c = t?.trade_context
  return !!c && !c.context_insufficient
}

/** Why a trade has no usable context, or null when it has one. Distinguishes the two cases so the
 *  UI can explain rather than just showing blanks. */
export function contextGap(t) {
  const c = t?.trade_context
  if (!c) return 'No price history was available for this symbol when the trade was logged.'
  if (c.context_insufficient) {
    return `Only ${c.bars_used} prior bars were available — too few to read trend or volatility from.`
  }
  return null
}

export const hasExcursion = (t) => t?.trade_context?.mae_pct != null

// --- Buckets, for grouping trades in the Statistics tab --------------------------------------
// Coarse on purpose. Slicing 100 trades across many fine buckets is how you find patterns that
// are pure noise - fewer, wider buckets keep the per-bucket sample big enough to mean something.

export const TREND_LABEL = { up: 'Uptrend', down: 'Downtrend', chop: 'Sideways' }
export const REGIME_LABEL = { low: 'Low volatility', normal: 'Normal volatility', high: 'High volatility' }

export function volRegimeBucket(t) {
  const c = t?.trade_context
  return c?.vol_regime ? REGIME_LABEL[c.vol_regime] : null
}

export function trendAlignmentBucket(t) {
  const c = t?.trade_context
  if (c?.with_trend == null) return c?.trend === 'chop' ? 'Sideways market' : null
  return c.with_trend ? 'With trend' : 'Against trend'
}

/** How far from the 20-EMA the entry was, in ATRs. The "was I chasing" axis. */
export function extensionBucket(t) {
  const e = t?.trade_context?.extension_atr
  if (e == null) return null
  if (e < -0.5) return 'Early (below mean)'
  if (e <= 0.5) return 'At the mean'
  if (e <= 1.5) return 'Mildly extended'
  if (e <= 3) return 'Extended'
  return 'Very extended (3+ ATR)'
}

export function rangePosBucket(t) {
  const p = t?.trade_context?.range_pos
  if (p == null) return null
  if (p > 1) return 'Breakout (above range)'
  if (p >= 0.75) return 'Top of range'
  if (p >= 0.25) return 'Mid range'
  return 'Bottom of range'
}

// --- Plain-English readings, for the trade detail modal ---------------------------------------
// A number like "extension_atr: 3.81" means nothing on its own. These turn each captured value
// into the sentence a person would actually say about the trade.

export function contextReadings(t) {
  const c = t?.trade_context
  if (!hasContext(t)) return []
  const out = []

  if (c.extension_atr != null) {
    const e = c.extension_atr
    out.push({
      label: 'Entry timing',
      value: `${e > 0 ? '+' : ''}${e} ATR from the 20-EMA`,
      tone: e > 3 ? 'bad' : e > 1.5 ? 'warn' : 'good',
      note:
        e > 3
          ? 'Well past the mean — chasing a move that had already happened.'
          : e > 1.5
            ? 'Somewhat extended from the mean.'
            : e < -0.5
              ? 'Entered before the move, against the short-term mean.'
              : 'Entered close to the mean — not chasing.',
    })
  }

  if (c.with_trend != null) {
    out.push({
      label: 'Trend',
      value: c.with_trend ? 'With trend' : 'Against trend',
      tone: c.with_trend ? 'good' : 'warn',
      note: `20/50 EMA had the symbol in a ${TREND_LABEL[c.trend]?.toLowerCase() ?? c.trend}.`,
    })
  } else if (c.trend === 'chop') {
    out.push({
      label: 'Trend',
      value: 'Sideways',
      tone: 'warn',
      note: 'No clear trend to trade with or against.',
    })
  }

  if (c.vol_regime) {
    out.push({
      label: 'Volatility',
      value: REGIME_LABEL[c.vol_regime],
      tone: 'neutral',
      note: `ATR was at the ${c.atr_percentile}th percentile of the last 100 bars (${c.atr_pct}% of price).`,
    })
  }

  if (c.range_pos != null) {
    const p = c.range_pos
    out.push({
      label: 'Range position',
      value: rangePosBucket(t),
      tone: 'neutral',
      note:
        p > 1
          ? 'Entered above the entire prior 100-bar range — a breakout entry.'
          : p < 0
            ? 'Entered beyond the far end of the prior range.'
            : `${Math.round(p * 100)}% of the way up the last 100 bars' range.`,
    })
  }

  if (c.vol_ratio != null) {
    out.push({
      label: 'Volume',
      value: `${c.vol_ratio}× average`,
      tone: 'neutral',
      note:
        c.vol_ratio >= 1.5
          ? 'Well above the 20-day average — real participation.'
          : c.vol_ratio < 0.7
            ? 'Below the 20-day average — thin tape.'
            : 'Around the 20-day average.',
    })
  }

  const spike = c.vol_spike
  if (spike?.max_ratio != null) {
    const hit = spike.count > 0
    out.push({
      label: 'Volume spike',
      value: hit
        ? `${spike.max_ratio}× — ${spike.bars_ago} bar${spike.bars_ago === 1 ? '' : 's'} before entry`
        : `None (peak ${spike.max_ratio}×)`,
      tone: hit ? 'good' : 'neutral',
      // `scanned`, not `lookback`: a short history shrinks the window, and claiming to have
      // checked 10 bars when 5 existed is the kind of small lie that makes the rest suspect.
      note: hit
        ? `${spike.count} of the ${spike.scanned ?? spike.lookback} bars before entry traded at or above ${spike.multiple}× the 20-bar average preceding them.`
        : `No bar in the ${spike.scanned ?? spike.lookback} before entry reached ${spike.multiple}× the 20-bar average preceding them — the move came in quietly.`,
    })
  }

  return out
}

/** How the entry sat against the account's volume-spike threshold, for grouping in Statistics.
 *  Null for trades logged before the scan existed, which keeps them out of the buckets rather
 *  than lumping them in with genuine no-spike entries. */
export function volSpikeBucket(t) {
  const spike = t?.trade_context?.vol_spike
  if (spike?.count == null) return null
  return spike.count > 0 ? 'Volume spike before entry' : 'No volume spike'
}

/** The excursion read: heat taken vs profit that was actually on the table.
 *  This is the one that catches exiting winners early - MFE says how far it ran, `capturedR` how
 *  much of that was kept. Returns null when the exit date was never recorded. */
export function excursionReading(t) {
  if (!hasExcursion(t)) return null
  const c = t.trade_context
  const captured = expectedR(t)
  const left = c.mfe_r != null && captured != null ? Math.round((c.mfe_r - captured) * 100) / 100 : null
  return {
    maePct: c.mae_pct,
    mfePct: c.mfe_pct,
    maeR: c.mae_r ?? null,
    mfeR: c.mfe_r ?? null,
    capturedR: captured,
    leftOnTableR: left != null && left > 0 ? left : null,
    bars: c.excursion_bars,
    // Sweeney's actual point: stops belong just past where winners stop going against you. A
    // winner that never took much heat says the stop was wider than it needed to be.
    stopTooWide: c.mae_r != null && c.mae_r < 0.5 && captured != null && captured > 0,
  }
}
