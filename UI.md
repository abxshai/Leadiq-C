# Lead-IQ — UI / design system

*Last updated: 2026-06-09*

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
| Primitives | `@base-ui/react` ^1.4 | Headless layer under shadcn (replaces Radix). Menu / Dialog / Select / Tooltip / AlertDialog / Tabs / Checkbox. | `src/components/ui/*.tsx` |
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

**Two faces:** JetBrains Mono (body + mono accents) and Major Mono Display (headings + subheadings). Both via `next/font/google` in `src/app/layout.tsx`; tokens mapped in `globals.css @theme inline`.

| Token | Family | Used for | Notes |
|---|---|---|---|
| `--font-mono` | **JetBrains Mono** (400 / 500 / 700) | The loaded mono var. | Font object's `variable`. |
| `--font-sans` | → `var(--font-mono)` | Body, paragraphs, table cells, KPI labels, all prose. | Default body face. |
| `--font-display` | **Major Mono Display** (400 only) | Page H1 titles (`PageHeader`, chat, login) + the sidebar/login "Lead-IQ" wordmark. | Geometric display monospace. |
| `--font-heading` | → `var(--font-display)` | Card / Dialog / AlertDialog titles ("subheadings"). | |

**Heading treatment.** Every heading element composes `font-display` (or `font-heading`) + **`lowercase`** + `tracking-wide`. The `lowercase` is deliberate: Major Mono Display maps lowercase input to clean capital glyphs, while *uppercase* input triggers its heavy "filled" alternates — so we type/transform to lowercase to get normal caps. Since the font ships only weight 400, extra weight comes from a same-color text-stroke (`[-webkit-text-stroke:Npx_currentColor]`): `0.6px` page H1s, `0.7px` login hero, `0.3px` card/dialog titles, `0.35px` sidebar wordmark. Sizes: `PageHeader` + chat H1 = `text-3xl`; login hero = `text-4xl sm:text-5xl`; Card/Dialog + sidebar wordmark = `text-base`.

**Decode animation.** Page H1s wrap their text in `<ScrambleText>` (`src/components/scramble-text.tsx`) — a glyph-scramble/decode that runs on mount and re-loops every 10s (hover trigger was removed for jitter). Animated glyphs are overlaid on an invisible full-text sizer so the decode never shifts layout; SSR/screen-reader safe (`aria-label`); honors `prefers-reduced-motion`.

**History:** JetBrains Mono came from [aiengineeringfromscratch.com](https://aiengineeringfromscratch.com/) (2026-05-13). On **2026-06-05** it replaced Space Mono (body) + VT323 (display) app-wide. On **2026-06-06** headings/subheadings moved to **Major Mono Display** (lowercase→caps, text-stroke for weight). Trial detours, all rejected: Pixelify Sans (Mondwest stand-in), Archivo expanded (Neue Plak Wide SemiBold stand-in — Neue Plak is Monotype/non-Google; can still drop a licensed `.woff2` in `src/app/fonts/` and repoint `--font-display` if wanted), Horizon (not on Google Fonts).

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
| `--accent` | `oklch(0.93 0.04 262)` | `oklch(0.24 0.04 262)` | Hover/focus surfaces (`bg-accent`). Hue tracks `--primary` so accent stays in family. |
| `--destructive` | `oklch(0.6 0.21 22.216)` | `oklch(0.704 0.191 22.216)` | Delete buttons, error banners. |

### Brand

Brand color is **#6bb3ff** sky-blue (OKLCH hue ~251), adopted 2026-06-06 (after iterating through #3dcbff cyan → #52b7ff → #3d70a6, all rejected). **Not** unified across themes: dark mode uses the literal #6bb3ff (`oklch(0.751 0.132 251)`); light mode deepens to `oklch(0.55 0.14 251)` so headings/buttons stay readable on the near-white canvas. Because #6bb3ff is bright, `--primary-foreground` is **dark** in dark mode (white-on-#6bb3ff fails contrast); light mode's deeper blue uses white foreground.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--primary` | `oklch(0.55 0.14 251)` | `oklch(0.751 0.132 251)` | **#6bb3ff** sky-blue (dark) / deeper blue (light). Buttons, focus rings, page H1 titles, qualified badges, primary chart series, sidebar primary surfaces. |
| `--primary-foreground` | `oklch(0.99 0 0)` (white) | `oklch(0.18 0.02 240)` (dark) | Text/icons on primary surfaces. **Dark in dark mode** so button text reads on the bright blue. |
| `--border` | `oklch(0.55 0.14 251 / 0.22)` | `oklch(0.751 0.132 251 / 0.2)` | Brand-tinted borders. |
| `--ring` | `oklch(0.55 0.14 251 / 0.55)` | `oklch(0.751 0.132 251 / 0.6)` | Focus rings (3px). |
| `--input` | `oklch(0.18 0.02 240 / 0.08)` | `oklch(1 0 0 / 0.08)` | Input field fills (kept neutral; not on the brand hue). |
| `--card-glow` | `0 0 0 1px rgb(0 0 0 / 0.04), 0 6px 20px -6px rgb(0 0 0 / 0.18)` | identical | Subtle dark-grey halo on cards. Applied in `card.tsx` via `shadow-[var(--card-glow)]` alongside the existing `ring-1 ring-foreground/10`. |

### Charts

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--chart-1` | `oklch(0.55 0.14 251)` | `oklch(0.751 0.132 251)` | Primary series (qualified leads, dominant bar fills). Tracks `--primary` (sky-blue). |
| `--chart-2` | `oklch(0.7 0.13 210)` | `oklch(0.78 0.13 210)` | Cyan-ish second series. |
| `--chart-3` | `oklch(0.5 0.18 258)` | `oklch(0.55 0.18 258)` | Indigo / purple-ish third series. |
| `--chart-4` | `oklch(0.78 0.05 240)` | `oklch(0.4 0.05 240)` | Muted / "not qualified" overlay (desaturated). |
| `--chart-5` | `oklch(0.65 0.15 190)` | `oklch(0.85 0.08 200)` | Cyan accent / outlier series. |
| `--chart-axis` | `oklch(0.45 0.02 240)` | `oklch(0.68 0.02 240)` | Recharts axis tick/label stroke. |
| `--chart-grid` | `oklch(0.18 0.02 240 / 0.08)` | `oklch(1 0 0 / 0.08)` | CartesianGrid line color. |

shadcn's `ChartContainer` re-emits the per-key chart vars as `--color-{key}` so any chart series defined in a `ChartConfig` auto-themes.

### Sidebar

`--sidebar-*` family (8 tokens) for the left rail. Surface / foreground / border tokens stay in the cool-neutral hue-240 family; `--sidebar-accent` (active and hover row fill) is on the brand sky-blue hue 251 so the selected nav item reads as the brand color rather than a generic cool grey.

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--sidebar` | `oklch(0.97 0.005 240)` | `oklch(0.04 0.005 240)` | Rail background. |
| `--sidebar-accent` | `oklch(0.94 0.04 251)` | `oklch(0.32 0.06 251)` | Active/hover row fill — brand-tinted. |
| `--sidebar-accent-foreground` | `oklch(0.4 0.13 251)` | `oklch(0.985 0 0)` | Text on active row. |
| `--sidebar-primary` | `oklch(0.55 0.14 251)` | `oklch(0.751 0.132 251)` | Mirrors `--primary`. |
| `--sidebar-border` | `oklch(0.55 0.14 251 / 0.18)` | `oklch(0.751 0.132 251 / 0.16)` | Brand-tinted hairlines. |
| `--sidebar-ring` | `oklch(0.55 0.14 251 / 0.55)` | `oklch(0.751 0.132 251 / 0.6)` | Focus rings on sidebar controls. |

Active row in `app-sidebar.tsx` composes `bg-sidebar-accent text-sidebar-accent-foreground ring-1 ring-primary/25` — the brand-tinted fill plus a faint primary ring around the edge.

### Decorative gradient

`--gradient-stop-1` … `--gradient-stop-4` drive the `body::before` fixed overlay (4 radial gradients). All four blobs are **bottom-right-anchored** (flipped from top-left on 2026-06-05) so the upper-left of every page stays clean. Hues track the **#6bb3ff sky-blue** family (236 → 256), bloom (stop-1) on the brand value, stops 2–4 lighter. Alphas are kept low so it stays subtle: dark `0.10 / 0.07 / 0.05 / 0.05`, light `0.08 / 0.06 / 0.05 / 0.04`. (Tried grey/white mid-iteration — pure neutral read warm/brown against the cool-grey surfaces, so the bg follows the brand instead.)

```
88% 105%  — primary sky-blue bloom, largest (130% × 100%), bottom-right corner
100% 55%  — right-edge tail, lighter blue (90% × 80%)
75% 80%   — lower-right accent, lighter blue (70% × 60%)
105% 20%  — right-edge wisp, lighter blue (55% × 50%)
```

Alpha: light mode is subtle (0.08 / 0.06 / 0.05 / 0.04); dark mode roughly 2× heavier (0.20 / 0.14 / 0.10 / 0.10).

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
| `default` | Solid primary (#6bb3ff sky-blue; dark text in dark mode) | Primary actions (Save, Create, Push to Campaign) |
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

`bg-card/40` is the default fill across the app — every page-level card uses translucent layered on the gradient. Card titles render in `--font-heading` (Major Mono Display), `lowercase` `text-base` with a light `0.3px` text-stroke for weight (see §3). Card descriptions use `text-muted-foreground`.

### Status colors for leads

In the campaign-detail table, `LeadStatus`:
- `pending` → `text-muted-foreground`
- `running` → `text-primary animate-pulse`
- `processed` → `text-emerald-400`
- `failed` → `text-destructive`
- `skipped` → `text-muted-foreground`

`FunctionVerdict` (the categorical "Qualified" cell): null → muted dash, "NO" → muted, "YES" → emerald-400 with checkmark icon, anything else → emerald-400 with the literal value.

`TemperatureBadge` (the "Temp" cell, M-CX1) — outline Badge, `capitalize`, per `temperatureBadge` map in `campaign-detail.tsx`; null → muted dash:

| Temperature | Tailwind |
|---|---|
| hot | `border-red-500/40 bg-red-500/10 text-red-400` |
| warm | `border-amber-500/40 bg-amber-500/10 text-amber-400` |
| cold | `border-muted-foreground/30 text-muted-foreground` |

The Temperature filter chips above the table reuse the active-pill style `border-primary/40 bg-primary/10 text-primary` (active) vs `border-border text-muted-foreground` (inactive) — same `Thermometer` lucide glyph as the row cells. The inline-expand "Touchpoint history" section reuses the existing prose-expand divider/label conventions (no new tokens). Each cited Smartlead email shows an action verb color-coded by `actionColor` (replied → `text-emerald-400`, clicked → `text-primary`, opened → `text-amber-400`, sent → `text-muted-foreground`) with the subject quoted in `italic text-foreground/80` underneath. **Deep links** use `lucide:ExternalLink` (h-3) in `text-primary`: the HubSpot line links to the contact record (gated on `NEXT_PUBLIC_HUBSPOT_PORTAL_ID`), each Smartlead email links to its campaign (`{NEXT_PUBLIC_SMARTLEAD_BASE_URL|app.smartlead.ai}/app/email-campaigns-v2/{campaign_id}/leads?tab={action}`); both open in a new tab with `rel="noopener noreferrer"`.

### Touchpoint summary (`src/components/leads/touchpoint-summary.tsx`, M-CX2)

The on-demand thread-summary control inside the hot/warm "Touchpoint history"
expand. Own `"use client"` module so `lead-display.tsx` stays hook-free; rendered
by `TouchpointHistory` only when `touchpoint_match.smartlead.reply_thread_count > 0`,
positioned **above** the existing HubSpot line + cited events (those are
untouched). No new tokens.
- **Unsummarized state** — an `outline size-xs` Button "Summarize touchpoints"
  with a `lucide:Sparkles` glyph and a trailing muted `· {count}` (thread size);
  swaps to `lucide:Loader2 animate-spin` while loading. Errors render below in
  `text-destructive`.
- **Summarized state** — a `rounded-md border border-border/60 bg-muted/30 px-3 py-2`
  card: a `Sparkles` "Thread summary" label (same `uppercase tracking-wide
  text-[10px] text-muted-foreground` as the prose-expand labels) + muted date +
  a right-aligned "Re-summarize" ghost link (`RefreshCw`, `text-primary` on
  hover). The recap is plain `whitespace-pre-wrap text-foreground/90` (**not**
  markdown — the source is untrusted email-body text, so plain text keeps it
  XSS-safe). The actionable signal is a `text-primary` line led by
  `lucide:ArrowRightCircle`, `font-medium`.
- BYOK Groq key via `useGroqStore`; POSTs to
  `/api/leads/[id]/summarize-touchpoints` with `x-groq-key`. No key → inline
  "Connect your Groq key to summarize."

**Thread marker (`ThreadMarker` in `lead-display.tsx`).** A compact "is a reply
thread on file?" indicator rendered next to the `TemperatureBadge` in **both**
lead tables (campaign-detail + `/leads`), and mirrored as an explicit line in
the touchpoint expand. Driven by `threadCountOf(lead)` →
`touchpoint_match.smartlead.reply_thread_count` (recomputed by
`classify_campaign_temperature` on every cross-check, so it self-populates as
the threads table grows). States: recorded → `lucide:MessageSquareText` +
count in `text-primary`; none → `lucide:MessageSquareOff` in
`text-muted-foreground/40`; not-applicable (cold / no match) → nothing. The
expand shows "No reply thread recorded yet" (`MessageSquareOff`) in the
zero case, in place of the Summarize button.

### Checkbox (`src/components/ui/checkbox.tsx`)

Added 2026-06-08 for the `/leads` row selection (the first checkbox in the app). Base-UI `Checkbox` (`@base-ui/react/checkbox`) styled shadcn-like: `size-4 rounded-[0.3rem] border border-input`, checked/indeterminate states fill with `bg-primary text-primary-foreground` (driven by base-UI's `data-[checked]` / `data-[indeterminate]` attributes), `focus-visible:ring-[3px] ring-ring/50`. The indicator shows `lucide:Check`, or `lucide:Minus` when `indeterminate` (used for the header "select all on page" tri-state).

### Leads browser (`src/components/leads/leads-browser.tsx`)

The `/leads` table reuses the campaign-detail row presentation via the shared `src/components/leads/lead-display.tsx` (badges, `FunctionVerdict`, `TemperatureBadge`, `DetailGrid`/`TouchpointHistory`, the `temperatureBadge`/action maps — all extracted there 2026-06-08 so both tables stay identical). New conventions:
- **Filter bar** — same shell as analytics (`rounded-lg border border-border/60 bg-card/40 p-3`). Multi-selects reuse the shared `MultiSelect` (extracted to `src/components/ui/multi-select.tsx` alongside `PillGroup`/`Divider`). Text filters (`TextFilter`) are an inline `border-border/60 bg-background/40` pill with a leading `lucide` glyph (`Boxes` area / `Building2` company / `MapPin` location / `Search` free-text) and a trailing `X` clear; debounced 400 ms before writing to the URL. Area is a text filter (not a multi-select) because `product_area` is the per-lead company/team name — ~9.5k distinct values. The All/Qualified toggle is a `PillGroup`.
- **Selected-row tint** — `bg-primary/5` on the row.
- **Selection action bar** — appears when ≥1 row selected: `sticky bottom-4 w-fit mx-auto rounded-full border border-border bg-popover/95 px-4 py-2 shadow-lg backdrop-blur`, with Export CSV (`text-primary`), Copy URLs (`lucide:Copy`, swaps to `lucide:Check text-emerald-400` for 1.5 s on copy), and Clear. Selection persists across pages (client `Map` keyed by lead id), so it survives pagination.
- **Pagination** — centered Prev/Next `outline size-sm` buttons + "Page N of M" in `tabular-nums text-muted-foreground`; only rendered when >1 page.

### Forms

- Inputs: `src/components/ui/input.tsx` — `border-input bg-transparent rounded-lg`.
- Textarea: same styling; `template-form.tsx` adds `font-mono text-xs` for the system-prompt textarea so prompts read as code.
- Native HTML validation (required, minLength, maxLength) is the first line; server-action errors render in a red banner above the submit button.

### Dropdowns

`DropdownMenu` (base-ui) with shadcn styling. `DropdownMenuCheckboxItem` has `closeOnClick={false}` by default in base-ui, so multi-select stays open while toggling. Indicators are 16px lucide check icons positioned at `right-2`.

### Login hero

`login-hero.tsx`. ASCII glyph rendered in JetBrains Mono at responsive sizes (`text-[10px] sm:text-[12px] md:text-[14px]`). Color is driven by `animate-hero-stream` (defined in `globals.css`), a `background-clip: text` trickle: a repeating 9-stop white → grey → black → grey → white linear-gradient interpolated **in oklab**, tiled at `100% 2em`, with `background-position-y` animating 0 → 2em over 2s linear infinite. Effect: a dense fluid wave of light/dark bands streams downward through the glyph shapes.

Surrounding layout: `login/page.tsx` puts the headline column and the ASCII column in `grid gap-10 sm:gap-32 sm:grid-cols-[1fr_1.5fr] items-center`. The wide gap and right-skewed ratio push the ASCII clearly off to the right of the headline; `overflow-hidden` + `justify-end` on the ASCII container clips ~35 px of left-side leading whitespace (well inside the pattern's ≥270 px indent), so no glyphs are touched.

### Sidebar wordmark

`app-sidebar.tsx` header row: the `Lead-IQ` wordmark in **Major Mono Display** (`font-display lowercase text-base`, `0.35px` text-stroke), with the Deccan logo (`<Image src="/logowhite.png">`, `h-4`, `invert dark:invert-0` to flip the white-on-transparent asset black in light mode) **absolutely positioned at the top-left corner** of the wordmark (`absolute bottom-full left-0`). Asset lives at `public/logowhite.png` (776 × 240).

### Login page logo

`login/page.tsx` mirrors the sidebar pattern: the `lead-IQ` headline (Major Mono Display, `text-4xl sm:text-5xl`) with the Deccan logo (`<Image src="/logowhite.png">`, `h-5`) **absolutely positioned at the top-left corner** of the headline. Login is dark-locked, so no `invert` filter needed — the white logo renders on the dark canvas.

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
| Sidebar styling + wordmark | `src/components/app-sidebar.tsx` |
| Login page | `src/app/login/page.tsx` |
| Login hero (ASCII + trickle) | `src/components/login-hero.tsx` |
| Logo asset | `public/logowhite.png` |
| Chart wrapper | `src/components/ui/chart.tsx` |
| `--card-glow` consumer | `src/components/ui/card.tsx` |
| Chat surface | `src/app/(app)/chat/page.tsx`, `src/components/chat/*.tsx` |
| Leads browser | `src/app/(app)/leads/page.tsx`, `src/components/leads/leads-browser.tsx` |
| Shared lead cells/badges | `src/components/leads/lead-display.tsx` |
| Touchpoint summary control | `src/components/leads/touchpoint-summary.tsx` |
| Thread → prompt helper | `src/lib/touchpoint-thread.ts` |
| Leads filter parsing | `src/lib/leads-filters.ts` |
| Checkbox primitive | `src/components/ui/checkbox.tsx` |
| MultiSelect / PillGroup | `src/components/ui/multi-select.tsx` |
| Agent registry + tools | `src/lib/agents/*.ts`, `src/lib/agents/tools/*.ts` |
| Postgres pool (chat tools) | `src/lib/agents/pg-pool.ts` (uses `postgres.js`) |

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

- ~~**Body face revisit.**~~ Done 2026-06-05 — Space Mono → JetBrains Mono everywhere (and VT323 dropped). See §3.
- **Brand-blue hierarchy pass.** `#6bb3ff` is uniform across buttons, links, badges, qualified verdicts. In dark mode buttons are full-bright blue with dark text; a slightly deeper blue for solid buttons (keeping full #6bb3ff for chips/headings/accents) would add hierarchy if the bright buttons read too loud.
- **Chart palette diversification.** `--chart-3` and `--chart-4` are similar muted blues; for multi-series breakdowns (per business unit, per company top-10) a more separated palette (purple / orange-warm / cyan-cold) reads cleaner. The shadcn chart system makes this a 5-line change in `globals.css`.
- **Card translucency in dark mode.** `oklch(... / 0.6)` looks great over the gradient but washes out when cards stack inside each other. A solid `--card-solid` variant for nested cases would help.
- **Status-badge consistency.** Campaign status uses semantic emerald/destructive/muted; lead status uses similar but not identical (e.g., `text-emerald-400` literal). Aligning to tokens (`text-success` / `text-destructive` / `text-muted-foreground`) would make future palette swaps painless.
- **Sidebar density.** The brand block + nav links + theme/connect pills all live above the fold but the spacing reads loose at `w-56`. Either tightening to `w-52` or formalizing a denser type scale for sidebar text.

---

## 11. Where it came from

- **Major Mono Display headings + #6bb3ff + decode animation + logo move** — 2026-06-06 (visual pass). Headings/subheadings → **Major Mono Display** in `lowercase` (its clean-caps mode; uppercase triggers heavy "filled" alternates), weight faked via same-color text-stroke. Brand settled on **#6bb3ff** sky-blue (`oklch 0.751 0.132 251`) after #3dcbff/#52b7ff/#3d70a6 trials; gradient recolored to the same blue family (a grey/white detour read brown against the cool-grey surfaces). Page H1s gained a 10s glyph-**decode animation** (`scramble-text.tsx`, layout-stable overlay, reduced-motion aware). The Deccan **logo** moved to the **top-left corner** of the "Lead-IQ" wordmark (sidebar + login).
- **Heading face → Archivo (Neue Plak Wide stand-in)** — 2026-06-06 (superseded same day by Major Mono Display, above). Headings + subheadings moved off JetBrains Mono to **Archivo** (variable, `wdth` axis) styled `font-stretch-expanded` + `font-semibold` + `uppercase` + `tracking-wide` — a free substitute for **Neue Plak Wide SemiBold caps** (Monotype, not on Google Fonts). Applied via `--font-display` (page H1s) and `--font-heading` (Card/Dialog titles); body stays JetBrains Mono. Real Neue Plak can drop into `src/app/fonts/` and swap one token. (Detour: Pixelify Sans was trialled as a Mondwest stand-in and rejected.)
- **Type unification + cyan rebrand + gradient flip** — 2026-06-05. (1) **One typeface:** JetBrains Mono promoted to the whole app, dropping Space Mono (body) and VT323 (display), after the user compared readability against [cyber.fund](https://cyber.fund/) (which is all JetBrains Mono). Title sizes dropped to fit a real font (`text-5xl`→`text-3xl`; login `7xl`→`5xl`). (2) **Brand → #3dcbff cyan** (`oklch(0.79 0.138 230)`), replacing #4E8CFA indigo across primary / border / ring / accent / chart-1 / sidebar. Not theme-unified: dark = literal #3dcbff, light = darker `oklch(0.6 0.15 230)` for contrast on white; `--primary-foreground` flips dark in dark mode (white fails on bright cyan). (3) **Gradient flipped** top-left → bottom-right (point-reflected the four blob positions), recolored to the cyan family (215–235), and dark-mode alpha halved (bloom `0.20→0.10`) because the brighter cyan popped too much.
- **Original launch palette (sky-blue + black, Space Mono)** — 2026-04-17 milestone M1.
- **Theme tokens + light mode** — 2026-05-07, added `:root` / `.dark` split, gradient stops per theme.
- **VT323 + JetBrains Mono adoption** — 2026-05-13, cloned from aiengineeringfromscratch.com.
- **Brand refresh** — 2026-05-13. Primary swapped from the original sky-blue (`oklch(0.6 0.17 237)`) to **#4E8CFA** (`oklch(0.65 0.18 262)`) after an iteration cycle (#59afff too pale → #2596be too dark → #BDF6FE too washed-out → #276DF9 saturated but heavy → settled on #4E8CFA, slightly lighter and same hue family). Unified across themes (one OKLCH triplet in both modes). `--primary-foreground` set to white in both modes (was light-only). H1 page titles tinted via `text-primary`. Cards gained a subtle dark-grey `--card-glow` box-shadow halo. Sidebar wordmark `Qualifier` → `Lead-IQ`, Sparkles glyph replaced by `logowhite.png` (Deccan / company mark, white-on-transparent, inverted in light mode). `--sidebar-accent` rebased onto hue 262 so the active nav row reads as brand. Metadata title also flipped to just `Lead-IQ`.
- **Background gradient → indigo family, left-anchored** — 2026-05-13. Four radial blobs concentrated on the left half (behind page title, trailing down the left edge). Cyan stops (hues 200 / 230) retired in favour of a uniform indigo family (262 → 275 → 270 → 280) with stops 2–4 noticeably lighter than the brand anchor. Blob sizes ~2× larger than the original launch geometry with softer 75–80% fades for an atmospheric feel.
- **Login hero animation overhaul** — 2026-05-13. `animate-hero-breathe` (opacity + brightness pulse) replaced by `animate-hero-stream` — a `background-clip: text` trickle with a 9-stop white → grey → black → grey → white oklab gradient on a 2em vertical tile, scrolled downward at 2s linear infinite. Iteration history: started as a uniform color-cycle, briefly tried a 135° diagonal stream (rolled back), then white static (rolled back), landed on the dense fluid white-grey-black wave. ASCII size 7 / 8 / 9 px → 10 / 12 / 14 px; column grid widened to `sm:gap-32 sm:grid-cols-[1fr_1.5fr]`. Login H1 swapped to `font-display` (VT323) to match in-app PageHeader. Company logo added above the headline.
- **LeadQuery chat surface (M-AG1)** — 2026-05-29. New `/chat` route shipped with a multi-agent registry; first agent is **LeadQuery** (natural-language → read-only SQL). UI conventions added: user message bubbles use `bg-primary/15` with `border-primary/30`; assistant turns are plain-flow text (*superseded 2026-06-05 — now rendered as markdown, see below*); tool-call cards use a collapsible `bg-muted/30` + `border-border` pill with `font-mono text-xs` body, `lucide:Wrench` glyph for the tool name, and status icons that map to existing semantic tokens (pending → `text-muted-foreground` + `animate-spin`, success → `text-emerald-400`, failure → `text-destructive`). No new design tokens introduced — re-uses the existing palette throughout. Sidebar gained a new "Chat" entry between Analytics and Settings (`lucide:MessageSquare`). Page title uses `font-display` (VT323) inline rather than via `PageHeader` to avoid a prop-shape guess.
- **LeadQuery answers render as markdown** — 2026-06-05. Assistant turns moved from raw `whitespace-pre-wrap` text to GitHub-flavored markdown via `react-markdown` + `remark-gfm`, in `src/components/chat/markdown-message.tsx`. Element styling reuses existing tokens — no new design tokens. Conventions: **tables** wrap in an `overflow-x-auto` + `rounded-md border border-border` container with a `border-collapse text-xs` `<table>` (so wide CRM results scroll inside the bubble and the table is natively selectable/copyable), `thead` on `bg-muted/50`, `th`/`td` at `px-3 py-2 align-top`, `td` divided by `border-r border-border/50`; **links** are `text-primary underline underline-offset-2 break-all`, opened in a new tab with `rel="noopener noreferrer"`; **inline code** is a `bg-muted` pill, **block code** sits in a `bg-muted/40 border border-border` `<pre>`. react-markdown allows no raw HTML by default, so rendering the (untrusted) DB-derived summary text stays XSS-safe. Only assistant turns are markdown; user input stays plain text. The LeadQuery system prompt was updated in tandem to emit markdown tables, `[label](url)` links, and ```sql fences. Deps: `react-markdown@9.1.0`, `remark-gfm@4.0.1`.
