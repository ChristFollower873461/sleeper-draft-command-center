# Sleeper Draft Command Center

An open-source Chrome extension project for bringing personal rankings, live
room context, and a manual offline draft board into Sleeper drafts.

## Status

The installable Manifest V3 shell, local storage migrations, read-only Sleeper
discovery, public starter board, CSV/JSON/paste imports, player matching, import
review, multi-profile ranking editor, read-only live draft room, persistent
manual draft room, release hardening, and the clean-profile real-Sleeper pilot
are implemented and browser-tested. GitHub beta packaging is in progress.

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

An unlisted Chrome Web Store release is the next distribution target. That
reduces installation to opening the release URL and choosing Add to Chrome.

For the current GitHub beta, follow
[`docs/install-github-beta.md`](docs/install-github-beta.md).

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
