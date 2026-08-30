# Sleeper Draft Command Center Build Plan

Last updated: 2026-08-29

Overall status: Phase 8 in progress

Private build status: The private league extension v1.2.0 is frozen. Public work
must not modify, package, or import its league board, account identifiers, or
licensed-source fields.

## Product Outcome

Anyone should be able to install the extension, enter a Sleeper username, build
or import personal rankings, select a draft, and use the same live or manual
draft command center without sharing credentials or private ranking data.

The intended first-use path is:

1. Install the extension.
2. Enter a Sleeper username.
3. Start from public ADP, paste a ranked list, or import CSV or JSON.
4. Resolve unmatched or duplicate players in a review screen.
5. Reorder players and save one or more format profiles.
6. Open or select a Sleeper draft.
7. Use live sync or manual input with persistent recommendations.

## Non-Negotiables

- The extension never submits a draft pick.
- No Sleeper password, cookie, or token collection.
- Rankings and draft sessions remain in Chrome local storage.
- No analytics, advertising, or project-operated backend in v1.
- No bundled subscriber-only, licensed, scraped, or private rankings.
- Posted Sleeper picks override manual records at the same pick number.
- Every release has a checksum, rollback ZIP, QA note, and privacy-gate result.
- The private downstream build stays recoverable and independent.

## Scope

Included in v1:

- One-QB, superflex, best-ball, and custom ranking profiles.
- Public-ADP baseline, paste-list, CSV, and JSON ranking inputs.
- Search, filters, drag reorder, keyboard reorder, undo, redo, and autosave.
- Sleeper username, league, draft, slot, scoring, and roster discovery.
- Live room sync plus full-screen manual draft entry.
- Shareable ranking-pack export without account or league identifiers.
- GitHub release followed by an unlisted Chrome Web Store release.

Deferred until after v1:

- Cloud sync, shared accounts, subscriptions, or hosted ranking storage.
- Other fantasy platforms.
- Mobile-native applications.
- Automatic Sleeper pick submission.
- Licensed ranking feeds or paid-source integrations.

## Progress Ledger

| ID | Work item | Status | Required proof |
| --- | --- | --- | --- |
| SDC-001 | Separate public project, MIT license, privacy, and security docs | Complete | Public safety test passes |
| SDC-002 | Versioned public ranking-pack JSON schema and fictional sample | Complete | Schema and sample parse |
| SDC-003 | Private-marker and risky-artifact release gate | Complete | Positive and negative unit tests |
| SDC-004 | Freeze MVP product contract and permissions | Complete | Architecture decision record |
| SDC-005 | Define versioned Chrome storage records and migrations | Complete | Migration and invalid-state tests |
| SDC-006 | Extract generic snake and third-round-reversal engine | Complete | Pure unit-test suite |
| SDC-007 | Extract live/manual pick merge and recovery engine | Complete | Conflict and reload tests |
| SDC-008 | Build generic recommendation inputs and construction rules | Complete | One-QB, superflex, best-ball fixtures |
| SDC-009 | Create generic Manifest V3 extension shell | Complete | Loads with no private assets |
| SDC-010 | Resolve Sleeper username and discover leagues and drafts | Complete | Public-API fixture tests |
| SDC-011 | Add public-ADP starter board | Complete | Freshness and fallback tests |
| SDC-012 | Add JSON and CSV import with limits and validation | Complete | Good, malformed, and oversized imports |
| SDC-013 | Add paste-list import and player identity matching | Complete | Alias, duplicate, and unmatched tests |
| SDC-014 | Build import review and correction screen | Complete | Browser workflow test |
| SDC-015 | Build searchable visual ranking editor | Complete | Desktop and mobile screenshots |
| SDC-016 | Add drag, keyboard movement, undo, redo, and autosave | Complete | Accessibility and reload tests |
| SDC-017 | Add profile create, clone, rename, delete, import, and export | Complete | Multi-profile isolation tests |
| SDC-018 | Detect draft format, scoring, roster slots, user slot, and snake rules | Complete | League fixture matrix |
| SDC-019 | Build live draft command center | Complete | Posted-pick browser simulation |
| SDC-020 | Build persistent full-screen manual draft room | Complete | Entry, Enter key, undo, and recovery QA |
| SDC-021 | Add rank, room, roster, faller, tier, and recommendation views | Complete | Responsive visual suite |
| SDC-022 | Audit permissions, storage, network access, and data export | Complete | Security and privacy QA note |
| SDC-023 | Run second-profile and real Sleeper mock-draft pilot | Complete | Pilot issue log and signoff |
| SDC-024 | Create dedicated GitHub repository and release workflow | Complete | CI-built ZIP and checksum |
| SDC-025 | Publish install guide and GitHub beta | Complete | Clean-profile install test |
| SDC-026 | Prepare Chrome Web Store listing and privacy disclosures | In progress | Submission packet review |
| SDC-027 | Publish unlisted Web Store release | Pending | Direct-link installation proof |

## Phase Gates

### Phase 1: Contract And Data Boundary

Deliver SDC-004 and SDC-005. Define the extension permissions, user profile,
ranking profile, player rank, draft session, manual pick, and app setting
records. Add schema versions and forward migrations before UI work begins.

Gate 1 passes when a fresh install, current install, corrupt record, and one
version migration all produce deterministic local state without private data.

### Phase 2: Generic Draft Engine

Deliver SDC-006 through SDC-008. Extract only pure logic and generic fields from
the tested private engine. Remove league names, account IDs, private preferences,
and paid-source columns. Preserve snake order, third-round reversal, live/manual
precedence, availability, roster construction, and recommendation scoring.

Gate 2 passes when unit fixtures cover one-QB, superflex, best ball, kicker and
defense limits, a complete draft, API failure, reload recovery, and malformed
input without loading Chrome.

### Phase 3: Setup And Ranking Import

Deliver SDC-009 through SDC-014. Build the generic extension, Sleeper discovery,
public baseline, and four ranking-input paths. Imports must be parsed by format,
size-limited, contract-validated, normalized, and reviewed before they replace a
saved profile.

Gate 3 passes when a new user can install locally, resolve a Sleeper username,
create a 250-player profile from each supported input, repair unmatched names,
and reopen the same profile after a browser restart.

### Phase 4: Ranking Editor

Deliver SDC-015 through SDC-017. Build a dense ranking workspace with position
filters, player search, rank and ADP columns, tier editing, drag reorder,
keyboard reorder, undo, redo, autosave, format profiles, and safe exports.

Gate 4 passes when all controls work at 1366x900 and 390x844 with no overlap or
horizontal overflow, and an exported profile reimports identically.

### Phase 5: Draft Runtime

Deliver SDC-018 through SDC-021. Connect the generic profile to an identified
Sleeper draft. Keep live sync and manual mode visibly distinct. Recalculate all
room state after every pick without mutating the user's ranking profile.

Gate 5 passes when deterministic browser tests complete full one-QB and
superflex drafts in live and manual modes, including undo, reload, API outage,
and a live pick replacing the same manual pick.

### Phase 6: Release Hardening

Deliver SDC-022 and SDC-023. Run permission, privacy, accessibility, keyboard,
performance, storage migration, corrupted-state, offline, and clean-profile QA.
Pilot against Sleeper mock drafts in a second Chrome profile so private local
storage cannot mask setup defects.

Gate 6 passes with zero P1 or P2 findings, no private-marker failures, no pick
submission code, a successful rollback, and written QA evidence.

### Phase 7: GitHub Beta

Deliver SDC-024 and SDC-025. Create a dedicated repository, protect the default
branch, run tests and the release gate in CI, build a versioned ZIP, publish its
checksum, and verify the install instructions from a clean download.

Gate 7 passes when a person who does not have this workspace can install the
GitHub release and finish onboarding without assistance.

### Phase 8: One-Click Distribution

Deliver SDC-026 and SDC-027. Prepare listing copy, screenshots, permission
explanations, support and privacy URLs, and the signed extension package. Submit
as unlisted first and preserve GitHub installation as the rollback path.

Gate 8 passes when the direct store URL installs the reviewed build in a clean
Chrome profile and an imported ranking pack reaches both live and manual rooms.

## Follow-Along Protocol

- Update the Progress Ledger whenever a work item changes state.
- Keep exactly one phase in progress.
- Attach commands, results, screenshots, and known gaps to a QA note at each gate.
- Do not advance a phase when its gate lacks proof.
- Record product decisions in `docs/` so later work does not reopen settled scope.
- Preserve the last known-good ZIP before every release candidate.
- Report blockers against the relevant SDC identifier.

## Immediate Next Work

1. Complete SDC-026 with store listing copy, imagery, privacy disclosures, and a
   protected release candidate.
2. Complete SDC-027 by submitting the unlisted listing and proving direct-link
   installation in a clean Chrome profile.

## Gate Record

- Gate 1: Passed on 2026-08-29. Evidence is in
  `docs/qa-gate-1-contract-and-storage-2026-08-29.md`.
- Gate 2: Passed on 2026-08-29. Evidence is in
  `docs/qa-gate-2-generic-draft-engine-2026-08-29.md`.
- Gate 3: Passed on 2026-08-29. Evidence is in
  `docs/qa-gate-3-setup-and-ranking-import-2026-08-29.md`.
- Gate 4: Passed on 2026-08-29. Evidence is in
  `docs/qa-gate-4-ranking-editor-2026-08-29.md`.
- Gate 5: Passed on 2026-08-29. Evidence is in
  `docs/qa-gate-5-draft-runtime-2026-08-29.md`.
- Gate 6: Passed on 2026-08-29. Evidence is in
  `docs/qa-gate-6-release-hardening-2026-08-29.md`.
- Gate 7: Passed on 2026-08-29. Evidence is in
  `docs/qa-gate-7-github-beta-2026-08-29.md`.
