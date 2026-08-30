# Product Contract v1

Work item: SDC-004

## User Contract

A first-time user can install the extension, resolve a public Sleeper username,
create personal rankings from public ADP, paste, CSV, or JSON, review identity
matches, edit and save format profiles, select a Sleeper draft, and operate in
live or manual mode.

Live mode reads posted Sleeper picks and updates local decision support. Manual
mode records explicitly selected players against the next missing pick number.
When both modes contain the same pick number, the posted Sleeper pick wins.

The extension provides recommendations but never presses or simulates
Sleeper's draft button. A recommendation is advisory and cannot mutate the
Sleeper room.

## Supported Profiles

- One-QB
- Superflex
- Best ball
- Custom

Each profile owns its player order, optional tiers, optional ADP, roster and
scoring context, and format. Account identity and draft sessions are not part of
the profile and are excluded from exported ranking packs.

## Failure Contract

- Invalid imports are rejected before stored rankings change.
- Ambiguous or unmatched players enter a review queue.
- Unsupported future storage versions stop with an actionable error.
- Corrupt current storage is normalized to a valid state with warnings.
- Sleeper API errors preserve the last local rankings and manual session.
- Undo removes only the latest effective manual action.
- Reloading Chrome restores the active profile and per-draft manual progress.

## Release Contract

A release is not ready until automated unit, migration, privacy, archive, and
responsive browser checks pass; the previous ZIP remains available; and a clean
Chrome profile can complete onboarding without workspace access.

