import type { ReactNode } from 'react'

/** A labelled row of examples, used across the component stories. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-border py-2">
      <span className="w-28 shrink-0 text-label text-muted-foreground uppercase">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

/** A terminal panel shell for showing components in context (Phase 4 replaces it with <Panel>). */
export function Frame({
  title,
  children,
  className = '',
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`overflow-hidden rounded-md border border-border bg-card ${className}`}>
      <header className="flex h-7.5 items-center border-b border-border bg-panel-head px-2 text-label text-muted-foreground uppercase">
        {title}
      </header>
      <div className="p-2">{children}</div>
    </section>
  )
}
