import type { ComponentProps, Ref } from 'react'
import { IconArrowDown, IconArrowUp, IconSelector } from '@tabler/icons-react'
import { nextSort } from '@/lib/sortRows'
import type { Sort, SortDir } from '@/lib/sortRows'
import { cn } from '@/lib/utils'

// Same parts and props as components/ui/table.tsx (containerClassName, containerRef for the
// virtualizer). Row height follows --row-h, so the density setting resizes every table.

function Table({
  className,
  containerClassName,
  containerRef,
  ...props
}: ComponentProps<'table'> & { containerClassName?: string; containerRef?: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={containerRef}
      data-slot="table-container"
      className={cn('relative w-full overflow-auto', containerClassName)}
    >
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-xs tabular-nums', className)}
        {...props}
      />
    </div>
  )
}

const TableHeader = ({ className, ...props }: ComponentProps<'thead'>) => (
  <thead
    data-slot="table-header"
    className={cn('[&_tr]:border-b [&_tr]:border-border', className)}
    {...props}
  />
)

const TableBody = ({ className, ...props }: ComponentProps<'tbody'>) => (
  <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />
)

/** Totals row. */
const TableFooter = ({ className, ...props }: ComponentProps<'tfoot'>) => (
  <tfoot
    data-slot="table-footer"
    className={cn('border-t border-border bg-panel-head font-semibold [&>tr]:last:border-b-0', className)}
    {...props}
  />
)

/** `data-state="selected"` (or aria-selected) marks the active row with an accent edge. */
function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b border-border/60 transition-colors hover:bg-muted has-aria-expanded:bg-muted',
        'data-[state=selected]:bg-selection data-[state=selected]:[&>td:first-child]:shadow-[inset_2px_0_var(--accent)] aria-selected:bg-selection',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-6 bg-panel-head px-2 text-left align-middle text-[11px] font-medium tracking-[0.06em] whitespace-nowrap text-muted-foreground uppercase [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  )
}

const TableCell = ({ className, ...props }: ComponentProps<'td'>) => (
  <td
    data-slot="table-cell"
    className={cn('h-(--row-h) px-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0', className)}
    {...props}
  />
)

const TableCaption = ({ className, ...props }: ComponentProps<'caption'>) => (
  <caption
    data-slot="table-caption"
    className={cn('mt-2 text-2xs text-muted-foreground', className)}
    {...props}
  />
)

/** Same props as components/SortTh.tsx: first click `first`, second flips, third clears. */
function TableSortHead({
  label,
  k,
  sort,
  onSort,
  align = 'right',
  first = 'desc',
  className,
}: {
  label: string
  k: string
  sort: Sort
  onSort: (next: Sort) => void
  align?: 'left' | 'right'
  first?: SortDir
  className?: string
}) {
  const active = sort?.key === k
  const Icon = !active ? IconSelector : sort.dir === 'asc' ? IconArrowUp : IconArrowDown
  return (
    <TableHead
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn(align === 'right' && 'text-right', className)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onSort(nextSort(sort, k, first))
        }}
        className={cn(
          'inline-flex items-center gap-0.5 uppercase hover:text-foreground',
          align === 'right' && 'flex-row-reverse',
          active && 'text-foreground',
        )}
      >
        {label}
        <Icon className={cn('size-2.5 shrink-0', active ? 'text-accent' : 'opacity-40')} />
      </button>
    </TableHead>
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  TableSortHead,
}
