# Design system (`frontend/src/design-system/`)

A swappable component layer for the whole frontend: trading-terminal components on shadcn/ui +
Base UI + Tailwind v4, catalogued in Storybook. Every component reads only CSS variables, so a
theme is data — pick one, tweak colors live, or ship your own preset in a fork.

> **Status:** on the `design-system` branch. The app runs on it: `components/ui/*` is gone, every
> page imports from `@/design-system`, and the theme is picked in the rail (palette icon) and
> edited in **Settings › Appearance**.

## Run Storybook

```bash
cd frontend
npm run storybook          # http://localhost:6006
npm run build-storybook    # static build in frontend/storybook-static/
```

## Themes

| Preset | Mode | Notes |
|---|---|---|
| Terminal Dark (default) | dark | hairline panels, Geist + Geist Mono numbers, 3px radius |
| Terminal Light | light | the light pair of Terminal Dark (the sun/moon toggle flips between them) |
| Midnight | dark | blue-tinted, violet accent |
| Amber Terminal | dark | all-mono, amber accent, square corners |

**Picking a theme** — `ThemeSelector` (top bar) or the paintbrush in Storybook's toolbar.
`ThemeModeToggle` flips to a preset's light/dark `pair`.

**Changing colors yourself** — `ThemeCustomizer` (Storybook: *Theme › Customizer*). Each editable
token has a color picker and a text box (any CSS color: hex, `rgb()`, `oklch()`…), plus radius
and density (compact 26px / comfortable 32px controls). Edits apply instantly and are saved in
`localStorage` under `ds.theme` as *preset + overrides*. Per-token reset, Reset all, Export /
Import (a JSON file), and **Copy as preset** — a block ready to paste into `themes.ts`.

Imported files and stored values are untrusted: unknown tokens and anything that isn't a plain
color (e.g. `red;}body{…}`) are dropped (`theme/resolve.ts` → `sanitizeState`).

**Making your own theme in a fork** — add an object to `THEMES` in
`src/design-system/tokens/themes.ts`. It appears in the selector and Storybook automatically.

### Tokens

Editable (in `themes.ts`, shown in the customizer):

| Group | Tokens |
|---|---|
| Surfaces | `background` (gutter), `card` (panel), `panel-head`, `popover`, `muted` |
| Text | `foreground`, `muted-foreground` |
| Lines | `border` (hairline), `input` (control border) |
| Brand | `primary`, `primary-foreground`, `accent`, `accent-foreground` |
| Market | `up`, `up-foreground`, `down`, `down-foreground`, `warning` |
| Charts | `chart-1` … `chart-5` |

Derived (in `tokens/tokens.css`, follow the editable ones): `ring` (accent 45%), `destructive`
(= down), `success` (= up), `selection`, `*-subtle` tints, `muted-hover`, `card-foreground`…

Non-color: `--radius` (every `rounded-*` derives from it), `--control-h`, `--row-h`,
`--ds-font-sans`, `--ds-font-mono`.

### Files

| File | What |
|---|---|
| `tokens/themes.ts` | presets + the editable token list — the file a fork edits |
| `tokens/tokens.css` | first-paint fallback values + derived tokens |
| `styles.css` | Tailwind entry: maps tokens to utilities (`bg-panel-head`, `text-up`, `h-(--control-h)`, `text-label`…) |
| `theme/resolve.ts` | pure merge/validate logic (`node src/design-system/theme/resolve.selfcheck.ts`) |
| `theme/store.ts` | runtime: applies vars to `<html>`, persists, `useTheme()` |
| `theme/ThemeSelector.tsx`, `theme/ThemeCustomizer.tsx` | the theme UI |
| `components/*` | components + their `*.stories.tsx` |
| `index.ts` | public exports — app code imports from `@/design-system` |

## Component rules

1. Colors only via tokens — never a hex value in a component.
2. Heights via `--control-h` / `--row-h`, so density resizes everything.
3. Numbers get the `tabular` class (mono, tabular figures).
4. Where `components/ui/*` already has the component, keep its name, variants and props, so
   migrating a page is an import-path change.

### What's new vs `components/ui/*`

| Component | Addition |
|---|---|
| Button | `buy`, `sell` variants; heights follow `--control-h` |
| Input | `numeric` (mono tabular figures) |
| Field, FieldLabel, FieldDescription, FieldError, Label | new — label/help/error with aria wiring from Base UI |
| Tabs | `TabsList variant="segment" \| "line"`, `size="sm"`, `TabsCount`; `TabsIndicator` kept but optional |
| ToggleGroup, Toggle | new — single/multi choice (timeframes, order type, indicators) |
| Badge | `warning`, `accent` variants, `dot` prop; success/destructive are tints, not solid |
| Kbd, KbdGroup | new |
| Progress | new — `tone`, `limit` marker, `size`, indeterminate |
| Checkbox, Switch, RadioGroup/Radio, Skeleton, Avatar | new to the shared set (pages hand-roll them today) |
| Spinner | CSS ring that takes the token color (was a lucide icon) |
| Dialog | `size` (`sm` / `default` / `lg` / `xl`); `DialogBody` scrolls while header/footer stay put; header and footer are panel-style strips |
| Sheet (`SheetContent side=…`) | new — a dialog docked to right / left / bottom / top |
| Popover | `PopoverHeader`, `PopoverClose` |
| Toaster | new — sonner's `<Toaster>` painted from tokens (colored left edge + icon per type). Existing `toast()` calls don't change |
| Panel, PanelHeader, PanelTitle, PanelBody, PanelSection, PanelFooter | new — the terminal surface: hairline box, header strip with uppercase title + actions |
| Card | same parts as `ui/card.tsx`, drawn as a panel |
| StatStrip, Stat | new — label / value / delta cells with hairline dividers (journal stats, backtest metrics, net worth) |
| EmptyState | new — icon, title, why, what to do |
| Table | same parts as `ui/table.tsx`; rows follow `--row-h`; `data-state="selected"` draws the accent edge; `TableSortHead` replaces `components/SortTh.tsx` (same props) |
| DataTable | same API as `components/DataTable.tsx` (now a named export); adds `selectedRowId` / `onRowClick` |
| Pagination | new — range label, pages with gaps (`pageRange`, self-checked: `node src/design-system/components/pageRange.selfcheck.ts`), rows-per-page select |
| Calendar, DatePicker, DateRangePicker | same props as `ui/calendar.tsx` and `components/DatePicker.tsx` ("YYYY-MM-DD" strings); range picker gains `presets` |
| Change, TickPrice, Quote | new — signed change (text or pill, %, ₹, R), a price that flashes on tick, the header quote line |
| RsPill | same API as `components/RsPill.tsx` |
| Delivery | `components/DelivCell.tsx`'s rule as a span (not a `<td>`), optional bar with the 20-day average marker |
| ResultsBadge, SurveillanceBadge | presentational versions: take `days` / `label` as props — the app keeps `useNextResults` / `useSurveillance` in thin wrappers |
| Sparkline, RangeBar, IndexCard, TickerStrip, WatchlistRow, Meter | new — SVG sparkline (area, baseline), 52W range, index tile, scrolling ticker tape, watchlist line, gauge against a cap |
| OrderTicket, SideToggle, MarketDepth | new — ticket with risk-based qty, R:R, % of wallet, wrong-side stop/target errors, warnings (math: `marketMath.readTicket`); flipping side mirrors the bracket; 5-level depth with qty bars and bid/ask balance |
| PnlCalendar, Treemap, HeatLegend | new — Monday-first month with weekly totals (`marketMath.monthGrid`); squarified heatmap (reuses `components/charts/squarify.ts`) sized to its measured box |
| Command palette | same parts as today, plus `CommandInput` `scope` / `loading` / `trailing`, `CommandScopes` (icon source tabs), `CommandChips` (filter chips + filter/sort slot), `CommandGroup count`, `CommandItemMedia` (icon / initials tile), `CommandItemText` (title • subtitle, breadcrumb, second line), `CommandItemMeta`, key-box `CommandShortcut`, `CommandLoading`, `CommandFooter` + `CommandHint`. The *Full palette* story is built from `lib/navTargets.ts`, so it lists every real page, tab and setting |

All floating surfaces share one look (`popupSurface` in `components/control.ts`: hairline border,
no shadow) and every menu-like row shares `menuRow`, so select, dropdown and command palette
items match.

Pure trading math is self-checked: `node src/design-system/components/marketMath.selfcheck.ts`.

## Phases

| # | Scope | State |
|---|---|---|
| 1 | Storybook, tokens, 4 presets, theme runtime, ThemeSelector, ThemeCustomizer, Button (+ buy/sell), Popover (needed by the selector) | done |
| 2 | Primitives: input (+ `numeric`), textarea, input-group, field (label/help/error), select (search at 6+ items, as today), checkbox, switch, radio-group, tabs (`segment` / `line`, `sm`, `TabsCount`), button-group, toggle-group, badge (+ warning, accent, `dot`), kbd, spinner, skeleton, progress (tones + `limit` marker), avatar, separator | done |
| 3 | Overlays: dialog (+ `size`, `DialogBody`), sheet (4 sides), alert-dialog, popover (+ header, close), tooltip, hover-card, dropdown-menu (sub, checkbox, radio, shortcut), command palette, themed Toaster for sonner | done |
| 4 | Layout & data: panel (header/title/body/section/footer), card (compat), stat strip + stat, empty state, table (+ `TableSortHead`), data-table (+ `selectedRowId` / `onRowClick`), pagination, calendar, date picker / range picker (+ presets) | done |
| 5 | Trading: change, tick price (flash), quote, RS pill, delivery, results & surveillance badges, sparkline, 52W range, index card, ticker strip (tape), watchlist row, meter, order ticket (risk sizing, R:R, warnings), side toggle, market depth, P&L calendar, treemap | done |
| 6 | Page stories built only from design-system parts (`src/design-system/pages/`): trading workspace, home, stock detail, holdings, book risk, trade simulation, agent, Settings › Appearance | done |
| 7 | Migration — see below | done |

## Page stories (`src/design-system/pages/`)

Whole screens assembled from `@/design-system` exports only — the check that the parts work
together before any real page moves. Storybook-only: sample data in `pages/data.ts`, an SVG
`CandleChart` standing in for lightweight-charts, and an `AppShell` (icon rail with page menus,
index tape, ⌘K palette, market status, theme selector and light/dark toggle).

| Story | Shows |
|---|---|
| Pages › Trading workspace | watchlist → chart → order ticket + depth; positions / orders / events dock. Clicking a row switches the symbol everywhere |
| Pages › Home | review banner, index cards, stats, sortable screener with pills/sparklines + pagination, sector treemap, P&L calendar, events |
| Pages › Stock detail | header (quote, range, fundamentals), tabs: chart, quarterly financials, shareholding, events, AI report |
| Pages › Portfolio | Holdings (DataTable with weights, summary strip) and Book risk (meters, sector concentration vs limit, position risk) |
| Pages › Review | Trade simulation: config, fan chart, percentiles, correlation matrix with n<10 cells |
| Pages › Automate · Settings | Agent chat with tool calls and prompt box; Settings › Appearance hosting the ThemeCustomizer |

Stories set `parameters.fullBleed` to drop the canvas padding.

## Migration (Phase 7)

1. ✅ **Stylesheet:** `main.tsx` imports `design-system/styles.css` instead of `index.css` + `theme.css`;
   call `applyTheme()` before render. `lib/theme.ts` (`useTheme`, `useAppliedTheme`) is re-pointed at
   `themeStore` so existing callers keep working. The old `theme` localStorage key maps to the
   Terminal Dark / Light preset once.
2. ✅ **Chrome:** App.tsx top bar gets `ThemeSelector` + `ThemeModeToggle` (replacing `ThemeToggle`);
   Settings gets an Appearance tab with `ThemeCustomizer`; `<Toaster>` from the design system.
   *Done as:* the app has no top bar, so the rail's theme button is `ThemeSelector compact`
   (preset list + light/dark + "Customize colors…" → `/settings?tab=appearance`).
3. ✅ **Primitives:** swap `@/components/ui/*` imports for `@/design-system` (same names/props), one
   folder at a time, then delete `components/ui/`. `DataTable`, `SortTh`, `DatePicker`, `RsPill`,
   `DelivCell` move to their design-system versions; `ResultsBadge` / `SurveillanceBadge` keep their
   data hooks and render the design-system badge.
   *Done as:* one codemod merged every `@/components/ui/*`, `DataTable`, `DatePicker`, `RsPill`
   and `SortTh` (→ `TableSortHead as SortTh`) import into a single `@/design-system` import per
   file; `DelivCell` stays as a `<td>` around `Delivery`. `components.json`'s `ui` alias points at
   `src/design-system/components`, so `shadcn add` lands there.

   **Charts:** canvas charts (lightweight-charts: `PriceChart`, `ReplayChart`, `IndexCard`,
   `SeriesChart`, engine and paper/journal mini charts) read `useChartColors()` - the theme as
   rgb strings, recomputed on every theme change - and rebuild/re-apply when it changes. SVG and
   DOM charts (journal stats, heatmaps, engine P&L cells) use `var(--up)` / `color-mix()` directly.
   Bar Replay's candle, wick, border, volume and oscillator-band colors follow the theme's up/down
   while they are still at the old built-in green/red defaults; a color the user picked stays theirs.

   **Palette classes:** 138 hardcoded Tailwind hue classes in 36 files (`text-amber-600 dark:text-amber-400`,
   `bg-sky-500/10`…) became tokens - amber/yellow/orange → `warning`, sky/blue/cyan → `accent`,
   emerald/green → `up`, red/rose → `down`, violet/purple → `chart-5` - so every status color follows
   the theme and the customizer.
4. ✅ **Pages:** no page hand-rolls a card any more.
   *By hand:* Stock detail, Holdings, Book risk, `PriceChart` / `StockChart`, `AllocationDonut`, and
   the local `Panel` / `StatCard` helpers in TradeSimulation and ManualStatistics (now thin
   wrappers over the design-system `Panel` and `Stat`, so every section on those pages follows).
   *By codemod:* a card whose first child is a title (`<p|h2|h3>`, a title + hint block, or a
   title-and-controls row) became `Panel` + `PanelHeader` (title, controls) + `PanelBody`; grids
   made only of stat cards became `StatStrip`; the rest - cards with dynamic class names, dashed
   empty boxes, workflow nodes - kept their markup but took the flat panel look
   (`rounded-md border border-border`), and so did the ~100 smaller `rounded-lg border` inner boxes
   (a box that already set its own border color keeps it). Floating shadows (chat widget, popups)
   are left as they are.

5. ✅ **Command palette:** `CommandPalette.tsx` is the Storybook palette on real data, keeping
   `lib/navTargets.ts` as its index: source tabs (All · Stocks · Pages · Page tabs · Actions ·
   Settings · Theme; Tab cycles), stock filter chips (Watchlist, Held, Gainers, Losers, Results
   soon, Surveillance, RS 80+) with clear-filters and sort-by-change, recents (last 5, per browser),
   tracked stocks with price/change and held / surveillance / results badges (from `/api/stocks`,
   the watchlist, paper positions, the results calendar, NSE surveillance and the market-wide
   strength table for RS - queries the app already caches; `useStrength(open)` keeps the strength
   poll off while the palette is closed), every page with a one-line hint and its route, page tabs and settings with
   breadcrumbs, quick actions with real shortcuts from `lib/shortcuts.ts`, every theme preset with
   a swatch tile, "Ask the agent" (`askInChat`), and a footer whose keys work: ⌘↵ opens the
   highlighted item in a new tab, ⌘L copies its link, the gear opens Settings › Shortcuts.
   `@SYMBOL` searches every tracked stock and verifies an unknown symbol on NSE before opening.

