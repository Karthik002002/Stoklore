import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { getEngineSettings, updateEngineSettings } from '@/services/api'

// Settings > Algo engine: where the external C++ engine lives and what to call it. Every field
// left empty falls back to its env var (ENGINE_NAME / ENGINE_DIR / ENGINE_VPS / ENGINE_VPS_REPORTS),
// then the default - app/routers/engine.py owns that order.
const EMPTY = { name: '', engine_dir: '', vps: '', vps_reports: '' }

export default function EngineSettingsTab() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery({ queryKey: ['engineSettings'], queryFn: getEngineSettings })
  const [form, setForm] = useState(EMPTY)
  useEffect(() => {
    if (settings)
      setForm({
        name: settings.name,
        engine_dir: settings.engine_dir,
        vps: settings.vps,
        vps_reports: settings.vps_reports,
      })
  }, [settings])

  const save = useMutation({
    mutationFn: () => updateEngineSettings(form),
    onSuccess: (saved) => {
      queryClient.setQueryData(['engineSettings'], saved)
      for (const key of ['engineStrategies', 'engineRuns', 'engineRun'])
        queryClient.invalidateQueries({ queryKey: [key] })
      toast.success(
        saved.built || !saved.engine_dir
          ? 'Saved'
          : 'Saved - the engine is not built yet, run make in that folder',
      )
    },
    onError: (e) => toast.error(e.message),
  })

  if (!settings) return <Spinner className="size-4" />
  const dirty = (Object.keys(EMPTY) as (keyof typeof EMPTY)[]).some((k) => form[k] !== settings[k])
  const field = (
    key: keyof typeof EMPTY,
    label: string,
    placeholder: string,
    help: React.ReactNode,
    mono = true,
  ) => (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <Input
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        placeholder={placeholder}
        className={mono ? 'font-mono text-xs' : undefined}
      />
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  )

  return (
    <form
      className="max-w-xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <p className="text-sm text-muted-foreground">
        Connects Stoklore to your checkout of the C++ trading engine: backtests and parameter sweeps run from
        its{' '}
        <Link to="/engine" className="underline underline-offset-4">
          page
        </Link>
        , and its paper/live sessions are pulled in from the VPS.
      </p>
      {field('name', 'Name', 'Algo Engine', 'What the sidebar and page call your engine.', false)}
      {field(
        'engine_dir',
        'Engine folder',
        '~/code/hft',
        <>
          Your checkout on this machine. Stoklore runs <code>build/backtest</code> there and keeps runs in{' '}
          <code>runs/</code>.{' '}
          {settings.engine_dir &&
            (settings.built ? (
              <Badge variant="success">built</Badge>
            ) : (
              <Badge variant="destructive">not built - run make there</Badge>
            ))}
        </>,
      )}
      {field(
        'vps',
        'VPS (optional)',
        'user@host',
        'Where the live engine is deployed. Sync live uses your ssh key.',
      )}
      {field(
        'vps_reports',
        'VPS reports folder',
        '/var/lib/algo/reports',
        <>
          <code>REPORT_DIR</code> in the VPS's engine env file.
        </>,
      )}
      <p className="text-xs text-muted-foreground">
        Leave a field empty to use the <code>ENGINE_NAME</code>, <code>ENGINE_DIR</code>,{' '}
        <code>ENGINE_VPS</code> or <code>ENGINE_VPS_REPORTS</code> environment variable, or the default.
      </p>
      <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
        {save.isPending && <Spinner className="size-3.5" />}
        Save
      </Button>
    </form>
  )
}
