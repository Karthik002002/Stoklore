import { useRef, useState } from 'react'
import { IconArrowBackUp, IconCopy, IconDownload, IconUpload } from '@tabler/icons-react'
import { Button } from '../components/button'
import { COLOR_TOKENS, THEMES } from '../tokens/themes'
import type { ColorToken, Density } from '../tokens/themes'
import { isColor, toPreset } from './resolve'
import { useTheme } from './store'
import { copyText, download } from '@/lib/exportFile'
import { cn } from '@/lib/utils'

const GROUPS = [...new Set(COLOR_TOKENS.map((t) => t.group))]
const HEX6 = /^#[0-9a-f]{6}$/i

function ColorRow({ token, label, hint }: { token: ColorToken; label: string; hint: string }) {
  const { resolved, state, setColor } = useTheme()
  const value = resolved.colors[token]
  const overridden = token in state.overrides
  const [draft, setDraft] = useState<string | null>(null)
  const bad = draft !== null && !isColor(draft)

  return (
    <div className="grid h-(--row-h) grid-cols-[20px_1fr_96px_20px] items-center gap-2 border-b border-border/60 px-2 hover:bg-muted">
      <label className="relative size-4 cursor-pointer overflow-hidden rounded-xs border border-input" style={{ background: value }} title="Pick color">
        {/* native picker only speaks #rrggbb; other formats stay editable in the text box */}
        <input
          type="color"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={HEX6.test(value) ? value : '#000000'}
          onChange={(e) => setColor(token, e.target.value)}
        />
      </label>
      <div className="min-w-0 truncate">
        <span className={cn(overridden && 'text-accent')}>{label}</span>
        {hint && <span className="ml-1.5 text-2xs text-muted-foreground">{hint}</span>}
      </div>
      <input
        aria-label={`${label} value`}
        className={cn('tabular h-5.5 w-full rounded-xs border border-input bg-panel-head px-1.5 text-2xs outline-none focus:border-accent', bad && 'border-down')}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && isColor(draft)) setColor(token, draft.trim())
          setDraft(null)
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {overridden ? (
        <Button variant="ghost" size="icon-xs" aria-label={`Reset ${label}`} title="Back to preset" onClick={() => setColor(token, undefined)}>
          <IconArrowBackUp />
        </Button>
      ) : (
        <span />
      )}
    </div>
  )
}

/** Live editor for every editable token. Changes apply instantly and persist in localStorage. */
export function ThemeCustomizer({ className }: { className?: string }) {
  const { resolved, state, setPreset, update, reset, import: importTheme } = useTheme()
  const file = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  const flash = (m: string) => {
    setMsg(m)
    setTimeout(() => setMsg(''), 2000)
  }
  const presetJson = () => JSON.stringify(toPreset(resolved), null, 2)

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-md border border-border bg-card', className)}>
      <div className="flex h-7.5 items-center gap-2 border-b border-border bg-panel-head px-2">
        <span className="text-label text-muted-foreground uppercase">Theme customizer</span>
        <span className="flex-1" />
        {msg && <span className="text-2xs text-up">{msg}</span>}
        <Button variant="ghost" size="xs" onClick={reset}>
          <IconArrowBackUp />
          Reset all
        </Button>
      </div>

      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 border-b border-border p-2">
        <span className="text-label text-muted-foreground uppercase">Start from</span>
        <select
          className="h-6 rounded-sm border border-input bg-panel-head px-1.5 outline-none focus:border-accent"
          value={resolved.preset.id}
          onChange={(e) => setPreset(e.target.value)}
        >
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <span className="text-label text-muted-foreground uppercase">Radius</span>
        <div className="flex items-center gap-2">
          <input type="range" min={0} max={12} step={1} value={resolved.radius} onChange={(e) => update({ radius: Number(e.target.value) })} className="flex-1 accent-(--accent)" />
          <span className="tabular w-8 text-right text-2xs">{resolved.radius}px</span>
        </div>
        <span className="text-label text-muted-foreground uppercase">Density</span>
        <div className="flex overflow-hidden rounded-sm border border-border">
          {(['compact', 'comfortable'] as Density[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => update({ density: d })}
              className={cn('h-6 flex-1 border-r border-border capitalize last:border-0 hover:bg-muted', resolved.density === d && 'bg-muted shadow-[inset_0_-2px_var(--accent)]')}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {GROUPS.map((g) => (
          <div key={g}>
            <div className="sticky top-0 border-b border-border bg-panel-head px-2 py-1 text-label text-muted-foreground uppercase">{g}</div>
            {COLOR_TOKENS.filter((t) => t.group === g).map((t) => (
              <ColorRow key={t.token} token={t.token} label={t.label} hint={t.hint} />
            ))}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-panel-head p-2">
        <Button variant="outline" size="sm" onClick={() => copyText(presetJson()).then(() => flash('Copied'))} title="Paste into THEMES in tokens/themes.ts">
          <IconCopy />
          Copy as preset
        </Button>
        <Button variant="outline" size="sm" onClick={() => download(JSON.stringify(state, null, 2), 'stoklore-theme.json', 'application/json')}>
          <IconDownload />
          Export
        </Button>
        <Button variant="outline" size="sm" onClick={() => file.current?.click()}>
          <IconUpload />
          Import
        </Button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            try {
              importTheme(JSON.parse(await f.text()))
              flash('Imported')
            } catch {
              flash('Not a theme file')
            }
          }}
        />
      </div>
    </div>
  )
}
