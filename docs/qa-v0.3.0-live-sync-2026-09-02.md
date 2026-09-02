# QA: v0.3.0 Live Sync

Date: 2026-09-02

Result: Pass

## Delivered

- Reduced active visible-room polling from 1.5 seconds to 300 ms and migrated
  the old default automatically.
- Added a 2.2-second pick-request timeout, cache-busting GETs, immediate retry
  queue, refocus and reconnect refreshes, and separate 30-second metadata reads.
- Removed drafted players using both Sleeper IDs and punctuation-tolerant names.
- Excluded future keeper slots from recent-pick and position-run signals while
  still treating those players as unavailable and part of roster construction.
- Added current traded-pick ownership to turn, roster, and ahead-demand logic.
- Kept every network operation credential-free and read-only with no backend.

## Verification

`npm test`

- Pass: 92 JavaScript tests.
- Pass: 6 Python release and privacy tests.
- Pass: public artifact scan with no private markers or risky files.

`SDCC_HEADED=1 node tools/browser_gate_5.cjs`

- Pass: live and manual one-QB and superflex draft completion.
- Pass: live-over-manual precedence, cached outage recovery, third-round
  reversal, and superflex quarterback priority.
- Pass: extension loading, Sleeper launcher, desktop and mobile layout checks.
- Pass: zero unexpected browser errors and zero horizontal overflow.

`python3 tools/package_release.py --output sleeper-draft-command-center-v0.3.0-beta.1.zip`

- Pass: deterministic allowlisted release package and checksum created.
- Pass: the extracted package loaded in a fresh Chrome profile as version
  `0.3.0` with zero browser errors.
- SHA-256: `6b111e5b52ec27a6b72c1733e1ca51125b6a35c58f187b096db0cca6834b7c37`.

## Focused Regressions

- A future keeper no longer appears as the newest room pick or creates a false
  position run.
- `A.J. Brown` and `AJ Brown` resolve as one drafted player even if an imported
  board and Sleeper metadata use different punctuation or IDs.
- Acquired and traded-away selections change the user's next decision pick.
- A visible active draft uses a 300 ms delay; hidden tabs back off to 2.5
  seconds and pre-draft rooms to at least 1 second.

## Remaining Distribution Work

The `v0.2.1` unlisted Chrome Web Store candidate remains under review. The
`v0.3.0-beta.1` package is distributed through GitHub until that review is
resolved and a new Store submission can be made deliberately.
