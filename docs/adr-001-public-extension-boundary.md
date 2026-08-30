# ADR 001: Public Extension Boundary

Status: Accepted

Date: 2026-08-29

Work item: SDC-004

## Context

The public extension must support personal rankings and live or manual Sleeper
drafts without requiring credentials, a hosted service, or bundled private data.
Chrome permissions, stored records, imports, exports, and network calls all need
an explicit boundary before the generic engine and UI are extracted.

## Decision

The v1 product is a local Manifest V3 extension with no project-operated
backend and no remote executable code.

The release manifest may request only:

- `storage` for user configuration, rankings, and recoverable draft sessions.
- Host access to `https://api.sleeper.app/*` and
  `https://api.sleeper.com/*` for public read-only API calls.
- Content-script matches limited to Sleeper draft, draft-board, mock-draft, and
  league predraft pages.

The release manifest must not request `cookies`, `identity`, `management`,
`webRequest`, `downloads`, unrestricted `tabs`, clipboard access, or broad web
host access. A later permission requires a new ADR and privacy review.

All imported ranking packs and draft sessions remain in `chrome.storage.local`,
which is restricted to trusted extension contexts. Root writes pass through a
service-worker queue with three-way conflict detection and a 6 MiB state budget.
The extension does not collect Sleeper passwords, browser cookies, access
tokens, payment information, or analytics identifiers. Sleeper identity is a
public username and public user ID resolved through Sleeper's API.

The only outbound runtime traffic is GET-style reading from public Sleeper API
endpoints. The extension must contain no request path that submits a pick,
trade, waiver, message, roster action, or payment. UI controls may record a
manual pick only in local extension storage.

Ranking imports are capped at 2 MiB and 1,000 players. They are parsed locally,
validated against the versioned ranking contract, normalized, and shown for
review before replacing a profile.
Unknown fields are discarded. Future schema versions are rejected until a
compatible migration exists.

Exported ranking packs contain only the public ranking-pack contract: name,
format, and normalized player ranking fields. They never contain Sleeper
username, user ID, league ID, draft ID, manual picks, pinned players, local
timestamps, file paths, or source credentials.

The private league extension and the public project remain separate build
roots. Public CI rejects risky artifacts, while protected release CI receives
known private markers through an encrypted repository secret before packaging.

## Consequences

- Users retain full custody of rankings and draft history.
- The product works without account registration or an operating backend.
- Chrome Web Store permission disclosures remain narrow and understandable.
- Cross-device sync is unavailable in v1.
- Clearing the extension's local storage removes user data, so local import and
  export must remain available as recovery tools.
- Public ADP and draft functionality degrade when Sleeper's public API is
  unavailable, while an already-loaded manual session remains usable.

## Acceptance Evidence

- The storage schema separates user, ranking-profile, and draft-session data.
- Migration tests cover fresh, current, legacy, corrupt, and future records.
- Export tests prove account and draft identifiers are excluded.
- The release safety gate passes with the ADR and implementation present.
- The eventual manifest is mechanically checked against this permission list.
