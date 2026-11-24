import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconBell, IconPlus, IconSearch } from '@tabler/icons-react'
import { Button } from '../components/button'
import { ThemeCustomizer } from './ThemeCustomizer'
import { ThemeModeToggle, ThemeSelector } from './ThemeSelector'

const meta: Meta = { title: 'Theme', parameters: { controls: { disable: true } } }
export default meta
type Story = StoryObj

/** How it sits in the app's top bar. */
export const Selector: Story = {
  render: () => (
    <div className="flex h-8.5 items-center gap-3 rounded-md border border-border bg-panel-head px-2.5">
      <span className="text-2xs font-bold tracking-widest">STOKLORE</span>
      <span className="tabular text-2xs text-muted-foreground">
        NIFTY 50 <span className="text-foreground">24,318.45</span> <span className="text-up">+0.84%</span>
      </span>
      <span className="flex-1" />
      <ThemeSelector onCustomize={() => alert('App opens Settings › Appearance here')} />
      <ThemeModeToggle />
    </div>
  ),
}

/** A slice of the terminal, to see edits land on real-looking UI. Grows as later phases add components. */
function Sample() {
  const rows = [
    ['RELIANCE', '2,914.60', '+1.82%', true],
    ['TATAMOTORS', '986.25', '+3.40%', true],
    ['ZOMATO', '262.15', '−2.14%', false],
    ['SUZLON', '64.80', '−4.95%', false],
  ] as const
  return (
    <div className="flex flex-col gap-1">
      <section className="overflow-hidden rounded-md border border-border bg-card">
        <header className="flex h-7.5 items-center gap-2 border-b border-border bg-panel-head px-2">
          <span className="text-label text-muted-foreground uppercase">Watchlist</span>
          <span className="flex-1" />
          <Button variant="ghost" size="icon-xs" aria-label="Search">
            <IconSearch />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Add">
            <IconPlus />
          </Button>
        </header>
        {rows.map(([s, p, c, up], i) => (
          <div key={s} className={`grid h-(--row-h) grid-cols-[1fr_auto_64px] items-center gap-2 border-b border-border/60 px-2 hover:bg-muted ${i === 1 ? 'bg-selection shadow-[inset_2px_0_var(--accent)]' : ''}`}>
            <span className="font-semibold">{s}</span>
            <span className="tabular text-right">{p}</span>
            <span className={`tabular text-right ${up ? 'text-up' : 'text-down'}`}>{c}</span>
          </div>
        ))}
      </section>
      <section className="flex flex-col gap-2 rounded-md border border-border bg-card p-2">
        <div className="flex flex-wrap gap-1.5">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">
            <IconBell />
            Ghost
          </Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="buy" size="lg">
            BUY 52 @ 986.25
          </Button>
          <Button variant="sell" size="lg">
            SELL
          </Button>
        </div>
        <div className="flex gap-1">
          {['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'].map((c) => (
            <span key={c} className="h-2 flex-1 rounded-xs" style={{ background: `var(--${c})` }} />
          ))}
        </div>
      </section>
    </div>
  )
}

/** Edit any token on the left; everything on the right (and every other story) updates live. */
export const Customizer: Story = {
  render: () => (
    <div className="grid h-[calc(100vh-2rem)] gap-1 md:grid-cols-[420px_1fr]">
      <ThemeCustomizer className="min-h-0" />
      <Sample />
    </div>
  ),
}
