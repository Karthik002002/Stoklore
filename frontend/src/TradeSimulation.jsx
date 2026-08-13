import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { DownloadIcon, FileTextIcon, PlayIcon, SaveIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { compact, fmt, inr } from '@/lib/format'
import { tradePnl } from '@/lib/manualTrades'
import { tradesForAccount } from '@/lib/tradeAccounts'
import {
  correlationMatrix,
  dailyTotals,
  MIN_OVERLAP,
  MODELS,
  poolStats,
  simulate,
  SIZING,
  toComparisonCsv,
  toCsv,
} from '@/lib/tradeSimulation'
import { usePageTitle } from '@/lib/usePageTitle'
import { getManualTrades, getTradeAccounts } from '@/services/api'

// Bold band colours. p50 is the app's neutral grey rather than a true dark grey: this page renders
// in both themes and a dark grey median vanishes into a dark background, which defeats the point of
// marking it.
const BAND = { p10: '#b91c1c', p50: '#9ca3af', p90: '#22c55e' }
const FAINT = 'rgba(148, 163, 184, 0.22)'
const HOVER = '#0ea5e9'
const AXIS = '#9ca3af'
const GRID = 'rgba(148, 163, 184, 0.18)'

// Per-account colours for the comparison view. Hand-picked rather than the theme's --chart-N tokens,
// which are a greyscale ramp - fine for a single series, useless for telling accounts apart.
const ACCOUNT_COLORS = [
  '#3b82f6',
  '#f59e0b',
  '#10b981',
  '#a855f7',
  '#ef4444',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
]
const colorFor = (i) => ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]

const PRESET_KEY = 'tradeSimulation.preset'

const DEFAULTS = {
  startBalance: 100000,
  runs: 1000,
  length: 100,
  model: 'bootstrap',
  slip: 0,
  removeTopWins: false,
  sizingMode: 'as-logged',
  riskAmount: 1000,
  riskPct: 1,
  liquidateAt: 0,
}

const TABLE_ROWS = [
  { key: 'endBalance', label: 'Ending account balance', format: inr },
  { key: 'maxDD', label: 'Max absolute drawdown', format: (v) => `${fmt(v, 1)}%` },
  { key: 'maxLossStreak', label: 'Max consecutive losses', format: (v) => fmt(v, 0) },
  { key: 'roi', label: 'Return on investment', format: (v) => `${fmt(v, 1)}%` },
  { key: 'profitFactor', label: 'Profit factor', format: (v) => (v >= 1e8 ? '∞' : fmt(v, 2)) },
  { key: 'sharpe', label: 'Sharpe (per trade)', format: (v) => fmt(v, 2) },
]

const PCT_HEADS = ['10th', '25th', '50th (median)', '75th', '90th']

// --- canvas -----------------------------------------------------------------------------------

/** One canvas, N paths. Canvas rather than SVG because this draws up to ~100 polylines of 100+
 *  points each on every scale toggle - the same picture as 10,000 SVG nodes React would have to
 *  diff, for a chart with no per-point interaction to justify them. */
function PathsCanvas({ faint = [], bold = [], log, invert = false, height = 260, formatY, tooltip }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const [width, setWidth] = useState(0)
  // { i: index into `series`, x, y } - the line under the cursor, or null.
  const [hover, setHover] = useState(null)
  // Scales from the last paint, so hit-testing doesn't recompute the layout.
  const geom = useRef(null)

  const series = useMemo(
    () => [
      ...faint.map((s) => ({ ...s, color: FAINT, lineWidth: 1 })),
      ...bold.map((b) => ({ ...b, lineWidth: 2 })),
    ],
    [faint, bold],
  )

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !width || !bold.length) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const padL = 56
    const padR = 10
    const padT = 10
    const padB = 22
    let lo = Infinity
    let hi = -Infinity
    for (const s of series) {
      for (let i = 0; i < s.data.length; i++) {
        if (s.data[i] < lo) lo = s.data[i]
        if (s.data[i] > hi) hi = s.data[i]
      }
    }
    if (!Number.isFinite(lo)) return
    if (invert) lo = 0
    if (hi === lo) hi = lo + 1

    // A log axis can't show 0 (a blown account) or anything below it, so the floor is clamped to a
    // rupee rather than silently dropping the runs that matter most.
    const t = log ? (v) => Math.log10(Math.max(v, 1)) : (v) => v
    const tLo = t(lo)
    const tHi = t(hi)
    const steps = Math.max(...bold.map((b) => b.data.length))
    const sx = (i) => padL + (i / (steps - 1 || 1)) * (width - padL - padR)
    const sy = (v) => {
      const f = (t(v) - tLo) / (tHi - tLo || 1)
      return invert ? padT + f * (height - padT - padB) : height - padB - f * (height - padT - padB)
    }

    ctx.font = '10px system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    for (let k = 0; k <= 4; k++) {
      const v = log ? 10 ** (tLo + ((tHi - tLo) * k) / 4) : lo + ((hi - lo) * k) / 4
      const y = sy(v)
      ctx.strokeStyle = GRID
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(padL, y)
      ctx.lineTo(width - padR, y)
      ctx.stroke()
      ctx.fillStyle = AXIS
      ctx.textAlign = 'right'
      ctx.fillText(formatY(v), padL - 6, y)
    }

    geom.current = { sx, sy, steps, padL, padR }

    const stroke = (data, color, lineWidth) => {
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      ctx.beginPath()
      for (let i = 0; i < data.length; i++) {
        const x = sx(i)
        const y = sy(data[i])
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    // Hovered line last, so it sits above the bundle it was picked out of.
    series.forEach((s, i) => i !== hover?.i && stroke(s.data, s.color, s.lineWidth))
    if (hover) {
      const s = series[hover.i]
      stroke(s.data, s.color === FAINT ? HOVER : s.color, s.lineWidth + 1.5)
      ctx.fillStyle = s.color === FAINT ? HOVER : s.color
      ctx.beginPath()
      ctx.arc(hover.x, hover.y, 3.5, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.fillStyle = AXIS
    ctx.textAlign = 'center'
    for (let k = 0; k <= 4; k++) {
      const i = Math.round(((steps - 1) * k) / 4)
      ctx.fillText(String(i), sx(i), height - 8)
    }
  }, [series, bold, log, invert, width, height, formatY, hover])

  const onMove = (e) => {
    if (!tooltip || !geom.current) return
    const { sx, sy, steps, padL, padR } = geom.current
    const rect = canvasRef.current.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const i = Math.round(((mx - padL) / Math.max(width - padL - padR, 1)) * (steps - 1))
    if (i < 0 || i > steps - 1) return setHover(null)
    let best = null
    series.forEach((s, k) => {
      const y = sy(s.data[Math.min(i, s.data.length - 1)])
      const d = Math.abs(y - my)
      if (d <= 14 && (!best || d < best.d)) best = { d, i: k, x: sx(i), y }
    })
    setHover((prev) => (best ? { i: best.i, x: best.x, y: best.y } : prev === null ? prev : null))
  }

  const hovered = hover ? series[hover.i] : null

  return (
    <div ref={wrapRef} className="relative w-full">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      />
      {hovered && tooltip && (
        <div
          className="pointer-events-none absolute z-10 w-52 rounded-lg border bg-popover p-2 text-xs shadow-md"
          style={{
            left: Math.min(hover.x + 12, Math.max(width - 220, 0)),
            top: Math.min(hover.y + 12, height - 40),
          }}
        >
          {tooltip(hovered)}
        </div>
      )}
    </div>
  )
}

// --- small pieces -----------------------------------------------------------------------------

function StatCard({ label, value, valueClassName, sub }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className={`text-lg font-semibold tabular-nums ${valueClassName ?? ''}`}>{value}</p>
      <p className="mt-0.5 text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Panel({ title, hint, children, className = '', action }) {
  return (
    <div className={`rounded-xl border bg-card p-4 ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{title}</p>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  )
}

function Field({ label, children, hint }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  )
}

/** Two-button radio. Same reason ManualOverview's deposit/withdrawal toggle is buttons: it's a
 *  binary choice whose consequences matter enough to stay visible without opening a menu. */
function Choice({ options, value, onChange }) {
  return (
    <div className="flex gap-1.5">
      {Object.entries(options).map(([key, label]) => (
        <Button
          key={key}
          type="button"
          size="sm"
          variant={value === key ? 'default' : 'outline'}
          className="h-auto flex-1 py-1.5 text-[11px] leading-tight whitespace-normal"
          onClick={() => onChange(key)}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}

function ScaleToggle({ log, onChange }) {
  return (
    <Button type="button" size="sm" variant="outline" onClick={() => onChange(!log)}>
      {log ? 'Log scale' : 'Linear scale'}
    </Button>
  )
}

function Legend({ items }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}

// --- the slippage panel -----------------------------------------------------------------------

/** Deliberately the loudest control on the page. An automated strategy fills where it fills; a
 *  manual trader hesitates, chases, and fat-fingers, and that per-trade cost is what separates a
 *  clean paper-traded equity curve from the live one. The panel shows the arithmetic drag live
 *  (slip x trades) so the cost is visible before a single run happens. */
function SlippagePanel({ config, set, pool }) {
  const drag = config.slip * config.length
  const winsEaten = pool?.avgWin ? drag / pool.avgWin : null
  return (
    <div className="rounded-xl border-2 border-amber-500/60 bg-amber-500/[0.06] p-4">
      <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">Human friction & slippage</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Charged on every simulated trade, winners included. This is the number that usually explains the gap
        between a paper account and a funded one.
      </p>

      <div className="mt-3 flex items-center gap-3">
        <span className="text-2xl font-semibold tabular-nums">{inr(config.slip)}</span>
        <span className="text-xs text-muted-foreground">per trade</span>
      </div>
      <input
        type="range"
        min="0"
        max="1000"
        step="10"
        value={config.slip}
        onChange={(e) => set({ slip: Number(e.target.value) })}
        className="mt-2 w-full accent-amber-500"
        aria-label="Slippage per trade"
      />
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>₹0</span>
        <span>₹1,000</span>
      </div>
      <Input
        type="number"
        min="0"
        step="10"
        value={config.slip}
        onChange={(e) => set({ slip: Math.max(0, Number(e.target.value) || 0) })}
        className="mt-2 h-8"
      />

      <p className="mt-3 border-t border-amber-500/30 pt-2 text-xs">
        Over {config.length} trades that is{' '}
        <span className="font-semibold text-amber-600 tabular-nums dark:text-amber-400">{inr(drag)}</span> of
        drag
        {winsEaten != null && (
          <>
            {' '}
            — <span className="font-semibold tabular-nums">{fmt(winsEaten, 1)}</span> of your average winning
            trades, gone before the edge is counted.
          </>
        )}
        .
      </p>

      <label className="mt-3 flex cursor-pointer items-start gap-2 border-t border-amber-500/30 pt-3 text-xs">
        <input
          type="checkbox"
          checked={config.removeTopWins}
          onChange={(e) => set({ removeTopWins: e.target.checked })}
          className="mt-0.5 accent-amber-500"
        />
        <span>
          <span className="font-medium">Erase the top 5% of winners</span>
          <span className="block text-muted-foreground">
            Black-swan test: does the strategy survive without its luckiest home runs?
          </span>
        </span>
      </label>
    </div>
  )
}

// --- shared config sidebar --------------------------------------------------------------------

/** Identical in both modes, and deliberately so: a comparison is only a comparison if every account
 *  was put through the same starting balance, the same friction and the same sizing rule. There is
 *  no per-account config in the Multiple tab for exactly that reason. */
function ConfigSidebar({ config, set, pool, onRun, canRun, runLabel, onCsv, csvLabel, hasResult }) {
  const savePreset = () => {
    localStorage.setItem(PRESET_KEY, JSON.stringify(config))
    toast.success('Configuration saved — it will load with this page next time')
  }

  return (
    <aside className="w-full shrink-0 space-y-3 no-print lg:sticky lg:top-4 lg:h-fit lg:w-80">
      <Panel title="Simulation setup">
        <div className="space-y-3">
          <Field label="Starting balance">
            <Input
              type="number"
              className="h-8"
              value={config.startBalance}
              onChange={(e) => set({ startBalance: Math.max(1, Number(e.target.value) || 0) })}
            />
          </Field>

          <Field label={`Simulations: ${fmt(config.runs, 0)} runs`}>
            <input
              type="range"
              min="100"
              max="10000"
              step="100"
              value={config.runs}
              onChange={(e) => set({ runs: Number(e.target.value) })}
              className="w-full accent-primary"
            />
          </Field>

          <Field label="Length (trades to project)">
            <div className="flex gap-1.5">
              <Input
                type="number"
                min="1"
                className="h-8"
                value={config.length}
                onChange={(e) => set({ length: Math.max(1, Number(e.target.value) || 1) })}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!pool}
                onClick={() => set({ length: pool.n })}
              >
                Match log
              </Button>
            </div>
          </Field>

          <Field
            label="Resampling model"
            hint={
              config.model === 'bootstrap'
                ? 'Draws with replacement — one monster loss can strike twice in a run.'
                : 'Same trades, new order — isolates sequence risk from selection luck.'
            }
          >
            <Choice options={MODELS} value={config.model} onChange={(v) => set({ model: v })} />
          </Field>
        </div>
      </Panel>

      <SlippagePanel config={config} set={set} pool={pool} />

      <Panel title="Position sizing">
        <div className="space-y-3">
          <Choice options={SIZING} value={config.sizingMode} onChange={(v) => set({ sizingMode: v })} />
          {config.sizingMode === 'fixed-amount' && (
            <Field label="Risk per trade (₹)">
              <Input
                type="number"
                min="1"
                className="h-8"
                value={config.riskAmount}
                onChange={(e) => set({ riskAmount: Math.max(1, Number(e.target.value) || 0) })}
              />
            </Field>
          )}
          {config.sizingMode === 'fixed-pct' && (
            <Field label="Risk per trade (% of equity)" hint="Compounds up and bleeds down with the curve.">
              <Input
                type="number"
                min="0.1"
                step="0.1"
                className="h-8"
                value={config.riskPct}
                onChange={(e) => set({ riskPct: Math.max(0.1, Number(e.target.value) || 0) })}
              />
            </Field>
          )}
          <Field label="Liquidation threshold (₹)" hint="Below this the account is dead.">
            <Input
              type="number"
              min="0"
              className="h-8"
              value={config.liquidateAt}
              onChange={(e) => set({ liquidateAt: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Field>
        </div>
      </Panel>

      <Button className="w-full" onClick={onRun} disabled={!canRun}>
        <PlayIcon className="size-4" /> {runLabel}
      </Button>

      <div className="flex gap-1.5">
        <Button size="sm" variant="outline" className="flex-1" onClick={savePreset}>
          <SaveIcon className="size-3.5" /> Preset
        </Button>
        <Button size="sm" variant="outline" className="flex-1" disabled={!hasResult} onClick={onCsv}>
          <DownloadIcon className="size-3.5" /> {csvLabel}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          disabled={!hasResult}
          onClick={() => window.print()}
        >
          <FileTextIcon className="size-3.5" /> PDF
        </Button>
      </div>
    </aside>
  )
}

// --- results (shared by the Single tab and every per-account tab) ------------------------------

function DataProfile({ pool, hint }) {
  return (
    <Panel title="Active data profile" hint={hint}>
      {pool ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Trades" value={fmt(pool.n, 0)} />
          <StatCard label="Win rate" value={`${fmt(pool.winRate, 1)}%`} />
          <StatCard
            label="Profit factor"
            value={pool.profitFactor == null ? '∞' : fmt(pool.profitFactor, 2)}
            valueClassName={pool.profitFactor >= 1 ? 'text-up' : 'text-down'}
          />
          <StatCard label="Avg win" value={inr(pool.avgWin)} valueClassName="text-up" />
          <StatCard label="Avg loss" value={inr(pool.avgLoss)} valueClassName="text-down" />
          <StatCard label="Largest loss" value={inr(pool.largestLoss)} valueClassName="text-down" />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No closed trades on this account yet — nothing to resample.
        </p>
      )}
    </Panel>
  )
}

/** One hovered run's own statistics — the same six metrics the percentile table reports, but for
 *  this single path rather than across the distribution. */
function RunTooltip({ result, run, label }) {
  const { endBalance, maxDD, maxLossStreak, profitFactor, sharpe } = result.perRun
  const stats = {
    endBalance: endBalance[run],
    maxDD: maxDD[run],
    maxLossStreak: maxLossStreak[run],
    roi: ((endBalance[run] - result.startBalance) / result.startBalance) * 100,
    profitFactor: profitFactor[run],
    sharpe: sharpe[run],
  }
  return (
    <>
      <p className="mb-1 font-medium">{label}</p>
      {TABLE_ROWS.map((row) => (
        <div key={row.key} className="flex justify-between gap-2">
          <span className="text-muted-foreground">{row.label}</span>
          <span className="tabular-nums">{row.format(stats[row.key])}</span>
        </div>
      ))}
    </>
  )
}

/** The full single-account read-out. Rendered identically whether it's the Single tab or one
 *  account's tab inside a comparison - an account's own numbers shouldn't change presentation just
 *  because it's being held up against another one. */
function SimulationResults({ result, config }) {
  const [logEquity, setLogEquity] = useState(false)
  const [logDd, setLogDd] = useState(false)

  const bands = [
    { data: result.bands.p10, color: BAND.p10, run: result.bandRuns.p10, label: '10th percentile run' },
    { data: result.bands.p50, color: BAND.p50, run: result.bandRuns.p50, label: 'Median run' },
    { data: result.bands.p90, color: BAND.p90, run: result.bandRuns.p90, label: '90th percentile run' },
  ]
  const faintRuns = useMemo(
    () =>
      result.sample.map((data, i) => ({
        data,
        run: result.sampleRuns[i],
        label: `${fmt(result.samplePct[i], 0)}th percentile run`,
      })),
    [result],
  )
  const ddBands = [
    { data: result.ddBands.p10, color: BAND.p10 },
    { data: result.ddBands.p50, color: BAND.p50 },
    { data: result.ddBands.p90, color: BAND.p90 },
  ]

  return (
    <>
      <div className="grid gap-2 sm:grid-cols-3">
        <StatCard
          label="Strategy survival rate"
          value={`${fmt(result.survivalRate, 1)}%`}
          valueClassName={result.survivalRate >= 95 ? 'text-up' : 'text-down'}
          sub={`of ${compact(result.runs)} runs finished above ${inr(config.liquidateAt)}`}
        />
        <StatCard
          label="Probability of ruin (50% DD)"
          value={`${fmt(result.ruin50Pct, 1)}%`}
          valueClassName={result.ruin50Pct <= 5 ? 'text-up' : 'text-down'}
          sub="hit a 50% drawdown at any point — needs a 100% gain to undo"
        />
        <StatCard
          label="Probability of ruin (total)"
          value={`${fmt(result.ruinFullPct, 1)}%`}
          valueClassName={result.ruinFullPct === 0 ? 'text-up' : 'text-down'}
          sub="account hit the liquidation threshold"
        />
      </div>

      <Panel
        title="Equity curves"
        hint={`${result.sample.length} representative runs. The three bold curves are real runs — the ones that finished at the 10th, 50th and 90th percentile — not a stitched band. Hover any line for that run's own numbers.`}
        action={<ScaleToggle log={logEquity} onChange={setLogEquity} />}
      >
        <PathsCanvas
          faint={faintRuns}
          bold={bands}
          log={logEquity}
          formatY={(v) => compact(v)}
          tooltip={(s) => <RunTooltip result={result} run={s.run} label={s.label} />}
        />
        <Legend
          items={[
            { label: '10th — worst case', color: BAND.p10 },
            { label: '50th — median', color: BAND.p50 },
            { label: '90th — best case', color: BAND.p90 },
          ]}
        />
      </Panel>

      <Panel
        title="Drawdown over time"
        hint="Peak-to-trough depth of those same three runs, at each trade."
        action={<ScaleToggle log={logDd} onChange={setLogDd} />}
      >
        <PathsCanvas bold={ddBands} log={logDd} invert height={180} formatY={(v) => `${Math.round(v)}%`} />
      </Panel>

      <Panel title="Performance & stress statistics">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Metric</TableHead>
              {PCT_HEADS.map((h) => (
                <TableHead key={h} className="text-right">
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {TABLE_ROWS.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="font-medium">{row.label}</TableCell>
                {result.table[row.key].map((v, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed 5-percentile columns
                  <TableCell key={i} className="text-right tabular-nums">
                    {row.format(v)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>

      <Panel
        title="Consecutive losses"
        hint="How deep a losing streak each run ran into. The number you have to sit through without abandoning the plan."
      >
        <div className="space-y-1.5">
          {result.lossStreakHist.map((b) => (
            <div key={b.streak} className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-xs font-medium tabular-nums">{b.label}</span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                <div
                  className={`h-full ${b.streak >= 7 ? 'bg-down' : b.streak >= 4 ? 'bg-amber-500' : 'bg-up'}`}
                  style={{ width: `${b.pct}%` }}
                />
              </div>
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {fmt(b.pct, 1)}%
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </>
  )
}

// --- comparison ---------------------------------------------------------------------------

/** Red through neutral to green. Correlation is signed, so a diverging scale is the only honest
 *  one - a single-hue ramp would make -0.9 (they hedge each other) and +0.9 (they crash together)
 *  look like near-neighbours. */
function correlationTint(r) {
  if (r == null) return 'transparent'
  const a = Math.min(Math.abs(r), 1) * 0.55
  return r >= 0 ? `rgba(34, 197, 94, ${a})` : `rgba(239, 68, 68, ${a})`
}

function CorrelationMatrixPanel({ entries, matrix }) {
  return (
    <Panel
      title="Daily P&L correlation"
      hint="Pearson correlation of realised daily P&L over the days each pair BOTH traded. Not of the simulated curves — two profitable curves always correlate at ~0.99 because both go up, which measures time passing, not agreement."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="p-2" />
              {entries.map((e, i) => (
                <th key={e.id} className="p-2 text-center font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ background: colorFor(i) }} />
                    {e.short}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((rowAcct, i) => (
              <tr key={rowAcct.id}>
                <th className="p-2 text-left font-medium whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ background: colorFor(i) }} />
                    {rowAcct.short}
                  </span>
                </th>
                {entries.map((colAcct, j) => {
                  const cell = matrix[i][j]
                  const thin = i !== j && cell.overlap < MIN_OVERLAP
                  return (
                    <td
                      key={colAcct.id}
                      className="p-2 text-center tabular-nums"
                      style={{ background: thin ? 'transparent' : correlationTint(cell.r) }}
                      title={`${cell.overlap} shared trading day${cell.overlap === 1 ? '' : 's'}`}
                    >
                      {cell.r == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className={thin ? 'text-muted-foreground' : 'font-medium'}>
                          {fmt(cell.r, 2)}
                        </span>
                      )}
                      <span className="block text-[10px] text-muted-foreground">{cell.overlap}d</span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Greyed-out cells have fewer than {MIN_OVERLAP} shared trading days — too thin to read as a finding.{' '}
        <span className="text-up">+1</span> means the two accounts win and lose on the same days (the backtest
        is being reproduced, or the two strategies are one strategy); <span className="text-down">−1</span>{' '}
        means they offset each other; 0 means they are genuinely independent bets.
      </p>
    </Panel>
  )
}

function ComparisonView({ entries, matrix, config }) {
  const [log, setLog] = useState(false)

  const medians = entries.map((e, i) => ({ data: e.result.bands.p50, color: colorFor(i) }))
  const worst = entries.map((e, i) => ({ data: e.result.bands.p10, color: colorFor(i) }))
  const legend = entries.map((e, i) => ({ label: e.name, color: colorFor(i) }))

  return (
    <div className="space-y-4">
      <Panel title="Where each account ends up" hint="Median run per account, on one set of axes.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {entries.map((e, i) => (
            <div key={e.id} className="rounded-xl border bg-card p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium">
                <span className="size-2 shrink-0 rounded-full" style={{ background: colorFor(i) }} />
                <span className="truncate">{e.name}</span>
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{inr(e.result.table.endBalance[2])}</p>
              <p className="text-[11px] text-muted-foreground">
                median · {fmt(e.result.table.roi[2], 1)}% ROI · {e.result.pool.n} trades in pool
              </p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Median equity curves"
        hint="The 50th-percentile run of each account, same starting balance and same friction. Diverging lines mean the accounts are not the same strategy, whatever the labels say."
        action={<ScaleToggle log={log} onChange={setLog} />}
      >
        <PathsCanvas bold={medians} log={log} formatY={(v) => compact(v)} />
        <Legend items={legend} />
      </Panel>

      <Panel
        title="Worst-case (10th percentile) curves"
        hint="The run each account finished the 10th percentile on. The comparison that actually decides which strategy gets funded."
        action={null}
      >
        <PathsCanvas bold={worst} log={log} formatY={(v) => compact(v)} />
        <Legend items={legend} />
      </Panel>

      <CorrelationMatrixPanel entries={entries} matrix={matrix} />

      <Panel
        title="Risk & survival"
        hint={`All accounts run at ${fmt(config.runs, 0)} runs x ${config.length} trades, ${inr(config.slip)} slippage.`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Survival</TableHead>
              <TableHead className="text-right">Ruin (50% DD)</TableHead>
              <TableHead className="text-right">Ruin (total)</TableHead>
              <TableHead className="text-right">Pool win rate</TableHead>
              <TableHead className="text-right">Pool profit factor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e, i) => (
              <TableRow key={e.id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: colorFor(i) }} />
                    {e.name}
                  </span>
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${e.result.survivalRate >= 95 ? 'text-up' : 'text-down'}`}
                >
                  {fmt(e.result.survivalRate, 1)}%
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${e.result.ruin50Pct <= 5 ? 'text-up' : 'text-down'}`}
                >
                  {fmt(e.result.ruin50Pct, 1)}%
                </TableCell>
                <TableCell className="text-right tabular-nums">{fmt(e.result.ruinFullPct, 1)}%</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(e.result.pool.winRate, 1)}%</TableCell>
                <TableCell className="text-right tabular-nums">
                  {e.result.pool.profitFactor == null ? '∞' : fmt(e.result.pool.profitFactor, 2)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>

      {/* Every metric the single view reports, one table each, accounts as rows - so any percentile
          of any metric can be read across accounts without switching tabs. */}
      <div className="grid gap-4 xl:grid-cols-2">
        {TABLE_ROWS.map((row) => (
          <Panel key={row.key} title={row.label}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  {PCT_HEADS.map((h) => (
                    <TableHead key={h} className="text-right">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e, i) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: colorFor(i) }} />
                        <span className="truncate">{e.short}</span>
                      </span>
                    </TableCell>
                    {e.result.table[row.key].map((v, k) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: fixed 5-percentile columns
                      <TableCell key={k} className="text-right tabular-nums">
                        {row.format(v)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
        ))}
      </div>
    </div>
  )
}

// --- modes ------------------------------------------------------------------------------------

const buildSizing = (config) =>
  config.sizingMode === 'fixed-amount'
    ? { mode: 'fixed-amount', amount: config.riskAmount }
    : config.sizingMode === 'fixed-pct'
      ? { mode: 'fixed-pct', pct: config.riskPct }
      : { mode: 'as-logged' }

const runFor = (pnls, config) =>
  simulate({
    pnls,
    startBalance: config.startBalance,
    runs: config.runs,
    length: config.length,
    model: config.model,
    slip: config.slip,
    removeTopWins: config.removeTopWins,
    sizing: buildSizing(config),
    liquidateAt: config.liquidateAt,
  })

const downloadCsv = (text, name) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function SingleMode({ config, set, accounts, allTrades }) {
  const { account } = useSearch({ from: '/simulation' })
  const navigate = useNavigate({ from: '/simulation' })
  const [result, setResult] = useState(null)

  const selected = accounts.find((a) => a.id === account) ?? null
  const pnls = useMemo(() => {
    if (account == null) return []
    return tradesForAccount(allTrades, account)
      .map(tradePnl)
      .filter((p) => p != null)
  }, [allTrades, account])
  const pool = useMemo(() => (pnls.length ? poolStats(pnls) : null), [pnls])

  // A fresh account should open at its own opening balance, not at a generic default - but never
  // clobber a balance the user typed in, so this only fires on an actual account change.
  useEffect(() => {
    if (selected?.opening_balance) set({ startBalance: selected.opening_balance })
    setResult(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])

  return (
    <div className="space-y-4">
      <div className="flex justify-end no-print">
        <Select
          value={account == null ? '' : String(account)}
          onValueChange={(v) => navigate({ search: (prev) => ({ ...prev, account: Number(v) }) })}
        >
          <SelectTrigger size="sm" className="w-72">
            <SelectValue placeholder="Select an account" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.kindLabel} · {a.name}
                {a.strategy ? ` (${a.strategy})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {account == null ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Pick a backtest log or paper account to simulate. To hold two or more against each other, use the{' '}
          <span className="font-medium">Multiple</span> tab.
        </p>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <ConfigSidebar
            config={config}
            set={set}
            pool={pool}
            onRun={() => pnls.length && setResult(runFor(pnls, config))}
            canRun={pnls.length > 0}
            runLabel="Run simulation"
            csvLabel="CSV"
            hasResult={!!result}
            onCsv={() => downloadCsv(toCsv(result), `simulation-${selected?.name ?? 'log'}`)}
          />
          <div className="min-w-0 flex-1 space-y-4">
            <DataProfile
              pool={pool}
              hint={`${selected?.kindLabel} · ${selected?.name} — closed trades only, the pool every run is drawn from.`}
            />
            {result ? (
              <SimulationResults result={result} config={config} />
            ) : (
              <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                Set the friction you actually pay, then run the simulation.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function MultiMode({ config, set, accounts, allTrades }) {
  const { accounts: idsParam, view } = useSearch({ from: '/simulation' })
  const navigate = useNavigate({ from: '/simulation' })
  const [results, setResults] = useState(null)

  const ids = useMemo(
    () => (idsParam ?? '').split(',').filter(Boolean).map(Number).filter(Number.isFinite),
    [idsParam],
  )
  // Depends on `accounts`, not just on the ids: the account list arrives from a query, so on a
  // reload of a /simulation?accounts=1,2 URL the ids are known a render before the names are.
  const chosen = useMemo(
    () => ids.map((id) => accounts.find((a) => a.id === id)).filter(Boolean),
    [ids, accounts],
  )

  const toggle = (id) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    setResults(null)
    navigate({ search: (prev) => ({ ...prev, accounts: next.join(',') || undefined, view: 'comparison' }) })
  }

  // Per-account trade pools, and the daily P&L series the correlation matrix is built from. Both
  // come off the same single getManualTrades() fetch - the accounts differ only by a filter.
  const perAccount = useMemo(
    () =>
      chosen.map((a) => {
        const trades = tradesForAccount(allTrades, a.id)
        const closed = trades.map((t) => ({ date: t.exited_at ?? t.traded_at, pnl: tradePnl(t) }))
        return {
          id: a.id,
          name: `${a.kindLabel} · ${a.name}`,
          short: a.name,
          pnls: closed.map((c) => c.pnl).filter((p) => p != null),
          daily: dailyTotals(closed),
        }
      }),
    [allTrades, chosen],
  )

  const runnable = useMemo(() => perAccount.filter((a) => a.pnls.length), [perAccount])
  // Pooled pool, purely so the sidebar's "Match log" and slippage readout have a sample size to
  // talk about when several accounts are selected. Never simulated as one - each account is run
  // separately, which is the whole point of this tab.
  const combinedPool = useMemo(
    () => (runnable.length ? poolStats(runnable.flatMap((a) => a.pnls)) : null),
    [runnable],
  )

  const run = () => {
    setResults(Object.fromEntries(runnable.map((a) => [a.id, { ...a, result: runFor(a.pnls, config) }])))
    navigate({ search: (prev) => ({ ...prev, view: prev.view ?? 'comparison' }) })
  }

  const entries = results ? runnable.map((a) => results[a.id]).filter(Boolean) : []
  const matrix = useMemo(
    () => (entries.length ? correlationMatrix(entries.map((e) => e.daily)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results],
  )

  return (
    <div className="space-y-4">
      <Panel
        title="Accounts to compare"
        hint="Pick two or more. Each is simulated separately under the same configuration — never pooled into one log."
        className="no-print"
      >
        <div className="flex flex-wrap gap-1.5">
          {accounts.map((a) => (
            <Button
              key={a.id}
              type="button"
              size="sm"
              variant={ids.includes(a.id) ? 'default' : 'outline'}
              onClick={() => toggle(a.id)}
            >
              <span
                className="size-2 rounded-full"
                style={{
                  background: ids.includes(a.id) ? colorFor(ids.indexOf(a.id)) : 'transparent',
                  boxShadow: ids.includes(a.id) ? 'none' : 'inset 0 0 0 1px currentColor',
                }}
              />
              {a.kindLabel} · {a.name}
            </Button>
          ))}
        </div>
        {accounts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No trade accounts yet — create one in Settings › Accounts.
          </p>
        )}
      </Panel>

      {chosen.length < 2 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Select at least two accounts. The usual pairing is a backtest log against the paper account running
          the same strategy — the comparison shows whether your live execution is still the thing you tested.
        </p>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <ConfigSidebar
            config={config}
            set={set}
            pool={combinedPool}
            onRun={run}
            canRun={runnable.length >= 2}
            runLabel={`Run ${runnable.length} simulations`}
            csvLabel="CSV"
            hasResult={!!results && entries.length > 0}
            onCsv={() => downloadCsv(toComparisonCsv(entries, matrix), 'simulation-comparison')}
          />

          <div className="min-w-0 flex-1">
            {!results ? (
              <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                {runnable.length < 2
                  ? 'At least two of the selected accounts need closed trades to compare.'
                  : 'Set the shared configuration, then run all selected accounts at once.'}
              </p>
            ) : (
              <Tabs
                value={view ?? 'comparison'}
                onValueChange={(next) => navigate({ search: (prev) => ({ ...prev, view: next }) })}
              >
                <TabsList className="no-print">
                  <TabsTab value="comparison">Comparison</TabsTab>
                  {entries.map((e) => (
                    <TabsTab key={e.id} value={String(e.id)}>
                      {e.short}
                    </TabsTab>
                  ))}
                  <TabsIndicator />
                </TabsList>

                <TabsPanel value="comparison" className="space-y-4">
                  <ComparisonView entries={entries} matrix={matrix} config={config} />
                </TabsPanel>

                {entries.map((e) => (
                  <TabsPanel key={e.id} value={String(e.id)} className="space-y-4">
                    <DataProfile
                      pool={e.result.pool}
                      hint={`${e.name} — closed trades only, the pool every run is drawn from.`}
                    />
                    <SimulationResults result={e.result} config={config} />
                  </TabsPanel>
                ))}
              </Tabs>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// --- page -------------------------------------------------------------------------------------

export default function TradeSimulation() {
  usePageTitle('Trade Log Simulation')
  const { mode } = useSearch({ from: '/simulation' })
  const navigate = useNavigate({ from: '/simulation' })

  const { data: allTrades = [] } = useQuery({ queryKey: ['manualTrades'], queryFn: getManualTrades })
  const { data: journalAccounts = [] } = useQuery({
    queryKey: ['tradeAccounts'],
    queryFn: () => getTradeAccounts('journal'),
  })
  const { data: paperAccounts = [] } = useQuery({
    queryKey: ['tradeAccounts', 'paper'],
    queryFn: () => getTradeAccounts('paper'),
  })

  const accounts = useMemo(
    () => [
      ...journalAccounts.map((a) => ({ ...a, kindLabel: 'Backtest log' })),
      ...paperAccounts.map((a) => ({ ...a, kindLabel: 'Paper account' })),
    ],
    [journalAccounts, paperAccounts],
  )

  // One config, shared by both tabs. Switching to Multiple keeps whatever you just set up in Single
  // rather than resetting it - the usual path onto this tab is "that looked bad, how does the paper
  // account handle the same friction".
  const [config, setConfig] = useState(() => {
    const saved = localStorage.getItem(PRESET_KEY)
    return saved ? { ...DEFAULTS, ...JSON.parse(saved) } : DEFAULTS
  })
  const set = (patch) => setConfig((c) => ({ ...c, ...patch }))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Trade log simulation</h1>
        <p className="text-xs text-muted-foreground">
          Monte Carlo over the trades you actually took — not over asset returns. Your own P&L distribution is
          the sample.
        </p>
      </div>

      <Tabs
        value={mode ?? 'single'}
        onValueChange={(next) => navigate({ search: (prev) => ({ ...prev, mode: next }) })}
      >
        <TabsList className="no-print">
          <TabsTab value="single">Single</TabsTab>
          <TabsTab value="multiple">Multiple</TabsTab>
          <TabsIndicator />
        </TabsList>

        <TabsPanel value="single">
          <SingleMode config={config} set={set} accounts={accounts} allTrades={allTrades} />
        </TabsPanel>
        <TabsPanel value="multiple">
          <MultiMode config={config} set={set} accounts={accounts} allTrades={allTrades} />
        </TabsPanel>
      </Tabs>
    </div>
  )
}
