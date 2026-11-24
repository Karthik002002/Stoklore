import type { ComponentProps } from 'react'
import * as React from 'react'
import { Select as SelectPrimitive } from '@base-ui/react/select'
import { IconCheck, IconChevronDown, IconChevronUp, IconSearch } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { controlBase } from './control'

// Behaviour copied from components/ui/select.tsx unchanged (item labels collected from children so
// <SelectValue /> shows labels; a search box once a list has 6+ items) - only the look is new.

// ts: `any` on value, because Base UI's own `items` prop declares it that way.
type SelectItemLabel = { value: any; label: React.ReactNode }

type PositionedPopupProps = ComponentProps<typeof SelectPrimitive.Popup> &
  Pick<
    ComponentProps<typeof SelectPrimitive.Positioner>,
    'side' | 'align' | 'sideOffset' | 'alignOffset' | 'alignItemWithTrigger'
  >

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

const SEARCH_MIN_ITEMS = 6
const SearchContext = React.createContext('')

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children)
  return ''
}
const matches = (query: string, label: React.ReactNode, value: unknown) => {
  const q = query.trim().toLowerCase()
  return (
    !q ||
    `${textOf(label)} ${typeof value === 'string' || typeof value === 'number' ? value : ''}`
      .toLowerCase()
      .includes(q)
  )
}

function Select({ items, children, ...props }: ComponentProps<typeof SelectPrimitive.Root>) {
  const derivedItems = React.useMemo(() => items ?? collectItemLabels(children, []), [items, children])
  return (
    <SelectPrimitive.Root items={derivedItems} {...props}>
      {children}
    </SelectPrimitive.Root>
  )
}

const SelectGroup = ({ className, ...props }: ComponentProps<typeof SelectPrimitive.Group>) => (
  <SelectPrimitive.Group data-slot="select-group" className={cn('py-0.5', className)} {...props} />
)

const SelectValue = ({ className, ...props }: ComponentProps<typeof SelectPrimitive.Value>) => (
  <SelectPrimitive.Value
    data-slot="select-value"
    className={cn('flex flex-1 truncate text-left', className)}
    {...props}
  />
)

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger> & { size?: 'default' | 'sm' }) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        controlBase,
        'flex w-fit items-center justify-between gap-1.5 pr-1.5 pl-2 whitespace-nowrap select-none hover:bg-muted data-placeholder:text-muted-foreground data-popup-open:border-accent',
        'data-[size=default]:h-(--control-h) data-[size=sm]:h-6 data-[size=sm]:text-2xs',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon render={<IconChevronDown className="text-muted-foreground" />} />
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
}: PositionedPopupProps & { searchable?: boolean }) {
  const [query, setQuery] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const items = React.useMemo(() => collectItemLabels(children, []), [children])
  const withSearch = searchable ?? items.length >= SEARCH_MIN_ITEMS
  const shown = withSearch ? items.filter((i) => matches(query, i.label, i.value)).length : items.length
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
        alignItemWithTrigger={alignItemWithTrigger ?? !withSearch}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            'relative max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border border-input bg-popover p-0.5 text-xs text-popover-foreground',
            'duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
            className,
          )}
          {...props}
        >
          {withSearch && (
            <div className="sticky top-0 z-20 -mx-0.5 -mt-0.5 mb-0.5 flex items-center gap-1.5 border-b border-border bg-popover px-2">
              <IconSearch className="size-3 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(e.key)) e.stopPropagation()
                }}
                placeholder="Search…"
                aria-label="Search options"
                className="h-7 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              />
            </div>
          )}
          <SelectPrimitive.ScrollUpArrow className="top-0 z-10 flex w-full items-center justify-center bg-popover py-0.5">
            <IconChevronUp className="size-3" />
          </SelectPrimitive.ScrollUpArrow>
          <SearchContext.Provider value={withSearch ? query : ''}>
            <SelectPrimitive.List>{children}</SelectPrimitive.List>
          </SearchContext.Provider>
          {withSearch && shown === 0 && (
            <p className="px-2 py-2.5 text-center text-2xs text-muted-foreground">No matches.</p>
          )}
          <SelectPrimitive.ScrollDownArrow className="bottom-0 z-10 flex w-full items-center justify-center bg-popover py-0.5">
            <IconChevronDown className="size-3" />
          </SelectPrimitive.ScrollDownArrow>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

const SelectLabel = ({ className, ...props }: ComponentProps<typeof SelectPrimitive.GroupLabel>) => (
  <SelectPrimitive.GroupLabel
    data-slot="select-label"
    className={cn('px-1.5 pt-1 pb-0.5 text-label text-muted-foreground uppercase', className)}
    {...props}
  />
)

function SelectItem({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  const query = React.useContext(SearchContext)
  if (!matches(query, children, props.value)) return null
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex h-6.5 w-full cursor-default items-center gap-1.5 rounded-sm pr-6 pl-1.5 outline-none select-none data-highlighted:bg-muted data-selected:text-accent data-disabled:pointer-events-none data-disabled:opacity-50',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 shrink-0 gap-1.5 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-1.5 flex size-3.5 items-center justify-center" />
        }
      >
        <IconCheck className="size-3" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

const SelectSeparator = ({ className, ...props }: ComponentProps<typeof SelectPrimitive.Separator>) => (
  <SelectPrimitive.Separator
    data-slot="select-separator"
    className={cn('pointer-events-none -mx-0.5 my-0.5 h-px bg-border', className)}
    {...props}
  />
)

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
