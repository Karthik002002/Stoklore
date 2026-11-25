import { useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconDots } from '@tabler/icons-react'
import { sortRows } from '@/lib/sortRows'
import type { Sort } from '@/lib/sortRows'
import { Badge } from './badge'
import { Button } from './button'
import { DataTable } from './data-table'
import type { DataTableColumns } from './data-table'
import { Pagination } from './pagination'
import { Panel, PanelFooter, PanelHeader, PanelTitle } from './panel'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TableSortHead,
} from './table'

const meta: Meta = {
  title: 'Components/Table · DataTable · Pagination',
  parameters: { controls: { disable: true } },
}
export default meta
type Story = StoryObj

type Holding = { symbol: string; account: string; qty: number; avg: number; ltp: number; day: number }

const HOLDINGS: Holding[] = [
  { symbol: 'TATAMOTORS', account: 'Zerodha', qty: 120, avg: 712.4, ltp: 986.25, day: 3.4 },
  { symbol: 'KAYNES', account: 'Zerodha', qty: 30, avg: 3810, ltp: 5480.75, day: 4.02 },
  { symbol: 'HDFCBANK', account: 'Dhan', qty: 80, avg: 1520, ltp: 1702.9, day: 0.05 },
  { symbol: 'ZOMATO', account: 'Dhan', qty: 900, avg: 188.5, ltp: 262.15, day: -2.14 },
  { symbol: 'DIXON', account: 'Zerodha', qty: 10, avg: 16480, ltp: 15210.5, day: -1.38 },
]

const fmt = (n: number, d = 2) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
const sgn = (n: number, d = 2) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n), d)}`
const tone = (n: number) => (n > 0 ? 'text-up' : n < 0 ? 'text-down' : 'text-muted-foreground')

/** Hand-written table with SortTh-style headers, a selected row and a totals footer (Holdings). */
function HoldingsTable() {
  const [sort, setSort] = useState<Sort>({ key: 'pnl', dir: 'desc' })
  const [selected, setSelected] = useState('TATAMOTORS')
  const rows = sortRows(HOLDINGS, sort, {
    symbol: (h) => h.symbol,
    value: (h) => h.qty * h.ltp,
    pnl: (h) => (h.ltp - h.avg) * h.qty,
    day: (h) => h.day,
  })
  const total = HOLDINGS.reduce((a, h) => a + h.qty * h.ltp, 0)
  const pnl = HOLDINGS.reduce((a, h) => a + (h.ltp - h.avg) * h.qty, 0)
  return (
    <Panel className="max-w-4xl">
      <PanelHeader>
        <PanelTitle hint="click a row · click headers to sort">Holdings</PanelTitle>
      </PanelHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableSortHead
              label="Instrument"
              k="symbol"
              sort={sort}
              onSort={setSort}
              align="left"
              first="asc"
            />
            <TableHead>Account</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Avg</TableHead>
            <TableHead className="text-right">LTP</TableHead>
            <TableSortHead label="Value" k="value" sort={sort} onSort={setSort} />
            <TableSortHead label="P&L" k="pnl" sort={sort} onSort={setSort} />
            <TableSortHead label="Day" k="day" sort={sort} onSort={setSort} />
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((h) => {
            const p = (h.ltp - h.avg) * h.qty
            return (
              <TableRow
                key={h.symbol}
                data-state={h.symbol === selected ? 'selected' : undefined}
                onClick={() => setSelected(h.symbol)}
                className="cursor-pointer"
              >
                <TableCell className="font-semibold">{h.symbol}</TableCell>
                <TableCell className="text-muted-foreground">{h.account}</TableCell>
                <TableCell className="text-right">{h.qty}</TableCell>
                <TableCell className="text-right">{fmt(h.avg)}</TableCell>
                <TableCell className="text-right">{fmt(h.ltp)}</TableCell>
                <TableCell className="text-right">{fmt(h.qty * h.ltp, 0)}</TableCell>
                <TableCell className={`text-right ${tone(p)}`}>{sgn(p, 0)}</TableCell>
                <TableCell className={`text-right ${tone(h.day)}`}>{sgn(h.day)}%</TableCell>
                <TableCell className="w-8">
                  <Button variant="ghost" size="icon-xs" aria-label="Actions">
                    <IconDots />
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={5}>Total</TableCell>
            <TableCell className="text-right">{fmt(total, 0)}</TableCell>
            <TableCell className={`text-right ${tone(pnl)}`}>{sgn(pnl, 0)}</TableCell>
            <TableCell colSpan={2} />
          </TableRow>
        </TableFooter>
      </Table>
    </Panel>
  )
}

export const Basic: Story = { name: 'Table (sort · select · totals)', render: () => <HoldingsTable /> }

type Trade = {
  id: string
  date: string
  symbol: string
  side: 'Long' | 'Short'
  qty: number
  entry: number
  exit: number
  r: number
  setup: string
}

const SYMBOLS = [
  'TATAMOTORS',
  'KAYNES',
  'INFY',
  'SUZLON',
  'RELIANCE',
  'TRENT',
  'DIXON',
  'BEL',
  'IRFC',
  'POLYCAB',
]
const SETUPS = ['breakout', 'pullback', 'VCP', 'earnings gap', 'reversal']

function makeTrades(n: number): Trade[] {
  let s = 11
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647
  return Array.from({ length: n }, (_, i) => {
    const entry = 100 + r() * 4000
    const rr = Math.round((r() * 5 - 1.6) * 100) / 100
    const d = new Date(2026, 10, 24 - Math.floor(i / 3))
    return {
      id: `t${i}`,
      date: d.toISOString().slice(0, 10),
      symbol: SYMBOLS[Math.floor(r() * SYMBOLS.length)],
      side: r() > 0.25 ? 'Long' : 'Short',
      qty: Math.ceil(r() * 200),
      entry,
      exit: entry * (1 + rr * 0.03),
      r: rr,
      setup: SETUPS[Math.floor(r() * SETUPS.length)],
    }
  })
}

const COLUMNS: DataTableColumns<Trade> = [
  { accessorKey: 'date', header: 'Date', size: 96, meta: { className: 'tabular text-muted-foreground' } },
  { accessorKey: 'symbol', header: 'Symbol', size: 120, meta: { className: 'font-semibold' } },
  {
    accessorKey: 'side',
    header: 'Side',
    size: 72,
    cell: ({ getValue }) => (
      <Badge variant={getValue() === 'Long' ? 'success' : 'destructive'}>{getValue() as string}</Badge>
    ),
  },
  {
    accessorKey: 'qty',
    header: 'Qty',
    size: 64,
    meta: { className: 'text-right', headClassName: 'text-right' },
  },
  {
    accessorKey: 'entry',
    header: 'Entry',
    size: 90,
    cell: ({ getValue }) => fmt(getValue() as number),
    meta: { className: 'text-right', headClassName: 'text-right' },
  },
  {
    accessorKey: 'exit',
    header: 'Exit',
    size: 90,
    cell: ({ getValue }) => fmt(getValue() as number),
    meta: { className: 'text-right', headClassName: 'text-right' },
  },
  {
    accessorKey: 'r',
    header: 'R',
    size: 70,
    cell: ({ getValue }) => {
      const v = getValue() as number
      return <span className={tone(v)}>{sgn(v)}R</span>
    },
    meta: { className: 'text-right', headClassName: 'text-right' },
  },
  {
    accessorKey: 'setup',
    header: 'Setup',
    size: 110,
    cell: ({ getValue }) => <Badge variant="outline">{getValue() as string}</Badge>,
    enableSorting: false,
  },
]

/** The journal: sortable, resizable, row click selects. 2,000 rows → virtualized. */
function Journal({ rows, resizable }: { rows: number; resizable?: boolean }) {
  const data = useMemo(() => makeTrades(rows), [rows])
  const [selected, setSelected] = useState<string>()
  return (
    <Panel className="max-w-4xl">
      <PanelHeader>
        <PanelTitle hint={`${rows.toLocaleString('en-IN')} trades${rows >= 60 ? ' · virtualized' : ''}`}>
          Trade journal
        </PanelTitle>
        <span className="flex-1" />
        {selected && (
          <span className="text-2xs text-muted-foreground">
            selected {data.find((t) => t.id === selected)?.symbol}
          </span>
        )}
      </PanelHeader>
      <DataTable
        columns={COLUMNS}
        data={data}
        getRowId={(t) => t.id}
        sortable
        resizable={resizable}
        initialSorting={[{ id: 'date', desc: true }]}
        containerClassName="max-h-96"
        selectedRowId={selected}
        onRowClick={(t) => setSelected(t.id)}
      />
    </Panel>
  )
}

export const DataTableSortable: Story = { name: 'DataTable · sortable', render: () => <Journal rows={24} /> }
export const DataTableResizable: Story = {
  name: 'DataTable · resizable',
  render: () => <Journal rows={24} resizable />,
}
export const DataTableVirtual: Story = {
  name: 'DataTable · 2,000 rows',
  render: () => <Journal rows={2000} />,
}
export const DataTableEmpty: Story = {
  name: 'DataTable · empty',
  render: () => (
    <Panel className="max-w-4xl">
      <DataTable columns={COLUMNS} data={[]} emptyMessage="No trades in this range." />
    </Panel>
  ),
}

function Paged() {
  const all = useMemo(() => makeTrades(1842), [])
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(25)
  const rows = all.slice((page - 1) * size, page * size)
  return (
    <Panel className="max-w-4xl">
      <PanelHeader>
        <PanelTitle>Screener</PanelTitle>
      </PanelHeader>
      <DataTable columns={COLUMNS} data={rows} getRowId={(t) => t.id} containerClassName="max-h-80" />
      <PanelFooter>
        <Pagination
          className="w-full"
          page={page}
          pageSize={size}
          total={all.length}
          onPageChange={setPage}
          pageSizes={[25, 50, 100]}
          onPageSizeChange={(s) => {
            setSize(s)
            setPage(1)
          }}
        />
      </PanelFooter>
    </Panel>
  )
}

export const Paginated: Story = { name: 'Pagination', render: () => <Paged /> }
