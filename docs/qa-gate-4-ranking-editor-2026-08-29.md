# QA Gate 4: Ranking Editor

Date: 2026-08-29

Plan items: SDC-015 through SDC-017

Result: Pass

## Delivered

- Added a full-tab, searchable ranking workspace with position filters, rank,
  ADP, tier, notes, format, and profile metadata.
- Added pointer-driven reorder handles that work with mouse or touch, direct rank
  movement, and keyboard movement with bounded history.
- Added undo, redo, 500ms local autosave, save-state feedback, and reload
  recovery without mutating another profile.
- Added profile create, clone, rename, delete, import, and export operations with
  a 50-profile limit, unique names, isolated player arrays, and draft-session
  reference cleanup.
- Added strict public ranking-pack import and export. Exports contain only schema,
  profile name, format, and normalized player fields; they omit account, league,
  draft, and session state.
- Added responsive mobile rows with an accessible player detail dialog for fields
  that do not fit the compact board.
- Routed saved-profile users from the popup and setup workspace into the ranking
  editor while preserving onboarding for new users.

## Verification

`npm test`

- Pass: 60 JavaScript tests and 3 Python release-safety tests.
- Editor fixtures cover target-rank movement, drag-order semantics, keyboard
  deltas, contiguous ranks, bounded history, field normalization, undo, redo,
  redo invalidation, search, and position filtering.
- Profile fixtures cover create, clone isolation, unique rename, delete cleanup,
  active-profile selection, update isolation, exact public export/reimport, future
  schema refusal, duplicate IDs, and invalid positions.
- Manifest tests include every editor script, enforce the existing permission
  allowlist and local CSP, and scan the editor for HTTP write methods.
- The public release safety gate passes with no private markers or risky artifacts.

`SDCC_HEADED=1 node tools/browser_gate_4.cjs`

- Pass in an actual unpacked Manifest V3 extension context.
- Loaded two isolated fictional 250-player profiles.
- Verified search and every position filter.
- Reordered through pointer drag, keyboard movement, and direct rank entry.
- Edited ADP, tier, and notes; verified undo and redo.
- Waited for autosave, reloaded, and recovered exact ordering and field values.
- Created, cloned, renamed, deleted, imported, and exported profiles.
- Deleted the source profile and reimported its exported pack with exact deep
  equality across name, format, player order, IDs, ADP, tiers, and notes.
- Reported zero browser console or page errors.
- Reported no document or body overflow at desktop or the 375px content viewport
  used by the 390x844 browser window.

## Visual QA

The browser gate writes fictional-data screenshots outside the public release
root under `exports/sleeper-draft-command-center-qa/gate-4`:

- `01-ranking-editor-desktop.png`
- `02-ranking-editor-mobile.png`

Visual inspection confirmed a clear profile hierarchy, stable row dimensions,
legible position signals, visible command states, bounded text, complete mobile
controls, no nested cards, no incoherent overlap, and no horizontal overflow.

## Gate Audit

- Search and filters: pass at desktop and mobile widths.
- Rank and ADP columns: pass.
- Tier and notes editing: pass.
- Pointer and keyboard reorder: pass.
- Undo and redo: pass.
- Autosave and reload: pass.
- Multi-profile isolation: pass.
- Lifecycle controls: pass.
- Safe export and identical reimport: pass.
- Private separation: release gate passes.

No Gate 4 gaps remain. Phase 5 may begin.
