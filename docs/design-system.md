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

## Phases

| # | Scope | State |
|---|---|---|
| 1 | Storybook, tokens, 4 presets, theme runtime, ThemeSelector, ThemeCustomizer, Button (+ buy/sell), Popover (needed by the selector) | done |
| 2 | Primitives: input (+ `numeric`), textarea, input-group, field (label/help/error), select (search at 6+ items, as today), checkbox, switch, radio-group, tabs (`segment` / `line`, `sm`, `TabsCount`), button-group, toggle-group, badge (+ warning, accent, `dot`), kbd, spinner, skeleton, progress (tones + `limit` marker), avatar, separator | done |
| 3 | Overlays: dialog, alert-dialog, popover stories, tooltip, hover-card, dropdown-menu, command, toast, sheet | next |
| 4 | Layout & data: panel, table / data-table, pagination, stat strip, empty state, calendar, date picker | |
| 5 | Trading: change pill, RS pill, delivery cell, sparkline, ticker, watchlist row, order ticket, depth, P&L calendar, treemap, meters | |
| 6 | Page compositions as stories: workspace, stock detail, holdings, risk, simulation, agent… | |
| 7 | Migration: app switches to `styles.css`, ThemeSelector in the top bar, ThemeCustomizer in Settings › Appearance, pages move to `@/design-system` | waits for go-ahead |
