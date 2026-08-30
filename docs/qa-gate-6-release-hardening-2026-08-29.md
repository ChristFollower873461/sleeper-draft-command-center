# Gate 6 QA: Release Hardening

Date: 2026-08-29

Work items: SDC-022 and SDC-023

Result: Passed

## Scope

Gate 6 reviewed the public extension's permissions, local-state integrity,
storage limits, imports, exports, network behavior, content-script boundary,
clean-profile recovery, real Sleeper compatibility, and rollback artifact.
Existing Gate 4 and Gate 5 evidence remains authoritative for keyboard,
responsive, offline, and full-draft matrices; those broad matrices were not
repeated.

## Hardening Delivered

- Removed the unused `activeTab` permission and constrained extension-page
  connections to the two public Sleeper API origins.
- Restricted `chrome.storage.local` to trusted extension contexts.
- Added one service-worker writer with three-way merge and explicit same-record
  conflict errors across setup, editor, and draft tabs.
- Added a 6 MiB application-state budget and a 3 MiB catalog-cache budget.
- Replaced all-pairs fuzzy matching with exact indexes and a bounded 120-player
  fuzzy candidate pool.
- Required trusted user activation for the injected launcher and validated and
  throttled its service-worker requests.
- Removed reversible private marker values from public source. Protected jobs
  receive marker policy only through `SDCC_PRIVATE_MARKERS_JSON`.
- Added a deterministic allowlist packager with SHA-256 output.

## Security Review

The frozen pre-hardening Standard scan reported two medium and three low
findings: reversible private markers, cross-window lost updates, storage quota
exhaustion, fuzzy-match complexity, and synthetic launcher activation. All five
were remediated in this gate. The same review found no Sleeper write path,
credential use, unsafe HTML rendering, prototype-pollution path, or broad host
access. No P1 or P2 finding remains open.

## Focused Verification

```bash
node --test tests/state-merge.test.js tests/storage.test.js tests/player-matcher.test.js tests/manifest.test.js
python3 -m unittest tests.test_release_safety
SDCC_HEADED=1 node tools/browser_gate_6.cjs
SDCC_HEADED=1 SDCC_PILOT_DRAFT_ID="$PRIVATE_DRAFT_ID" node tools/browser_real_pilot.cjs
npm test
```

Results:

- 84 JavaScript tests passed in the full suite.
- Five Python release-safety and packaging tests passed after the packager was
  added.
- The bounded 400-row by 5,000-player matcher case completed in 269 ms in the
  full run.
- Gate 6 passed clean install, corrupt-state recovery, future-version refusal,
  concurrent profile/session merge, synthetic-click rejection, one trusted
  launcher open, and credential-free GET traffic with zero browser errors.
- A fresh temporary Chrome profile loaded a real Sleeper draft in live and
  manual modes with credential-free GET requests and zero browser errors. The
  private pilot draft ID was not written to any repository artifact.
- The protected marker-policy scan passed.

## Rollback Proof

The protected packager produced `sdcc-0.1.0-gate6-rollback.zip` outside the
public project with SHA-256:

```text
6b070828ada97f193a1c4927215559abaf8e11ded01ac799edbabc5b93bd63d4
```

The ZIP was extracted into a new temporary directory and loaded as an unpacked
extension in a new Chrome profile. Version `0.1.0` opened setup with zero browser
errors. This is the known-good rollback artifact for the GitHub beta work.

## Residual Work

GitHub branch protection, release download verification, store imagery,
publisher registration, Web Store review, and direct-link installation belong
to Gates 7 and 8.
