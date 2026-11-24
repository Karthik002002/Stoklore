// The look every text-entry control shares (input, textarea, select trigger, input-group).
// One string so a tweak to "what a control looks like" happens once.
export const controlBase =
  'w-full min-w-0 rounded-md border border-input bg-panel-head text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-down aria-invalid:ring-2 aria-invalid:ring-down/20'

/** Numbers in inputs line up like everywhere else. */
export const numericText = 'font-mono tabular-nums tracking-tight'

/** Every floating surface (menu, popover, select list, hover card): flat, hairline, no shadow. */
export const popupSurface =
  'origin-(--transform-origin) rounded-md border border-input bg-popover text-xs text-popover-foreground outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0'

/** One row in a menu-like list (dropdown, command palette, select). */
export const menuRow =
  "relative flex h-6.5 cursor-default items-center gap-2 rounded-sm px-1.5 outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
