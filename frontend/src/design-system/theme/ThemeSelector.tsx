import { IconCheck, IconMoon, IconPalette, IconSun } from '@tabler/icons-react'
import { Button } from '../components/button'
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover'
import { THEMES } from '../tokens/themes'
import type { ThemePreset } from '../tokens/themes'
import { useTheme } from './store'
import { cn } from '@/lib/utils'

/** Three dots of a preset's own colors, so a theme is recognisable before it's applied. */
function Swatch({ preset }: { preset: ThemePreset }) {
  const c = preset.colors
  return (
    <span
      className="flex h-4 shrink-0 overflow-hidden rounded-xs border border-border"
      style={{ background: c.card }}
    >
      {[c.accent, c.up, c.down].map((col) => (
        <span key={col} className="w-1.5" style={{ background: col }} />
      ))}
    </span>
  )
}

/** Sun/moon button: jumps to the current preset's light/dark pair. Hidden when it has none. */
export function ThemeModeToggle({ className }: { className?: string }) {
  const { resolved, toggleMode } = useTheme()
  if (!resolved.preset.pair) return null
  const dark = resolved.preset.mode === 'dark'
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      onClick={toggleMode}
      aria-label={dark ? 'Switch to light' : 'Switch to dark'}
    >
      {dark ? <IconSun /> : <IconMoon />}
    </Button>
  )
}

/** Top-bar theme picker. `onCustomize` opens wherever the app hosts the ThemeCustomizer. */
export function ThemeSelector({ onCustomize }: { onCustomize?: () => void }) {
  const { resolved, state, setPreset } = useTheme()
  const edited =
    Object.keys(state.overrides).length > 0 || state.radius !== undefined || state.density !== undefined
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" aria-label="Theme" />}>
        <Swatch preset={resolved.preset} />
        <span>{resolved.preset.label}</span>
        {edited && <span className="size-1.5 rounded-full bg-accent" title="Customized" />}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <div className="px-1.5 pt-1 pb-1.5 text-label text-muted-foreground uppercase">Theme</div>
        {THEMES.map((t) => {
          const active = t.id === resolved.preset.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setPreset(t.id)}
              className={cn(
                'flex h-7 w-full items-center gap-2 rounded-sm px-1.5 text-left hover:bg-muted',
                active && 'bg-selection',
              )}
            >
              <Swatch preset={t} />
              <span className="flex-1">{t.label}</span>
              <span className="text-2xs text-muted-foreground">{t.mode}</span>
              {active ? <IconCheck className="size-3 text-accent" /> : <span className="size-3" />}
            </button>
          )
        })}
        {onCustomize && (
          <>
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              onClick={onCustomize}
              className="flex h-7 w-full items-center gap-2 rounded-sm px-1.5 text-left hover:bg-muted"
            >
              <IconPalette className="size-3.5 text-muted-foreground" />
              <span className="flex-1">Customize colors…</span>
              {edited && <span className="text-2xs text-accent">edited</span>}
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
