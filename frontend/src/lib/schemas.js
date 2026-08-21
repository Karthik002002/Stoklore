// Zod schemas for every form that actually submits (create/edit + POST), used through
// react-hook-form's zodResolver. Filters, search boxes and table controls deliberately stay on
// plain useState - they have nothing to validate and never submit.
//
// Numeric fields come out of <Input type="number"> as strings, and an untouched optional field is
// '' rather than undefined, so the shared helpers below normalize '' -> null before validating
// instead of every schema repeating that dance.
import { z } from 'zod'

// '' | null | undefined -> null; anything else -> Number. Keeps "left blank" distinct from 0.
const emptyToNull = (v) => (v === '' || v == null ? null : Number(v))

/** Optional number field: blank is allowed, but a filled-in value must be a real number. */
export const optionalNumber = (label) =>
  z.preprocess(
    emptyToNull,
    z
      .number({ message: `${label} must be a number` })
      .finite(`${label} must be a number`)
      .nullable(),
  )

/** Required positive number (prices, quantities). */
export const positiveNumber = (label) =>
  z.preprocess(
    emptyToNull,
    z
      .number({ message: `${label} is required` })
      .finite(`${label} must be a number`)
      .positive(`${label} must be greater than 0`),
  )

/** Optional number that must be >= 0 when provided (balances, risk amounts). */
export const optionalNonNegative = (label) =>
  z.preprocess(
    emptyToNull,
    z
      .number({ message: `${label} must be a number` })
      .finite(`${label} must be a number`)
      .nonnegative(`${label} can't be negative`)
      .nullable(),
  )

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((v) => v || null)

// --- Manual trade (ManualBacktesting's add/edit dialog) ---------------------------------------
export const tradeSchema = z
  .object({
    symbol: z.string().trim().min(1, 'Symbol is required').toUpperCase(),
    direction: z.enum(['long', 'short']),
    setup: optionalText,
    quantity: positiveNumber('Quantity'),
    entryPrice: positiveNumber('Entry price'),
    exitPrice: optionalNumber('Exit price'),
    stopLoss: optionalNumber('Stop loss'),
    target: optionalNumber('Target'),
    idealRiskAmount: optionalNonNegative('Ideal risk ₹'),
    isOpen: z.boolean(),
    result: z.enum(['profit', 'loss', 'neutral']).nullish(),
    resultManual: z.boolean(),
    emotion: z.string().nullish(),
    tags: z.array(z.string()),
    notes: optionalText,
    tradedAt: z.string().nullish(),
    // Optional. Supplying it unlocks MAE/MFE on the trade (the backend needs a window to measure
    // the excursion over); leaving it blank just means those two metrics stay unavailable.
    exitedAt: z.string().nullish(),
    accountId: z.number().nullable(),
    imageFile: z.any().nullish(),
  })
  .refine((v) => !v.exitedAt || !v.tradedAt || v.exitedAt >= v.tradedAt, {
    path: ['exitedAt'],
    message: "Close date can't be before the trade was opened",
  })
  // A closed trade needs an exit price. Cross-field, so it lives here rather than on either field
  // alone - this is the one rule the old hand-rolled `valid` check already enforced.
  .refine((v) => v.isOpen || v.exitPrice != null, {
    path: ['exitPrice'],
    message: 'Exit price is required to close a trade',
  })
// Deliberately NOT validated: that a stop sits below entry on a long (and above on a short). It's
// a real rule for placing an order - the Bar Replay ticket enforces it - but this form also edits
// trades already in the journal, and rejecting one recorded before the rule existed would lock the
// user out of editing their own history. The journal records what happened, not what should have.

// --- Bar Replay close-trade dialog -------------------------------------------------------------
// Entry/exit/quantity are supplied by the replay engine, not typed - only the journalling fields
// are user input here. No `resultManual` twin of the trade form's: the exit price is fixed the
// moment the dialog opens, so the auto-computed result can't change underneath a hand-picked one
// and there is nothing to protect it from - the field is just seeded with the computed value.
export const closeTradeSchema = z.object({
  result: z.enum(['profit', 'loss', 'neutral']).nullish(),
  emotion: z.string().nullish(),
  tags: z.array(z.string()),
  notes: optionalText,
})

// --- Trade account (Settings > Trade accounts) -------------------------------------------------
// Field names here are the API payload's snake_case rather than the camelCase used elsewhere -
// this form maps 1:1 onto the trade_accounts row, so renaming would only add a mapping layer.
export const tradeAccountSchema = z.object({
  name: z.string().trim().min(1, 'Account name is required').max(120),
  strategy: optionalText,
  strategy_explanation: optionalText,
  opening_balance: optionalNonNegative('Opening balance').transform((v) => v ?? 0),
  max_position_size: optionalNonNegative('Max position size'),
  max_position_size_type: z.enum(['currency', 'percentage']),
  max_position_count: optionalNonNegative('Max open positions'),
  // Trading costs, charged per side (see lib/tradeCosts.js). Blank means zero rather than "unset":
  // an account with no rate typed in trades for free, which is exactly what it did before these
  // fields existed.
  slippage_value: optionalNonNegative('Slippage').transform((v) => v ?? 0),
  slippage_type: z.enum(['per_share', 'bps']),
  brokerage_flat: optionalNonNegative('Brokerage per order').transform((v) => v ?? 0),
  brokerage_pct: optionalNonNegative('Brokerage %').transform((v) => v ?? 0),
  other_charges_pct: optionalNonNegative('Other charges %').transform((v) => v ?? 0),
  // Volume-spike scan for trades filed under this account (see app/core/trade_context.py). Blank
  // falls back to the backend's own defaults rather than to zero - a 0x multiple would call every
  // bar a spike and a 0-bar window would scan nothing.
  vol_spike_multiple: optionalNonNegative('Spike multiple').transform((v) => v ?? 2),
  // Capped at 80: only 100 bars are fetched per trade and the scan needs 20 behind its window for
  // the baseline, so anything larger would scan fewer bars than it claims. The backend rejects it
  // too - this is just the faster no.
  vol_spike_lookback: optionalNonNegative('Spike lookback')
    .refine((v) => v == null || v <= 80, 'Spike lookback can be at most 80 bars')
    .transform((v) => v ?? 10),
})

// --- Balance adjustment (Overview > Adjust) ----------------------------------------------------
export const balanceAdjustmentSchema = z.object({
  amount: positiveNumber('Amount'),
  type: z.enum(['add', 'subtract']),
  reason: optionalText,
  date: z.string().min(1, 'Date is required'),
})

// --- Watch rule (Settings > Watch rules) -------------------------------------------------------
export const watchRuleSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  criteria: z.string().trim().min(1, 'Describe what to check'),
})

// --- Trading goal (Goals tab's add-goal row) ---------------------------------------------------
// metric/operator/mode are keyed against GOAL_METRICS/OPERATORS/MODES in lib/tradeGoals.js;
// they're plain strings here rather than a duplicated enum, so adding a metric there needs no
// change in this file.
export const goalSchema = z.object({
  metric: z.string().min(1),
  operator: z.string().min(1),
  // Deliberately signed: a loss-limit goal ("keep daily net P&L above -2000") needs a negative
  // target, so this is the one numeric field here that must not be constrained to >= 0.
  target: z.preprocess(
    (v) => (v === '' || v == null ? null : Number(v)),
    z.number({ message: 'Enter a numeric target' }).finite('Enter a numeric target'),
  ),
  mode: z.string().min(1),
  label: optionalText,
})

// --- Paper trading order ticket ------------------------------------------------------------------
// A leg is one rung of a laddered exit: a price and the slice of the position it closes. One leg
// covering the whole quantity is the ordinary single-stop/single-target case, so there's no
// separate shape for it.
const exitLeg = z.object({
  id: z.string(),
  price: positiveNumber('Exit price'),
  qty: positiveNumber('Exit quantity'),
})

export const paperOrderSchema = z
  .object({
    accountId: z.number({ message: 'Pick an account' }),
    symbol: z.string().trim().min(1, 'Symbol is required').toUpperCase(),
    direction: z.enum(['long', 'short']),
    orderType: z.enum(['market', 'limit']),
    quantity: positiveNumber('Quantity'),
    limitPrice: optionalNumber('Limit price'),
    stopLosses: z.array(exitLeg),
    targets: z.array(exitLeg),
    notes: optionalText,
  })
  .refine((v) => v.orderType !== 'limit' || v.limitPrice != null, {
    path: ['limitPrice'],
    message: 'A limit order needs a limit price',
  })
  // Ladder legs may cover LESS than the position (the uncovered slice simply has no protection,
  // exactly as if no stop had been set) but never more - that would close more shares than exist.
  .refine((v) => v.stopLosses.reduce((s, l) => s + (l.qty || 0), 0) <= v.quantity, {
    path: ['stopLosses'],
    message: "Stop-loss legs add up to more than the position's quantity",
  })
  .refine((v) => v.targets.reduce((s, l) => s + (l.qty || 0), 0) <= v.quantity, {
    path: ['targets'],
    message: "Target legs add up to more than the position's quantity",
  })
