# Design System V1

Date: 2026-08-29

Work items: SDC-009, SDC-014 through SDC-021

## Brief

This is a full-tab Chrome-extension workspace for fantasy-football players who
want to turn personal rankings into deliberate live draft decisions. The job is
to make setup recoverable and the draft surface immediately scannable. It
should feel precise, fast, and cyberpunk without becoming decorative or noisy.
The main objection is trust: users need proof that imports matched correctly,
data stays local, and the extension cannot submit picks. The memorable element
is a signal rail that reports identity, board, match, and room readiness as
honest instrument states.

## Research Summary

- Queries: 5 screen searches, 3 style searches, and 1 flow search.
- References reviewed: 50 screens, 8 screen deep dives, 3 full style systems,
  and the 9-step Resend CSV import flow.
- Resend separates upload, mapping, and row review; its review provides All,
  Valid, and Error states before the write.
- Intercom shows exact row, column, and error reasons after import instead of a
  single failure count.
- Rox uses 48-56px table rows, a 24px page gutter, anchored filters, and
  low-contrast hairline dividers for dense data.
- Anthropic and n8n place compact summary metrics and filters above the primary
  data view, preserving a predictable scan path.
- The Athletic keeps player identity in the first wide column and narrow
  numeric attributes aligned to its right.

## Reference Lock

Primary foundation: Turso's electric-teal command center, translated from a
marketing system into a compact product workspace.

Borrowed details:

- Inngest: amber is reserved for urgency, active decisions, and stale states.
- Rarible: monospace is reserved for rank, ADP, pick, tier, and status data.
- Rox: dense flat tables use borders and surface shifts instead of shadows.
- Resend: every import passes through a resumable review state.
- Intercom: errors are actionable at row level.

Rejected:

- Purple-dominant palettes, glow effects, gradient backgrounds, oversized hero
  text, nested cards, decorative orbs, and status color without text.
- Marketing copy inside the working product.
- Hidden autosave, silent match replacement, or irreversible imports.

## Tokens

- Canvas: `#080c0f`
- Surface: `#10171b`
- Raised surface: `#172228`
- Border: `#263840`
- Primary text: `#f1f5f6`
- Secondary text: `#8fa1a9`
- Primary action and ready state: `#4ff7d1`
- Urgency and stale state: `#efc66d`
- Error: `#f07667`
- Success secondary: `#65d68b`

Use Inter or the system sans stack for interface text and the system monospace
stack for data. Body text stays 14-16px; compact metadata stays 11-12px; panel
headings stay 18-24px. Letter spacing is `0` except uppercase instrument labels
at `0.06em`. Cards never exceed an 8px radius. Buttons and form controls use a
4-6px radius. Spacing follows 4, 8, 12, 16, 24, 32, and 48px increments.

## Interaction Rules

- Focus rings use a 2px amber outline with 3px offset.
- Hover feedback completes within 150ms; larger state changes within 220ms.
- Reduced-motion mode disables nonessential transitions.
- All icon-only actions require accessible names and 44px targets.
- Tables retain fixed rank, position, team, ADP, tier, and action columns while
  the player-name column absorbs available width.
- At mobile widths, setup stages stack; ranking rows retain identity and rank,
  while secondary metadata moves to a second line without horizontal overflow.

