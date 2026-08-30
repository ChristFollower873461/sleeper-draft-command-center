# ADR 002: Optional Public ADP Source

Status: Accepted

Date: 2026-08-29

Work items: SDC-009, SDC-011

## Context

Sleeper documents its read-only public API at `api.sleeper.app`. That API
provides users, leagues, drafts, picks, NFL state, and the player directory. A
separate Sleeper-owned host currently exposes season projection records that
include format-specific ADP fields. The public extension needs a useful starter
board without bundling, redistributing, or operating a ranking feed.

## Decision

The extension may request host access to `https://api.sleeper.com/*` solely for
GET requests to the NFL season projections endpoint. The response is fetched
directly by the user's browser, reduced to player ID plus the applicable ADP
number, and used to construct a local starter profile.

The extension does not bundle a projection snapshot, proxy the response,
publish the feed, or claim that it is a stable documented API contract. It
labels the result as a Sleeper public-data baseline and records retrieval time.
If the endpoint is absent, malformed, stale, or blocked, the extension falls
back to the documented player directory's public search order and clearly
reports the fallback.

The endpoint URL is constructed internally. No user-provided URL is fetched.
Only JSON responses are accepted, and no executable response content is used.
Public ranking-pack export contains the user's final order and numeric ADP
field, never the raw projection response or provider metadata.

## Consequences

- Fresh installs can start with a current market-shaped board without a project
  backend or bundled third-party rankings.
- Baseline quality can degrade independently of the documented Sleeper API.
- The manifest gains one narrow Sleeper-owned host permission and no broader
  network access.
- A commercial fork must independently confirm the applicable Sleeper API and
  data-use terms.

## Verification

- API tests assert that only the two approved Sleeper origins are accepted.
- Freshness and fallback fixtures cover missing, malformed, and stale ADP.
- The release gate mechanically checks the manifest host permission allowlist.

