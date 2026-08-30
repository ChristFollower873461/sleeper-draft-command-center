# QA Gate 1: Contract And Storage

Date: 2026-08-29

Plan items: SDC-004, SDC-005

Result: Pass

## Delivered

- Accepted the no-backend, read-only Manifest V3 permission and data boundary in
  `docs/adr-001-public-extension-boundary.md`.
- Defined the v1 user contract and failure behavior in
  `docs/product-contract-v1.md`.
- Added `schemas/storage-v1.schema.json` for user, ranking-profile,
  draft-session, manual-pick, and app-setting records.
- Added `src/storage.js` with schema-0 migration, schema-1 normalization,
  unsupported-future-version refusal, invariant validation, and public ranking
  export stripping.
- Added reserved-key defenses for imported object keys and stale profile
  reference cleanup.

## Verification

`node --check src/storage.js`

- Pass.

`node --test tests/*.test.js`

- Pass: 9 tests.
- Covered fresh state isolation, corrupt-current normalization, legacy migration,
  non-object recovery, future-version refusal, duplicate manual picks, private
  export stripping, empty export refusal, reserved keys, and stale references.

`python3 tools/check_release.py`

- Pass: no private markers or risky artifacts.

`python3 -m unittest discover -s tests`

- Pass: 3 release-safety tests.

JSON parse checks

- Pass for ranking schema, storage schema, fictional sample, and package file.

## Gate Audit

- Fresh install: proven by default-state test.
- Current install: proven by schema-1 normalization test.
- Corrupt record: proven by malformed fields and non-object recovery tests.
- One-version migration: proven from legacy schema 0 to schema 1.
- Future version: fails explicitly instead of downgrading.
- Private data separation: export allowlist and project leak gate both pass.

No Gate 1 gaps remain. Phase 2 may begin.
