import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertCircleIcon, ImageUpIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { autoResult } from '@/lib/manualTrades'
import { analyzeBulkTradeImage, createManualTrade, getActiveModel, getModels } from '@/services/api'

const numeric = (v) => (v === '' || v == null ? null : Number(v))

function newRow(file) {
  return {
    key: crypto.randomUUID(),
    file,
    previewUrl: URL.createObjectURL(file),
    status: 'analyzing', // 'analyzing' | 'ready' | 'error'
    error: null,
    imageFilename: null,
    symbol: '',
    direction: 'long',
    quantity: '',
    entryPrice: '',
    exitPrice: '',
    stopLoss: '',
    target: '',
    tradedAt: '',
  }
}

function Field({ value, onChange, ...props }) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-full text-xs"
      {...props}
    />
  )
}

function BulkRow({ row, onChange, onRemove }) {
  const set = (key) => (value) => onChange({ ...row, [key]: value })

  return (
    <div className="grid grid-cols-[auto_1fr] gap-3 rounded-lg border p-2.5">
      <img src={row.previewUrl} alt="" className="size-16 rounded object-cover" />
      <div className="min-w-0 space-y-1.5">
        {row.status === 'analyzing' && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner className="size-3.5" /> Analyzing chart…
          </p>
        )}
        {row.status === 'error' && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircleIcon className="size-3.5" /> {row.error}
          </p>
        )}
        {row.status === 'ready' && (
          <div className="grid grid-cols-4 gap-1.5">
            <Field value={row.symbol} onChange={set('symbol')} placeholder="Symbol" className="uppercase" />
            <Select value={row.direction} onValueChange={set('direction')}>
              <SelectTrigger size="sm" className="h-7 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="long">Long</SelectItem>
                <SelectItem value="short">Short</SelectItem>
              </SelectContent>
            </Select>
            <Field value={row.quantity} onChange={set('quantity')} type="number" placeholder="Qty" />
            <Field value={row.tradedAt} onChange={set('tradedAt')} type="datetime-local" />
            <Field
              value={row.entryPrice}
              onChange={set('entryPrice')}
              type="number"
              step="0.01"
              placeholder="Entry ₹"
            />
            <Field
              value={row.exitPrice}
              onChange={set('exitPrice')}
              type="number"
              step="0.01"
              placeholder="Exit ₹ (blank = open)"
            />
            <Field
              value={row.stopLoss}
              onChange={set('stopLoss')}
              type="number"
              step="0.01"
              placeholder="Stop ₹"
            />
            <Field
              value={row.target}
              onChange={set('target')}
              type="number"
              step="0.01"
              placeholder="Target ₹"
            />
          </div>
        )}
      </div>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Remove"
        className="col-start-2 justify-self-end"
        onClick={onRemove}
      >
        <Trash2Icon className="size-3.5" />
      </Button>
    </div>
  )
}

// Multi-image import: pick several trade-chart screenshots at once, each gets analyzed by a
// vision LLM in parallel (one request per image, not awaited sequentially) to pre-fill its
// fields, then a single review pass before saving them all. Built to cut the time cost of
// manually retyping each trade from a screenshot you already have.
export default function BulkTradesDialog({ open, onOpenChange, onSaved }) {
  const [rows, setRows] = useState([])
  const [model, setModel] = useState(null)

  const { data: models } = useQuery({ queryKey: ['models'], queryFn: getModels, enabled: open })
  const { data: active } = useQuery({ queryKey: ['activeModel'], queryFn: getActiveModel, enabled: open })
  const effectiveModel = model ?? active?.model ?? null

  const updateRow = (key, patch) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const removeRow = (key) => setRows((prev) => prev.filter((r) => r.key !== key))

  const addFiles = (fileList) => {
    const files = Array.from(fileList ?? [])
    const added = files.map(newRow)
    setRows((prev) => [...prev, ...added])
    added.forEach((row) => {
      analyzeBulkTradeImage(row.file, effectiveModel)
        .then((res) =>
          updateRow(row.key, {
            status: 'ready',
            imageFilename: res.filename,
            symbol: res.symbol ?? '',
            direction: res.direction ?? 'long',
            entryPrice: res.entry_price != null ? String(res.entry_price) : '',
            exitPrice: res.exit_price != null ? String(res.exit_price) : '',
            stopLoss: res.stop_loss != null ? String(res.stop_loss) : '',
            target: res.target != null ? String(res.target) : '',
            tradedAt: res.traded_at ? `${res.traded_at}T09:15` : '',
          }),
        )
        .catch((e) => updateRow(row.key, { status: 'error', error: e.message }))
    })
  }

  const readyRows = rows.filter(
    (r) => r.status === 'ready' && r.symbol.trim() && numeric(r.quantity) > 0 && numeric(r.entryPrice) > 0,
  )

  const save = useMutation({
    mutationFn: () =>
      Promise.all(
        readyRows.map((r) => {
          const exitPrice = numeric(r.exitPrice)
          const entryPrice = numeric(r.entryPrice)
          return createManualTrade({
            symbol: r.symbol.trim().toUpperCase(),
            direction: r.direction,
            quantity: numeric(r.quantity),
            entry_price: entryPrice,
            exit_price: exitPrice,
            stop_loss: numeric(r.stopLoss),
            target: numeric(r.target),
            is_open: exitPrice == null,
            result:
              exitPrice == null
                ? null
                : autoResult({ direction: r.direction, entry_price: entryPrice, exit_price: exitPrice }),
            emotion: null,
            tags: ['bulk-import'],
            notes: null,
            traded_at: r.tradedAt ? new Date(r.tradedAt).toISOString() : null,
            image_filename: r.imageFilename,
          })
        }),
      ),
    onSuccess: () => {
      toast.success(`${readyRows.length} trade${readyRows.length === 1 ? '' : 's'} imported`)
      setRows([])
      onSaved()
      onOpenChange(false)
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setRows([])
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk import trades</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Select value={effectiveModel ?? ''} onValueChange={(m) => m && setModel(m)}>
              <SelectTrigger size="sm" className="max-w-56 flex-1">
                <SelectValue placeholder="Model for image analysis…" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {(models ?? []).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">needs a vision-capable model</span>
          </div>

          <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed p-6 text-sm text-muted-foreground hover:bg-muted/50">
            <ImageUpIcon className="size-5" />
            Select trade chart screenshots…
            <input
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>

          {rows.length > 0 && (
            <div className="space-y-2">
              {rows.map((row) => (
                <BulkRow
                  key={row.key}
                  row={row}
                  onChange={(next) => updateRow(row.key, next)}
                  onRemove={() => removeRow(row.key)}
                />
              ))}
            </div>
          )}

          <Button
            className="w-full"
            disabled={readyRows.length === 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Spinner className="size-4" /> : <UploadIcon className="size-4" />}
            Import {readyRows.length || ''} trade{readyRows.length === 1 ? '' : 's'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
