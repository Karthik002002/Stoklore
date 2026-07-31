import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fmt, inr } from '@/lib/format'
import {
  currentPeriodProgress,
  evaluateGoals,
  GOAL_METRICS,
  goalLabel,
  MODES,
  OPERATORS,
  PERIODS,
} from '@/lib/tradeGoals'
import { getTradingGoals, setTradingGoals } from '@/services/api'

const formatActual = (v, format) => {
  if (v == null) return '—'
  if (format === 'inr') return inr(v)
  if (format === 'pct') return `${fmt(v, 1)}%`
  if (format === 'x') return `${fmt(v, 2)}×`
  if (format === 'r') return `${fmt(v, 2)}R`
  return fmt(v, 0)
}

// Heat-mapped by achievement, not by goal type: on a table this dense, "am I on track" has to
// read at a glance, and green-good/red-bad is the only encoding that does that for both targets
// and limits at once. Whether a goal is a target or a limit is carried by its ≥/≤ badge instead.
const heatFor = (pct) => {
  if (pct == null) return 'bg-muted/30 text-muted-foreground'
  if (pct >= 100) return 'bg-up/25'
  if (pct >= 60) return 'bg-up/10'
  if (pct >= 30) return 'bg-amber-500/15'
  return 'bg-down/20'
}

const strokeFor = (pct) => {
  if (pct == null) return '#9ca3af'
  if (pct >= 100) return '#22c55e'
  if (pct >= 60) return '#4ade80'
  if (pct >= 30) return '#f59e0b'
  return '#ef4444'
}

function Gauge({ pct, size = 52 }) {
  const radius = 18
  const circumference = 2 * Math.PI * radius
  const filled = ((pct ?? 0) / 100) * circumference

  return (
    <svg viewBox="0 0 44 44" style={{ width: size, height: size }} className="shrink-0">
      <circle
        cx="22"
        cy="22"
        r={radius}
        fill="none"
        strokeWidth="4"
        stroke="currentColor"
        className="text-muted"
      />
      <circle
        cx="22"
        cy="22"
        r={radius}
        fill="none"
        strokeWidth="4"
        stroke={strokeFor(pct)}
        strokeDasharray={`${filled} ${circumference}`}
        strokeLinecap="round"
        transform="rotate(-90 22 22)"
      />
      <text
        x="22"
        y="22"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-foreground text-[10px] font-semibold"
      >
        {pct == null ? '—' : `${Math.round(pct)}%`}
      </text>
    </svg>
  )
}

const BLANK = { metric: 'netPnl', operator: 'gt', target: '', mode: 'continuous', label: '' }

function AddGoalForm({ period, onAdd, saving }) {
  const [draft, setDraft] = useState(BLANK)
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))

  const submit = (e) => {
    e.preventDefault()
    const target = Number(draft.target)
    if (draft.target === '' || Number.isNaN(target)) {
      toast.error('Enter a numeric target')
      return
    }
    onAdd({
      id: crypto.randomUUID(),
      metric: draft.metric,
      operator: draft.operator,
      target,
      period,
      mode: draft.mode,
      label: draft.label.trim() || null,
    })
    setDraft(BLANK)
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3">
      <span className="text-sm text-muted-foreground">Keep my {PERIODS[period].label.toLowerCase()}</span>
      <Select value={draft.metric} onValueChange={(metric) => set({ metric })}>
        <SelectTrigger size="sm" className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(GOAL_METRICS).map(([key, m]) => (
            <SelectItem key={key} value={key}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={draft.operator} onValueChange={(operator) => set({ operator })}>
        <SelectTrigger size="sm" className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(OPERATORS).map(([key, o]) => (
            <SelectItem key={key} value={key}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={draft.target}
        onChange={(e) => set({ target: e.target.value })}
        placeholder="Target"
        inputMode="decimal"
        className="w-28"
      />
      <Select value={draft.mode} onValueChange={(mode) => set({ mode })}>
        <SelectTrigger size="sm" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(MODES).map(([key, m]) => (
            <SelectItem key={key} value={key}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={draft.label}
        onChange={(e) => set({ label: e.target.value })}
        placeholder="Name (optional)"
        className="w-44"
      />
      <Button type="submit" size="sm" disabled={saving}>
        Add goal
      </Button>
    </form>
  )
}

function CurrentPeriod({ progress, period }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{progress.label}</p>
          <p className="text-xs text-muted-foreground">
            {progress.trades} closed trade{progress.trades === 1 ? '' : 's'} this{' '}
            {period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Gauge pct={progress.total} size={56} />
          <span className="text-xs text-muted-foreground">overall</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {progress.cells.map(({ goal, actual, pct }) => (
          <div key={goal.id} className="flex items-center gap-3 rounded-lg border p-2.5">
            <Gauge pct={pct} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{goalLabel(goal)}</p>
              <p className="text-xs text-muted-foreground">
                {formatActual(actual, GOAL_METRICS[goal.metric]?.format)} of{' '}
                {formatActual(goal.target, GOAL_METRICS[goal.metric]?.format)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function HistoryTable({ evaluated, onDelete, saving }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            {/* Left and right columns pinned, the goal columns scroll between them - a trader with
                a dozen goals still needs to see which period a row is and how it scored overall. */}
            <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium">Period</th>
            {evaluated.goals.map((goal) => (
              <th key={goal.id} className="min-w-40 px-3 py-2 text-left font-medium">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{goalLabel(goal)}</span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete goal ${goalLabel(goal)}`}
                    disabled={saving}
                    onClick={() => onDelete(goal.id)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
                <div className="mt-0.5 flex gap-1">
                  <Badge variant="outline" className="text-[10px]">
                    {goal.operator === 'gt' ? 'Target' : 'Limit'}
                  </Badge>
                  {goal.mode === 'binary' && (
                    <Badge variant="outline" className="text-[10px]">
                      All or nothing
                    </Badge>
                  )}
                </div>
              </th>
            ))}
            <th className="sticky right-0 z-10 bg-card px-3 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {evaluated.rows.map((row) => (
            <tr key={row.key} className="border-b last:border-0">
              <td className="sticky left-0 z-10 bg-card px-3 py-2 whitespace-nowrap">
                <span className="font-medium">{row.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">{row.trades}T</span>
              </td>
              {row.cells.map((cell) => {
                const goal = evaluated.goals.find((g) => g.id === cell.goalId)
                return (
                  <td key={cell.goalId} className="px-1 py-1">
                    <div className={`rounded-md px-2 py-1.5 ${heatFor(cell.pct)}`}>
                      <span className="text-sm font-medium tabular-nums">
                        {cell.pct == null ? '—' : `${Math.round(cell.pct)}%`}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                        {formatActual(cell.actual, GOAL_METRICS[goal?.metric]?.format)}
                      </span>
                    </div>
                  </td>
                )
              })}
              <td className="sticky right-0 z-10 bg-card px-3 py-2 text-right">
                <span className={`font-semibold tabular-nums ${row.total >= 60 ? 'text-up' : 'text-down'}`}>
                  {row.total == null ? '—' : `${Math.round(row.total)}%`}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function useGoals() {
  const queryClient = useQueryClient()
  const { data: goals = [], isLoading } = useQuery({
    queryKey: ['tradingGoals'],
    queryFn: getTradingGoals,
  })
  const save = useMutation({
    mutationFn: setTradingGoals,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tradingGoals'] }),
    onError: (e) => toast.error(e.message),
  })
  return { goals, isLoading, save }
}

export default function ManualGoals({ trades }) {
  const [period, setPeriod] = useState('daily')
  const { goals, isLoading, save } = useGoals()

  const forPeriod = goals.filter((g) => g.period === period)
  const evaluated = evaluateGoals(trades, goals, period)
  const progress = currentPeriodProgress(trades, goals, period)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Period</span>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger size="sm" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PERIODS).map(([key, p]) => (
                <SelectItem key={key} value={key}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          {forPeriod.length} {PERIODS[period].label.toLowerCase()} goal{forPeriod.length === 1 ? '' : 's'}
        </p>
      </div>

      <AddGoalForm period={period} saving={save.isPending} onAdd={(goal) => save.mutate([...goals, goal])} />

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading goals…</p>
      ) : forPeriod.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No {PERIODS[period].label.toLowerCase()} goals yet — add one above.
        </p>
      ) : (
        <>
          <CurrentPeriod progress={progress} period={period} />
          {evaluated.rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No closed trades to score these goals against yet.
            </p>
          ) : (
            <HistoryTable
              evaluated={evaluated}
              saving={save.isPending}
              onDelete={(id) => save.mutate(goals.filter((g) => g.id !== id))}
            />
          )}
        </>
      )}
    </div>
  )
}

// Compact strip for the Overview tab: where each period stands right now. Runs its own goals
// query rather than taking them as a prop, so Overview doesn't have to know goals exist.
export function GoalsSummary({ trades }) {
  const { goals } = useGoals()
  if (goals.length === 0) return null

  const periods = Object.keys(PERIODS).filter((p) => goals.some((g) => g.period === p))

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {periods.map((period) => {
        const progress = currentPeriodProgress(trades, goals, period)
        const met = progress.cells.filter((c) => c.met).length
        return (
          <div key={period} className="flex items-center gap-3 rounded-xl border bg-card p-3">
            <Gauge pct={progress.total} />
            <div className="min-w-0">
              <p className="text-sm font-medium">{PERIODS[period].label} goals</p>
              <p className="text-xs text-muted-foreground">
                {met} of {progress.cells.length} met · {progress.trades} trade
                {progress.trades === 1 ? '' : 's'}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
