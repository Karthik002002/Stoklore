import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  IconBell,
  IconChartLine,
  IconDotsVertical,
  IconFilter,
  IconInfoCircle,
  IconPlus,
  IconTrash,
  IconWallet,
} from '@tabler/icons-react'
import { Badge, Kbd } from './badge'
import { Button } from './button'
import { Checkbox } from './choice'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu'
import { Field, FieldLabel, Label } from './field'
import { Input } from './input'
import { Popover, PopoverClose, PopoverContent, PopoverHeader, PopoverTrigger } from './popover'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip'
import { Row } from '../story-helpers'

const meta: Meta = {
  title: 'Components/Menu · Popover · Tooltip',
  parameters: { controls: { disable: true } },
}
export default meta
type Story = StoryObj

/** EventActionsMenu: icons, shortcuts, a submenu, a destructive item. */
export const ActionsMenu: Story = {
  name: 'Dropdown menu',
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Actions" />}>
        <IconDotsVertical />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>TATAMOTORS</DropdownMenuLabel>
          <DropdownMenuItem>
            <IconChartLine />
            Open chart
            <DropdownMenuShortcut>C</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <IconPlus />
            Add to watchlist
            <DropdownMenuShortcut>W</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <IconBell />
            Create alert
            <DropdownMenuShortcut>A</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <IconWallet />
              Log trade in
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Zerodha · Swing</DropdownMenuItem>
              <DropdownMenuItem>Dhan · Intraday</DropdownMenuItem>
              <DropdownMenuItem>Paper</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem disabled inset>
            Backtest (no data)
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <IconTrash />
          Remove stock
          <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

/** Table column chooser + sort order. */
export const CheckAndRadio: Story = {
  name: 'Dropdown · checkbox & radio items',
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>Columns</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Show</DropdownMenuLabel>
          {['LTP', 'Chg %', 'RS', 'Deliv %', 'Volume'].map((c, i) => (
            <DropdownMenuCheckboxItem key={c} defaultChecked={i !== 4}>
              {c}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup defaultValue="rs">
            <DropdownMenuRadioItem value="chg">Change</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="rs">Relative strength</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="vol">Volume</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

/** TradeFilterDialog-style filters in a popover. */
export const FilterPopover: Story = {
  name: 'Popover',
  render: () => (
    <Popover defaultOpen>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <IconFilter />
        Filters <Badge variant="secondary">2</Badge>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <PopoverHeader>
          <span>Filters</span>
          <Button variant="link" size="xs">
            Clear
          </Button>
        </PopoverHeader>
        <div className="grid grid-cols-2 gap-2">
          <Field>
            <FieldLabel>Min RS</FieldLabel>
            <Input numeric defaultValue="70" />
          </Field>
          <Field>
            <FieldLabel>Min deliv %</FieldLabel>
            <Input numeric defaultValue="40" />
          </Field>
        </div>
        <div className="mt-2 flex flex-col gap-1.5">
          <Label>
            <Checkbox defaultChecked />
            Hide ASM / GSM
          </Label>
          <Label>
            <Checkbox />
            Results this week only
          </Label>
        </div>
        <div className="mt-2.5 flex justify-end gap-1.5 border-t border-border pt-2">
          <PopoverClose render={<Button variant="ghost" size="sm" />}>Cancel</PopoverClose>
          <PopoverClose render={<Button size="sm" />}>Apply</PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  ),
}

export const Tooltips: Story = {
  name: 'Tooltip',
  render: () => (
    <TooltipProvider>
      <div className="flex flex-col gap-6 p-10">
        <Row label="Sides">
          {(['top', 'right', 'bottom', 'left'] as const).map((s) => (
            <Tooltip key={s}>
              <TooltipTrigger render={<Button variant="outline" size="sm" />}>{s}</TooltipTrigger>
              <TooltipContent side={s}>Delivery % = delivered ÷ traded qty</TooltipContent>
            </Tooltip>
          ))}
        </Row>
        <Row label="With shortcut">
          <Tooltip defaultOpen>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Open chart" />}>
              <IconChartLine />
            </TooltipTrigger>
            <TooltipContent>
              Open chart <Kbd>G</Kbd>
              <Kbd>C</Kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={<span className="inline-flex items-center gap-1 text-muted-foreground" />}
            >
              RS <IconInfoCircle className="size-3" />
            </TooltipTrigger>
            <TooltipContent className="max-w-56">
              Relative strength vs NIFTY 500 over 6 months, as a 1–99 percentile.
            </TooltipContent>
          </Tooltip>
        </Row>
      </div>
    </TooltipProvider>
  ),
}

/** SectorHoverCard. */
export const SectorHover: Story = {
  name: 'Hover card',
  render: () => (
    <div className="p-4">
      <HoverCard defaultOpen>
        <HoverCardTrigger
          render={<a href="#auto" className="font-semibold underline decoration-dotted underline-offset-4" />}
        >
          Auto
        </HoverCardTrigger>
        <HoverCardContent align="start">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Auto · 1W</span>
            <span className="tabular text-up">+1.9%</span>
          </div>
          <div className="my-2 flex h-8 items-end gap-0.5">
            {[40, 55, 48, 70, 66, 82, 90].map((h) => (
              <span key={h} className="flex-1 rounded-xs bg-up/70" style={{ height: `${h}%` }} />
            ))}
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-2xs">
            <span className="text-muted-foreground">Leaders</span>
            <span>TATAMOTORS, M&amp;M</span>
            <span className="text-muted-foreground">Breadth</span>
            <span className="tabular">14 / 17 up</span>
          </div>
        </HoverCardContent>
      </HoverCard>
    </div>
  ),
}
