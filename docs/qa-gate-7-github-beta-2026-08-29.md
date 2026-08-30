# Gate 7 QA: GitHub Beta

Date: 2026-08-29

Work items: SDC-024 and SDC-025

Result: Passed

## Delivered

- Published the dedicated public repository at
  <https://github.com/ChristFollower873461/sleeper-draft-command-center>.
- Protected `main` with the required `test` check, strict updates, enforced
  administrator rules, conversation resolution, and force-push and deletion
  prevention.
- Added CI and tagged-release workflows that run tests, apply the protected
  private-marker policy, and publish a deterministic ZIP plus SHA-256 file.
- Published the install guide and prerelease `v0.2.0-beta.1`.

## Verification

The repository CI and tagged-release jobs passed:

- <https://github.com/ChristFollower873461/sleeper-draft-command-center/actions/runs/33289120525>
- <https://github.com/ChristFollower873461/sleeper-draft-command-center/actions/runs/33289156531>

The release assets were downloaded into a fresh temporary directory. The
published checksum verified successfully, and the extracted extension loaded
in a clean temporary Chrome profile as version `0.2.0` with zero browser
errors.

Published ZIP SHA-256:

```text
e284cf3d159ea7325c933497b8dce02a2f5118013303fc6dfcdc07fd608048f5
```

## Rollback

The prior Gate 6 rollback ZIP remains available outside the public repository.
The GitHub beta release is now the public rollback path while the unlisted
Chrome Web Store candidate is prepared.

## Residual Work

Store imagery, disclosure review, publisher submission, review approval, and
direct-link installation belong to Gate 8.
