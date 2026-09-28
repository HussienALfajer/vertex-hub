# Brand assets

Single source for Vertex Media brand assets used by Vertex Hub. Apps and packages reference files from here (the design system copies or imports them at build time); don't keep other copies of the logo in the repository.

Visual identity rules: [identity.md](identity.md).

## Logo files

| Path | Contents | Use |
|---|---|---|
| `logo/source/` | Original raster files as delivered | Reference only |
| `logo/svg/vertex-logo.svg` | Full logo (mark + wordmark), `fill="currentColor"` | UI: inherits text color, works in both themes |
| `logo/svg/vertex-mark.svg` | Mark only, `currentColor` | Sidebar, compact headers, loaders |
| `logo/svg/vertex-{logo,mark}-{green,gold,white}.svg` | Fixed-color variants | Emails, PDFs, anywhere CSS color is unavailable |
| `logo/svg/favicon.svg` | Sand mark on a green rounded square | Browser favicon |
| `logo/png/vertex-logo-{green,gold,white}.png` | 1024 px, transparent | Email clients and tools that don't support SVG |
| `logo/png/vertex-mark-{green,gold,white}.png` | 512 px, transparent | Same |
| `logo/png/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | Sand mark on Vertex Green | PWA manifest and home-screen icons |

## Provenance

The SVGs were traced from `logo/source/vertex-logo-green-on-white.jpg` and match it at 99.3% pixel overlap. They are production-ready for UI sizes. When the designer's original vector files (AI/EPS/SVG) are available, replace the traced SVGs with them and regenerate the PNGs.

## Fonts

- Madani Arabic is a commercial font: its files are **never committed** (this repository is public). Keep them in `brand/fonts/private/` (git-ignored) locally and provision them on the server outside the repository.
- Montserrat and Noto Kufi Arabic (SIL OFL) are installed as packages when the design system is scaffolded.
