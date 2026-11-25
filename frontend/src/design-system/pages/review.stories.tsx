import { useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconDownload, IconPlayerPlay } from '@tabler/icons-react'
import {
  Button,
  Change,
  DateRangePicker,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Label,
  Panel,
  PanelBody,
  PanelHeader,
  PanelSection,
  PanelTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Stat,
  StatStrip,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTab,
  Toggle,
  ToggleGroup,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
} from '../index'
import { AppShell } from './AppShell'
import { walk } from './data'

const meta: Meta = { title: 'Pages/Review', parameters: { fullBleed: true, controls: { disable: true } } }
export default meta
type Story = StoryObj

function FanChart({ seed }: { seed: number }) {
  const N = 60
  const W = 600
  const H = 240
  const pct = [-0.35, 0.05, 0.28, 0.5, 0.92]
  const curves = pct.map((e, k) =>
    Array.from(
      { length: N + 1 },
      (_, i) => 1 + e * (i / N) + Math.sin(i * 0.7 + k + seed) * 0.015 * Math.sqrt(i),
    ),
  )
  const lo = 0.6
  const hi = 2.0
  const X = (i: number) => (i / N) * W
  const Y = (v: number) => H - ((v - lo) / (hi - lo)) * H
  const band = (a: number[], b: number[]) =>
    `M${a.map((v, i) => `${X(i)},${Y(v)}`).join(' L')} L${b.map((_, i) => `${X(N - i)},${Y(b[N - i])}`).join(' L')}Z`
  const samples = Array.from({ length: 8 }, (_, k) => walk(seed * 13 + k, N + 1, 0.04, 1, 0.05))
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-60 w-full"
      role="img"
      aria-label="Equity fan chart"
    >
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1="0"
          x2={W}
          y1={H * f}
          y2={H * f}
          stroke="var(--border)"
          strokeDasharray="2 4"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {samples.map((s, k) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: sample paths
        <polyline
          key={k}
          points={s.map((v, i) => `${X(i)},${Y(v)}`).join(' ')}
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth=".75"
          opacity=".3"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path d={band(curves[0], curves[4])} fill="var(--accent)" opacity=".1" />
      <path d={band(curves[1], curves[3])} fill="var(--accent)" opacity=".18" />
      <line
        x1="0"
        x2={W}
        y1={Y(1)}
        y2={Y(1)}
        stroke="var(--muted-foreground)"
        strokeDasharray="3 3"
        vectorEffect="non-scaling-stroke"
        opacity=".6"
      />
      <polyline
        points={curves[2].map((v, i) => `${X(i)},${Y(v)}`).join(' ')}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.75"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

const ACC = ['Swing', 'Intraday', 'Paper', 'Algo']
const RHO: (number | null)[][] = [
  [1, 0.31, 0.72, -0.08],
  [0.31, 1, 0.12, null],
  [0.72, 0.12, 1, 0.05],
  [-0.08, null, 0.05, 1],
]

function Simulation() {
  const [mode, setMode] = useState('single')
  const [runs, setRuns] = useState('10000')
  const [model, setModel] = useState('bootstrap')
  const [sizing, setSizing] = useState(['pct'])
  const [range, setRange] = useState({ from: '2026-04-01', to: '2026-11-24' })
  const [seed, setSeed] = useState(1)
  const [busy, setBusy] = useState(false)
  const run = () => {
    setBusy(true)
    setTimeout(() => {
      setSeed((s) => s + 1)
      setBusy(false)
      toast.success(`${Number(runs).toLocaleString('en-IN')} runs in 6 ms`)
    }, 450)
  }
  const pctl = useMemo(
    () => [
      ['P5', 6.5, -8.9, -31.2, 9],
      ['P25', 10.5, 1.0, -19.4, 6],
      ['P50', 12.8, 5.2, -13.1, 5],
      ['P75', 15.0, 9.1, -9.0, 4],
      ['P95', 19.2, 15.8, -5.6, 3],
    ],
    [],
  )
  return (
    <AppShell page="Trade Simulation" className="flex flex-col gap-1">
      <Tabs value={mode} onValueChange={(v) => setMode(v as string)} className="gap-1">
        <div className="flex items-center gap-2">
          <TabsList variant="line" className="flex-1">
            <TabsTab value="single">Single account</TabsTab>
            <TabsTab value="multiple">Multiple accounts</TabsTab>
          </TabsList>
          <Button variant="ghost" size="xs">
            <IconDownload />
            CSV
          </Button>
          <Button variant="ghost" size="xs" onClick={() => window.print()}>
            PDF
          </Button>
        </div>
      </Tabs>
      <div className="grid gap-1 xl:grid-cols-[290px_minmax(0,1fr)]">
        <Panel>
          <PanelHeader>
            <PanelTitle>Config</PanelTitle>
          </PanelHeader>
          <PanelBody className="flex flex-col gap-2.5">
            <Field>
              <FieldLabel>Account</FieldLabel>
              <Select defaultValue="swing">
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="swing">Zerodha · Swing (144 trades)</SelectItem>
                  <SelectItem value="intra">Dhan · Intraday (402 trades)</SelectItem>
                  <SelectItem value="paper">Paper (88 trades)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Trades logged between</FieldLabel>
              <DateRangePicker from={range.from} to={range.to} onChange={setRange} className="w-full" />
            </Field>
            <Field>
              <FieldLabel>Model</FieldLabel>
              <ToggleGroup
                value={[model]}
                onValueChange={(v) => v[0] && setModel(v[0] as string)}
                className="w-full *:flex-1"
              >
                <Toggle value="bootstrap">Bootstrap</Toggle>
                <Toggle value="shuffle">Shuffle</Toggle>
              </ToggleGroup>
              <FieldDescription>
                {model === 'bootstrap' ? 'Draws with replacement' : 'Reorders the same trades'}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Position sizing</FieldLabel>
              <ToggleGroup
                value={sizing}
                onValueChange={(v) => v[0] && setSizing(v as string[])}
                className="w-full *:flex-1"
              >
                <Toggle value="logged">As logged</Toggle>
                <Toggle value="fixed">Fixed ₹</Toggle>
                <Toggle value="pct">% equity</Toggle>
              </ToggleGroup>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field>
                <FieldLabel>Runs</FieldLabel>
                <Input numeric value={runs} onChange={(e) => setRuns(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel>Start equity</FieldLabel>
                <Input numeric defaultValue="10,00,000" />
              </Field>
            </div>
            <Label>
              <Switch defaultChecked />
              Ruin at −50%
            </Label>
            <Button onClick={run} disabled={busy}>
              {busy ? <Spinner className="size-3 text-current" /> : <IconPlayerPlay />}
              Run simulation
            </Button>
          </PanelBody>
        </Panel>
        <div className="flex flex-col gap-1">
          <StatStrip bordered>
            <Stat label="Median end" value="₹12.8L" tone="up" delta="+28%" deltaTone="up" />
            <Stat label="P5 end" value="₹6.5L" tone="down" delta="−35%" deltaTone="down" />
            <Stat label="Risk of ruin" value="2.1%" tone="warning" hint="hit −50% at least once" />
            <Stat label="Median max DD" value="−13.1%" />
            <Stat label="Expectancy" value="0.42R" hint="144 closed trades" />
          </StatStrip>
          <Panel>
            <PanelHeader>
              <PanelTitle hint={`${Number(runs).toLocaleString('en-IN')} runs · P5–P95 band, P25–P75 inner`}>
                Equity paths
              </PanelTitle>
            </PanelHeader>
            <FanChart seed={seed} />
          </Panel>
          <div className="grid gap-1 lg:grid-cols-[minmax(0,1fr)_300px]">
            <Panel>
              <PanelHeader>
                <PanelTitle>Percentiles</PanelTitle>
              </PanelHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pctl</TableHead>
                    <TableHead className="text-right">End equity</TableHead>
                    <TableHead className="text-right">CAGR</TableHead>
                    <TableHead className="text-right">Max DD</TableHead>
                    <TableHead className="text-right">Worst streak</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pctl.map(([p, e, c, d, s]) => (
                    <TableRow key={p} data-state={p === 'P50' ? 'selected' : undefined}>
                      <TableCell className="font-semibold">{p}</TableCell>
                      <TableCell className="text-right">₹{e}L</TableCell>
                      <TableCell className="text-right">
                        <Change value={c as number} digits={1} />
                      </TableCell>
                      <TableCell className="text-right text-down">{d}%</TableCell>
                      <TableCell className="text-right">{s} losses</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
            <Panel>
              <PanelHeader>
                <PanelTitle hint="daily P&L, shared days">Correlation</PanelTitle>
              </PanelHeader>
              <PanelBody>
                <TooltipProvider>
                  <div className="grid grid-cols-[48px_repeat(4,1fr)] gap-0.5 text-2xs">
                    <span />
                    {ACC.map((a) => (
                      <span key={a} className="truncate text-center text-muted-foreground">
                        {a}
                      </span>
                    ))}
                    {RHO.map((r, i) => (
                      <div key={ACC[i]} className="contents">
                        <span className="self-center truncate text-muted-foreground">{ACC[i]}</span>
                        {r.map((v, j) =>
                          v == null ? (
                            <Tooltip key={ACC[j]}>
                              <TooltipTrigger className="h-8 rounded-xs bg-[repeating-linear-gradient(45deg,var(--panel-head)_0_4px,var(--muted)_4px_8px)] text-muted-foreground">
                                n&lt;10
                              </TooltipTrigger>
                              <TooltipContent>Fewer than 10 shared trading days</TooltipContent>
                            </Tooltip>
                          ) : (
                            <span
                              key={ACC[j]}
                              className="tabular grid h-8 place-items-center rounded-xs"
                              style={{
                                background: `color-mix(in oklab, var(--${v >= 0 ? 'accent' : 'down'}) ${Math.abs(v) * 70}%, var(--panel-head))`,
                              }}
                            >
                              {v.toFixed(2)}
                            </span>
                          ),
                        )}
                      </div>
                    ))}
                  </div>
                </TooltipProvider>
              </PanelBody>
              <PanelSection>Read</PanelSection>
              <PanelBody className="text-2xs text-muted-foreground">
                Swing and Paper move together (0.72): paper isn't diversifying you.
              </PanelBody>
            </Panel>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

export const Simulation_: Story = { name: 'Trade simulation', render: () => <Simulation /> }
