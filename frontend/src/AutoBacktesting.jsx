import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { PlayIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { BacktestResultView, PlotsResultView } from '@/components/BacktestResult'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime } from '@/lib/format'
import { DEFAULT_PINE_SCRIPT, runPineScript } from '@/lib/runPineScript'
import { createAutoBacktestScript, deleteAutoBacktestScript, getAutoBacktestScripts } from '@/services/api'

function ScriptPreview({ script }) {
  const [symbol, setSymbol] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const preview = useMutation({
    mutationFn: () => runPineScript(script, symbol.trim().toUpperCase()),
    onSuccess: (r) => {
      setResult(r)
      setError(null)
    },
    onError: (e) => {
      setResult(null)
      setError(e.message)
    },
  })

  return (
    <div className="space-y-3 rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2">
        <Input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="NSE symbol, e.g. INFY"
          className="h-8 w-40 uppercase placeholder:normal-case"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!symbol.trim() || !script.trim() || preview.isPending}
          onClick={() => preview.mutate()}
        >
          {preview.isPending ? <Spinner className="size-4" /> : <PlayIcon className="size-4" />}
          Preview
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {result &&
        (result.trades ? <BacktestResultView result={result} /> : <PlotsResultView plots={result.plots} />)}
    </div>
  )
}

function AddScriptDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [script, setScript] = useState(DEFAULT_PINE_SCRIPT)
  const queryClient = useQueryClient()

  const save = useMutation({
    mutationFn: () => createAutoBacktestScript({ name: name.trim(), script }),
    onSuccess: () => {
      toast.success(`Saved "${name.trim()}"`)
      queryClient.invalidateQueries({ queryKey: ['autoBacktestScripts'] })
      setOpen(false)
      setName('')
      setScript(DEFAULT_PINE_SCRIPT)
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setName('')
          setScript(DEFAULT_PINE_SCRIPT)
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <PlusIcon className="size-4" />
        Add script
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Pine Script</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Script name" />
          <Textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={16}
            className="font-mono text-xs"
            spellCheck={false}
          />
          <ScriptPreview script={script} />
          <Button
            className="w-full"
            disabled={!name.trim() || !script.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending && <Spinner className="size-4" />}
            Save script
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ScriptsTable() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: scripts } = useQuery({ queryKey: ['autoBacktestScripts'], queryFn: getAutoBacktestScripts })

  const remove = useMutation({
    mutationFn: deleteAutoBacktestScript,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['autoBacktestScripts'] }),
    onError: (e) => toast.error(e.message),
  })

  if (!scripts || scripts.length === 0) {
    return <p className="text-sm text-muted-foreground">No saved scripts yet - add one above.</p>
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead>Saved</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {scripts.map((s) => (
            <TableRow
              key={s.id}
              className="cursor-pointer"
              onClick={() => navigate({ to: '/backtest/auto/$scriptId', params: { scriptId: String(s.id) } })}
            >
              <TableCell className="font-medium">{s.name}</TableCell>
              <TableCell className="text-muted-foreground">{formatDateTime(s.created_at)}</TableCell>
              <TableCell>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete ${s.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    remove.mutate(s.id)
                  }}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export default function AutoBacktesting() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Saved scripts</h2>
        <AddScriptDialog />
      </div>
      <ScriptsTable />
    </div>
  )
}
