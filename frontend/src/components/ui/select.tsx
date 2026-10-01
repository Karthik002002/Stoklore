import type { ComponentProps } from 'react'
import * as React from 'react'
import { Select as SelectPrimitive } from '@base-ui/react/select'

import { cn } from '@/lib/utils'
import { ChevronDownIcon, CheckIcon, ChevronUpIcon, SearchIcon } from 'lucide-react'

/** A popup wrapper's props: the popup's own, plus the placement props it forwards to the
 *  positioner (which is a separate element in Base UI, but one prop set to the caller). */
/** One option, as collected off the JSX children so <SelectValue /> can show a label. Shaped to
 *  match what the primitive's own `items` prop accepts, since that is where these end up. */
// ts: `any` on value, because Base UI's own `items` prop declares it that way - a value here is
// whatever the caller put on <SelectItem value={...}>, and narrowing to unknown makes this
// unassignable to the prop it exists to feed. Remove if the library ever generifies it.
type SelectItemLabel = { value: any; label: React.ReactNode }

type PositionedPopupProps = ComponentProps<typeof SelectPrimitive.Popup> &
  Pick<
    ComponentProps<typeof SelectPrimitive.Positioner>,
    'side' | 'align' | 'sideOffset' | 'alignOffset' | 'alignItemWithTrigger'
  >

// Base UI's <Select.Value> shows the raw selected value ("2", "daily") unless the root is given
// an `items` map of {value, label} - it can't derive a label from <Select.Item> children on its
// own, since SelectContent's items aren't mounted in the DOM while the popup is closed. Rather
// than every call site hand-maintaining a parallel items list (or every consumer needing its own
// <SelectValue>{(v) => ...}</SelectValue> workaround), this walks the JSX tree passed as children
// once per render, pulls {value, label} out of every <SelectItem>, and feeds that to the root -
// so <SelectValue /> shows the item's label everywhere, by default, with zero per-caller wiring.
// An explicit `items` prop (or an explicit SelectValue children function) still wins over this.
function collectItemLabels(children: React.ReactNode, items: SelectItemLabel[]): SelectItemLabel[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === SelectItem) {
      const { value, children: label } = child.props as { value: unknown; children: React.ReactNode }
      items.push({ value, label })
      return
    }
    const nested = (child.props as { children?: React.ReactNode }).children
    if (nested != null) collectItemLabels(nested, items)
  })
  return items
}

// Search inside every list long enough to need it (the shadcnblocks "select with search"): a box at
// the top of the popup filters the items as you type. One place, so every <Select> in the app gets
// it without its call site changing. An item matches on its visible text or its value.
const SEARCH_MIN_ITEMS = 6
const SearchContext = React.createContext('')

/** The words a person would type to find an item: its rendered text, whatever JSX it's wrapped in. */
function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children)
  return ''
}
const matches = (query: string, label: React.ReactNode, value: unknown) => {
  const q = query.trim().toLowerCase()
  return !q || `${textOf(label)} ${typeof value === 'string' || typeof value === 'number' ? value : ''}`.toLowerCase().includes(q)
}

function Select({ items, children, ...props }: ComponentProps<typeof SelectPrimitive.Root>) {
  const derivedItems = React.useMemo(() => items ?? collectItemLabels(children, []), [items, children])
  return (
    <SelectPrimitive.Root items={derivedItems} {...props}>
      {children}
    </SelectPrimitive.Root>
  )
}

function SelectGroup({ className, ...props }: ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group data-slot="select-group" className={cn('scroll-my-1 p-1', className)} {...props} />
  )
}

function SelectValue({ className, ...props }: ComponentProps<typeof SelectPrimitive.Value>) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn('flex flex-1 text-left', className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
  // `size` is this app's, not the primitive's - it lands as data-size for the CSS below.
}: ComponentProps<typeof SelectPrimitive.Trigger> & { size?: 'default' | 'sm' }) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={<ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />}
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = 'bottom',
  sideOffset = 4,
  align = 'center',
  alignOffset = 0,
  alignItemWithTrigger,
  searchable,
  ...props
}: PositionedPopupProps & {
  /** Force the search box on or off. Default: on once the list has SEARCH_MIN_ITEMS items. */
  searchable?: boolean
}) {
  const [query, setQuery] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const items = React.useMemo(() => collectItemLabels(children, []), [children])
  const withSearch = searchable ?? items.length >= SEARCH_MIN_ITEMS
  const shown = withSearch ? items.filter((i) => matches(query, i.label, i.value)).length : items.length
  // the popup opens with focus on the selected item; a searchable one wants the box instead
  React.useEffect(() => {
    if (!withSearch) return
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [withSearch])
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        // a list that filters can't sit over its trigger - it would jump as it shrinks
        alignItemWithTrigger={alignItemWithTrigger ?? !withSearch}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger ?? !withSearch}
          className={cn(
            'relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        >
          {withSearch && (
            <div className="sticky top-0 z-20 flex items-center gap-1.5 border-b bg-popover px-2">
              <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                // typing is for the box: keep it from the list's typeahead (and Space from selecting);
                // arrows, Enter, Escape and Tab still reach the list
                onKeyDown={(e) => {
                  if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(e.key)) e.stopPropagation()
                }}
                placeholder="Search…"
                aria-label="Search options"
                className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          )}
          <SelectScrollUpButton />
          <SearchContext.Provider value={withSearch ? query : ''}>
            <SelectPrimitive.List>{children}</SelectPrimitive.List>
          </SearchContext.Provider>
          {withSearch && shown === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">No matches.</p>
          )}
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({ className, ...props }: ComponentProps<typeof SelectPrimitive.GroupLabel>) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn('px-1.5 py-1 text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

function SelectItem({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  const query = React.useContext(SearchContext)
  if (!matches(query, children, props.value)) return null
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({ className, ...props }: ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('pointer-events-none -mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({ className, ...props }: ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
