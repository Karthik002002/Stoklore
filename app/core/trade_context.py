"""What the chart looked like when a trade was taken, plus how far it ran either way.

Computed ONCE, at trade creation, and stored on the row (manual_trades.trade_context). Never
recomputed on read - same reasoning as account_balance_at_trade (see db.py's column comment): it's
a point-in-time fact, and bars get split-adjusted and revised behind you. Recomputing it later
would silently rewrite the history you're trying to learn from.

Two halves:

  Entry context  - trend, volatility regime, how extended the entry was, where in the recent range
                   it sat. Computed from the ~100 daily bars BEFORE the entry. Lets trades be
                   bucketed later by market condition ("do I only lose when I chase?").

  MAE / MFE      - Maximum Adverse / Favourable Excursion (John Sweeney). How far the trade went
                   against you before it worked, and how far in your favour before you closed it.
                   Diagnoses execution rather than the market: stops too wide, stops too tight,
                   entries too early, winners cut short. Needs an exit date; absent one, these
                   keys are simply not present.

Everything here reads the local DB only - no network. That matters: the bulk-import dialog fires
N parallel POSTs, and a per-trade network fetch would make it unusable.
"""

# Enough bars to make ATR(14), EMA(50) and a 100-bar percentile mean something. Below this the
# numbers are arithmetically computable but not worth trusting, so they aren't stored at all.
MIN_BARS = 30
LOOKBACK = 100

ATR_PERIOD = 14
FAST_EMA = 20
SLOW_EMA = 50
VOLUME_AVG = 20

# ATR percentile boundaries for the volatility regime - the conventional 20/80 split.
LOW_VOL_PCT = 20
HIGH_VOL_PCT = 80

# How far above/below the fast EMA (in ATRs) counts as "extended". Used only for the bucket label;
# the raw signed value is stored too so the threshold can be revisited without re-collecting data.
EXTENDED_ATR = 1.5


def _ema(values, span):
    """Same idiom prices.ema_crossover and backtest.run_ema_crossover already use."""
    import pandas as pd

    return pd.Series(values).ewm(span=span, adjust=False).mean()


def _atr(highs, lows, closes, period=ATR_PERIOD):
    """Wilder's ATR. Written here because the backend has no TA library at all - the only
    indicator math that existed was EMA, inline, in two places."""
    import pandas as pd

    high = pd.Series(highs)
    low = pd.Series(lows)
    prev_close = pd.Series(closes).shift(1)
    # True range: the widest of today's range, today's high vs yesterday's close, and today's low
    # vs yesterday's close - the last two are what capture overnight gaps.
    true_range = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)
    return true_range.ewm(alpha=1 / period, adjust=False).mean()


def _percentile_rank(series, value):
    """Where `value` sits within `series`, 0-100. Plain rank rather than a distribution fit - the
    sample is 100 bars of one symbol, which is nowhere near enough to justify anything fancier."""
    finite = [v for v in series if v == v]
    if not finite:
        return None
    below = sum(1 for v in finite if v < value)
    return round(below / len(finite) * 100, 1)


def _round(v, places=2):
    return None if v is None or v != v else round(float(v), places)


def entry_context(bars, direction, entry_price):
    """Market state at entry, from the bars strictly BEFORE it. `bars` is oldest-first
    [{date, open, high, low, close, volume}]. Returns None when there's nothing usable.

    Every value is direction-adjusted where direction matters, so "extended" means the same thing
    for a short as for a long: entered late, in the direction of the move already made.
    """
    if not bars:
        return None
    if len(bars) < MIN_BARS:
        # Deliberately not a partial payload: a dict carrying `trend` but no `vol_regime` reads
        # exactly like a real one at a glance. Store the reason instead.
        return {"bars_used": len(bars), "context_insufficient": True}

    highs = [b["high"] for b in bars]
    lows = [b["low"] for b in bars]
    closes = [b["close"] for b in bars]
    volumes = [b["volume"] for b in bars]

    fast = _ema(closes, FAST_EMA)
    slow = _ema(closes, SLOW_EMA)
    atr_series = _atr(highs, lows, closes)

    fast_last = float(fast.iloc[-1])
    slow_last = float(slow.iloc[-1])
    atr_last = float(atr_series.iloc[-1])

    if fast_last > slow_last:
        trend = "up"
    elif fast_last < slow_last:
        trend = "down"
    else:
        trend = "chop"

    atr_pct_rank = _percentile_rank(atr_series.tolist()[ATR_PERIOD:], atr_last)
    if atr_pct_rank is None:
        vol_regime = None
    elif atr_pct_rank < LOW_VOL_PCT:
        vol_regime = "low"
    elif atr_pct_rank > HIGH_VOL_PCT:
        vol_regime = "high"
    else:
        vol_regime = "normal"

    # Signed so that positive always means "entered in the direction the move had already gone" -
    # above the EMA for a long, below it for a short. That's the chasing axis.
    extension = (entry_price - fast_last) / atr_last if atr_last else None
    if extension is not None and direction == "short":
        extension = -extension

    hi = max(highs)
    lo = min(lows)
    span = hi - lo
    # 0 = at the low of the last 100 bars, 1 = at the high, flipped for shorts so 1 always means
    # "entered at the far end of the range in my direction".
    #
    # Deliberately NOT clamped to [0, 1]: an entry outside the prior range is a breakout, and
    # >1 (or <0) is the only way to tell that apart from merely entering at the extreme of it.
    # Clamping would erase the distinction precisely where it's most interesting.
    range_pos = (entry_price - lo) / span if span else None
    if range_pos is not None and direction == "short":
        range_pos = 1 - range_pos

    recent_volume = volumes[-VOLUME_AVG:]
    avg_volume = sum(recent_volume) / len(recent_volume) if recent_volume else 0

    return {
        "bars_used": len(bars),
        "trend": trend,
        "atr": _round(atr_last),
        "atr_pct": _round(atr_last / entry_price * 100) if entry_price else None,
        "atr_percentile": atr_pct_rank,
        "vol_regime": vol_regime,
        "extension_atr": _round(extension),
        "extended": None if extension is None else bool(extension > EXTENDED_ATR),
        "range_pos": _round(range_pos, 3),
        "vol_ratio": _round(volumes[-1] / avg_volume) if avg_volume else None,
        # Trading with or against the prevailing trend - the single most-asked question of a
        # journal, and free once trend and direction are both known.
        "with_trend": (trend == "up") == (direction == "long") if trend != "chop" else None,
    }


def excursion(bars, direction, entry_price, stop_loss=None):
    """MAE/MFE over the holding period. `bars` is the bars from entry through exit, inclusive.

    MAE is the worst the trade looked before it ended; MFE the best. Both as positive percentages
    of entry (adverse and favourable are already directional concepts - a negative MAE would be
    meaningless). Also expressed in R against the stop distance where a stop was set, since a
    percentage isn't comparable across symbols but an R multiple is.
    """
    if not bars:
        return {}

    worst = min(b["low"] for b in bars) if direction == "long" else max(b["high"] for b in bars)
    best = max(b["high"] for b in bars) if direction == "long" else min(b["low"] for b in bars)

    adverse = (entry_price - worst) if direction == "long" else (worst - entry_price)
    favourable = (best - entry_price) if direction == "long" else (entry_price - best)

    # Clamp at zero: a trade that gapped straight through in your favour never actually went
    # against you, and a negative "adverse excursion" would read as nonsense.
    adverse = max(adverse, 0.0)
    favourable = max(favourable, 0.0)

    out = {
        "mae_pct": _round(adverse / entry_price * 100),
        "mfe_pct": _round(favourable / entry_price * 100),
        "excursion_bars": len(bars),
    }

    risk = abs(entry_price - stop_loss) if stop_loss is not None else None
    if risk:
        out["mae_r"] = _round(adverse / risk)
        out["mfe_r"] = _round(favourable / risk)
    return out


def compute(before_bars, holding_bars, direction, entry_price, stop_loss=None, source=None):
    """The whole snapshot. `before_bars` are the bars strictly before entry (oldest-first),
    `holding_bars` those from entry through exit (empty/None when the exit date is unknown).

    Returns None when there is no usable pre-entry data at all - the caller stores NULL rather
    than an empty object, so "never captured" stays distinguishable from "captured, nothing found".
    """
    context = entry_context(before_bars, direction, entry_price)
    if context is None:
        return None
    if source:
        context["source"] = source
    # Excursion is attached even when the entry context came back `context_insufficient` - MAE/MFE
    # is computed purely from the holding bars and doesn't depend on the 100-bar lookback at all,
    # so a thin pre-entry history is no reason to discard it. That's why the flag is named for the
    # context specifically rather than the whole snapshot.
    #
    # MAE/MFE keys are absent, not zero, when the holding window is unknown. The UI branches on
    # key presence - a 0.0 here would read as "never went against me", which is a real finding and
    # would be a lie.
    if holding_bars:
        context.update(excursion(holding_bars, direction, entry_price, stop_loss))
    return context
