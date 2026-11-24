import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconChartHistogram, IconHistory, IconLayoutDashboard, IconTrophy } from '@tabler/icons-react'
import {
  Command,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandHint,
  CommandInput,
  CommandItem,
  CommandItemMedia,
  CommandItemMeta,
  CommandItemText,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './command'
import { Kbd } from './badge'
import { StoklorePalette } from './command.demo'
import { Toaster } from './toast'

const meta: Meta = { title: 'Components/Command palette', parameters: { controls: { disable: true } } }
export default meta
type Story = StoryObj

/**
 * The full palette, laid out after the reference: source tabs (Tab cycles), stock filter chips with
 * filter/sort buttons, Recent, stocks with prices, every page / tab / setting from
 * lib/navTargets.ts, quick actions with key-box shortcuts, theme switching (applies live), an
 * "Ask agent" fallback and a key-hint footer. ⌘K toggles.
 */
export const Full: Story = {
  name: 'Full palette',
  render: () => (
    <>
      <Toaster />
      <StoklorePalette />
    </>
  ),
}

/** Typing @ switches to stock search: scope chip, loading spinner, prices, "Go to" fallback. */
export const StockSearch: Story = {
  name: 'Stock search (@)',
  render: () => (
    <>
      <Toaster />
      <StoklorePalette initialQuery="@tata" />
    </>
  ),
}

/** Nothing matches: the empty state points at the agent fallback, which is always listed. */
export const NoMatch: Story = {
  name: 'No match → ask agent',
  render: () => (
    <>
      <Toaster />
      <StoklorePalette initialQuery="rebalance my book" />
    </>
  ),
}

/** Same palette rendered inline (e.g. a settings page or docs). */
export const Embedded: Story = {
  render: () => (
    <>
      <Toaster />
      <StoklorePalette embedded />
    </>
  ),
}

/** The parts on their own: media tiles, two-line text, group count, key-box shortcut, footer. */
export const Parts: Story = {
  render: () => (
    <Command className="max-w-xl rounded-md border border-input">
      <CommandInput placeholder="Search…" trailing={<Kbd>esc</Kbd>} />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Pages" count={3}>
          <CommandItem>
            <CommandItemMedia>
              <IconLayoutDashboard />
            </CommandItemMedia>
            <CommandItemText title="Stocks" subtitle="Indices, watchlist" description="/" />
          </CommandItem>
          <CommandItem>
            <CommandItemMedia tone="up">TA</CommandItemMedia>
            <CommandItemText title="TATAMOTORS" subtitle="Tata Motors" description="Auto · RS 88" />
            <CommandItemMeta>
              <span className="tabular text-up">+3.40%</span>
            </CommandItemMeta>
          </CommandItem>
          <CommandItem>
            <CommandItemMedia>
              <IconTrophy />
            </CommandItemMedia>
            <CommandItemText title="Leaders" />
            <CommandShortcut>⌘L</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Tabs">
          <CommandItem>
            <CommandItemMedia>
              <IconChartHistogram />
            </CommandItemMedia>
            <CommandItemText title="Multiple accounts" path={['Trade Simulation']} />
          </CommandItem>
          <CommandItem>
            <CommandItemMedia>
              <IconHistory />
            </CommandItemMedia>
            <CommandItemText title="Statistics" path={['Backtesting']} />
          </CommandItem>
        </CommandGroup>
      </CommandList>
      <CommandFooter>
        <CommandHint keys="↑↓">Select</CommandHint>
        <CommandHint keys="↵">Open</CommandHint>
        <CommandHint keys="ESC">Close</CommandHint>
      </CommandFooter>
    </Command>
  ),
}
