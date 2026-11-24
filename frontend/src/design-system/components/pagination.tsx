import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { pageRange, rangeLabel } from './pageRange'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'

type PaginationProps = {
  /** 1-based. */
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  /** Shows a rows-per-page select when given. */
  pageSizes?: number[]
  onPageSizeChange?: (size: number) => void
  className?: string
}

/** "1–25 of 1,842 · ‹ 1 … 4 5 6 … 74 › · 25 / page". New - the app has no pager yet. */
function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  pageSizes,
  onPageSizeChange,
  className,
}: PaginationProps) {
  const count = Math.max(1, Math.ceil(total / pageSize))
  return (
    <nav
      aria-label="Pagination"
      data-slot="pagination"
      className={cn('flex flex-wrap items-center gap-2 text-2xs text-muted-foreground', className)}
    >
      <span className="tabular">{rangeLabel(page, pageSize, total)}</span>
      <span className="flex-1" />
      {pageSizes && onPageSizeChange && (
        <Select value={pageSize} onValueChange={(v) => v != null && onPageSizeChange(Number(v))}>
          <SelectTrigger size="sm" aria-label="Rows per page" className="w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizes.map((s) => (
              <SelectItem key={s} value={s}>
                {s} / page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <IconChevronLeft />
        </Button>
        {pageRange(page, count).map((p, i) =>
          p === 'gap' ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: gaps have no identity of their own
            <span key={`gap${i}`} className="w-5 text-center">
              …
            </span>
          ) : (
            <Button
              key={p}
              variant={p === page ? 'secondary' : 'ghost'}
              size="xs"
              aria-current={p === page ? 'page' : undefined}
              className={cn(
                'tabular min-w-5.5 justify-center px-1',
                p === page && 'text-foreground shadow-[inset_0_-2px_var(--accent)]',
              )}
              onClick={() => onPageChange(p)}
            >
              {p}
            </Button>
          ),
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Next page"
          disabled={page >= count}
          onClick={() => onPageChange(page + 1)}
        >
          <IconChevronRight />
        </Button>
      </div>
    </nav>
  )
}

export { Pagination }
export type { PaginationProps }
