import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconAlertTriangle, IconGripVertical, IconTrash } from '@tabler/icons-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './alert-dialog'
import { Badge } from './badge'
import { Button } from './button'
import { Switch } from './choice'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './dialog'
import { Field, FieldLabel } from './field'
import { Textarea } from './input'

const meta: Meta = {
  title: 'Components/Dialog · Sheet · Alert dialog',
  parameters: { controls: { disable: true } },
}
export default meta
type Story = StoryObj

const KV = ({ rows }: { rows: Record<string, React.ReactNode> }) => (
  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
    {Object.entries(rows).map(([k, v]) => (
      <div key={k} className="contents">
        <span className="text-muted-foreground">{k}</span>
        <span className="tabular">{v}</span>
      </div>
    ))}
  </div>
)

/** TradeDetailDialog: header strip, body, footer strip. */
export const TradeDetail: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button variant="outline" />}>Open trade</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>TATAMOTORS · Long</DialogTitle>
          <DialogDescription>Closed 21 Nov · held 6 days · Zerodha Swing</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <KV
            rows={{
              Entry: '942.10 × 52',
              Exit: '1,011.40',
              'P&L': <span className="text-up">+₹3,603.60 · +2.4R</span>,
              'MAE / MFE': (
                <span>
                  <span className="text-down">−1.1%</span> / <span className="text-up">+8.3%</span>
                </span>
              ),
              Setup: (
                <span className="flex gap-1">
                  <Badge variant="secondary">breakout</Badge>
                  <Badge variant="secondary">stage-2</Badge>
                </span>
              ),
            }}
          />
          <Field>
            <FieldLabel>What went well?</FieldLabel>
            <Textarea rows={2} defaultValue="Waited for the close above pivot instead of buying intraday." />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" className="mr-auto text-down">
            <IconTrash />
            Delete
          </Button>
          <DialogClose render={<Button variant="outline" size="sm" />}>Cancel</DialogClose>
          <Button size="sm">Save review</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="flex gap-2">
      {(['sm', 'default', 'lg', 'xl'] as const).map((s) => (
        <Dialog key={s}>
          <DialogTrigger render={<Button variant="outline" size="sm" />}>{s}</DialogTrigger>
          <DialogContent size={s}>
            <DialogHeader>
              <DialogTitle>size="{s}"</DialogTitle>
            </DialogHeader>
            <DialogBody className="text-muted-foreground">Content.</DialogBody>
            <DialogFooter showCloseButton />
          </DialogContent>
        </Dialog>
      ))}
    </div>
  ),
}

/** Header and footer stay put; the body scrolls. */
export const LongContent: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button variant="outline" />}>Open</DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Import tradebook · 214 rows</DialogTitle>
          <DialogDescription>Review before writing to the journal.</DialogDescription>
        </DialogHeader>
        <DialogBody className="p-0">
          {Array.from({ length: 40 }, (_, i) => (
            <div
              key={i}
              className="grid h-(--row-h) grid-cols-[60px_1fr_80px_80px] items-center gap-2 border-b border-border/60 px-3"
            >
              <span className="tabular text-muted-foreground">#{i + 1}</span>
              <span className="font-semibold">{['TATAMOTORS', 'KAYNES', 'INFY', 'SUZLON'][i % 4]}</span>
              <span className="tabular text-right">{(900 + i * 7.35).toFixed(2)}</span>
              <span className={`tabular text-right ${i % 3 ? 'text-up' : 'text-down'}`}>
                {i % 3 ? '+' : '−'}
                {(i * 0.37).toFixed(2)}%
              </span>
            </div>
          ))}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>Cancel</DialogClose>
          <Button size="sm">Import 214 trades</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

/** HomeCustomizeSheet / DrillDrawer. */
export const SheetRight: Story = {
  name: 'Sheet',
  render: () => (
    <div className="flex gap-2">
      <Sheet defaultOpen>
        <SheetTrigger render={<Button variant="outline" size="sm" />}>Right</SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Customize home</SheetTitle>
            <SheetDescription>Drag to reorder, toggle to hide.</SheetDescription>
          </SheetHeader>
          <SheetBody className="p-0">
            {['Indices', 'Watchlist', 'Day P&L', 'Top news', 'Earnings this week', 'Sector heatmap'].map(
              (n, i) => (
                <div key={n} className="flex h-8 items-center gap-2 border-b border-border/60 px-3">
                  <IconGripVertical className="size-3.5 cursor-grab text-muted-foreground" />
                  <span className="flex-1">{n}</span>
                  <Switch defaultChecked={i !== 3} aria-label={n} />
                </div>
              ),
            )}
          </SheetBody>
          <SheetFooter>
            <Button size="sm">Done</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      {(['left', 'bottom', 'top'] as const).map((side) => (
        <Sheet key={side}>
          <SheetTrigger render={<Button variant="outline" size="sm" />}>{side}</SheetTrigger>
          <SheetContent side={side}>
            <SheetHeader>
              <SheetTitle>side="{side}"</SheetTitle>
            </SheetHeader>
            <SheetBody className="text-muted-foreground">Content.</SheetBody>
          </SheetContent>
        </Sheet>
      ))}
    </div>
  ),
}

export const Confirm: Story = {
  name: 'Alert dialog',
  render: () => (
    <div className="flex gap-2">
      <AlertDialog defaultOpen>
        <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
          Delete trade
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-down-subtle text-down">
              <IconTrash />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete this trade?</AlertDialogTitle>
            <AlertDialogDescription>
              TATAMOTORS · 21 Nov. Removes it from the journal and every stat. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="sell">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>Exit all (sm)</AlertDialogTrigger>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-warning-subtle text-warning">
              <IconAlertTriangle />
            </AlertDialogMedia>
            <AlertDialogTitle>Exit 4 positions?</AlertDialogTitle>
            <AlertDialogDescription>
              Market orders at the next tick. Day P&amp;L +₹6,842.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction>Exit all</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  ),
}
