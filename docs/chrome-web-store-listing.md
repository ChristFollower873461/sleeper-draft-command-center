# Chrome Web Store Submission Packet

Candidate version: `0.2.1`

The newer `v0.3.0-beta.1` GitHub package is not part of this pending Store
submission. Submit it separately only after the current review is resolved.

Distribution: Unlisted

Primary language: English

Category: Productivity

## Store Listing

### Name

Sleeper Draft Command Center

### Short Description

Use your own rankings with live, read-only Sleeper draft context and a full-screen manual draft board.

Character count: 102 of 132.

### Detailed Description

Bring your own fantasy football rankings into a focused command center built
for Sleeper drafts.

DATA USE: The extension saves your Sleeper username and public ID, ranking
profiles, selected draft and league IDs, posted picks, manual picks, and pinned
players locally in your Chrome profile. Your username and public identifiers
are sent only to Sleeper's public HTTPS APIs for account discovery and live
draft sync. Nothing is sent to the project maintainers, and no password, Sleeper
cookie, or login token is requested.

BUILD YOUR BOARD

- Start with public ADP or import your own CSV, JSON, or pasted ranking list.
- Review player matches before saving a profile.
- Search, filter, reorder, tier, annotate, clone, import, and export boards.
- Keep separate one-QB, superflex, best-ball, or custom profiles.

DRAFT WITH CONTEXT

- Follow posted Sleeper picks in a live, read-only command center.
- See roster construction, turn distance, tiers, fallers, and a four-player
  decision set based on your board.
- Use the persistent manual room for offline drafts or any board you enter by
  hand.

READ ONLY BY DESIGN

The extension never submits picks, trades, waivers, messages, roster changes,
or payments. It has no analytics, ads, remote ranking uploads, or
project-operated backend. Rankings and draft sessions remain in Chrome local
storage until you delete them or uninstall the extension.

Sleeper Draft Command Center is an independent open-source project and is not
affiliated with or endorsed by Sleeper.

## URLs

- Homepage: <https://github.com/ChristFollower873461/sleeper-draft-command-center>
- Support: <https://github.com/ChristFollower873461/sleeper-draft-command-center/issues>
- Privacy policy: <https://github.com/ChristFollower873461/sleeper-draft-command-center/blob/main/PRIVACY.md>

## Single Purpose

Help fantasy football drafters apply user-created rankings to read-only live or
manual Sleeper draft context.

## Permission Justifications

### `storage`

Stores the user's Sleeper public profile reference, ranking profiles, cached
public player directory, draft sessions, manual picks, pinned players, and view
settings in the current Chrome profile. Storage is restricted to trusted
extension pages and is never synchronized to a project server.

### `https://api.sleeper.app/*`

Makes credential-free HTTPS `GET` requests for the public Sleeper account,
league and draft metadata, posted picks, rosters, and player directory required
for onboarding and live draft context. No write request is implemented.

### `https://api.sleeper.com/*`

Makes credential-free HTTPS `GET` requests for Sleeper's public projection and
ADP data when the user chooses the public starter board. No write request is
implemented.

### Sleeper Draft Content Script

Runs only on declared Sleeper draft, draftboard, predraft, and mock-draft URLs.
It reads the current URL's draft identifier and displays one launcher button for
the user-facing command center. It cannot access extension local storage and
does not read cookies, page messages, or authentication state.

### Remote Code

No remote code is used. All JavaScript executes from files included in the
extension package, and the extension Content Security Policy permits API data
connections only to the two Sleeper HTTPS origins.

## Privacy Practices

Disclose these handled data types when the dashboard presents them:

| Data type | Dashboard selection | Handling and purpose |
| --- | --- | --- |
| Personally identifiable information | Select | Sleeper username and public account ID are saved locally; the username and public IDs are sent only to Sleeper's HTTPS APIs for account and draft discovery. |
| Website content or resources | Select | The extension extracts a draft ID from supported Sleeper draft URLs and reads public draft, league, roster, player, projection, and posted-pick data for the visible draft workspace. |
| User-generated content or form data | Select if shown | User-entered ranking profiles, notes, manual picks, and pinned players are stored locally to provide the ranking and manual-room features. |
| Authentication information | Do not select | No password, cookie, login token, or Sleeper authentication state is requested or read. |
| Web history | Do not select | The extension does not retain browsing history; its content script is limited to supported Sleeper draft pages and keeps only the draft identifier needed to open that room. |
| User activity | Do not select | The extension does not monitor general clicks, keystrokes, mouse position, network traffic, or browsing behavior. Explicit ranking and manual-pick inputs are disclosed as user-generated content/form data. |
| Financial, health, location, or personal communications | Do not select | These categories are not handled. |

Certify all Limited Use statements:

- Data is used only to provide or improve the disclosed single purpose.
- Data is not sold or transferred except to Sleeper's API as necessary for the
  disclosed user-facing feature.
- Data is not used or transferred for advertising, creditworthiness, or lending.
- Humans do not read user data because no project backend receives it.

## Store Assets

- Icon: `extension/icons/icon-128.png`
- Screenshot 1: `store-assets/01-import-review-1280x800.png`
- Screenshot 2: `store-assets/02-ranking-editor-1280x800.png`
- Screenshot 3: `store-assets/03-live-draft-1280x800.png`
- Small promo tile: `store-assets/promo-small-440x280.png`

All screenshots show deterministic fictional players, identifiers, league
names, and account data.

## Reviewer Instructions

1. Install and open the extension; the setup workspace opens automatically.
2. Enter any public Sleeper username to test discovery, or continue by creating
   a board from a pasted list or CSV/JSON import.
3. Use the included fictional ranking-pack shape documented in the public
   repository if an import fixture is needed.
4. Open a discovered draft for live read-only mode, or choose the manual room
   to test without a Sleeper account or active draft.
5. Inspect DevTools network traffic to confirm that requests are HTTPS `GET`s to
   Sleeper's two declared API origins. There is no pick-submission path.

## Release Notes

Initial unlisted beta with local ranking profiles, public Sleeper discovery,
read-only live draft sync, full-screen manual drafts, and local profile export.
