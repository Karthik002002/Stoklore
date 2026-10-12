import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from 'lucide-react'
import { nextSort } from '@/lib/sortRows'
import type { Sort, SortDir } from '@/lib/sortRows'
import { cn } from '@/lib/utils'

/** A clickable column header: highest-first (or A-Z) on the first click, flipped on the second, the
 *  table's own order on the third. The arrow shows which way it's sorted right now. */
export default function SortTh({
  label,
  k,
  sort,
  onSort,
  align = 'right',
  first = 'desc',
}: {
  label: string
  k: string
  sort: Sort
  onSort: (next: Sort) => void
  align?: 'left' | 'right'
  first?: SortDir
}) {
  const active = sort?.key === k
  const Icon = !active ? ChevronsUpDownIcon : sort.dir === 'asc' ? ArrowUpIcon : ArrowDownIcon
  return (
    <th
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('px-2 py-1 font-medium', align === 'right' ? 'text-right' : 'text-left')}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onSort(nextSort(sort, k, first))
        }}
        className={cn(
          'inline-flex items-center gap-0.5 tracking-widest uppercase hover:text-foreground',
          align === 'right' && 'flex-row-reverse',
          active && 'text-foreground',
        )}
      >
        {label}
        <Icon className={cn('size-2.5 shrink-0', !active && 'opacity-40')} />
      </button>
    </th>
  )
}
