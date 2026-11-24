import type { ComponentProps } from 'react'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { IconCheck, IconChevronRight } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { menuRow, popupSurface } from './control'

// Same parts and props as components/ui/dropdown-menu.tsx: `inset` lines an item up with ones
// that have an icon, `variant="destructive"` paints it red.
type MenuItemExtras = { inset?: boolean; variant?: 'default' | 'destructive' }

type PositionedPopupProps = ComponentProps<typeof MenuPrimitive.Popup> &
  Pick<ComponentProps<typeof MenuPrimitive.Positioner>, 'side' | 'align' | 'sideOffset' | 'alignOffset'>

const item = cn(
  menuRow,
  'data-highlighted:bg-muted data-inset:pl-6.5',
  'data-[variant=destructive]:text-down data-[variant=destructive]:data-highlighted:bg-down-subtle',
)

const DropdownMenu = (props: ComponentProps<typeof MenuPrimitive.Root>) => (
  <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
)
const DropdownMenuPortal = (props: ComponentProps<typeof MenuPrimitive.Portal>) => (
  <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
)
const DropdownMenuTrigger = (props: ComponentProps<typeof MenuPrimitive.Trigger>) => (
  <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
)

function DropdownMenuContent({
  align = 'start',
  alignOffset = 0,
  side = 'bottom',
  sideOffset = 4,
  className,
  ...props
}: PositionedPopupProps) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            popupSurface,
            'max-h-(--available-height) min-w-40 overflow-x-hidden overflow-y-auto p-0.5',
            className,
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

const DropdownMenuGroup = (props: ComponentProps<typeof MenuPrimitive.Group>) => (
  <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
)

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: ComponentProps<typeof MenuPrimitive.GroupLabel> & { inset?: boolean }) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        'px-1.5 pt-1 pb-0.5 text-label text-muted-foreground uppercase data-inset:pl-6.5',
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & MenuItemExtras) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(item, className)}
      {...props}
    />
  )
}

const DropdownMenuSub = (props: ComponentProps<typeof MenuPrimitive.SubmenuRoot>) => (
  <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
)

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.SubmenuTrigger> & { inset?: boolean }) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(item, 'data-popup-open:bg-muted', className)}
      {...props}
    >
      {children}
      <IconChevronRight className="ml-auto size-3 text-muted-foreground" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  align = 'start',
  alignOffset = -3,
  side = 'right',
  sideOffset = 2,
  className,
  ...props
}: ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      className={cn('min-w-32', className)}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  inset,
  ...props
}: ComponentProps<typeof MenuPrimitive.CheckboxItem> & MenuItemExtras) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(item, 'pr-6', className)}
      {...props}
    >
      <span className="pointer-events-none absolute right-1.5 flex items-center">
        <MenuPrimitive.CheckboxItemIndicator>
          <IconCheck className="size-3 text-accent" />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

const DropdownMenuRadioGroup = (props: ComponentProps<typeof MenuPrimitive.RadioGroup>) => (
  <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />
)

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: ComponentProps<typeof MenuPrimitive.RadioItem> & MenuItemExtras) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(item, 'pr-6', className)}
      {...props}
    >
      <span className="pointer-events-none absolute right-1.5 flex items-center">
        <MenuPrimitive.RadioItemIndicator>
          <span className="block size-1.5 rounded-full bg-accent" />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

const DropdownMenuSeparator = ({ className, ...props }: ComponentProps<typeof MenuPrimitive.Separator>) => (
  <MenuPrimitive.Separator
    data-slot="dropdown-menu-separator"
    className={cn('-mx-0.5 my-0.5 h-px bg-border', className)}
    {...props}
  />
)

const DropdownMenuShortcut = ({ className, ...props }: ComponentProps<'span'>) => (
  <span
    data-slot="dropdown-menu-shortcut"
    className={cn('ml-auto pl-3 font-mono text-[10px] tracking-wide text-muted-foreground', className)}
    {...props}
  />
)

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
