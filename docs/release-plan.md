# Release Plan

## 0.1: Public-Safe Core

- Extract the tested snake-order, manual-pick, and recommendation engine.
- Add Sleeper username resolution and league/draft discovery.
- Add a contract-validated JSON ranking-pack importer.
- Keep all imported data in Chrome local storage.
- Run deterministic desktop and mobile browser tests.

## 0.2: GitHub Release

- Publish the source in a dedicated repository.
- Build a release ZIP in CI after the privacy gate and tests pass.
- Attach a checksum and human-readable install guide.
- Tag releases and preserve the previous known-good ZIP for rollback.

## 1.0: Chrome Web Store

- Register the publisher account and complete store verification.
- Publish first as unlisted so installation works from a direct link.
- Supply the privacy policy, screenshots, permission explanations, and release
  notes required by review.
- Move to a public listing after real-draft testing and import compatibility QA.
