// The look every text-entry control shares (input, textarea, select trigger, input-group).
// One string so a tweak to "what a control looks like" happens once.
export const controlBase =
  'w-full min-w-0 rounded-md border border-input bg-panel-head text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-down aria-invalid:ring-2 aria-invalid:ring-down/20'

/** Numbers in inputs line up like everywhere else. */
export const numericText = 'font-mono tabular-nums tracking-tight'
