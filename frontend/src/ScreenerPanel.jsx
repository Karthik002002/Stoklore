import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLinkIcon, MinusCircleIcon, PlusCircleIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { getScreenerData } from '@/services/api'

// Values arrive as display strings ("1,027", "-2,145", "8%", "₹ 590") rather than numbers - one
// screener table mixes ₹ Cr, %, and per-share units across its rows, so the source formatting is
// what carries the meaning. Only the sign is interpreted, for colour.
const isNegative = (v) => typeof v === 'string' && v.trim().startsWith('-')

function StatementTable({ table }) {
  return (
    <Table containerClassName="max-h-[460px] rounded-xl border bg-card">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="sticky top-0 left-0 z-20 bg-card">Breakdown</TableHead>
          {table.periods.map((p) => (
            <TableHead key={p} className="sticky top-0 z-10 bg-card text-right whitespace-nowrap">
              {p}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {table.rows.map((row) => (
          <TableRow key={row.label}>
            <TableCell className="sticky left-0 z-[1] bg-card whitespace-nowrap font-medium">
              {row.label}
            </TableCell>
            {row.values.map((v, i) => (
              <TableCell
                key={i}
                className={`text-right tabular-nums whitespace-nowrap ${isNegative(v) ? 'text-down' : ''}`}
              >
                {v || <span className="text-muted-foreground">—</span>}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// Screener's own rule-based commentary on the company - not advice, and not derived from anything
// this app computes, so it's labelled with its source.
function ProsCons({ pros, cons }) {
  if (!pros.length && !cons.length) return null
  const columns = [
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

function DocumentGroup({ title, items }) {
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

export default function ScreenerPanel({ symbol }) {
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
              <StatementTable table={table} />
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
