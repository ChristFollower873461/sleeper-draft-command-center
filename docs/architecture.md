# Architecture

## Boundary

The public product has two inputs:

1. Public Sleeper draft data fetched directly by the extension.
2. A user-supplied ranking pack stored in Chrome local storage.

It has no project backend. This keeps private rankings and draft decisions out
of a shared service and makes the extension useful without account credentials.

## Components

- `extension`: generic Manifest V3 UI and draft engine, with no bundled rankings.
- `schemas`: versioned contracts for user ranking packs.
- `tools`: release packaging and privacy checks.
- `examples`: fictional data that exercises the import path.

## Private Build Separation

League-specific overlays are downstream builds. They may consume private data
locally, but their board files and identifiers cannot flow back into this public
repository. CI enforces known-marker and risky-file checks before release.

## Local State

Setup, editor, and draft pages read the same versioned root record. Mutations are
sent to the Manifest V3 service worker, which serializes commits and applies a
three-way merge against the latest saved state. Independent profile and draft
changes survive; conflicting edits to the same record fail explicitly. The
content script has no storage access.

## State Precedence

Posted Sleeper picks are authoritative. Manual picks fill only missing pick
numbers. Draft state is keyed by draft ID, survives reloads, and can be undone
one manual action at a time.
