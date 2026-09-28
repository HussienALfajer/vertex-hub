# 0004 — Vertex design system on shadcn/ui + Base UI

Status: Accepted · Date: 2026-09-28

## Context
The UI must follow Vertex Media's visual identity, be Arabic RTL first, and stay consistent as the system grows.

## Decision
- **shadcn/ui** as the component source: components are copied into `packages/ui` and owned by us, not consumed as a styled dependency.
- **Base UI** primitives (shadcn/ui's default since July 2026; stable since 1.0 in December 2025; actively maintained). Radix was not chosen because development momentum moved to Base UI.
- **Tailwind CSS v4** with design tokens (color, typography, spacing, radius, shadow, motion) derived from the Vertex brand identity and exposed as CSS variables.
- **RTL** through shadcn/ui's RTL mode (logical classes, mirrored icons and animations).

Rejected: MUI, Mantine, Ant Design (strong built-in look, hard to turn into a distinct brand); React Aria Components (best-in-class accessibility and i18n, but more verbose and outside the shadcn ecosystem).

## Consequences
- Tokens are built **before** any screen, from the brand assets (see open questions).
- To avoid a generic look, the design system keeps an explicit list of patterns to avoid, extended after each review.
- Apps import UI only from `packages/ui`; no ad-hoc colors, fonts or spacing.
