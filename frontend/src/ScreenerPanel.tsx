import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLinkIcon, MinusCircleIcon, PlusCircleIcon } from 'lucide-react'
import DataTable from '@/components/DataTable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { cellChange } from '@/lib/screenerTable'
import type { DataTableColumns } from '@/components/DataTable'
import type { ScreenerDocument, ScreenerTable } from '@/services/api'
import { getScreenerData } from '@/services/api'

// Values arrive as display strings ("1,027", "-2,145", "8%", "₹ 590") rather than numbers - one
// screener table mixes ₹ Cr, %, and per-share units across its rows, so the source formatting is
// what carries the meaning. Only the sign is interpreted, for colour.
const isNegative = (v: unknown) => typeof v === 'string' && v.trim().startsWith('-')

// The quarter-on-quarter delta is drawn for the shareholding tab only. Everywhere else the rows
// mix units within one table (₹ Cr against %, against per-share), so a column of deltas would be
// four different quantities; shareholding is the one table where every row asks the same question
// - what share of the company, held by whom - once a quarter.

type StatementRow = ScreenerTable['rows'][number]

function StatementTable({ table, showChange }: { table: ScreenerTable; showChange?: boolean }) {
  // Pivoted: a row per line item, a column per period, so the period index lives on the column and
  // not on the row - which is also what makes "vs the previous quarter" a column-local question.
  const columns = useMemo<DataTableColumns<StatementRow>>(
    () => [
      {
        id: 'label',
        header: 'Breakdown',
        size: 200,
        cell: ({ row }) => row.original.label,
        meta: { className: 'sticky left-0 z-[1] bg-card font-medium', headClassName: 'left-0 z-20' },
      },
      ...table.periods.map((period, i): DataTableColumns<StatementRow>[number] => ({
        id: `${period}-${i}`,
        header: period,
        size: 104,
        cell: ({ row }) => {
          const value = row.original.values[i]
          // Screener prints oldest quarter first, so the predecessor is the cell to the left.
          const change = showChange && i > 0 ? cellChange(value, row.original.values[i - 1]) : null
          return (
            <>
              <span className={isNegative(value) ? 'text-down' : undefined}>
                {value || <span className="text-muted-foreground">—</span>}
              </span>
              {change && (
                <span className={`block text-[11px] ${change.up ? 'text-up' : 'text-down'}`}>
                  {change.text}
                </span>
              )}
            </>
          )
        },
        meta: { className: 'text-right', headClassName: 'text-right' },
      })),
    ],
    [table, showChange],
  )

  return (
    <DataTable
      columns={columns}
      data={table.rows}
      getRowId={(row) => row.label}
      resizable
      containerClassName="max-h-[460px] rounded-xl border bg-card"
    />
  )
}

// Screener's own rule-based commentary on the company - not advice, and not derived from anything
// this app computes, so it's labelled with its source.
function ProsCons({ pros, cons }: { pros: string[]; cons: string[] }) {
  if (!pros.length && !cons.length) return null
  const columns: [string, string[], typeof PlusCircleIcon, string][] = [
    ['Pros', pros, PlusCircleIcon, 'text-up'],
    ['Cons', cons, MinusCircleIcon, 'text-down'],
  ]
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {columns.map(([title, items, Icon, tone]) =>
        items.length === 0 ? null : (
          <div key={title} className="rounded-xl border bg-card p-4">
            <p className={`mb-2 flex items-center gap-1.5 text-sm font-medium ${tone}`}>
              <Icon className="size-4" /> {title}
            </p>
            <ul className="space-y-1.5">
              {items.map((text, i) => (
                <li key={i} className="text-sm text-muted-foreground">
                  {text}
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
    </div>
  )
}

const DOCS_PREVIEW = 6

function DocumentGroup({ title, items }: { title: string; items: ScreenerDocument[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? items : items.slice(0, DOCS_PREVIEW)
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium">
        {title}
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          {items.length}
        </Badge>
      </p>
      <ul className="space-y-2">
        {visible.map((doc, i) => (
          <li key={i}>
            <a
              href={doc.url}
              target="_blank"
              rel="noreferrer"
              className="group flex items-start gap-1.5 text-sm hover:underline"
            >
              <span className="min-w-0">
                {doc.title}
                {doc.detail && (
                  <span className="mt-0.5 block text-xs text-muted-foreground no-underline">
                    {doc.detail}
                  </span>
                )}
              </span>
              <ExternalLinkIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
            </a>
          </li>
        ))}
      </ul>
      {items.length > DOCS_PREVIEW && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 px-2 text-xs"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : `Show all ${items.length}`}
        </Button>
      )}
    </div>
  )
}

export default function ScreenerPanel({ symbol }: { symbol: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['screener', symbol],
    queryFn: () => getScreenerData(symbol),
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border bg-card py-16 text-muted-foreground">
        <Spinner className="size-4" /> Loading screener data…
      </div>
    )
  }

  if (error || !data) {
    return (
      <p className="rounded-xl border bg-card py-16 text-center text-sm text-muted-foreground">
        No screener.in page for {symbol}.
      </p>
    )
  }

  const tableEntries = Object.entries(data.tables ?? {})
  const documentEntries = Object.entries(data.documents ?? {})

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">{data.name}</span>
          {/* Broad sector > sector > broad industry > industry; the last is the most specific. */}
          {data.industry?.map((tag, i) => (
            <Badge key={i} variant="secondary" className="text-[10px]">
              {tag}
            </Badge>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          render={<a href={data.url} target="_blank" rel="noreferrer" />}
        >
          screener.in <ExternalLinkIcon className="size-3" />
        </Button>
      </div>

      {data.ratios?.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {data.ratios.map((r) => (
            <div key={r.label} className="rounded-xl border bg-card p-3">
              <p className="text-xs text-muted-foreground">{r.label}</p>
              <p className="mt-1 font-semibold tabular-nums">{r.value}</p>
            </div>
          ))}
        </div>
      )}

      <ProsCons pros={data.pros ?? []} cons={data.cons ?? []} />

      {(data.about || data.keyPoints) && (
        <div className="rounded-xl border bg-card p-4">
          {data.about && <p className="text-sm text-muted-foreground">{data.about}</p>}
          {data.keyPoints && (
            <>
              <p className="mt-3 text-sm font-medium">Key points</p>
              <p className="mt-1 text-sm text-muted-foreground">{data.keyPoints}</p>
            </>
          )}
        </div>
      )}

      {tableEntries.length > 0 && (
        <Tabs defaultValue={tableEntries[0][0]}>
          {/* Six statement tabs overflow a narrow viewport - scroll the strip rather than
              wrapping it, which would break the sliding indicator's absolute positioning. */}
          <TabsList className="max-w-full self-start overflow-x-auto">
            <TabsIndicator />
            {tableEntries.map(([id, table]) => (
              <TabsTab key={id} value={id}>
                {table.title}
              </TabsTab>
            ))}
          </TabsList>
          {tableEntries.map(([id, table]) => (
            <TabsPanel key={id} value={id} className="mt-3">
              {id === 'shareholding' && (
                <p className="mb-2 text-xs text-muted-foreground">
                  The small figure under each cell is the change from the previous quarter — percentage points
                  of shares outstanding for the holder rows, shareholders for the count.
                </p>
              )}
              <StatementTable table={table} showChange={id === 'shareholding'} />
            </TabsPanel>
          ))}
        </Tabs>
      )}

      {documentEntries.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {documentEntries.map(([title, items]) => (
            <DocumentGroup key={title} title={title} items={items} />
          ))}
        </div>
      )}
    </div>
  )
}
