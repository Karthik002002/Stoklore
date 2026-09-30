// One walk-forward report in full, at /engine/autotune/$reportId - the report id is the whole key.
// The walk itself (verdict, curves, picks, cells, executions, windows) is what the Auto-tune tab used
// to show inline; around it, every metric of the run page for the tuned and the fixed-defaults
// out-of-sample results side by side, window-by-window charts, and the full trade log with MAE/MFE.
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import type { UTCTimestamp } from 'lightweight-charts'
import { ArrowLeftIcon, ListPlusIcon, PrinterIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import SeriesChart from '@/components/charts/SeriesChart'
import { seriesColor } from '@/components/charts/colors'
import type { Dataset } from '@/components/charts/colors'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  autotuneSheets,
  excursions,
  istTime,
  paramsLabel,
  pickedSets,
  pinnedRange,
  runAnalytics,
  sessionTime as sessionEpoch,
  windowOfTrade,
} from '@/lib/engine'
import type { RunAnalytics, RunTrade } from '@/lib/engine'
import { fmt, formatDateTime, inr } from '@/lib/format'
import { usePageTitle } from '@/lib/usePageTitle'
import { cn } from '@/lib/utils'
import { deleteEngineAutotune, getEngineAutotune, getIntradayBars } from '@/services/api'
import type { EngineAutotuneCell, EngineAutotuneReport, EngineAutotuneRequest, EngineRun, EngineSizing } from '@/services/api'
import { useQueueJob } from './EngineJobs'
import {
  BucketBars,
  Histogram,
  ReturnsHeatmap,
  Section,
  TradeLog,
  dedupe,
  hold,
  num,
  pct,
  points,
} from './EngineRunPage'
import { DailyBars, ExecutionsChart, ExportMenu, HistoryLine, Stat, pnlClass } from './engineUi'

const sessionTime = (date: string) => sessionEpoch(date) as UTCTimestamp

type CellSort = 'net' | 'profit_factor' | 'win_rate' | 'picked'
const CELL_SORTS: Record<CellSort, string> = {
  net: 'Net',
  profit_factor: 'PF',
  win_rate: 'Win %',
  picked: 'Picked',
}

/** Every grid cell as if traded, unchanged, in every test window - which part of the grid actually
 *  held up out-of-sample, against what the tuner picked. Hindsight: no walk could have known the
 *  winner in advance, which is the point of comparing it with the picks. */
function CellTable({
  cells,
  axes,
  sort,
  onSort,
}: {
  cells: EngineAutotuneCell[]
  axes: string[]
  sort: CellSort
  onSort: (s: CellSort) => void
}) {
  const bestNet = cells[0]?.net
  const rows = [...cells].sort((a, b) => b[sort] - a[sort]).slice(0, 200)
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">
        Every combination, traded unchanged in every window (hindsight) · {cells.length} combinations
        {cells.length > rows.length ? `, top ${rows.length} shown` : ''} · highlighted = the tuner picked it
      </p>
      <div className="max-h-80 overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {axes.map((k) => (
                <TableHead key={k} className="font-mono">
                  {k}
                </TableHead>
              ))}
              {(Object.keys(CELL_SORTS) as CellSort[]).map((k) => (
                <TableHead key={k} className="text-right">
                  <button type="button" className="hover:text-foreground" onClick={() => onSort(k)}>
                    {CELL_SORTS[k]}
                    {sort === k ? ' ↓' : ''}
                  </button>
                </TableHead>
              ))}
              <TableHead className="text-right">Trades</TableHead>
              <TableHead className="text-right">Windows won</TableHead>
              <TableHead className="text-right">In-sample / window</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={paramsLabel(c.params, axes)} className={cn(c.picked > 0 && 'bg-primary/5')}>
                {axes.map((k) => (
                  <TableCell key={k} className="font-mono text-xs">
                    {c.params[k]}
                  </TableCell>
                ))}
                <TableCell className={cn('text-right tabular-nums', pnlClass(c.net))}>
                  {inr(c.net)}
                  {c.net === bestNet && c.trades > 0 && (
                    <Badge variant="outline" className="ml-1.5 text-success">
                      best
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.trades ? fmt(c.profit_factor) : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.trades ? `${fmt(c.win_rate, 0)}%` : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.picked ? `×${c.picked}` : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{c.trades}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.positive_windows}/{c.windows}
                </TableCell>
                <TableCell className={cn('text-right tabular-nums', pnlClass(c.is_net))}>
                  {inr(c.is_net)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

/** The walk itself: verdict, headline stats, the three curves, picks, cells, executions, the parameter
 *  path and every window - what the Auto-tune tab used to show inline. */
function WalkForward({ r }: { r: EngineAutotuneReport }) {
  const swept = useMemo(() => Object.keys(r?.axes ?? {}), [r])
  // Drill-down: a window row filters the trades and zooms the chart onto it; a trade row zooms to
  // that trade. Tuned and fixed-default executions are both kept, one shown at a time.
  const [selected, setSelected] = useState<number | null>(null)
  const [focusTrade, setFocusTrade] = useState<RunTrade | null>(null)
  const [side, setSide] = useState<'tuned' | 'fixed'>('tuned')
  const [cellSort, setCellSort] = useState<CellSort>('net')
  const trades = useMemo(() => (side === 'tuned' ? r.oos.trades : r.baseline.trades) ?? [], [r, side])
  const tradeWindow = useMemo(() => trades.map((t) => windowOfTrade(t, r.windows)), [r, trades])
  const shownTrades = useMemo(
    () => (selected == null ? trades : trades.filter((_, i) => tradeWindow[i] === selected)),
    [trades, tradeWindow, selected],
  )
  // The executions chart takes a run; this is the walk's out-of-sample trades dressed as one. With a
  // window selected, its bars run from that window's train start (context) to its test end - the
  // chart gets the newest 30k bars of what it asks for, which on 1m wouldn't reach an old window.
  const execRun = useMemo(() => {
    const w = selected == null ? null : r.windows[selected]
    const from = w ? sessionTime(w.train[0]) : (r.windows[0]?.start ?? sessionTime(r.sessions[0]))
    const to = w ? (w.end ?? sessionTime(w.test[1])) : (r.windows.at(-1)?.end ?? sessionTime(r.sessions[1]))
    return {
      id: r.id,
      symbols: [r.symbol],
      interval: r.interval,
      trades: shownTrades,
      summary: { from, to },
    } as unknown as EngineRun
  }, [r, selected, shownTrades])
  const focus = useMemo<RunTrade | null>(() => {
    if (focusTrade) return focusTrade
    const w = selected == null ? null : r.windows[selected]
    return w
      ? [r.symbol, w.start ?? sessionTime(w.test[0]), w.end ?? sessionTime(w.test[1]), 0, 0, 0, 0]
      : null
  }, [focusTrade, selected, r])
  const curves = useMemo<Dataset[]>(() => {
    const pts = (curve: [number, number][]) => curve.map(([t, v]) => ({ time: t as UTCTimestamp, value: v }))
    const start = r.oos.equity[0]?.[0]
    const promised: [number, number][] =
      start != null && r.promised.length && start < r.promised[0][0]
        ? [[start, 0], ...r.promised]
        : r.promised
    return [
      { key: 'Tuned (out-of-sample)', color: seriesColor(0), points: pts(r.oos.equity) },
      { key: 'Fixed defaults (out-of-sample)', color: seriesColor(3), points: pts(r.baseline.equity) },
      { key: 'In-sample promise', color: seriesColor(1), points: pts(promised) },
    ]
  }, [r])
  const paths = useMemo<Dataset[]>(
    () =>
      swept.map((k, i) => ({
        key: k,
        color: seriesColor(i),
        points: r.windows
          .filter((w) => w.chosen)
          .map((w) => ({ time: sessionTime(w.test[0]), value: w.chosen![k] })),
      })),
    [r, swept],
  )

  const st = r.stats
  const tuned = r.oos.summary
  const base = r.baseline.summary
  // what happened, in numbers - not advice
  const verdict = !st.traded_windows
    ? 'No cell made money in-sample in any window, so the tuner never traded. This grid has nothing to tune.'
    : tuned.net <= 0
      ? `Tuned parameters lost ${inr(-tuned.net)} out-of-sample${st.beats_baseline ? ` - less than fixed defaults (${inr(base.net)}), largely by sitting out ${st.sat_out} of ${st.windows} windows` : ''}. No out-of-sample edge.`
      : st.beats_baseline
        ? `Tuned parameters made ${inr(tuned.net)} out-of-sample, against ${inr(base.net)} for fixed defaults. Read it with the efficiency, deflated Sharpe and stability below before trusting it.`
        : `Tuned parameters made ${inr(tuned.net)} out-of-sample, but fixed defaults made more (${inr(base.net)}) - tuning added nothing here.`

  return (
    <>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>
            {r.sessions[0]} → {r.sessions[1]} · train {r.train} / test {r.test} sessions · min {r.min_trades}{' '}
            trades · switch margin {fmt(r.margin * 100, 0)}% · cost {r.cost_bps} bps
          </span>
          <span>
            Tuned:{' '}
            <span className="font-mono text-foreground">
              {swept.map((k) => `${k} ${r.axes[k][0]}…${r.axes[k].at(-1)} (${r.axes[k].length})`).join(', ')}
            </span>
          </span>
          <span>
            Fixed defaults:{' '}
            <span className="font-mono text-foreground">
              {swept.map((k) => `${k}=${r.defaults[k]}`).join(' ')}
            </span>
          </span>
          <span>created {formatDateTime(r.created)}</span>
        </div>
        <HistoryLine history={r.history} coverage={r.coverage && { [r.symbol]: r.coverage }} />

        <p
          className={cn(
            'text-sm',
            tuned.net > 0 && st.beats_baseline ? 'text-success' : 'text-muted-foreground',
          )}
        >
          {verdict}
        </p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Tuned net · out-of-sample" value={inr(tuned.net)} className={pnlClass(tuned.net)} />
          <Stat
            label="Fixed defaults net · out-of-sample"
            value={inr(base.net)}
            className={pnlClass(base.net)}
          />
          <Stat label="Trades · tuned vs fixed" value={`${fmt(tuned.trades, 0)} vs ${fmt(base.trades, 0)}`} />
          <Stat
            label="Profit factor · tuned vs fixed"
            value={`${fmt(tuned.profit_factor)} vs ${fmt(base.profit_factor)}`}
          />
          <Stat label="Max drawdown · tuned vs fixed" value={`${inr(tuned.max_dd)} vs ${inr(base.max_dd)}`} />
          <Stat
            label="Walk-forward efficiency · want ≥ 0.5"
            value={st.wfe == null ? '—' : fmt(st.wfe)}
            className={st.wfe == null ? undefined : st.wfe >= 0.5 ? 'text-success' : 'text-destructive'}
          />
          <Stat
            label={`Deflated Sharpe · ${st.trials} tries/window · want ≥ 90%`}
            value={st.dsr == null ? '—' : `${fmt(st.dsr * 100, 0)}%`}
            className={st.dsr == null ? undefined : st.dsr >= 0.9 ? 'text-success' : 'text-destructive'}
          />
          <Stat label="Windows traded" value={`${st.traded_windows} / ${st.windows}`} />
          <Stat
            label="Param stability · want ≥ 70%"
            value={st.stability == null ? '—' : `${fmt(st.stability * 100, 0)}%`}
            className={
              st.stability == null ? undefined : st.stability >= 0.7 ? 'text-success' : 'text-destructive'
            }
          />
          <Stat label="Pick switches" value={fmt(st.switches, 0)} />
        </div>

        <div>
          <p className="mb-1 text-xs text-muted-foreground">
            Out-of-sample equity, stitched window to window. The gap between the tuned line and the in-sample
            promise is how much of the in-sample result was fit to noise.
          </p>
          <div className="h-72">
            <SeriesChart datasets={curves} fill format={inr} />
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-5">
          <div className="xl:col-span-2">
            <p className="mb-1 text-xs text-muted-foreground">
              What the tuner picked - each parameter set it traded, and what those windows made out-of-sample
            </p>
            <div className="max-h-80 overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Params</TableHead>
                    <TableHead className="text-right">Windows</TableHead>
                    <TableHead className="text-right">Won</TableHead>
                    <TableHead className="text-right">Trades</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pickedSets(r.windows, swept).map((g) => (
                    <TableRow key={paramsLabel(g.params, swept)}>
                      <TableCell className="font-mono text-xs">{paramsLabel(g.params, swept)}</TableCell>
                      <TableCell className="text-right tabular-nums">{g.windows}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {g.positive}/{g.windows}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{g.trades}</TableCell>
                      <TableCell className={cn('text-right tabular-nums', pnlClass(g.net))}>
                        {inr(g.net)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!st.traded_windows && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-xs text-muted-foreground italic">
                        Nothing picked - every window was sat out.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
          <div className="xl:col-span-3">
            {r.cells?.length ? (
              <CellTable cells={r.cells} axes={swept} sort={cellSort} onSort={setCellSort} />
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                Every combination's out-of-sample result is kept on walk-forwards run from now on - re-run
                this one to see which parameter sets held up across all its windows.
              </p>
            )}
          </div>
        </div>

        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <p className="text-xs text-muted-foreground">
              Executed trades, out-of-sample
              {selected != null &&
                ` - window ${r.windows[selected].test[0]} → ${r.windows[selected].test[1]}`}
              {' · click a trade to zoom to it'}
            </p>
            {selected != null && (
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  setSelected(null)
                  setFocusTrade(null)
                }}
              >
                All windows <XIcon />
              </Button>
            )}
            <div className="ml-auto flex gap-1">
              {(['tuned', 'fixed'] as const).map((k) => (
                <Button
                  key={k}
                  size="xs"
                  variant={side === k ? 'secondary' : 'ghost'}
                  onClick={() => {
                    setSide(k)
                    setFocusTrade(null)
                  }}
                >
                  {k === 'tuned'
                    ? `Tuned (${r.oos.trades?.length ?? 0})`
                    : `Fixed defaults (${r.baseline.trades?.length ?? 0})`}
                </Button>
              ))}
            </div>
          </div>
          {r.oos.trades ? (
            <div className="space-y-2">
              {execRun && <ExecutionsChart key={`${side}-${selected}`} run={execRun} focus={focus} />}
              <div className="max-h-80 overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Window</TableHead>
                      {side === 'tuned' && <TableHead>Params</TableHead>}
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead>Entry</TableHead>
                      <TableHead className="text-right">Entry px</TableHead>
                      <TableHead>Exit</TableHead>
                      <TableHead className="text-right">Exit px</TableHead>
                      <TableHead className="text-right">Gross P&L</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shownTrades.slice(-1000).map((t, i) => {
                      const w = r.windows[windowOfTrade(t, r.windows)]
                      const active = focusTrade?.[1] === t[1] && focusTrade?.[2] === t[2]
                      return (
                        <TableRow
                          key={`${t[1]}-${i}`}
                          className={cn('cursor-pointer', active && 'bg-muted')}
                          onClick={() => setFocusTrade(t)}
                        >
                          <TableCell className="text-xs text-muted-foreground tabular-nums">
                            {w ? `${w.test[0]} → ${w.test[1]}` : '—'}
                          </TableCell>
                          {side === 'tuned' && (
                            <TableCell className="font-mono text-xs">
                              {w?.chosen ? paramsLabel(w.chosen, swept) : '—'}
                            </TableCell>
                          )}
                          <TableCell>{t[3] > 0 ? 'Long' : 'Short'}</TableCell>
                          <TableCell className="text-right tabular-nums">{Math.abs(t[3])}</TableCell>
                          <TableCell className="tabular-nums">{istTime(t[1])}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(t[4])}</TableCell>
                          <TableCell className="tabular-nums">{istTime(t[2])}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(t[5])}</TableCell>
                          <TableCell className={cn('text-right tabular-nums', pnlClass(t[6]))}>
                            {inr(t[6])}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    {!shownTrades.length && (
                      <TableRow>
                        <TableCell colSpan={9} className="text-xs text-muted-foreground italic">
                          No trades {selected != null ? 'in this window' : ''}.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {shownTrades.length > 1000 && (
                <p className="text-[11px] text-muted-foreground">
                  Showing the latest 1,000 of {shownTrades.length} - pick a window to see its own. Export has
                  them all.
                </p>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
              Executed trades are kept on walk-forwards run from now on - re-run this one to see them on the
              chart.
            </p>
          )}
        </div>

        {paths.some((p) => p.points.length > 1) && (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">
              Parameter path - the pick at each window's start. A line that jumps around the grid means there
              is no stable optimum to tune toward.
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              {paths.map((p) => (
                <div key={p.key} className="h-40">
                  <SeriesChart datasets={[p]} fill />
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1 text-xs text-muted-foreground">
            Windows · click one to see its trades on the chart · <em>pick rank</em> is where the tuner's
            choice finished among every combination on that window's unseen bars
          </p>
          <div className="max-h-[28rem] overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Test sessions</TableHead>
                  {swept.map((k) => (
                    <TableHead key={k} className="font-mono">
                      {k}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Eligible cells</TableHead>
                  <TableHead className="text-right">In-sample net</TableHead>
                  <TableHead className="text-right">Out-of-sample net</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="text-right">Fixed defaults net</TableHead>
                  <TableHead className="text-right">Pick rank</TableHead>
                  <TableHead>Best combination (hindsight)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.windows.map((w, wi) => (
                  <TableRow
                    key={w.test[0]}
                    className={cn(
                      'cursor-pointer',
                      !w.chosen && 'text-muted-foreground/60',
                      selected === wi && 'bg-muted',
                    )}
                    onClick={() => {
                      setSelected(selected === wi ? null : wi)
                      setFocusTrade(null)
                    }}
                  >
                    <TableCell className="tabular-nums">
                      {w.test[0]} → {w.test[1]}
                      {w.switched && (
                        <Badge variant="outline" className="ml-2">
                          switched
                        </Badge>
                      )}
                    </TableCell>
                    {w.chosen ? (
                      swept.map((k) => (
                        <TableCell key={k} className="font-mono text-xs">
                          {w.chosen![k]}
                        </TableCell>
                      ))
                    ) : (
                      <TableCell colSpan={swept.length} className="text-xs italic">
                        sat out
                      </TableCell>
                    )}
                    <TableCell className="text-right tabular-nums">
                      {w.eligible} / {w.cells}
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', w.is && pnlClass(w.is.net))}>
                      {w.is ? inr(w.is.net) : '—'}
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', w.oos && pnlClass(w.oos.net))}>
                      {w.oos ? inr(w.oos.net) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{w.oos ? w.oos.trades : '—'}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', pnlClass(w.baseline.net))}>
                      {inr(w.baseline.net)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        w.rank != null && w.of
                          ? w.rank <= Math.ceil(w.of / 3)
                            ? 'text-success'
                            : w.rank > Math.floor((2 * w.of) / 3)
                              ? 'text-destructive'
                              : ''
                          : '',
                      )}
                    >
                      {w.rank != null && w.of ? `${w.rank}/${w.of}` : '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {w.best ? (
                        <>
                          {paramsLabel(w.best.params, swept)}{' '}
                          <span className={pnlClass(w.best.net)}>{inr(w.best.net)}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </>
  )
}

/** The report's sizing args (["sizing=1", "capital=100000"]) back as a Sizing; null = fixed qty. */
function sizingOf(args?: string[] | null): EngineSizing | null {
  if (!args?.length) return null
  const kv = Object.fromEntries(args.map((a) => a.split('=')))
  return { mode: kv.sizing === '2' ? 'all_in' : 'scale', capital: Number(kv.capital) }
}

/** One side's stitched out-of-sample result, shaped as a run for runAnalytics and the trade log. */
function sideRun(r: EngineAutotuneReport, side: 'oos' | 'baseline') {
  const s = r[side]
  return {
    id: `${r.id}-${side}`,
    symbols: [r.symbol],
    interval: r.interval,
    summary: { ...s.summary, from: s.equity[0]?.[0] ?? 0, to: s.equity.at(-1)?.[0] ?? 0 },
    equity: s.equity,
    daily: s.daily,
    trades: s.trades ?? [],
    params: { cost_bps: r.cost_bps },
    sizing: sizingOf(r.sizing),
  }
}

/** The request that walks this stock again the same way, on the same sessions. */
function rewalkRequest(r: EngineAutotuneReport): EngineAutotuneRequest {
  return {
    strategy: r.strategy,
    symbols: [r.symbol],
    interval: r.interval,
    params: r.params,
    train: r.train,
    test: r.test,
    min_trades: r.min_trades,
    margin: r.margin,
    cost_bps: r.cost_bps,
    range: pinnedRange(typeof r.history === 'number' ? null : r.history, r.coverage && { [r.symbol]: r.coverage }),
    sizing: sizingOf(r.sizing) ?? { mode: 'fixed', capital: 100000 },
  }
}

function Compare({ t, f, r }: { t: RunAnalytics; f: RunAnalytics; r: EngineAutotuneReport }) {
  const ts = r.oos.summary
  const fs = r.baseline.summary
  // [label, tuned, fixed, which is better: 1 higher, -1 lower, 0 neither, formatter]
  const rows: [string, number | null | undefined, number | null | undefined, 1 | -1 | 0, (v: number | null | undefined) => string][] = [
    ['Net P&L', ts.net, fs.net, 1, inr],
    ['Return', t.returnPct, f.returnPct, 1, pct],
    ['CAGR', t.cagr, f.cagr, 1, pct],
    ['Max drawdown', ts.max_dd, fs.max_dd, -1, inr],
    ['Max drawdown %', t.maxDdPct, f.maxDdPct, -1, pct],
    ['Sharpe', ts.sharpe, fs.sharpe, 1, num],
    ['Sortino', t.sortino, f.sortino, 1, num],
    ['Calmar', t.calmar, f.calmar, 1, num],
    ['Ulcer index', t.ulcer, f.ulcer, -1, num],
    ['Return / drawdown', ts.ret_dd, fs.ret_dd, 1, num],
    ['Profit factor', ts.profit_factor, fs.profit_factor, 1, num],
    ['Win rate', ts.win_rate, fs.win_rate, 1, pct],
    ['Expectancy (gross)', ts.expectancy, fs.expectancy, 1, inr],
    ['Payoff ratio', t.payoff, f.payoff, 1, num],
    ['SQN', t.sqn, f.sqn, 1, num],
    ['Kelly', t.kelly, f.kelly, 1, pct],
    ['Trades', ts.trades, fs.trades, 0, (v) => fmt(v, 0)],
    ['Trades / month', t.tradesPerMonth, f.tradesPerMonth, 0, (v) => num(v, 1)],
    ['Exposure', t.exposurePct, f.exposurePct, 0, pct],
    ['Median hold', t.medianHoldMin, f.medianHoldMin, 0, (v) => (v == null ? '—' : hold(v))],
    ['Avg win (net)', t.avgWin, f.avgWin, 1, inr],
    ['Avg loss (net)', t.avgLoss, f.avgLoss, 1, inr],
    ['Largest win', t.largestWin, f.largestWin, 1, inr],
    ['Largest loss', t.largestLoss, f.largestLoss, 1, inr],
    ['Longest win streak', t.winStreak, f.winStreak, 1, (v) => fmt(v, 0)],
    ['Longest loss streak', t.lossStreak, f.lossStreak, -1, (v) => fmt(v, 0)],
    ['Costs', ts.costs, fs.costs, -1, inr],
    ['Cost drag', t.costDragPct, f.costDragPct, -1, pct],
    ['Sessions', ts.days, fs.days, 0, (v) => fmt(v, 0)],
  ]
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Out-of-sample</TableHead>
          <TableHead className="text-right">Tuned</TableHead>
          <TableHead className="text-right">Fixed defaults</TableHead>
          <TableHead className="text-right">Tuned − fixed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(([label, a, b, better, f]) => {
          const d = a != null && b != null ? a - b : null
          const win = d == null || !better || d === 0 ? null : d * better > 0
          return (
            <TableRow key={label}>
              <TableCell className="text-muted-foreground">{label}</TableCell>
              <TableCell className={cn('text-right tabular-nums', win === true && 'font-medium text-success')}>{f(a)}</TableCell>
              <TableCell className={cn('text-right tabular-nums', win === false && 'font-medium text-success')}>{f(b)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{d == null ? '—' : f(d)}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

/** Window by window: what each side made, what the pick promised in-sample, and how the pick ranked. */
function WindowCharts({ r }: { r: EngineAutotuneReport }) {
  const at = (w: EngineAutotuneReport['windows'][number]) => (w.start ?? sessionTime(w.test[0])) as UTCTimestamp
  const nets: Dataset[] = [
    { key: 'Tuned', color: seriesColor(0), points: r.windows.map((w) => ({ time: at(w), value: w.oos?.net ?? 0 })) },
    { key: 'Fixed defaults', color: seriesColor(3), points: r.windows.map((w) => ({ time: at(w), value: w.baseline.net })) },
    {
      key: 'In-sample promise (per test length)',
      color: seriesColor(1),
      points: r.windows.map((w) => ({ time: at(w), value: w.is ? (w.is.net / r.train) * r.test : 0 })),
    },
  ]
  const ranks: Dataset[] = [
    {
      key: 'Pick percentile (100 = best cell)',
      color: seriesColor(2),
      points: r.windows
        .filter((w) => w.rank != null && w.of)
        .map((w) => ({ time: at(w), value: w.of! > 1 ? (100 * (w.of! - w.rank!)) / (w.of! - 1) : 100 })),
    },
    {
      key: 'Eligible cells %',
      color: seriesColor(4),
      points: r.windows.map((w) => ({ time: at(w), value: w.cells ? (100 * w.eligible) / w.cells : 0 })),
    },
  ]
  const beat = r.windows.filter((w) => (w.oos?.net ?? 0) > w.baseline.net).length
  const positive = r.windows.filter((w) => (w.oos?.net ?? 0) > 0).length
  const ranked = r.windows.filter((w) => w.rank != null && w.of)
  const topThird = ranked.filter((w) => w.rank! <= Math.ceil(w.of! / 3)).length
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Windows tuned beat fixed" value={`${beat} / ${r.windows.length}`} />
        <Stat label="Windows tuned made money" value={`${positive} / ${r.windows.length}`} />
        <Stat label="Pick in the top third" value={ranked.length ? `${topThird} / ${ranked.length}` : '—'} />
        <Stat
          label="Avg pick percentile"
          value={
            ranked.length
              ? `${fmt(ranked.reduce((s, w) => s + (w.of! > 1 ? (100 * (w.of! - w.rank!)) / (w.of! - 1) : 100), 0) / ranked.length, 0)}`
              : '—'
          }
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-xs text-muted-foreground">Net per test window</p>
          <div className="h-64">
            <SeriesChart datasets={nets} fill format={inr} />
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">
            How good the pick was on unseen bars, and how much of the grid was worth picking
          </p>
          <div className="h-64">
            <SeriesChart datasets={ranks} fill format={(v) => `${fmt(v, 0)}%`} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function EngineAutotunePage() {
  const { reportId } = useParams({ from: '/engine/autotune/$reportId' })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: r, error } = useQuery({
    queryKey: ['engineAutotune', reportId],
    queryFn: () => getEngineAutotune(reportId),
  })
  usePageTitle(r ? `${r.symbol} walk-forward` : reportId)
  const queue = useQueueJob()
  const remove = useMutation({
    mutationFn: () => deleteEngineAutotune(reportId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['engineAutotunes'] })
      navigate({ to: '/engine', search: { tab: 'autotune' } })
    },
    onError: (e) => toast.error(e.message),
  })
  const [side, setSide] = useState<'oos' | 'baseline'>('oos')
  const [focus, setFocus] = useState<RunTrade | null>(null)
  const runs = useMemo(() => (r ? { oos: sideRun(r, 'oos'), baseline: sideRun(r, 'baseline') } : null), [r])
  const an = useMemo(() => (runs ? { oos: runAnalytics(runs.oos), baseline: runAnalytics(runs.baseline) } : null), [runs])

  // MAE/MFE: the stock's bars over the traded windows
  const span = runs && { start: istTime(runs.oos.summary.from).slice(0, 10), end: istTime(runs.oos.summary.to).slice(0, 10) }
  const { data: bars } = useQuery({
    queryKey: ['intradayBars', r?.symbol, r?.interval, span?.start, span?.end],
    queryFn: () => getIntradayBars(r!.symbol, r!.interval, span!),
    enabled: !!r && !!runs?.oos.summary.from,
    staleTime: 5 * 60_000,
  })
  const exc = useMemo(() => {
    const out = new Map<RunTrade, { mae: number; mfe: number } | null>()
    if (!an || !bars?.bars) return out
    const trades = an[side].trades
    excursions(trades, bars.bars).forEach((e, i) => out.set(trades[i], e))
    return out
  }, [an, bars, side])

  const back = (
    <Link to="/engine" search={{ tab: 'autotune' }} className="no-print inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeftIcon className="size-4" /> Auto-tune reports
    </Link>
  )
  if (error || !r || !runs || !an)
    return (
      <div className="space-y-4">
        {back}
        {error ? <p className="text-sm text-destructive">{error.message}</p> : <Spinner className="size-4" />}
      </div>
    )

  const a = an[side]
  const run = runs[side]
  const sized = sizingOf(r.sizing)
  const under: Dataset[] = [
    { key: 'Tuned', color: seriesColor(0), points: points(an.oos.underwater) },
    { key: 'Fixed defaults', color: seriesColor(3), points: points(an.baseline.underwater) },
  ]
  const rolling: Dataset[] = [
    { key: 'Tuned', color: seriesColor(0), points: points(an.oos.rollingSharpe) },
    { key: 'Fixed defaults', color: seriesColor(3), points: points(an.baseline.rollingSharpe) },
  ]
  const sideLabel = side === 'oos' ? 'tuned' : 'fixed defaults'
  const sidePicker = (
    <div className="no-print flex gap-1">
      {(['oos', 'baseline'] as const).map((k) => (
        <Button key={k} size="xs" variant={side === k ? 'secondary' : 'ghost'} onClick={() => setSide(k)}>
          {k === 'oos' ? 'Tuned' : 'Fixed defaults'}
        </Button>
      ))}
    </div>
  )
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {back}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-lg font-medium">
              {r.symbol} · {r.strategy} {r.interval} walk-forward
            </h1>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="outline" className="font-mono">
                {r.id}
              </Badge>
              {sized && (
                <Badge>
                  {sized.mode === 'all_in' ? 'All-in' : 'Scale qty'} · {inr(sized.capital)}
                </Badge>
              )}
              {r.job != null && (
                <Link to="/engine" search={{ tab: 'jobs' }}>
                  <Badge variant="secondary">job #{r.job}</Badge>
                </Link>
              )}
              {r.batch && (
                <Link to="/engine" search={{ tab: 'autotune', tunebatch: r.batch }}>
                  <Badge variant="secondary">batch {r.batch}</Badge>
                </Link>
              )}
              <span>
                {r.sessions[0]} → {r.sessions[1]} · {r.stats.windows} windows · created {formatDateTime(r.created)}
              </span>
            </div>
          </div>
          <div className="no-print flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={queue.isPending}
              title="Walk this stock again with the same settings on the same sessions, as a background job"
              onClick={() => queue.mutate({ kind: 'autotune', request: rewalkRequest(r) })}
            >
              {queue.isPending ? <Spinner className="size-3.5" /> : <ListPlusIcon />} Walk again
            </Button>
            <ExportMenu name={r.id} sheets={() => autotuneSheets(r)} csvSheet={2} />
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <PrinterIcon /> PDF
            </Button>
            <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
              <Trash2Icon /> Delete
            </Button>
          </div>
        </div>
      </div>

      <Section title="The walk" hint="picks, cells, executions and every window">
        <WalkForward r={r} />
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Tuned vs fixed defaults" hint={`every metric, out-of-sample · % on ${inr(an.oos.capital)} (${an.oos.capitalBasis})`}>
          <Compare t={an.oos} f={an.baseline} r={r} />
        </Section>
        <Section title="Window by window">
          <WindowCharts r={r} />
        </Section>
      </div>

      <Section title="Drawdown and consistency" hint="both sides">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Under water - % below each side's peak</p>
            <div className="h-64">
              <SeriesChart datasets={under} fill format={(v) => `${fmt(v, 2)}%`} />
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Rolling Sharpe · 63 sessions</p>
            {an.oos.rollingSharpe.length ? (
              <div className="h-64">
                <SeriesChart datasets={rolling} fill />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Needs at least 63 out-of-sample sessions.</p>
            )}
          </div>
        </div>
      </Section>

      <div className="no-print flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Everything below is for</span>
        {sidePicker}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={`Monthly returns · ${sideLabel}`}>
          <ReturnsHeatmap a={a} />
        </Section>
        <Section title={`Worst drawdowns · ${sideLabel}`} hint="peak to recovery">
          {a.drawdowns.length ? (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Peak</TableHead>
                  <TableHead>Trough</TableHead>
                  <TableHead>Recovered</TableHead>
                  <TableHead className="text-right">Depth</TableHead>
                  <TableHead className="text-right">Length</TableHead>
                  <TableHead className="text-right">Recovery</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {a.drawdowns.map((d) => (
                  <TableRow key={d.start}>
                    <TableCell className="tabular-nums">{istTime(d.start).slice(0, 10)}</TableCell>
                    <TableCell className="tabular-nums">{istTime(d.trough).slice(0, 10)}</TableCell>
                    <TableCell className="tabular-nums">
                      {d.end ? istTime(d.end).slice(0, 10) : <span className="text-destructive">not yet</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">
                      {inr(-d.depth)} · {pct(d.pct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{d.days}d</TableCell>
                    <TableCell className="text-right tabular-nums">{d.recovery == null ? '—' : `${d.recovery}d`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">Never below a previous high.</p>
          )}
        </Section>
      </div>

      <Section title={`Daily P&L and position size · ${sideLabel}`}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Daily P&L (sat-out windows are flat days)</p>
            <DailyBars daily={run.daily} />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">
              Shares per trade, at entry{sized ? ' - compounding moves it with the account' : ''}
            </p>
            <div className="h-44">
              <SeriesChart
                datasets={[{ key: 'Qty', color: seriesColor(4), points: points(dedupe(a.sizes)) }]}
                fill
                format={(v) => fmt(v, 0)}
              />
            </div>
          </div>
        </div>
      </Section>

      <Section title={`When it makes its money · ${sideLabel}`} hint="net by entry time · % = win rate">
        <div className="grid gap-6 md:grid-cols-3">
          {r.interval !== '1D' && <BucketBars title="Hour of day (IST)" rows={a.byHour} />}
          <BucketBars title="Weekday" rows={a.byWeekday} />
          <BucketBars title="Month" rows={a.byMonth} />
        </div>
      </Section>

      <Section
        title={`Trades · ${sideLabel}`}
        hint={bars ? 'MAE / MFE = worst / best open P&L while held' : 'loading bars for MAE/MFE'}
      >
        <div className="space-y-4">
          <Histogram values={a.nets} />
          <ExecutionsChart key={side} run={run as unknown as EngineRun} focus={focus} />
          <TradeLog run={run as unknown as EngineRun} a={a} exc={exc} focus={focus} onFocus={setFocus} />
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Data provenance">
          <div className="space-y-2 text-sm">
            <HistoryLine history={r.history} coverage={r.coverage && { [r.symbol]: r.coverage }} />
            {r.coverage && (
              <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Bars</dt>
                <dd>
                  {r.coverage.from} → {r.coverage.to} · {fmt(r.coverage.sessions, 0)} sessions
                </dd>
                <dt className="text-muted-foreground">Missing sessions</dt>
                <dd className={cn(r.coverage.missing?.sessions && 'text-destructive')}>
                  {r.coverage.missing ? `${r.coverage.missing.sessions} (${r.coverage.missing.from} → ${r.coverage.missing.to})` : '0'}
                </dd>
                <dt className="text-muted-foreground">Back-adjusted</dt>
                <dd>{r.coverage.adjusted?.map((x) => `${x.date} ×${fmt(x.ratio, 3)}`).join(', ') || '—'}</dd>
                <dt className="text-muted-foreground">Jumps to check</dt>
                <dd className="text-destructive">{r.coverage.jumps?.map((x) => `${x.date} ${pct(x.move * 100, 0)}`).join(', ') || '—'}</dd>
              </dl>
            )}
          </div>
        </Section>
        <Section title="How it was made">
          <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Report id</dt>
            <dd className="font-mono text-xs">{r.id}</dd>
            <dt className="text-muted-foreground">Started by</dt>
            <dd>{r.job != null ? `background job #${r.job}` : 'Run now'}</dd>
            <dt className="text-muted-foreground">Walk</dt>
            <dd>
              train {r.train} / test {r.test} sessions · min {r.min_trades} trades · switch margin {fmt(r.margin * 100, 0)}% · cost{' '}
              {r.cost_bps} bps
            </dd>
            <dt className="text-muted-foreground">Params as typed</dt>
            <dd className="font-mono text-xs">
              {Object.entries(r.params)
                .map(([k, v]) => `${k}=${v}`)
                .join(' ')}
            </dd>
            <dt className="text-muted-foreground">Fixed defaults</dt>
            <dd className="font-mono text-xs">
              {Object.entries(r.defaults)
                .map(([k, v]) => `${k}=${v}`)
                .join(' ')}
            </dd>
            <dt className="text-muted-foreground">Sizing</dt>
            <dd>{sized ? `${sized.mode === 'all_in' ? 'All-in' : 'Scale qty'} on ${inr(sized.capital)}, carried window to window` : 'Fixed qty'}</dd>
          </dl>
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">The request to walk it again</summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded bg-muted p-2">{JSON.stringify(rewalkRequest(r), null, 2)}</pre>
          </details>
        </Section>
      </div>
    </div>
  )
}
