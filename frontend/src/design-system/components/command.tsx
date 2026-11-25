import type { ComponentProps, ComponentType, ReactNode } from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { IconCheck, IconChevronRight, IconSearch } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { menuRow } from './control'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog'
import { Spinner } from './display'

// Same parts and props as components/ui/command.tsx (cmdk), so CommandPalette.tsx migrates by
// import path. New parts for the fuller palette: input extras (scope chip, spinner, trailing
// slot), icon source tabs, filter chips, group counts, leading media tiles, two-line item text,
// right-aligned meta, key-box shortcuts and a key-hint footer.

function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'flex size-full flex-col overflow-hidden bg-popover text-xs text-popover-foreground',
        className,
      )}
      {...props}
    />
  )
}

function CommandDialog({
  title = 'Command Palette',
  description = 'Search for a command to run...',
  children,
  className,
  showCloseButton = false,
  ...props
}: ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        size="lg"
        showCloseButton={showCloseButton}
        className={cn('top-[18%] translate-y-0 p-0 sm:max-w-xl', className)}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        {children as ReactNode}
      </DialogContent>
    </Dialog>
  )
}

type CommandInputProps = ComponentProps<typeof CommandPrimitive.Input> & {
  /** A chip before the text, e.g. the active scope while searching with @. */
  scope?: ReactNode
  /** Spinner in place of the search icon (remote results loading). */
  loading?: boolean
  /** Right end: key hint, an "ask AI" button… */
  trailing?: ReactNode
}

function CommandInput({ className, scope, loading, trailing, ...props }: CommandInputProps) {
  return (
    <div data-slot="command-input-wrapper" className="flex h-11 shrink-0 items-center gap-2.5 px-3.5">
      {loading ? (
        <Spinner className="size-4" />
      ) : (
        <IconSearch className="size-4 shrink-0 text-muted-foreground" />
      )}
      {scope && (
        <span className="inline-flex h-5 shrink-0 items-center rounded-sm bg-accent-subtle px-1.5 text-2xs font-medium text-accent">
          {scope}
        </span>
      )}
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          'h-full w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground disabled:opacity-50',
          className,
        )}
        {...props}
      />
      {trailing && <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>}
    </div>
  )
}

type Icon = ComponentType<{ className?: string }>
type Scope = { value: string; label: string; icon?: Icon; count?: number }

/** Source tabs under the input. A scope with an icon shows only the icon (label as tooltip). */
function CommandScopes({
  scopes,
  value,
  onValueChange,
  trailing,
  className,
}: {
  scopes: Scope[]
  value: string
  onValueChange: (v: string) => void
  trailing?: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="command-scopes"
      role="tablist"
      className={cn(
        'flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border px-2.5',
        className,
      )}
    >
      {scopes.map((s) => {
        const Icon = s.icon
        return (
          <button
            key={s.value}
            type="button"
            role="tab"
            title={s.count != null ? `${s.label} · ${s.count}` : s.label}
            aria-label={s.label}
            aria-selected={s.value === value}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault() /* keep focus in the input */}
            onClick={() => onValueChange(s.value)}
            className="flex h-9 min-w-9 shrink-0 items-center justify-center gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground aria-selected:text-foreground aria-selected:shadow-[inset_0_-2px_var(--accent)]"
          >
            {Icon ? <Icon className="size-4" /> : s.label}
          </button>
        )
      })}
      {trailing && <div className="ml-1 flex items-center border-l border-border pl-1.5">{trailing}</div>}
    </div>
  )
}

type Chip = { value: string; label: string; icon?: Icon; disabled?: boolean }

/** Toggleable filter chips (multi-select), with room for filter/sort buttons on the right. */
function CommandChips({
  chips,
  selected,
  onToggle,
  trailing,
  className,
}: {
  chips: Chip[]
  selected: string[]
  onToggle: (v: string) => void
  trailing?: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="command-chips"
      className={cn('flex shrink-0 items-center gap-2 border-b border-border px-3 py-2', className)}
    >
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [mask-image:linear-gradient(to_right,black_85%,transparent)]">
        {chips.map((c) => {
          const Icon = c.icon
          const on = selected.includes(c.value)
          return (
            <button
              key={c.value}
              type="button"
              aria-pressed={on}
              disabled={c.disabled}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onToggle(c.value)}
              className="inline-flex h-6.5 shrink-0 items-center gap-1.5 rounded-md border border-input px-2 text-2xs text-foreground hover:bg-muted disabled:opacity-40 aria-pressed:border-accent aria-pressed:bg-accent-subtle aria-pressed:text-accent"
            >
              {Icon && <Icon className="size-3.5" />}
              {c.label}
            </button>
          )
        })}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-1">{trailing}</div>}
    </div>
  )
}

const CommandList = ({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) => (
  <CommandPrimitive.List
    data-slot="command-list"
    className={cn('max-h-80 scroll-py-1 overflow-x-hidden overflow-y-auto p-1 outline-none', className)}
    {...props}
  />
)

const CommandEmpty = ({ className, ...props }: ComponentProps<typeof CommandPrimitive.Empty>) => (
  <CommandPrimitive.Empty
    data-slot="command-empty"
    className={cn('py-8 text-center text-muted-foreground', className)}
    {...props}
  />
)

/** While remote results load (stock search). */
const CommandLoading = ({
  className,
  children,
  ...props
}: ComponentProps<typeof CommandPrimitive.Loading>) => (
  <CommandPrimitive.Loading data-slot="command-loading" {...props}>
    <div className={cn('flex items-center gap-2 px-2 py-2 text-muted-foreground', className)}>
      <Spinner className="size-3" />
      {children ?? 'Searching…'}
    </div>
  </CommandPrimitive.Loading>
)

/** `count` renders a small badge after the heading: RECENT [3]. */
const CommandGroup = ({
  className,
  heading,
  count,
  ...props
}: ComponentProps<typeof CommandPrimitive.Group> & { count?: number }) => (
  <CommandPrimitive.Group
    data-slot="command-group"
    heading={
      count != null ? (
        <>
          {heading}
          <span className="rounded-xs bg-muted px-1 font-mono text-[11px] tracking-normal text-muted-foreground tabular-nums">
            {count}
          </span>
        </>
      ) : (
        heading
      )
    }
    className={cn(
      'overflow-hidden **:[[cmdk-group-heading]]:flex **:[[cmdk-group-heading]]:items-center **:[[cmdk-group-heading]]:gap-1.5 **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:pt-2.5 **:[[cmdk-group-heading]]:pb-1.5 **:[[cmdk-group-heading]]:text-label **:[[cmdk-group-heading]]:tracking-[0.07em] **:[[cmdk-group-heading]]:text-muted-foreground **:[[cmdk-group-heading]]:uppercase',
      className,
    )}
    {...props}
  />
)

const CommandSeparator = ({ className, ...props }: ComponentProps<typeof CommandPrimitive.Separator>) => (
  <CommandPrimitive.Separator
    data-slot="command-separator"
    className={cn('mx-2 my-1 border-t border-dashed border-border', className)}
    {...props}
  />
)

function CommandItem({ className, children, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        menuRow,
        'group/command-item h-auto min-h-8 gap-2.5 rounded-md px-2 py-1 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40 data-selected:bg-muted',
        "data-selected:[&>svg:not([class*='text-'])]:text-foreground [&>svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <IconCheck className="ml-auto hidden size-3 text-accent group-data-[checked=true]/command-item:block" />
    </CommandPrimitive.Item>
  )
}

/** Leading tile: an icon in a bordered square, or `tone` for a filled initials/avatar tile. */
function CommandItemMedia({
  className,
  tone = 'outline',
  ...props
}: ComponentProps<'span'> & { tone?: 'outline' | 'up' | 'down' | 'accent' | 'muted' }) {
  return (
    <span
      data-slot="command-item-media"
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md text-[11px] font-bold [&_svg:not([class*='size-'])]:size-3.5",
        tone === 'outline' &&
          'border border-border bg-panel-head text-muted-foreground group-data-[selected=true]/command-item:text-foreground',
        tone === 'up' && 'bg-up-subtle text-up',
        tone === 'down' && 'bg-down-subtle text-down',
        tone === 'accent' && 'bg-accent-subtle text-accent',
        tone === 'muted' && 'bg-muted text-foreground',
        className,
      )}
      {...props}
    />
  )
}

/** "Title • subtitle" on line one (with an optional breadcrumb before it), details on line two. */
function CommandItemText({
  title,
  subtitle,
  description,
  path,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  description?: ReactNode
  path?: string[]
  className?: string
}) {
  return (
    <span data-slot="command-item-text" className={cn('flex min-w-0 flex-1 flex-col gap-px', className)}>
      <span className="flex min-w-0 items-center gap-1.5">
        {path?.map((p) => (
          <span key={p} className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
            {p}
            <IconChevronRight className="size-2.5" />
          </span>
        ))}
        <span className="truncate text-foreground">{title}</span>
        {subtitle && (
          <>
            <span className="text-muted-foreground">•</span>
            <span className="truncate text-muted-foreground">{subtitle}</span>
          </>
        )}
      </span>
      {description && <span className="truncate text-2xs text-muted-foreground">{description}</span>}
    </span>
  )
}

/** Right-aligned extra: a price, a count, an "open" glyph. */
const CommandItemMeta = ({ className, ...props }: ComponentProps<'span'>) => (
  <span
    data-slot="command-item-meta"
    className={cn(
      'ml-auto flex shrink-0 items-center gap-1.5 pl-3 text-2xs text-muted-foreground',
      className,
    )}
    {...props}
  />
)

/** Shortcut as a key box: ⌘T. */
const CommandShortcut = ({ className, ...props }: ComponentProps<'span'>) => (
  <span
    data-slot="command-shortcut"
    className={cn(
      'ml-auto inline-flex h-5 shrink-0 items-center rounded-sm border border-border bg-panel-head px-1.5 font-mono text-[11px] tracking-wide text-muted-foreground',
      className,
    )}
    {...props}
  />
)

/** Bottom strip of key hints; put CommandHint children left and a status/button right. */
const CommandFooter = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="command-footer"
    className={cn(
      'flex h-10 shrink-0 items-center gap-3.5 overflow-x-auto border-t border-border bg-panel-head px-3 text-2xs text-muted-foreground',
      className,
    )}
    {...props}
  />
)

function CommandHint({ keys, children }: { keys: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-card px-1 font-mono text-[11px] text-foreground [&_svg]:size-3">
        {keys}
      </span>
      <span>{children}</span>
    </span>
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandScopes,
  CommandChips,
  CommandList,
  CommandEmpty,
  CommandLoading,
  CommandGroup,
  CommandItem,
  CommandItemMedia,
  CommandItemText,
  CommandItemMeta,
  CommandShortcut,
  CommandSeparator,
  CommandFooter,
  CommandHint,
}
