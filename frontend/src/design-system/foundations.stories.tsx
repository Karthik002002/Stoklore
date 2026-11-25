import type { Meta, StoryObj } from '@storybook/react-vite'
import { COLOR_TOKENS } from './tokens/themes'
import { useTheme } from './theme/store'

const meta: Meta = { title: 'Foundations', parameters: { controls: { disable: true } } }
export default meta
type Story = StoryObj

const DERIVED = [
  'ring',
  'destructive',
  'success',
  'selection',
  'up-subtle',
  'down-subtle',
  'warning-subtle',
  'accent-subtle',
  'muted-hover',
]

function Swatch({ token, label, value }: { token: string; label?: string; value?: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-border/60 py-1">
      <span
        className="h-6 w-10 shrink-0 rounded-sm border border-border"
        style={{ background: `var(--${token})` }}
      />
      <div className="min-w-0">
        <div>{label ?? token}</div>
        <div className="tabular truncate text-2xs text-muted-foreground">
          --{token}
          {value && ` · ${value}`}
        </div>
      </div>
    </div>
  )
}

function ColorsView() {
  const { resolved } = useTheme()
  const groups = [...new Set(COLOR_TOKENS.map((t) => t.group))]
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {groups.map((g) => (
        <section key={g}>
          <h3 className="mb-1 text-label text-muted-foreground uppercase">{g}</h3>
          {COLOR_TOKENS.filter((t) => t.group === g).map((t) => (
            <Swatch key={t.token} token={t.token} label={t.label} value={resolved.colors[t.token]} />
          ))}
        </section>
      ))}
      <section>
        <h3 className="mb-1 text-label text-muted-foreground uppercase">Derived (tokens.css)</h3>
        {DERIVED.map((t) => (
          <Swatch key={t} token={t} />
        ))}
      </section>
    </div>
  )
}

export const Colors: Story = { render: () => <ColorsView /> }

export const Typography: Story = {
  render: () => (
    <div className="flex max-w-xl flex-col gap-3">
      {[
        ['text-label uppercase text-muted-foreground', 'Panel label · 11.5px uppercase'],
        ['text-2xs', 'Secondary · 12px — captions, sub-rows'],
        ['text-xs', 'Body · 13px — tables, controls, everything by default'],
        ['text-[14px] font-semibold', 'Section · 14px semibold'],
        ['text-lg font-bold', 'Symbol heading · TATAMOTORS'],
      ].map(([c, t]) => (
        <div key={t} className="flex items-baseline gap-4 border-b border-border pb-2">
          <code className="tabular w-56 shrink-0 text-2xs text-muted-foreground">{c}</code>
          <span className={c}>{t}</span>
        </div>
      ))}
      <div className="flex items-baseline gap-4">
        <code className="tabular w-56 shrink-0 text-2xs text-muted-foreground">tabular</code>
        <span className="tabular">₹1,23,456.78 · +3.40% · 0123456789</span>
      </div>
      <div className="flex items-baseline gap-4">
        <code className="tabular w-56 shrink-0 text-2xs text-muted-foreground">text-up / text-down</code>
        <span className="tabular text-up">+32.45 (+3.40%)</span>
        <span className="tabular text-down">−5.73 (−2.14%)</span>
      </div>
    </div>
  ),
}

function ShapeView() {
  const { resolved } = useTheme()
  return (
    <div className="flex flex-col gap-4">
      <div className="text-muted-foreground">
        --radius <span className="tabular text-foreground">{resolved.radius}px</span> · density{' '}
        <span className="text-foreground">{resolved.density}</span> — change both in Theme › Customizer.
      </div>
      <div className="flex flex-wrap gap-3">
        {['rounded-xs', 'rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl'].map((r) => (
          <div
            key={r}
            className={`flex size-20 items-end border border-input bg-card p-1.5 text-2xs text-muted-foreground ${r}`}
          >
            {r}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex h-(--control-h) items-center rounded-md border border-input px-2">
          --control-h
        </div>
        <div className="flex h-(--row-h) items-center border-b border-border px-2">--row-h (table rows)</div>
      </div>
    </div>
  )
}

export const ShapeAndDensity: Story = { name: 'Radius & density', render: () => <ShapeView /> }
