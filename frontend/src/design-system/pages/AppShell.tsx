import { useEffect, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import {
  IconBell,
  IconChartCandle,
  IconChartLine as IconLogo,
  IconCpu,
  IconHistory,
  IconNews,
  IconSearch,
  IconSettings,
  IconTelescope,
} from '@tabler/icons-react'
import {
  Avatar,
  AvatarFallback,
  Badge,
  Kbd,
  KbdGroup,
  Separator,
  TickerStrip,
  Toaster,
  TooltipProvider,
  toast,
} from '../index'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  ThemeModeToggle,
  ThemeSelector,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../index'
import { StoklorePalette } from '../components/command.demo'
import { INDICES } from './data'
import { cn } from '@/lib/utils'

type Group = { label: string; hint: string; icon: ComponentType<{ className?: string }>; pages: string[] }

// Mirrors App.tsx's NAV_GROUPS.
const GROUPS: Group[] = [
  {
    label: 'Discover',
    hint: 'Find trade ideas',
    icon: IconTelescope,
    pages: ['Stocks', 'Leaders', 'Microcaps', 'Chart', 'Scans'],
  },
  {
    label: 'Research',
    hint: 'News, events and ownership',
    icon: IconNews,
    pages: ['Events', 'Earnings', 'Top news', 'Shareholding'],
  },
  {
    label: 'Trade',
    hint: 'Place and manage positions',
    icon: IconChartCandle,
    pages: ['Paper Trading', 'Live Trading', 'Holdings', 'Book risk', 'Alerts'],
  },
  {
    label: 'Review',
    hint: 'Journal, replay and practice',
    icon: IconHistory,
    pages: ['Backtesting', 'Bar Replay', 'Trade Simulation', 'Net worth & goals'],
  },
  {
    label: 'Automate',
    hint: 'Algo engine, workflows and AI',
    icon: IconCpu,
    pages: ['Algo engine', 'Workflows', 'Agent', 'Dashboards'],
  },
]

function Clock() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="tabular hidden text-2xs text-muted-foreground lg:inline">
      {t.toLocaleTimeString('en-IN', { hour12: false })}
    </span>
  )
}

/** Story-only app frame: icon rail with page menus, a top bar with the index tape, ⌘K palette,
 *  market status, theme selector and light/dark toggle. `page` lights up its rail group. */
export function AppShell({
  page,
  crumbs,
  children,
  className,
}: {
  page: string
  crumbs?: string[]
  children: ReactNode
  className?: string
}) {
  const active = GROUPS.find((g) => g.pages.includes(page))?.label
  return (
    <TooltipProvider>
      <Toaster />
      <div className="flex h-screen min-h-[640px] flex-col bg-background">
        <header className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-panel-head pr-2">
          <div className="flex h-full w-11 shrink-0 items-center justify-center border-r border-border text-accent">
            <IconLogo className="size-4" />
          </div>
          <div className="hidden items-center gap-1 text-2xs sm:flex">
            {(crumbs ?? [active ?? '', page]).filter(Boolean).map((c, i, a) => (
              <span key={c} className={i === a.length - 1 ? 'font-semibold' : 'text-muted-foreground'}>
                {c}
                {i < a.length - 1 && <span className="px-1 text-muted-foreground">/</span>}
              </span>
            ))}
          </div>
          <TickerStrip items={INDICES} scroll className="min-w-0 flex-1" />
          <StoklorePalette
            defaultOpen={false}
            renderTrigger={(open) => (
              <button
                type="button"
                onClick={open}
                className="hidden h-6 w-52 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-2xs text-muted-foreground hover:border-input md:flex"
              >
                <IconSearch className="size-3.5" />
                <span className="flex-1 text-left">Search</span>
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>K</Kbd>
                </KbdGroup>
              </button>
            )}
          />
          <Badge dot variant="success">
            NSE open
          </Badge>
          <Clock />
          <Separator orientation="vertical" className="my-2" />
          <ThemeSelector
            onCustomize={() =>
              toast('Opens Settings › Appearance', { description: 'See Pages › Automate · Settings' })
            }
          />
          <ThemeModeToggle />
          <Avatar size="sm">
            <AvatarFallback>K</AvatarFallback>
          </Avatar>
        </header>
        <div className="flex min-h-0 flex-1">
          <nav
            className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-border bg-panel-head py-1.5"
            aria-label="Main"
          >
            {GROUPS.map((g) => (
              <DropdownMenu key={g.label}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <DropdownMenuTrigger
                        aria-label={g.label}
                        className={cn(
                          'relative grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted',
                          g.label === active &&
                            'bg-muted text-foreground before:absolute before:inset-y-1.5 before:-left-1.5 before:w-0.5 before:bg-accent',
                        )}
                      />
                    }
                  >
                    <g.icon className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent side="right">{g.label}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent side="right" align="start" sideOffset={6}>
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      {g.label} <span className="tracking-normal normal-case">· {g.hint}</span>
                    </DropdownMenuLabel>
                    {g.pages.map((p) => (
                      <DropdownMenuItem key={p} className={cn(p === page && 'text-accent')}>
                        {p}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ))}
            <span className="flex-1" />
            {[
              ['Alerts', IconBell],
              ['Settings', IconSettings],
            ].map(([label, Icon]) => {
              const I = Icon as ComponentType<{ className?: string }>
              return (
                <Tooltip key={label as string}>
                  <TooltipTrigger
                    aria-label={label as string}
                    className={cn(
                      'grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
                      label === page && 'bg-muted text-foreground',
                    )}
                  >
                    <I className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent side="right">{label as string}</TooltipContent>
                </Tooltip>
              )
            })}
          </nav>
          <main className={cn('min-h-0 min-w-0 flex-1 overflow-auto p-1', className)}>{children}</main>
        </div>
      </div>
    </TooltipProvider>
  )
}
