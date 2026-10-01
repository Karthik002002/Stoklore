// Chart scans: flip a list of stocks one chart at a time in the chart modal (components/ChartModal)
// and mark each A/B/C. /scans is the history plus "scan a watchlist"; /scans/$scanId reviews one
// scan by priority - open any marked stock's chart to trade it or set an alert, save the A/B picks
// to a watchlist, or rescan just them.
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeftIcon, PlayIcon, ScanEyeIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { ChartButton, PRIORITY, resumeScan, startScan } from '@/components/ChartModal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime, inr } from '@/lib/format'
import { usePageTitle } from '@/lib/usePageTitle'
import { cn } from '@/lib/utils'
import { deleteScan, getScan, getScans, getWatchlist, scanToWatchlist } from '@/services/api'
import type { ScanMark, ScanPriority } from '@/services/api'

const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** Pick a watchlist and scan it, in its own order. */
function ScanWatchlist() {
  const { data: rows = [] } = useQuery({ queryKey: ['watchlist'], queryFn: getWatchlist })
  const lists = useMemo(() => {
    const by = new Map<string, string[]>()
    for (const r of rows) by.set(r.list_name, [...(by.get(r.list_name) ?? []), r.symbol])
    return [...by.entries()]
  }, [rows])
  const [list, setList] = useState<string | null>(null)
  const chosen = lists.find(([n]) => n === list) ?? lists[0]
  if (!lists.length)
    return <p className="text-sm text-muted-foreground">No watchlists yet - add stocks to one from the home page.</p>
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={chosen?.[0] ?? ''} onValueChange={(v) => setList(v as string)}>
        <SelectTrigger size="sm" className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {lists.map(([name, syms]) => (
            <SelectItem key={name} value={name}>
              {name} · {syms.length}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" disabled={!chosen} onClick={() => chosen && startScan(`${chosen[0]} · ${today()}`, `watchlist:${chosen[0]}`, chosen[1])}>
        <PlayIcon /> Scan {chosen?.[1].length ?? 0} stocks
      </Button>
      <span className="text-xs text-muted-foreground">
        Or use <PlayIcon className="inline size-3" /> Scan on any stock table to scan exactly the rows it shows.
      </span>
    </div>
  )
}

export function ScansList() {
  usePageTitle('Scans')
  const queryClient = useQueryClient()
  const { data: scans = [], isPending } = useQuery({ queryKey: ['scans'], queryFn: getScans })
  const remove = useMutation({
    mutationFn: deleteScan,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scans'] }),
    onError: (e) => toast.error(e.message),
  })
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <ScanEyeIcon className="size-4" /> Scans
        </h1>
        <p className="text-sm text-muted-foreground">
          A list of stocks, one chart at a time: <kbd>→</kbd> or the timer flips, <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> marks
          A/B/C, <kbd>N</kbd> adds a note. Marks are saved as you go.
        </p>
      </div>
      <section className="space-y-2 rounded-xl border bg-card p-4">
        <p className="text-sm font-medium">Scan a watchlist</p>
        <ScanWatchlist />
      </section>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scan</TableHead>
              <TableHead>From</TableHead>
              <TableHead className="text-right">Progress</TableHead>
              <TableHead>Marked</TableHead>
              <TableHead>Started</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center">
                  <Spinner className="inline size-4" />
                </TableCell>
              </TableRow>
            ) : !scans.length ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  No scans yet.
                </TableCell>
              </TableRow>
            ) : (
              scans.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link to="/scans/$scanId" params={{ scanId: String(s.id) }} className="font-medium hover:underline">
                      {s.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.source.replace(/^watchlist:/, 'watchlist ')}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.finished_at ? <Badge variant="secondary">done · {s.symbols.length}</Badge> : `${s.position + 1} / ${s.symbols.length}`}
                  </TableCell>
                  <TableCell>
                    <span className="flex gap-1 font-mono text-[11px]">
                      {(['A', 'B', 'C'] as const).map((p) => (
                        <span key={p} className={cn('rounded border px-1', PRIORITY[p].className)}>
                          {p} {s[p.toLowerCase() as 'a' | 'b' | 'c']}
                        </span>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(s.created_at)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => resumeScan(s.id)}>
                      <PlayIcon /> {s.finished_at ? 'Scan again' : 'Resume'}
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Delete scan" onClick={() => remove.mutate(s.id)}>
                      <Trash2Icon />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function MarkCard({ m, onOpen }: { m: ScanMark; onOpen: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border p-2 text-sm">
      <ChartButton symbol={m.symbol} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <button type="button" onClick={onOpen} className="font-semibold hover:underline" title="Open in the scan">
            {m.symbol}
          </button>
          {m.price != null && <span className="text-xs text-muted-foreground">at {inr(m.price)}</span>}
        </div>
        {m.note && <p className="text-xs text-muted-foreground">{m.note}</p>}
      </div>
    </div>
  )
}

export function ScanReview() {
  const { scanId } = useParams({ from: '/scans/$scanId' })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const id = Number(scanId)
  const { data: scan, error } = useQuery({ queryKey: ['scan', id], queryFn: () => getScan(id), refetchOnWindowFocus: true })
  usePageTitle(scan ? `Scan · ${scan.name}` : 'Scan')
  const [save, setSave] = useState<ScanPriority[]>(['A', 'B'])
  const [listName, setListName] = useState<string | null>(null)
  const toList = useMutation({
    mutationFn: () => scanToWatchlist(id, save, (listName ?? `Scan ${today()} ${save.join('')}`).trim()),
    onSuccess: (r) => {
      toast.success(`${r.added} stocks saved to ${r.list_name}`)
      queryClient.invalidateQueries({ queryKey: ['watchlist'] })
    },
    onError: (e) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: () => deleteScan(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scans'] })
      navigate({ to: '/scans' })
    },
    onError: (e) => toast.error(e.message),
  })

  const back = (
    <Link to="/scans" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeftIcon className="size-4" /> Scans
    </Link>
  )
  if (error || !scan)
    return (
      <div className="space-y-4">
        {back}
        {error ? <p className="text-sm text-destructive">{error.message}</p> : <Spinner className="size-4" />}
      </div>
    )

  const by = (p: ScanPriority | null) => scan.marks.filter((m) => m.priority === p)
  const marked = new Set(scan.marks.map((m) => m.symbol))
  const picks = scan.marks.filter((m) => m.priority === 'A' || m.priority === 'B').map((m) => m.symbol)
  const openAt = (symbol: string) => resumeScan(id, Math.max(0, scan.symbols.indexOf(symbol)))
  const unmarked = scan.symbols.filter((s) => !marked.has(s))

  return (
    <div className="space-y-4">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{scan.name}</h1>
          <p className="text-xs text-muted-foreground">
            {scan.source.replace(/^watchlist:/, 'watchlist ')} · {scan.symbols.length} stocks · started{' '}
            {formatDateTime(scan.created_at)}
            {scan.finished_at ? ` · finished ${formatDateTime(scan.finished_at)}` : ` · at ${scan.position + 1} / ${scan.symbols.length}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => resumeScan(id)}>
            <PlayIcon /> {scan.finished_at ? 'Scan again' : 'Resume'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!picks.length}
            title="A new scan of only the A and B picks"
            onClick={() => startScan(`${scan.name} · A+B`, `scan:${id}`, picks)}
          >
            Rescan A+B ({picks.length})
          </Button>
          <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
            <Trash2Icon /> Delete
          </Button>
        </div>
      </div>

      <section className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 text-sm">
        <span className="font-medium">Save to a watchlist</span>
        {(['A', 'B', 'C'] as const).map((p) => (
          <label key={p} className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={save.includes(p)}
              onChange={(e) => setSave(e.target.checked ? [...save, p].sort() : save.filter((x) => x !== p))}
              className="accent-primary"
            />
            {p} ({by(p).length})
          </label>
        ))}
        <Input
          value={listName ?? `Scan ${today()} ${save.join('')}`}
          onChange={(e) => setListName(e.target.value)}
          className="h-8 w-56"
          aria-label="Watchlist name"
        />
        <Button size="sm" disabled={!save.length || toList.isPending} onClick={() => toList.mutate()}>
          Save
        </Button>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {(['A', 'B', 'C'] as const).map((p) => (
          <section key={p} className="space-y-2">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <span className={cn('rounded border px-1.5 font-mono', PRIORITY[p].className)}>{p}</span>
              {PRIORITY[p].label}
              <span className="text-muted-foreground">· {by(p).length}</span>
            </h2>
            {by(p).length ? (
              by(p).map((m) => <MarkCard key={m.symbol} m={m} onOpen={() => openAt(m.symbol)} />)
            ) : (
              <p className="text-xs text-muted-foreground">None.</p>
            )}
          </section>
        ))}
      </div>
      {by(null).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Noted, not ranked · {by(null).length}</h2>
          <div className="grid gap-2 md:grid-cols-3">
            {by(null).map((m) => (
              <MarkCard key={m.symbol} m={m} onOpen={() => openAt(m.symbol)} />
            ))}
          </div>
        </section>
      )}
      {unmarked.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Not marked ({unmarked.length}): {unmarked.join(', ')}
        </p>
      )}
    </div>
  )
}
