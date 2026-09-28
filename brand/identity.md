# Vertex Media — Visual Identity for Vertex Hub

The single reference for how Vertex Hub looks. Derived from the Vertex Media logo (`brand/logo/`). Design tokens in `packages/ui` implement these values; if they disagree, this file wins until it is changed deliberately.

## 1. What the logo says

| Logo trait | Meaning | How the product uses it |
|---|---|---|
| A peak built from three parallel strokes | *Vertex* = the summit; progress upward | Progress and "reaching the goal" moments (retainer counters, approvals) |
| Strokes at a constant 60° angle, equal gaps | Order, rhythm, precision | The **60° diagonal** is the signature motif; a strict 4 px spacing grid |
| Sharp corners, flat fills, no gradients | Confident, architectural, calm | Small radii, flat surfaces, borders over shadows |
| Deep green + sand gold | Trust and growth + premium craft | Green carries structure and action; gold is a rare accent |
| Geometric sans wordmark, wide-tracked "MEDIA" | Modern, clean | Montserrat for Latin text; tracking only on Latin overlines |

## 2. Color

### Brand colors (sampled from the logo)

| Name | Hex | OKLCH | Role |
|---|---|---|---|
| **Vertex Green** | `#004139` | 0.337 0.061 181.4 | Primary: structure, navigation, primary actions |
| **Vertex Sand** | `#B9A87A` | 0.735 0.065 90.1 | Accent: highlights, active states, key moments |
| White | `#FFFFFF` | — | Surfaces |

### Tonal scales

Generated in OKLCH around the brand hues; the brand colors sit at `green-800` and `gold-400`.

| Step | green | gold | neutral (green-tinted) |
|---|---|---|---|
| 50 | `#E8FCF8` | `#FCF7E7` | `#F4F8F7` |
| 100 | `#DBF3EE` | `#F3EDDA` | `#E7EFED` |
| 200 | `#C2E1DA` | `#E1D9C1` | `#D4DBD9` |
| 300 | `#A0C7BF` | `#C8BD9E` | `#B8BFBE` |
| 400 | `#77AAA1` | **`#B9A87A`** | `#99A09F` |
| 500 | `#4E8E83` | `#907F4F` | `#7B8280` |
| 600 | `#307369` | `#766434` | `#616866` |
| 700 | `#235B52` | `#5D4E27` | `#4B5150` |
| 800 | **`#004139`** | `#433819` | `#353B39` |
| 900 | `#0B2D28` | `#2E260E` | `#222827` |
| 950 | `#031B17` | `#1B1505` | `#121716` |

### Status colors

Kept visibly distinct from the brand: success is a brighter emerald (not Vertex Green), warning is orange-amber (not Vertex Sand).

| Step | success | warning | danger | info |
|---|---|---|---|---|
| 50 | `#E5FFE9` | `#FFF5EE` | `#FFF4F2` | `#F0F8FF` |
| 100 | `#D4F8DA` | `#FEE8D8` | `#FEE7E3` | `#DEEFFE` |
| 500 | `#3C9555` | `#BB6814` | `#D54A43` | `#3786C3` |
| 600 | `#167A3A` | `#97520A` | `#B62926` | `#116BA7` |
| 700 | `#09602B` | `#783F04` | `#921B1A` | `#055485` |

### Semantic roles

| Role | Light theme | Dark theme |
|---|---|---|
| App background | neutral-50 `#F4F8F7` | green-950 `#031B17` |
| Surface (cards, panels) | white | green-900 `#0B2D28` |
| Text | neutral-900 `#222827` | neutral-100 `#E7EFED` |
| Muted text | neutral-600 `#616866` | neutral-400 `#99A09F` |
| Border | neutral-200 `#D4DBD9` | green-700 `#235B52` |
| Primary action | green-800 bg, white text | gold-400 bg, green-950 text |
| Accent | gold-400 | gold-400 |
| Accent as text | gold-700 `#5D4E27` | gold-300 `#C8BD9E` |
| Focus ring | gold-500 `#907F4F`, 2 px, 2 px offset | gold-400 |
| Sidebar | green-800 bg, neutral-100 text, gold-400 active marker | green-950 bg, same markers |

The dark theme is the logo's own inverse: sand on deep green.

### Measured contrast (WCAG 2.2)

| Pair | Ratio | Verdict |
|---|---|---|
| White on Vertex Green | 11.57 | AAA |
| Vertex Sand on Vertex Green | 4.93 | AA text |
| green-950 on Vertex Sand | 7.63 | AAA |
| neutral-900 on white | 14.99 | AAA |
| neutral-600 on white | 5.71 | AA |
| gold-700 on white | 8.13 | AAA |
| neutral-100 on green-950 | 15.32 | AAA |
| neutral-100 on green-800 (sidebar) | 9.90 | AAA |
| neutral-400 on green-900 (dark muted) | 5.55 | AA |
| gold-400 on green-900 (dark accent) | 6.30 | AA |
| gold-500 focus ring on neutral-50 | 3.68 | AA non-text (≥ 3) |
| **Vertex Sand on white** | **2.35** | **Fails — never use for text or icons on light surfaces** |

### Proportion

About 60% neutral surfaces, 30% green, 10% sand. Sand is precious: if everything is gold, nothing is.

### Workflow status colors

| Task status | Color |
|---|---|
| New | neutral |
| In progress | info |
| Internal review | gold |
| Awaiting client | warning |
| Revisions | danger (soft tint) |
| Approved | success |
| Delivered / published | Vertex Green |

## 3. Typography

| Script | Typeface | Source and license |
|---|---|---|
| Arabic | **Madani Arabic** (Namela) | Commercial. Needs a web license (and coverage for server-side PDF embedding). Font files are private: never committed to this public repository. |
| Latin and digits | **Montserrat** | SIL OFL. Matches the geometric wordmark in the logo. |
| Arabic fallback | Noto Kufi Arabic | SIL OFL. Used until the Madani files and license are in place, and as a runtime fallback. |

Implementation rules:
- Madani's `@font-face` uses an Arabic `unicode-range`, so Latin letters and digits render in Montserrat.
- Stack: `"Madani Arabic", "Montserrat", "Noto Kufi Arabic", system-ui, sans-serif`.
- Weights: 400 body, 500 labels and table headers, 700 headings.
- Never letter-space Arabic, never italicize Arabic, never justify Arabic UI text.
- Tabular figures (`font-variant-numeric: tabular-nums`) in tables, money and counters.
- Digits: Latin digits recommended for financial data (open question Q3).

Scale (size / line height, px), Arabic-friendly line heights:

| Token | Size | Line height | Use |
|---|---|---|---|
| xs | 12 | 18 | Captions, meta |
| sm | 13 | 20 | Secondary text, table cells |
| base | 15 | 24 | Body, inputs |
| md | 16 | 26 | Emphasized body |
| lg | 18 | 28 | Section titles |
| xl | 20 | 30 | Card titles |
| 2xl | 24 | 34 | Page titles |
| 3xl | 30 | 40 | Dashboard figures |
| 4xl | 36 | 46 | Hero figures, login |

## 4. Shape, space and depth

- **Spacing:** 4 px grid (4, 8, 12, 16, 20, 24, 32, 40, 48, 64).
- **Radius:** sm 4 (badges, chips), md 6 (buttons, inputs), lg 8 (cards), xl 12 (dialogs, sheets). No pill-shaped buttons; full rounding only for avatars and status dots.
- **Depth:** borders define structure. Shadows only for floating layers (menus, popovers, dialogs), one soft green-tinted shadow.
- **Lines:** 1 px borders; 2 px for focus and active markers.

## 5. The signature motif: the 60° ascent

The logo's parallel strokes at 60° become the product's recognizable detail, used sparingly:
- A short sand diagonal bar at the start of page titles.
- Parallel 60° hairlines as a quiet pattern on the login screen and empty states.
- The retainer deliverables meter drawn as ascending stepped bars reaching a peak when the month's commitment is met.

Never animate it continuously, never use it as a full-page background behind content.

## 6. Iconography and motion

- Lucide icons, 1.75 px stroke, 20 px default, 16 px in dense tables. Directional icons mirror in RTL.
- Motion: 150 ms (hover, press), 200 ms (menus, popovers), 250 ms (dialogs, sheets), ease-out. Respect `prefers-reduced-motion`.

## 7. Logo usage

| Rule | Value |
|---|---|
| Clear space | One stroke width of the mark on every side (≈ 10% of the mark's width) |
| Minimum size | Full logo 96 px wide; mark 24 px; below that use the favicon |
| Approved colorways | Green on white or light surfaces; sand on Vertex Green; white on Vertex Green or dark photos; sand on white only at large sizes (≥ 160 px) |
| In the app | Sidebar: sand mark on green. Login: full logo. Documents (quotes, invoices): green full logo on white |
| Don't | Recolor outside the palette, stretch, rotate, outline, add shadows or gradients, place on busy images, rebuild the wordmark in another font |

## 8. Patterns to avoid (to keep the product from looking generic)

Cream or beige page backgrounds · purple/blue gradients · glassmorphism · pill-shaped buttons · italic accent words in headings · numbered "01/02/03" section labels · monospace labels as decoration · emoji as icons · heavy drop shadows · gold text on light surfaces · letter-spaced Arabic.

Extend this list after each design review.

## 9. Voice (UI copy)

Modern Standard Arabic, clear and concise. Verbs on buttons ("احفظ", "أرسل للعميل"). Numbers and dates formatted consistently. No exclamation marks in system messages.
