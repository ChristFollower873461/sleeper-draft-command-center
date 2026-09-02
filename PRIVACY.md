# Privacy

Sleeper Draft Command Center is designed to work without a project-operated
backend.

## Local Data

The extension stores the following data in `chrome.storage.local`:

- Sleeper username and public user ID.
- Ranking profiles, player IDs, ranks, tiers, ADP values, notes, format, roster
  positions, and scoring settings supplied or approved by the user.
- Draft and league IDs, roster and slot IDs, cached posted picks, traded-pick
  ownership, manual picks, pinned players, draft configuration, view settings,
  and sync timestamps.
- A time-limited cache of Sleeper's public player directory.

Extension storage is restricted to trusted extension pages. The Sleeper content
script cannot read it. Data remains in the current Chrome profile until the user
removes the extension data or uninstalls the extension. Ranking-pack export is an
explicit user action and includes only the selected profile's ranking fields; it
does not include account identifiers, draft state, or settings.

## Network Access

The extension makes credential-free `GET` requests to public Sleeper API
endpoints only to resolve a username, read league and draft metadata, fetch the
public player directory, read posted picks, and build a public ADP starter board.
It does not send ranking packs, draft decisions, local state, or account
credentials to project maintainers or any project-operated service.

## Collection

The project does not collect analytics, advertising identifiers, browsing
history, payment data, or Sleeper passwords. Sleeper authentication remains
between the user and Sleeper.

The extension does not submit picks, trades, waivers, messages, roster changes,
or payments to Sleeper.

## Retention And Control

Local data remains until the user deletes a ranking profile, replaces the
connected Sleeper profile, clears the extension's site data, or uninstalls the
extension. The project maintainers cannot access or delete this local data
because it is never sent to a project-operated service.

## Sharing And Limited Use

The extension shares a Sleeper username and public identifiers only with
Sleeper's public HTTPS APIs when necessary to provide account discovery, draft
sync, and the public ranking baseline. It does not sell user data, use it for
advertising or credit decisions, or allow project maintainers or other humans
to read it.

The extension's use and transfer of user data complies with the Chrome Web
Store User Data Policy, including its Limited Use requirements. User data is
used only to provide or improve the extension's single purpose: applying the
user's rankings to read-only live or manual Sleeper draft context.
