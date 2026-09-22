import { CHECKS, scoreFromChecks } from '@/lib/tradeReview'
import type { ExecutionChecks, Trade } from '@/lib/types'

/** The review as a form holds it. `checks`/`mistakes` stay null until touched - an untouched
 *  review is "not reviewed", which is a different fact from "reviewed, nothing wrong". */
export type ReviewValue = {
  mistakes: string[] | null
  checks: ExecutionChecks | null
  score: number | null
  scoreManual: boolean
}

export const EMPTY_REVIEW: ReviewValue = { mistakes: null, checks: null, score: null, scoreManual: false }

export const reviewFromTrade = (t: Trade): ReviewValue => ({
  mistakes: t.mistakes,
  checks: t.execution_checks,
  score: t.execution_score,
  // A stored score that differs from what the checks give was set by hand - keep it latched.
  scoreManual: t.execution_score != null && t.execution_score !== scoreFromChecks(t.execution_checks),
})

/** The API fields for a review, or {} when nothing was touched - on a PUT an omitted field is
 *  left as stored, so an untouched review never overwrites one. */
export function reviewPayload(v: ReviewValue) {
  if (v.checks == null && v.mistakes == null && !v.scoreManual) return {}
  return {
    mistakes: v.mistakes ?? [],
    execution_checks: v.checks,
    execution_score: v.scoreManual ? v.score : scoreFromChecks(v.checks),
  }
}

// The six keys, all false - what an untouched checklist is displayed as, before the prefill.
const allFalse = () => Object.fromEntries(CHECKS.map((c) => [c.key, false])) as ExecutionChecks

/** Mistakes, the execution checklist and the 1-10 score. `prefill` is what the journal can already
 *  answer (see tradeReview.prefillChecks) - shown ticked, and saved only once the user touches the
 *  checklist, so an unreviewed trade isn't quietly stored as a reviewed one. */
export default function TradeReviewFields({
  options,
  value,
  onChange,
  prefill = {},
  compact = false,
}: {
  options: string[]
  value: ReviewValue
  onChange: (value: ReviewValue) => void
  prefill?: ExecutionChecks
  compact?: boolean
}) {
  const shown = value.checks ?? { ...allFalse(), ...prefill }
  const derived = scoreFromChecks(value.checks)
  const score = value.scoreManual ? value.score : derived
  // Mistakes the list no longer offers (renamed in Settings) still show on the trade that has them.
  const mistakeOptions = [...options, ...(value.mistakes ?? []).filter((m) => !options.includes(m))]

  const toggleMistake = (m: string) => {
    const current = value.mistakes ?? []
    onChange({ ...value, mistakes: current.includes(m) ? current.filter((x) => x !== m) : [...current, m] })
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="space-y-1.5">
        <p className="text-xs font-medium">Mistakes</p>
        <div className="flex flex-wrap gap-1.5">
          {mistakeOptions.map((m) => {
            const on = value.mistakes?.includes(m)
            return (
              <button
                key={m}
                type="button"
                aria-pressed={!!on}
                onClick={() => toggleMistake(m)}
                className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                  on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
                }`}
              >
                {m}
              </button>
            )
          })}
        </div>
        {!compact && (
          <p className="text-[11px] text-muted-foreground">
            Pick what actually went wrong. A loss that followed the plan is a Normal loss, not a mistake.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium">Execution</p>
        <div className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
          {CHECKS.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={!!shown[c.key]}
                onChange={(e) => onChange({ ...value, checks: { ...shown, [c.key]: e.target.checked } })}
              />
              {c.label}
            </label>
          ))}
        </div>
        {value.checks == null && Object.keys(prefill).length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Sizing and stop are pre-ticked from the trade's numbers. Saved once you tick anything.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium">Execution score</p>
          {value.scoreManual && (
            <button
              type="button"
              className="text-[11px] text-muted-foreground underline"
              onClick={() => onChange({ ...value, scoreManual: false, score: null })}
            >
              Use checklist ({derived ?? '—'})
            </button>
          )}
        </div>
        <div className="flex gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={score === n}
              onClick={() => onChange({ ...value, score: n, scoreManual: true })}
              className={`h-7 flex-1 rounded border text-xs tabular-nums ${
                score === n ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        {!compact && (
          <p className="text-[11px] text-muted-foreground">
            {value.scoreManual
              ? 'Set by hand — no longer follows the checklist.'
              : 'From the checklist. A winner can have poor execution, a loser excellent execution.'}
          </p>
        )}
      </div>
    </div>
  )
}

/** Read-only: each check, with the pre-trade answer beside the post-trade one when both exist. */
export function ChecksReadout({ trade }: { trade: Trade }) {
  const post = trade.execution_checks
  const pre = trade.pre_trade_checks
  const mark = (v: boolean | undefined) =>
    v == null ? (
      <span className="text-muted-foreground">—</span>
    ) : v ? (
      <span className="text-up">✓</span>
    ) : (
      <span className="text-down">✗</span>
    )
  return (
    <div className="overflow-hidden rounded-lg border text-xs">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b bg-muted/40 px-3 py-1.5 font-medium">
        <span>Check</span>
        <span className="w-14 text-center">{pre ? 'Planned' : ''}</span>
        <span className="w-14 text-center">Did</span>
      </div>
      {CHECKS.map((c) => {
        const drifted = pre?.[c.key] === true && post?.[c.key] === false
        return (
          <div
            key={c.key}
            className={`grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-1 ${drifted ? 'bg-amber-500/10' : ''}`}
          >
            <span>{c.label}</span>
            <span className="w-14 text-center">{pre ? mark(pre[c.key]) : ''}</span>
            <span className="w-14 text-center">{post ? mark(post[c.key]) : mark(undefined)}</span>
          </div>
        )
      })}
    </div>
  )
}
