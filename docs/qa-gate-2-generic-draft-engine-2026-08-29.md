# QA Gate 2: Generic Draft Engine

Date: 2026-08-29

Plan items: SDC-006, SDC-007, SDC-008

Result: Pass

## Delivered

- Added `src/draft-order.js` with deterministic normal-snake and third-round-
  reversal mapping, current-pick detection, manual-pick creation, undo, and
  live/manual merge rules.
- Added `src/recommendation-engine.js` with format-aware roster targets,
  position limits, decision-point calculation, availability, run detection,
  room demand, tier cliffs, ADP fallers, and ranked recommendation roles.
- Derived construction behavior from roster slots and profile format instead of
  private league preferences.
- Kept the engine pure: it does not require Chrome, a Sleeper login, network
  access, private rankings, or a browser DOM.
- Preserved the rule that a posted live pick wins over a saved manual pick at
  the same pick number or for the same player.

## Verification

`npm test`

- Pass: 23 JavaScript tests and 3 Python release-safety tests.
- Covered normal snake order, third-round reversal, complete drafts, malformed
  dimensions, manual undo, live/manual conflicts, one-QB, superflex, best ball,
  kicker and defense timing and limits, room runs, ahead-slot demand, tier
  cliffs, ADP fallers, API-outage recovery, reload recovery, and later live-data
  replacement.

`node --check src/draft-order.js`

- Pass.

`node --check src/recommendation-engine.js`

- Pass.

`python3 tools/check_release.py`

- Pass as part of `npm test`: no private markers or risky artifacts.

## Gate Audit

- One-QB: a filled quarterback starter suppresses early excess-QB pressure.
- Superflex: an empty two-quarterback structure elevates quarterback need.
- Best ball: kicker and defense stay unavailable when the roster has no such
  slots.
- Specialist limits: kicker and defense unlock late and stop at roster limits.
- Complete draft: returns an explicit completed state.
- API failure: saved manual picks independently reconstruct room state.
- Reload recovery: normalized storage restores manual picks deterministically.
- Live recovery: subsequent posted picks replace conflicting manual records.
- Malformed input: invalid draft dimensions fail explicitly.

No Gate 2 gaps remain. Phase 3 may begin.
