# packages/ui

The Vertex design system: shadcn/ui patterns on Base UI, Tailwind CSS v4 tokens, RTL (ADR 0004, ADR 0011). Read `brand/identity.md` before changing anything visual.

## Layout
- `src/styles/theme.css`: the only place colors and design tokens are defined (light and dark).
- `src/components/<name>.tsx`: one component family per file, exported from `src/index.ts`. Pattern to copy: `src/components/button.tsx` (Base UI primitive + `cva` variants + `cn`).
- `src/brand/`: logo and the 60° ascent motif.

## Rules the tests enforce (`src/conventions.test.ts`, `src/tokens.test.ts`)
- Logical directions only: no `ml-`/`mr-`/`pl-`/`pr-`/`left-`/`right-`/`text-left`.
- No hex, `rgb()` or `oklch()` values outside `theme.css`.
- None of the patterns in `brand/identity.md` §8: gradients, backdrop blur, italic, letter spacing, uppercase, monospace.

## Rules to apply yourself
- Build on Base UI primitives, keep their accessibility (focus rings, keyboard, ARIA), and use the `render` prop instead of wrapper elements.
- Every component sets `data-slot` (directly, or through `useRender` state as in `badge.tsx`), merges `className` with `cn`, and passes other props through.
- Variants through `cva` with semantic names (`tone`, `variant`, `size`), mapped to semantic tokens (`bg-primary`, `text-muted-foreground`), never to raw palette steps in app code.
- No user-facing text inside components: labels come in as props, so the app translates them.
- New components appear on the design-system page (`apps/web/src/routes/_app/design-system.tsx`) and in its screenshots.
- Fonts: Madani Arabic files are never committed (git-ignored `brand/fonts/private/`). The build must work with the Noto Kufi Arabic fallback.

Run: `pnpm --filter @vertex-hub/ui test` · `pnpm --filter @vertex-hub/ui typecheck`.
