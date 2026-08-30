# Security Policy

## Supported Releases

Security fixes will target the latest published release.

## Reporting

Open a private GitHub security advisory in the eventual public repository. Do
not place account identifiers, ranking files, browser-storage exports, or league
screenshots in a public issue.

## Security Boundaries

- No remote project backend or embedded credentials.
- Minimum Chrome permissions: local storage plus exact public Sleeper API hosts
  and narrowly matched Sleeper draft pages.
- Extension storage is restricted to trusted extension contexts. The Sleeper
  content script can only request a user-initiated command-center launch.
- Imported files are contract-validated, normalized, and size-limited before
  storage. Root state has a 6 MiB application budget.
- Root-state writes are serialized by the service worker and conflict-checked
  across setup, editor, and draft tabs.
- The extension does not submit picks, trades, waivers, messages, or payments.
- Release CI runs `tools/check_release.py --require-private-policy` with a
  protected marker policy before packaging.
