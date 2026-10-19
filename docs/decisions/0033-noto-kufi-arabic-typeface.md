# 0033 — Noto Kufi Arabic is the Arabic typeface

Status: Accepted · Date: 2026-10-19

## Context
ADR 0011 chose Madani Arabic, a commercial font, and kept Noto Kufi Arabic as the fallback until a license and the font files arrived (open question Q11). The app has run on Noto Kufi Arabic since the design system was built, in the web app and in every PDF. On 2026-10-19 the owner closed Q11: drop Madani Arabic and keep the current font.

## Decision
- **Arabic typeface: Noto Kufi Arabic** (SIL OFL), from `@fontsource/noto-kufi-arabic`, at weights 400, 500 and 700. **Latin and digits: Montserrat** (SIL OFL), unchanged from ADR 0011.
- The font stack is `"Montserrat", "Noto Kufi Arabic", system-ui, sans-serif` in the web app (`packages/ui` theme) and in the worker's PDFs.
- The Madani loading path is removed: the `virtual:madani-fonts` Vite plugin, `madani.css`, the `/fonts/madani/` nginx location, `MADANI_FONTS_DIR` in the deploy and the server's `fonts/` directory.
- Commercial font files are still never committed: the repository is public. `brand/fonts/private/` stays git-ignored.

## Consequences
- No license is needed for web or PDF embedding; Q11 is resolved.
- Nothing changes on screen or in the PDFs: they already rendered in Noto Kufi Arabic.
- Choosing a commercial typeface later needs a new ADR, a license covering web and PDF embedding, and a loading path for files kept out of the repository.
