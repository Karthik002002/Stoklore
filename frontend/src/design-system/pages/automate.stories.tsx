import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconPaperclip,
  IconPlus,
  IconRobot,
  IconSend,
} from '@tabler/icons-react'
import {
  Badge,
  Button,
  Change,
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupTextarea,
  Kbd,
  Panel,
  PanelHeader,
  PanelTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Switch,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
  ThemeCustomizer,
  ThemeSelector,
  toast,
} from '../index'
import { AppShell } from './AppShell'

const meta: Meta = {
  title: 'Pages/Automate · Settings',
  parameters: { fullBleed: true, controls: { disable: true } },
}
export default meta
type Story = StoryObj

function ToolCall({ name, meta: m, running }: { name: string; meta: string; running?: boolean }) {
  return (
    <div className="flex max-w-md items-center gap-2 rounded-md border border-border bg-panel-head px-2 py-1">
      {running ? <Spinner className="size-3" /> : <IconCheck className="size-3 text-up" />}
      <code className="tabular text-2xs">{name}</code>
      <span className="text-2xs text-muted-foreground">{m}</span>
      <span className="flex-1" />
      <IconChevronDown className="size-3 text-muted-foreground" />
    </div>
  )
}

function Agent() {
  const [draft, setDraft] = useState('')
  return (
    <AppShell page="Agent" className="grid gap-1 lg:grid-cols-[220px_minmax(0,1fr)]">
      <Panel>
        <PanelHeader>
          <PanelTitle>Chats</PanelTitle>
          <span className="flex-1" />
          <Button variant="ghost" size="icon-xs" aria-label="New chat">
            <IconPlus />
          </Button>
        </PanelHeader>
        {['Book risk if Nifty −2%', 'TATAMOTORS thesis', 'Weekly review', 'Scan: VCP in capital goods'].map(
          (c, i) => (
            <button
              key={c}
              type="button"
              className={`border-b border-border/60 px-2 py-1.5 text-left hover:bg-muted ${i === 0 ? 'bg-selection shadow-[inset_2px_0_var(--accent)]' : ''}`}
            >
              <div className="truncate">{c}</div>
              <div className="text-2xs text-muted-foreground">{['now', '2h', 'Fri', 'Thu'][i]}</div>
            </button>
          ),
        )}
      </Panel>
      <Panel>
        <PanelHeader>
          <IconRobot className="size-3.5 text-accent" />
          <PanelTitle>Agent</PanelTitle>
          <span className="flex-1" />
          <Select defaultValue="opus">
            <SelectTrigger size="sm" className="w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="opus">claude-opus-5-5</SelectItem>
              <SelectItem value="sonnet">claude-sonnet-5-5</SelectItem>
              <SelectItem value="haiku">claude-haiku-5-5</SelectItem>
            </SelectContent>
          </Select>
        </PanelHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
          <div className="max-w-lg self-end rounded-md border border-border bg-muted px-2.5 py-1.5">
            Which of my open positions are most at risk if Nifty falls 2% tomorrow?
          </div>
          <div className="flex flex-col gap-1.5">
            <ToolCall name="get_positions" meta="5 rows · 120ms" />
            <ToolCall name="get_beta(symbols=[…5])" meta="5 rows · 340ms" />
            <ToolCall name="get_surveillance" meta="running" running />
            <div className="mt-1 max-w-2xl leading-relaxed">
              <p>
                <b>SUZLON</b> and <b>KAYNES</b> carry most of the downside:
              </p>
              <ul className="my-1.5 list-disc pl-5">
                <li>
                  <b>SUZLON</b> — β 1.9, already <Change value={-4.95} />, only 3.6% above your stop at{' '}
                  <span className="tabular">62.50</span>. It's under ASM, so an exit can be hard.
                </li>
                <li>
                  <b>KAYNES</b> — β 1.6, <Change value={1350} unit="₹" digits={0} /> open profit; a −3.2% move
                  takes you to breakeven. Results in 2 days.
                </li>
              </ul>
              <p className="text-muted-foreground">
                TATAMOTORS has room: the stop is 2.7% below and its β is 1.1.
              </p>
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon-xs" aria-label="Copy">
                <IconCopy />
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={() => toast('Draft: tighten SL on SUZLON to 63.80')}
              >
                Tighten SLs
              </Button>
              <Button variant="outline" size="xs">
                Open book risk
              </Button>
            </div>
          </div>
        </div>
        <div className="border-t border-border p-2">
          <InputGroup>
            <InputGroupTextarea
              rows={2}
              placeholder="Ask about your book, a stock, or run a scan…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <InputGroupAddon align="block-end" className="justify-between">
              <span className="flex items-center gap-1.5">
                <Button variant="ghost" size="icon-xs" aria-label="Attach">
                  <IconPaperclip />
                </Button>
                <Badge variant="outline">@positions</Badge>
                <Badge variant="outline">@journal</Badge>
              </span>
              <span className="flex items-center gap-1.5">
                <InputGroupText>
                  <Kbd>↵</Kbd> send
                </InputGroupText>
                <Button size="xs" disabled={!draft.trim()} onClick={() => setDraft('')}>
                  <IconSend />
                  Send
                </Button>
              </span>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </Panel>
    </AppShell>
  )
}

export const Agent_: Story = { name: 'Agent', render: () => <Agent /> }

const SECTIONS = [
  'Appearance',
  'Account',
  'Trade accounts',
  'Broker',
  'Model',
  'Telegram',
  'Shortcuts',
  'Algo engine',
]

function SettingRow({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border/60 px-3 py-1.5 last:border-0">
      <div>
        <div>{title}</div>
        {hint && <div className="text-2xs text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

/** Where the theme lives after migration: Settings › Appearance hosts the ThemeCustomizer, and the
 *  top-bar ThemeSelector's "Customize colors…" opens it. */
function Settings() {
  return (
    <AppShell page="Settings" className="max-w-6xl">
      <Tabs defaultValue="appearance" orientation="vertical" className="h-full gap-1">
        <TabsList className="w-44 shrink-0 self-start">
          {SECTIONS.map((s) => (
            <TabsTab
              key={s}
              value={s.toLowerCase()}
              className="justify-start border-r-0 border-b border-border last:border-b-0"
            >
              {s}
            </TabsTab>
          ))}
        </TabsList>
        <TabsPanel
          value="appearance"
          className="grid min-w-0 flex-1 gap-1 xl:grid-cols-[minmax(0,1fr)_420px]"
        >
          <div className="flex flex-col gap-1">
            <Panel>
              <PanelHeader>
                <PanelTitle>Appearance</PanelTitle>
              </PanelHeader>
              <SettingRow title="Theme" hint="Preset; your color edits sit on top of it">
                <ThemeSelector />
              </SettingRow>
              <SettingRow title="Compact tables" hint="Follows the density setting in the customizer">
                <Switch defaultChecked />
              </SettingRow>
              <SettingRow title="Flash prices on tick" hint="Green / red blink when a quote changes">
                <Switch defaultChecked />
              </SettingRow>
              <SettingRow
                title="Up / down colors"
                hint="Edit Up and Down in the customizer; colour-blind friendly: try blue / orange"
              >
                <span className="flex gap-1">
                  <span className="size-4 rounded-xs bg-up" />
                  <span className="size-4 rounded-xs bg-down" />
                </span>
              </SettingRow>
            </Panel>
            <Panel>
              <PanelHeader>
                <PanelTitle>For forks</PanelTitle>
              </PanelHeader>
              <div className="p-3 text-2xs leading-relaxed text-muted-foreground">
                Your edits are saved in this browser. <b className="text-foreground">Copy as preset</b> gives
                a block for{' '}
                <code className="tabular text-foreground">src/design-system/tokens/themes.ts</code> — commit
                it and the theme ships for everyone.
              </div>
            </Panel>
          </div>
          <ThemeCustomizer className="h-[calc(100vh-4rem)] min-h-[560px]" />
        </TabsPanel>
        {SECTIONS.slice(1).map((s) => (
          <TabsPanel key={s} value={s.toLowerCase()} className="flex-1">
            <Panel>
              <PanelHeader>
                <PanelTitle>{s}</PanelTitle>
              </PanelHeader>
              <div className="p-3 text-muted-foreground">{s} settings…</div>
            </Panel>
          </TabsPanel>
        ))}
      </Tabs>
    </AppShell>
  )
}

export const Settings_: Story = { name: 'Settings › Appearance', render: () => <Settings /> }
