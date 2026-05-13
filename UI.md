# Lead-IQ — UI / design system

*Last updated: 2026-05-13*

This is the working inventory of every visual decision baked into the app — fonts, colors, components, and where each token surfaces. Use it to scope a refresh: every line below is something you can choose to keep or change.

For product / architecture context, see [`DOCS.md`](./DOCS.md). For shipped/queued visual work, see [`lead-iq-roadmap.md`](./lead-iq-roadmap.md).

---

## 1. Purpose

- **Source of truth** for fonts, colors, spacing scales, and component conventions.
- **Snapshot for decisions** — when you say "change the primary blue" or "ditch VT323," look here first to see every place it shows up.
- **Refresh seam** — the "Decisions on the table" section at the bottom captures candidate changes so the next visual pass doesn't restart from zero.

---

## 2. Libraries

| Layer | Package | Why we use it | Files |
|---|---|---|---|
| Primitives | `@base-ui/react` ^1.4 | Headless layer under shadcn (replaces Radix). Menu / Dialog / Select / Tooltip / AlertDialog / Tabs. | `src/components/ui/*.tsx` |
| Component layer | shadcn/ui (Base-UI variant) | Owned, copy-paste components — not a runtime dep. | `src/components/ui/*.tsx` |
| Styling | Tailwind v4 + `@tailwindcss/postcss` | CSS-variable-driven theming via `@theme inline`. | `src/app/globals.css`, `postcss.config.mjs` |
| Tailwind extras | `tw-animate-css` | Enter/exit utilities (`animate-in`, `fade-in-0`, `zoom-in-95`). | Used in `dropdown-menu.tsx`, `dialog.tsx`. |
| Theme switching | `next-themes` ^0.4 | `class` strategy on `<html>`. Default dark, no system preference (login stays dark-locked). | `theme-provider.tsx`, `theme-toggle.tsx` |
| Charts | Recharts ^3.8 + shadcn `Chart` wrapper | Per-chart CSS vars (`--color-{key}`) so series colors track the theme. | `src/components/ui/chart.tsx`, `analytics-dashboard.tsx` |
| Icons | `lucide-react` | Default size 16px via `[&_svg:not([class*='size-'])]:size-4`. | App-wide |
| Toasts | `sonner` (next-themes aware) | Wired but not surfaced yet — toast notifications are a roadmap polish item. | `src/components/ui/sonner.tsx` |
| Dropzone | `react-dropzone` | CSV/JSON upload in the campaign wizard + scrape page. | `run-wizard.tsx`, `scrape/page.tsx` |
| Forms | Controlled inputs + Server Actions | No `react-hook-form` / `zod-form` — small surface keeps the indirection low. | `template-form.tsx`, login, dialogs |

---

## 3. Fonts

Three faces, all Google Fonts via `next/font/google` in `src/app/layout.tsx`.

| Token | Family | Used for | Notes |
|---|---|---|---|
| `--font-sans` | **Space Mono** (400 / 700) | Body, paragraphs, table cells, KPI labels, Card / Dialog / AlertDialog titles (via `--font-heading` alias) | Default. Mono-spaced; tabular by nature. |
| `--font-mono` | **JetBrains Mono** (400 / 500 / 700) | Code chips, error displays (campaign-detail + scrape), login-hero ASCII art, template version previews, system-prompt textarea, chart tooltip numbers, connect-key dialogs | Anything with the `font-mono` Tailwind utility. |
| `--font-display` | **VT323** (400) | Page H1 titles in `PageHeader` (`text-5xl`) — and only there | Pixel-terminal retro. Reads small per its physical box; **do not** promote to body or smaller chrome. |
| `--font-heading` | alias → `--font-sans` | Inherited by Card/Dialog/AlertDialog titles | Kept aliased so reducing-prominence titles stay Space Mono. |

Cloned 2026-05-13 — VT323 + JetBrains Mono came from [aiengineeringfromscratch.com](https://aiengineeringfromscratch.com/) (`rohitg00/ai-engineering-from-scratch`). Their body face (Source Serif 4) was explicitly not adopted.

---

## 4. Color tokens

Both themes declared in `src/app/globals.css`. Colors in OKLCH so hue / chroma stay coherent across alpha variants. `:root` = light; `.dark` = dark (toggled by next-themes).

### Core surfaces

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--page-bg` | `#f7f8fb` | `#000` | Drawn behind the gradient overlay (raw color on `<html>` + `<body>`). |
| `--background` | `oklch(0.985 0.003 240)` | `oklch(0 0 0)` | Body/canvas via Tailwind `bg-background`. |
| `--foreground` | `oklch(0.18 0.02 240)` | `oklch(0.985 0 0)` | Body text via `text-foreground`. |
| `--card` | `oklch(1 0 0 / 0.7)` | `oklch(0.14 0.01 240 / 0.6)` | Translucent so the body gradient shows through. |
| `--card-foreground` | matches foreground | matches foreground | Text inside cards. |
| `--popover` | `oklch(0.99 0.002 240)` | `oklch(0.12 0.01 240)` | DropdownMenu, Select, Tooltip surfaces. |
| `--muted` | `oklch(0.95 0.01 240)` | `oklch(0.2 0.01 240)` | Secondary surfaces, filled inputs. |
| `--muted-foreground` | `oklch(0.45 0.02 240)` | `oklch(0.68 0.02 240)` | Descriptions, helper text, table secondary cells. |
| `--accent` | `oklch(0.93 0.04 237)` | `oklch(0.24 0.04 237)` | Hover/focus surfaces (`bg-accent`). |
| `--destructive` | `oklch(0.6 0.21 22.216)` | `oklch(0.704 0.191 22.216)` | Delete buttons, error banners. |

### Brand

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--primary` | `oklch(0.6 0.17 237)` | `oklch(0.685 0.169 237)` | **Sky-blue.** Buttons, focus rings, qualified badges, primary chart series, sidebar primary surfaces. |
| `--primary-foreground` | `oklch(0.99 0 0)` | `oklch(0.12 0.02 240)` | Text/icons on primary surfaces. |
| `--border` | `oklch(0.6 0.17 237 / 0.18)` | `oklch(0.685 0.169 237 / 0.18)` | Sky-tinted borders by default. |
| `--ring` | `oklch(0.6 0.17 237 / 0.6)` | `oklch(0.685 0.169 237 / 0.6)` | Focus rings (3px). |
| `--input` | `oklch(0.18 0.02 240 / 0.08)` | `oklch(1 0 0 / 0.08)` | Input field fills. |

### Charts

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--chart-1` | `oklch(0.6 0.17 237)` | `oklch(0.685 0.169 237)` | Primary series (qualified leads, dominant bar fills). |
| `--chart-2` | `oklch(0.7 0.13 210)` | `oklch(0.78 0.13 210)` | Cyan-ish second series. |
| `--chart-3` | `oklch(0.5 0.18 258)` | `oklch(0.55 0.18 258)` | Indigo / purple-ish third series. |
| `--chart-4` | `oklch(0.78 0.05 240)` | `oklch(0.4 0.05 240)` | Muted / "not qualified" overlay (desaturated). |
| `--chart-5` | `oklch(0.65 0.15 190)` | `oklch(0.85 0.08 200)` | Cyan accent / outlier series. |
| `--chart-axis` | `oklch(0.45 0.02 240)` | `oklch(0.68 0.02 240)` | Recharts axis tick/label stroke. |
| `--chart-grid` | `oklch(0.18 0.02 240 / 0.08)` | `oklch(1 0 0 / 0.08)` | CartesianGrid line color. |

shadcn's `ChartContainer` re-emits the per-key chart vars as `--color-{key}` so any chart series defined in a `ChartConfig` auto-themes.

### Sidebar

`--sidebar-*` family (8 tokens) for the left rail. Slightly darker than the main canvas in dark mode; lighter and slightly blue-tinted in light mode. Borders use the brand sky-blue tint.

### Decorative gradient

`--gradient-stop-1` … `--gradient-stop-4` drive the `body::before` fixed overlay (4 radial gradients). Same sky-blue family across themes; dark uses ~28% alpha on the strongest stop, light uses ~16% so the overlay stays subtle.

```
top-left bloom (8% -5%)    — strongest, anchors the eye on the hero
mid-left extension (-5% 55%) — carries glow down past the sidebar
bottom-right counterweight (100% 110%) — composition balance
cyan highlight (85% 20%)    — small accent near login hero
```

---

## 5. Layout & spacing

| Token | Value | Notes |
|---|---|---|
| `--radius` | `0.7rem` | Base. `--radius-sm` (0.42rem), `-md` (0.56rem), `-lg` (0.7rem), `-xl` (0.98rem), `-2xl` (1.26rem), `-3xl` (1.54rem), `-4xl` (1.82rem) derived as multipliers in `@theme inline`. |
| Sidebar width | implicit (children-defined) | `app-sidebar.tsx` uses `w-56` (14rem). |
| Header height | `h-14` (3.5rem) | App-shell header in `(app)/layout.tsx`. |
| Page padding | `px-6 py-8` | Main content gutter in `(app)/layout.tsx`. |
| Min hit target | 32px (`h-8`) | Default button size. `sm` = 28px, `xs` = 24px, `lg` = 36px. |

No formal spacing scale beyond Tailwind defaults (`gap-1`/`-2`/`-3`/`-4` are the most-used).

---

## 6. Components — visual conventions

### Buttons (`src/components/ui/button.tsx`)

`buttonVariants` from `class-variance-authority`. Variants:

| Variant | Look | Used for |
|---|---|---|
| `default` | Solid primary (sky-blue) | Primary actions (Save, Create, Push to Campaign) |
| `outline` | Border + transparent fill | Secondary actions (Edit on template cards, Export CSV in non-dropdown contexts) |
| `secondary` | Muted fill | Rare |
| `ghost` | No border, hover-only fill | Tertiary (Cancel, Back) |
| `destructive` | Red tint | Delete confirmations |
| `link` | Underlined text | Rare |

Sizes: `xs` / `sm` / `default` / `lg` / `icon` (+ `icon-xs` / `icon-sm` / `icon-lg`). All buttons have built-in icon support — `size-4` SVGs render inline without extra classes.

### Badges (`src/components/ui/badge.tsx`)

Variants used today:
- **Default** primary tint — qualified count chips, default-template marker
- **Outline** with status-specific border + bg + text — campaign statuses (pending/running/completed/failed/canceled) per the `statusClasses` map in `campaigns/page.tsx`

Color map for campaign status badges:

| Status | Tailwind |
|---|---|
| pending | `border-muted-foreground/30 text-muted-foreground` |
| running | `border-primary/40 bg-primary/10 text-primary animate-pulse` (only in detail header) |
| completed | `border-emerald-500/40 bg-emerald-500/10 text-emerald-400` |
| failed | `border-destructive/40 bg-destructive/10 text-destructive` |
| canceled | `border-muted-foreground/30 text-muted-foreground` |

### Cards

`bg-card/40` is the default fill across the app — every page-level card uses translucent layered on the gradient. Card titles render in `--font-heading` (Space Mono via alias), `text-base font-medium`. Card descriptions use `text-muted-foreground`.

### Status colors for leads

In the campaign-detail table, `LeadStatus`:
- `pending` → `text-muted-foreground`
- `running` → `text-primary animate-pulse`
- `processed` → `text-emerald-400`
- `failed` → `text-destructive`
- `skipped` → `text-muted-foreground`

`FunctionVerdict` (the categorical "Qualified" cell): null → muted dash, "NO" → muted, "YES" → emerald-400 with checkmark icon, anything else → emerald-400 with the literal value.

### Forms

- Inputs: `src/components/ui/input.tsx` — `border-input bg-transparent rounded-lg`.
- Textarea: same styling; `template-form.tsx` adds `font-mono text-xs` for the system-prompt textarea so prompts read as code.
- Native HTML validation (required, minLength, maxLength) is the first line; server-action errors render in a red banner above the submit button.

### Dropdowns

`DropdownMenu` (base-ui) with shadcn styling. `DropdownMenuCheckboxItem` has `closeOnClick={false}` by default in base-ui, so multi-select stays open while toggling. Indicators are 16px lucide check icons positioned at `right-2`.

### Login hero

`login-hero.tsx`. ASCII glyph rendered in JetBrains Mono at responsive sizes (`text-[7px] sm:text-[8px] md:text-[9px]`), `text-primary` color. `animate-hero-breathe` keyframe (defined in `globals.css`) pulses opacity 0.55 → 0.95 + brightness 0.9 → 1.1 over 5s loops.

---

## 7. Theming mechanics

- `next-themes` toggles the `.dark` class on `<html>` (attribute strategy = `class`).
- `defaultTheme="dark"`, `enableSystem={false}`. The login screen renders before the theme provider mounts and stays dark-locked regardless.
- The Sun/Moon toggle in the app header (`theme-toggle.tsx`) is the only entry point.
- All color tokens swap via the class — no JS reads needed.
- shadcn's chart wrapper emits CSS for both `[data-chart=...]` (light) and `.dark [data-chart=...]` (dark) so the theme split flows through to series colors.

---

## 8. Where things live

| Concern | File |
|---|---|
| Token declarations | `src/app/globals.css` |
| Theme provider | `src/components/theme-provider.tsx` |
| Theme toggle | `src/components/theme-toggle.tsx` |
| Font loading | `src/app/layout.tsx` |
| Component layer | `src/components/ui/*.tsx` |
| Page-title styling | `src/components/page-header.tsx` |
| Sidebar styling | `src/components/app-sidebar.tsx` |
| Login hero | `src/components/login-hero.tsx` |
| Chart wrapper | `src/components/ui/chart.tsx` |

---

## 9. How to change a token

1. **Color** — edit the value in `globals.css` under both `:root` and `.dark`. Hard-refresh the dev server; the new value flows through every consumer automatically.
2. **Font** — `src/app/layout.tsx` imports from `next/font/google`; update the `variable` binding and the `weight` array, then update Section 3 of this doc. If introducing a new utility (`font-xxx`), also add the matching `--font-xxx: var(--font-xxx);` to `@theme inline` in `globals.css`.
3. **Radius** — change `--radius` in both themes; the size scale rederives via the `calc(var(--radius) * N)` multipliers in `@theme inline`.
4. **Gradient overlay** — adjust the four `--gradient-stop-*` tokens per theme. The geometry (positions / sizes of the four ellipses) lives in `body::before` directly.
5. **Component-level** — the shadcn-style overrides live in `src/components/ui/*.tsx`. Variants are CVAs; add a new variant or tweak the existing ones inline.

After any change: hard-refresh in the browser (Cmd+Shift+R) because Turbopack sometimes caches the previous CSS bundle.

---

## 10. Decisions on the table

Concrete candidates for the next visual pass — none of these are committed, all are starting points.

- **Body face revisit.** Space Mono is identifiable but heavy on long-form prose (reasoning expansions in lead detail can read dense). A clean sans for `--font-sans` (Inter / IBM Plex Sans / Geist) while keeping JetBrains Mono on `font-mono` and VT323 on `font-display` would be the lightest-touch upgrade.
- **VT323 size sweep.** Currently `text-5xl` on page H1s in `PageHeader`. The pixel grid reads better even bigger — `text-6xl` / `text-7xl` worth eyeballing for hero pages (Analytics, Campaigns).
- **Primary blue saturation pass.** Sky-blue is uniform across buttons, links, badges, qualified verdicts. Differentiating tone (e.g., a darker primary for buttons, the current bright for chips/badges) would add hierarchy.
- **Chart palette diversification.** `--chart-3` and `--chart-4` are similar muted blues; for multi-series breakdowns (per business unit, per company top-10) a more separated palette (purple / orange-warm / cyan-cold) reads cleaner. The shadcn chart system makes this a 5-line change in `globals.css`.
- **Card translucency in dark mode.** `oklch(... / 0.6)` looks great over the gradient but washes out when cards stack inside each other. A solid `--card-solid` variant for nested cases would help.
- **Status-badge consistency.** Campaign status uses semantic emerald/destructive/muted; lead status uses similar but not identical (e.g., `text-emerald-400` literal). Aligning to tokens (`text-success` / `text-destructive` / `text-muted-foreground`) would make future palette swaps painless.
- **Sidebar density.** The brand block + nav links + theme/connect pills all live above the fold but the spacing reads loose at `w-56`. Either tightening to `w-52` or formalizing a denser type scale for sidebar text.

---

## 11. Where it came from

- **Original launch palette (sky-blue + black, Space Mono)** — 2026-04-17 milestone M1.
- **Theme tokens + light mode** — 2026-05-07, added `:root` / `.dark` split, gradient stops per theme.
- **VT323 + JetBrains Mono adoption** — 2026-05-13, cloned from aiengineeringfromscratch.com.
