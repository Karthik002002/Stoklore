# Design system (`frontend/src/design-system/`)

A swappable component layer for the whole frontend: trading-terminal components on shadcn/ui +
Base UI + Tailwind v4, catalogued in Storybook. Every component reads only CSS variables, so a
theme is data — pick one, tweak colors live, or ship your own preset in a fork.

> **Status:** being built on the `design-system` branch. The app still uses `components/ui/*`
> and `index.css`; nothing switches over until the migration phase.

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
| 6 | Page compositions as stories: workspace, stock detail, holdings, risk, simulation, agent… | next |
| 7 | Migration: app switches to `styles.css`, ThemeSelector in the top bar, ThemeCustomizer in Settings › Appearance, pages move to `@/design-system` | waits for go-ahead |
