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
    accountId: z.number().nullable(),
    imageFile: z.any().nullish(),
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
