import { useRef } from 'react'
import {
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

// One table. Column definitions in, a scrollable table out - headless TanStack Table for the row
// model and TanStack Virtual for the windowing, rendered through the same ui/table primitives
// every hand-written table in this app already uses, so adopting it changes behaviour and not
// the way anything looks.
//
// Deliberately narrow: sorting and virtualization, nothing else. No pagination, no selection, no
// column visibility - none of this app's tables ask for them, and a shared component grows props
// far faster than it grows callers.

const FEATURES = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
})

// Below this many rows, windowing costs more than it saves: the measuring pass and the spacer
// rows buy nothing when the browser was going to lay out thirty <tr>s anyway.
const VIRTUALIZE_FROM = 60

/**
 * @param columns  TanStack column defs. `meta.className` lands on every cell of the column and
 *                 `meta.headClassName` on its header - which is where a caller puts right
 *                 alignment, a sticky first column, or a highlighted TTM column.
 * @param sortable Turns on header sorting; individual columns opt out with `enableSorting: false`.
 */
export default function DataTable({
  columns,
  data,
  getRowId,
  sortable = false,
  initialSorting,
  emptyMessage = 'Nothing to show.',
  containerClassName,
  estimateRowHeight = 28,
  virtualizeFrom = VIRTUALIZE_FROM,
}) {
  const scrollRef = useRef(null)

  const table = useTable({
    features: FEATURES,
    columns,
    data,
    getRowId,
    enableSorting: sortable,
    initialState: initialSorting ? { sorting: initialSorting } : undefined,
  })

  const rows = table.getRowModel().rows
  const virtualized = rows.length >= virtualizeFrom

  // Spacer rows rather than absolutely positioned ones: a <tr> taken out of flow stops sharing the
  // table's column widths, and every table here has a sticky first column that depends on them.
  // measureElement means a row that wrapped onto two lines is measured, not guessed at.
  const virtualizer = useVirtualizer({
    count: rows.length,
    enabled: virtualized,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 12,
  })

  const items = virtualized ? virtualizer.getVirtualItems() : []
  const before = items.length ? items[0].start : 0
  const after = items.length ? virtualizer.getTotalSize() - items[items.length - 1].end : 0
  const drawn = virtualized ? items.map((item) => [rows[item.index], item.index]) : rows.map((r, i) => [r, i])

  return (
    <Table containerRef={scrollRef} containerClassName={containerClassName}>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="hover:bg-transparent">
            {group.headers.map((header) => {
              const meta = header.column.columnDef.meta ?? {}
              const canSort = header.column.getCanSort?.()
              const sorted = header.column.getIsSorted?.()
              const Icon =
                sorted === 'asc' ? ArrowUpIcon : sorted === 'desc' ? ArrowDownIcon : ArrowUpDownIcon
              const label = <table.FlexRender header={header} />
              return (
                <TableHead key={header.id} className={cn('sticky top-0 z-10 bg-card', meta.headClassName)}>
                  {canSort ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn(
                        'flex items-center gap-1 whitespace-nowrap',
                        sorted ? 'text-foreground' : 'hover:text-foreground',
                        meta.headClassName?.includes('text-right') && 'ml-auto',
                      )}
                    >
                      {label}
                      <Icon className={cn('size-3', !sorted && 'opacity-30')} />
                    </button>
                  ) : (
                    label
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        ))}
      </TableHeader>

      <TableBody>
        {rows.length === 0 && (
          <TableRow className="hover:bg-transparent">
            <TableCell
              colSpan={table.getAllLeafColumns().length}
              className="py-8 text-center text-muted-foreground"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        )}
        {before > 0 && <tr style={{ height: before }} aria-hidden />}
        {drawn.map(([row, index]) => (
          <TableRow
            key={row.id}
            data-index={index}
            ref={virtualized ? virtualizer.measureElement : undefined}
          >
            {row.getAllCells().map((cell) => (
              <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                <table.FlexRender cell={cell} />
              </TableCell>
            ))}
          </TableRow>
        ))}
        {after > 0 && <tr style={{ height: after }} aria-hidden />}
      </TableBody>
    </Table>
  )
}
