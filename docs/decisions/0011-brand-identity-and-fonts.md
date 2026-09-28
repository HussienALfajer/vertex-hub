# 0011 — Brand identity and fonts

Status: Accepted · Date: 2026-09-28

## Context
The owner provided the Vertex Media logo (green on white, sand on green, sand on white) and chose the **Madani Arabic** typeface. The repository is public.

## Decision
- The visual identity is defined in `brand/identity.md` and derived from the logo: Vertex Green `#004139` (primary), Vertex Sand `#B9A87A` (accent), OKLCH tonal scales, green-tinted neutrals, distinct status colors, a dark theme that mirrors the logo's sand-on-green colorway, and the 60° diagonal as the signature motif.
- Brand assets live in `brand/` and nowhere else. Traced SVGs (`currentColor` and fixed colorways) are the UI source until the designer's original vectors arrive.
- **Arabic typeface: Madani Arabic (Namela),** a commercial font. Its files are never committed; they are kept in the git-ignored `brand/fonts/private/` locally and provisioned on the server outside the repository. The build must work without them, falling back to Noto Kufi Arabic.
- **Latin and digits: Montserrat** (OFL), matching the logo wordmark, applied through `unicode-range` so Arabic renders in Madani and Latin/digits in Montserrat.

## Consequences
- A valid Madani Arabic license covering web embedding (and server-side PDF embedding for quotes and invoices) must exist before production use (open question Q11).
- CI and contributors build with the fallback font; production serves the licensed files.
- Vertex Sand fails contrast on light surfaces (2.35:1) and is never used for text or icons there.
