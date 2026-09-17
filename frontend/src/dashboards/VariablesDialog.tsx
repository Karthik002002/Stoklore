import { useQuery } from '@tanstack/react-query'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DASHBOARD_ALL, getDashboardFields, getDashboardParams } from '@/services/api'
import type { DashboardVariable } from '@/services/api'

// Dashboard-wide dropdowns. A variable is one field of one source - `symbol` from a workflow's data -
// and any panel filter whose value is `$symbol` follows it. All drops those filters, so the same board
// shows everything or narrows to one stock from a single control.

const NONE = '__none__'

function VariableRow({
  variable,
  onChange,
  onRemove,
}: {
  variable: DashboardVariable
  onChange: (v: DashboardVariable) => void
  onRemove: () => void
}) {
  const params = variable.query.params ?? {}
  const { data: options } = useQuery({
    queryKey: ['dashboardParams', variable.query.source, params],
    queryFn: () => getDashboardParams(variable.query.source, params),
  })
  const { data: fields = [] } = useQuery({
    queryKey: ['dashboardFields', variable.query.source, params],
    queryFn: () =>
      getDashboardFields({
        query: { source: variable.query.source, params },
        variables: {},
        time_from: null,
        time_to: null,
      }),
    enabled: variable.query.source !== 'workflow_series' || !!params.workflow_id,
  })
  const setParams = (next: Record<string, string>) =>
    onChange({ ...variable, query: { ...variable.query, params: next } })

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <Input
          id={`var-name-${variable.name}`}
          value={variable.name}
          onChange={(e) => onChange({ ...variable, name: e.target.value.replace(/[^A-Za-z0-9_]/g, '') })}
          placeholder="name (used as $name)"
          className="h-8 font-mono text-xs"
          aria-label="Variable name"
        />
        <Input
          id={`var-label-${variable.name}`}
          value={variable.label}
          onChange={(e) => onChange({ ...variable, label: e.target.value })}
          placeholder="Label"
          className="h-8"
          aria-label="Label"
        />
        <Button size="icon-sm" variant="ghost" onClick={onRemove} aria-label="Remove variable">
          <Trash2Icon />
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Select
          value={params.workflow_id || NONE}
          onValueChange={(v) => setParams({ workflow_id: v === NONE ? '' : String(v), series: '' })}
        >
          <SelectTrigger className="h-8 w-full" aria-label="Workflow">
            <SelectValue placeholder="Workflow" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={NONE}>Pick a workflow…</SelectItem>
            {(options?.workflow_id ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={params.series || NONE}
          onValueChange={(v) => setParams({ ...params, series: v === NONE ? '' : String(v) })}
        >
          <SelectTrigger className="h-8 w-full" aria-label="Series">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>First series</SelectItem>
            {(options?.series ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={variable.field || NONE}
          onValueChange={(v) => onChange({ ...variable, field: v === NONE ? '' : String(v) })}
        >
          <SelectTrigger className="h-8 w-full" aria-label="Field">
            <SelectValue placeholder="Field" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={NONE}>Pick a field…</SelectItem>
            {fields
              .filter((f) => f.type === 'text')
              .map((f) => (
                <SelectItem key={f.name} value={f.name}>
                  {f.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export default function VariablesDialog({
  open,
  onOpenChange,
  variables,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  variables: DashboardVariable[]
  onChange: (variables: DashboardVariable[]) => void
}) {
  const add = () => {
    const taken = new Set(variables.map((v) => v.name))
    let name = 'symbol'
    for (let i = 2; taken.has(name); i++) name = `symbol${i}`
    onChange([
      ...variables,
      {
        name,
        label: 'Symbol',
        query: { source: 'workflow_series', params: {} },
        field: 'symbol',
        default: DASHBOARD_ALL,
      },
    ])
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Variables</DialogTitle>
          <DialogDescription>
            A dropdown at the top of the board, filled from one field of a workflow's data. Filter a panel on{' '}
            <code>$name</code> to make it follow the dropdown.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {variables.map((variable, i) => (
            <VariableRow
              // biome-ignore lint/suspicious/noArrayIndexKey: the name is being edited, so it can't be the key
              key={i}
              variable={variable}
              onChange={(next) => onChange(variables.map((v, j) => (j === i ? next : v)))}
              onRemove={() => onChange(variables.filter((_, j) => j !== i))}
            />
          ))}
          {!variables.length && <p className="text-xs text-muted-foreground">No variables yet.</p>}
        </div>
        <Button size="sm" variant="outline" onClick={add} className="self-start">
          <PlusIcon className="size-3.5" />
          Add variable
        </Button>
      </DialogContent>
    </Dialog>
  )
}
