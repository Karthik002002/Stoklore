import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconAlertTriangle, IconRefresh, IconWallet } from '@tabler/icons-react'
import {
  Badge,
  Button,
  Change,
  DataTable,
  Meter,
  Panel,
  PanelBody,
  PanelHeader,
  PanelSection,
  PanelTitle,
  Progress,
  ResultsBadge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stat,
  StatStrip,
  SurveillanceBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../index'
import type { DataTableColumns } from '../index'
import { AppShell } from './AppShell'
import { HOLDINGS, POSITIONS } from './data'
import type { Holding } from './data'

const meta: Meta = { title: 'Pages/Portfolio', parameters: { fullBleed: true, controls: { disable: true } } }
export default meta
type Story = StoryObj

const INR = (v: number, d = 2) =>
  v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })

const total = HOLDINGS.reduce((a, h) => a + h.qty * h.ltp, 0)
const invested = HOLDINGS.reduce((a, h) => a + h.qty * h.avg, 0)

const COLS: DataTableColumns<Holding> = [
  { accessorKey: 'symbol', header: 'Instrument', size: 130, meta: { className: 'font-semibold' } },
  { accessorKey: 'account', header: 'Account', size: 90, meta: { className: 'text-muted-foreground' } },
  {
    accessorKey: 'qty',
    header: 'Qty',
    size: 60,
    meta: { className: 'text-right', headClassName: 'text-right' },
  },
  {
    accessorKey: 'avg',
    header: 'Avg',
    size: 90,
    cell: ({ getValue }) => INR(getValue() as number),
    meta: { className: 'text-right', headClassName: 'text-right' },
  },
  {
    accessorKey: 'ltp',
    header: 'LTP',
    size: 90,
    cell: ({ getValue }) => INR(getValue() as number),
    meta: { className: 'text-right', headClassName: 'text-right' },
  },
  {
    id: 'value',
    header: 'Value',
    size: 100,
    accessorFn: (h) => h.qty * h.ltp,
    cell: ({ getValue }) => INR(getValue() as number, 0),
    meta: { className: 'text-right', headClassName: 'text-right' },
  },
  {
    id: 'pnl',
    header: 'P&L',
    size: 130,
    accessorFn: (h) => (h.ltp - h.avg) * h.qty,
    cell: ({ row }) => {
      const h = row.original
      return (
        <span>
          <Change value={(h.ltp - h.avg) * h.qty} unit="₹" digits={0} />{' '}
          <Change value={((h.ltp - h.avg) / h.avg) * 100} className="text-2xs" />
        </span>
      )
    },
    meta: { className: 'text-right', headClassName: 'text-right' },
  },
  {
    accessorKey: 'pct',
    header: 'Day',
    size: 70,
    cell: ({ getValue }) => <Change value={getValue() as number} />,
    meta: { className: 'text-right', headClassName: 'text-right' },
  },
  {
    id: 'weight',
    header: 'Weight',
    size: 120,
    accessorFn: (h) => (h.qty * h.ltp) / total,
    cell: ({ getValue }) => {
      const w = (getValue() as number) * 100
      return (
        <span className="flex items-center gap-1.5">
          <Progress value={w * 2} size="sm" className="w-14" />
          <span className="tabular text-2xs">{w.toFixed(1)}%</span>
        </span>
      )
    },
  },
]

function Holdings() {
  const [sel, setSel] = useState<string>()
  return (
    <AppShell page="Holdings" className="flex flex-col gap-1">
      <Panel>
        <PanelHeader>
          <PanelTitle>Holdings</PanelTitle>
          <Select defaultValue="all">
            <SelectTrigger size="sm" className="w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              <SelectItem value="z">Zerodha</SelectItem>
              <SelectItem value="d">Dhan</SelectItem>
            </SelectContent>
          </Select>
          <span className="flex-1" />
          <span className="text-2xs text-muted-foreground">synced 2m ago</span>
          <Button variant="ghost" size="xs">
            <IconRefresh />
            Sync
          </Button>
        </PanelHeader>
        <StatStrip>
          <Stat label="Invested" value={`₹${INR(invested, 0)}`} icon={IconWallet} />
          <Stat label="Current" value={`₹${INR(total, 0)}`} />
          <Stat
            label="Total P&L"
            value={`+₹${INR(total - invested, 0)}`}
            tone="up"
            delta={`+${(((total - invested) / invested) * 100).toFixed(1)}%`}
            deltaTone="up"
          />
          <Stat label="Day P&L" value="+₹6,842" tone="up" delta="+0.72%" deltaTone="up" />
          <Stat label="Holdings" value={HOLDINGS.length} hint="2 accounts" />
        </StatStrip>
        <DataTable
          columns={COLS}
          data={HOLDINGS}
          getRowId={(h) => h.symbol}
          sortable
          initialSorting={[{ id: 'value', desc: true }]}
          selectedRowId={sel}
          onRowClick={(h) => setSel(h.symbol)}
        />
      </Panel>
    </AppShell>
  )
}

export const Holdings_: Story = { name: 'Holdings', render: () => <Holdings /> }

function BookRisk() {
  const bySector = POSITIONS.reduce<Record<string, number>>((a, p) => {
    a[p.sector] = (a[p.sector] ?? 0) + Math.abs(p.qty * p.ltp)
    return a
  }, {})
  const gross = Object.values(bySector).reduce((a, b) => a + b, 0)
  return (
    <AppShell page="Book risk" className="grid gap-1 xl:grid-cols-[340px_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        <Panel>
          <PanelHeader>
            <PanelTitle>Limits</PanelTitle>
          </PanelHeader>
          <PanelBody className="flex flex-col gap-3">
            <Meter label="Open risk" value={9820} max={15000} limit={12000} />
            <Meter label="Gross exposure" value={112} max={100} limit={80} format={(v) => `${v}%`} />
            <Meter label="Correlated heat" value={2.9} max={6} limit={4} format={(v) => `${v}R`} />
            <Meter label="Day loss" value={1200} max={10000} limit={7500} />
          </PanelBody>
          <PanelSection>Sector concentration</PanelSection>
          <PanelBody className="flex flex-col gap-1.5">
            {Object.entries(bySector)
              .sort((a, b) => b[1] - a[1])
              .map(([s, v]) => {
                const pct = (v / gross) * 100
                return (
                  <div key={s} className="grid grid-cols-[96px_1fr_40px] items-center gap-2 text-2xs">
                    <span>{s}</span>
                    <Progress value={pct} limit={35} tone={pct > 35 ? 'warning' : 'accent'} />
                    <span className="tabular text-right">{pct.toFixed(0)}%</span>
                  </div>
                )
              })}
          </PanelBody>
        </Panel>
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-subtle px-2.5 py-2 text-2xs">
          <IconAlertTriangle className="mt-px size-3.5 shrink-0 text-warning" />
          <span>
            Electronics is over your 35% sector limit. KAYNES and DIXON move together (ρ 0.71 on daily
            P&amp;L).
          </span>
        </div>
      </div>
      <Panel>
        <PanelHeader>
          <PanelTitle hint="if every stop is hit">Position risk</PanelTitle>
        </PanelHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Instrument</TableHead>
              <TableHead>Sector</TableHead>
              <TableHead className="text-right">Exposure</TableHead>
              <TableHead className="text-right">To stop</TableHead>
              <TableHead className="text-right">Risk ₹</TableHead>
              <TableHead className="text-right">β</TableHead>
              <TableHead>Flags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {POSITIONS.map((p) => {
              const risk = Math.abs((p.ltp - p.sl) * p.qty)
              const dist = (Math.abs(p.ltp - p.sl) / p.ltp) * 100
              return (
                <TableRow key={p.symbol}>
                  <TableCell className="font-semibold">{p.symbol}</TableCell>
                  <TableCell className="text-muted-foreground">{p.sector}</TableCell>
                  <TableCell className="text-right">₹{INR(Math.abs(p.qty * p.ltp), 0)}</TableCell>
                  <TableCell className={`text-right ${dist < 4 ? 'text-warning' : ''}`}>
                    {dist.toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-right text-down">₹{INR(risk, 0)}</TableCell>
                  <TableCell className={`text-right ${p.beta > 1.5 ? 'text-warning' : ''}`}>
                    {p.beta.toFixed(1)}
                  </TableCell>
                  <TableCell className="flex gap-1">
                    {p.symbol === 'SUZLON' && <SurveillanceBadge label="ASM I" />}
                    {p.symbol === 'KAYNES' && <ResultsBadge days={2} />}
                    {p.qty < 0 && <Badge variant="outline">short</Badge>}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Panel>
    </AppShell>
  )
}

export const BookRisk_: Story = { name: 'Book risk', render: () => <BookRisk /> }
