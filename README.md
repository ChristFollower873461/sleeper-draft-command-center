# Sleeper Draft Command Center

An open-source Chrome extension project for bringing personal rankings, live
room context, and a manual offline draft board into Sleeper drafts.

## Status

The installable Manifest V3 extension, local ranking profiles, public starter
board, CSV/JSON/paste imports, ranking editor, read-only live command center,
and persistent manual room are implemented and browser-tested. The current
[GitHub beta](https://github.com/ChristFollower873461/sleeper-draft-command-center/releases/tag/v0.3.0-beta.1)
is `v0.3.0-beta.1`. It adds subsecond active-draft sync, fast recovery from a
stalled pick request, keeper-safe room signals, defensive drafted-player
filtering, and traded-pick ownership. The older `v0.2.1` package remains the
unlisted Chrome Web Store candidate while that submission is under review.

No private league data, account identifiers, or licensed ranking exports belong
in this repository or its release artifacts.

## Local Setup

1. Open `chrome://extensions` and enable Developer mode.
2. Choose Load unpacked and select this project folder, the folder containing
   `manifest.json`.
3. Enter a Sleeper username in the workspace that opens.
4. Build a public starter board, paste rankings, or import CSV or JSON.
5. Resolve any flagged player identities and save the ranking profile.
6. Open the ranking board to search, filter, reorder, annotate, clone, import,
   or export profiles. Changes autosave in Chrome local storage.
7. Open a discovered draft in the full-screen command center, or create a manual
   room for an offline draft.

The submitted unlisted Chrome Web Store release will reduce installation to
opening its release URL and choosing Add to Chrome after review approval.

For the current GitHub beta, follow
[`docs/install-github-beta.md`](docs/install-github-beta.md).

## Live Sync

During an active draft, the visible command center checks Sleeper's posted-pick
endpoint every 300 ms and refreshes recommendations when a posted pick's identity,
ownership, or player metadata changes. A request is abandoned after 2.2 seconds so
one slow response cannot freeze the board. Hidden tabs back off to 2.5 seconds,
room metadata refreshes separately, and returning online or refocusing the command
center triggers an immediate check.

This works directly against Sleeper's public read-only API. It does not need
Supabase or another project-operated backend.

## Product Rules

- Rankings are supplied by the user and remain in Chrome local storage.
- The extension reads only public Sleeper draft endpoints.
- No analytics, ads, remote ranking uploads, or credential collection.
- Live and manual draft records are reversible; the extension never submits a
  Sleeper pick.
- Public releases contain only fictional sample rankings.

## Release Safety

Run the full test and safety gate before packaging:

```bash
npm test
```

The headed Chromium workflow exercises all four 250-player input paths and
reload recovery:

```bash
SDCC_HEADED=1 node tools/browser_gate_3.cjs
```

The ranking-editor workflow exercises pointer and keyboard reorder, autosave,
reload, isolated profiles, every lifecycle command, and exact export/reimport:

```bash
SDCC_HEADED=1 node tools/browser_gate_4.cjs
```

The draft-runtime workflow completes one-QB and superflex drafts in live and
manual modes, including reload, undo, outage recovery, and mobile layouts:

```bash
SDCC_HEADED=1 node tools/browser_gate_5.cjs
```

The compact release-hardening gate covers real service-worker concurrency,
state recovery, launcher trust, and GET-only API traffic:

```bash
SDCC_HEADED=1 node tools/browser_gate_6.cjs
```

The public gate rejects ranking CSVs, ZIP archives, environment files, keys, and
certificates. Protected release jobs also supply a private marker policy through
`SDCC_PRIVATE_MARKERS_JSON`; the values never live in this repository.

## Roadmap

See `PLAN.md` for the gated execution ledger and `docs/release-plan.md` for the
path to a GitHub release and one-click Chrome Web Store install.
