# Contributing

Keep pull requests small, tested, and free of real account or league data.

## Data Rules

- Use fictional players and identifiers in tests and examples.
- Do not commit downloaded, scraped, licensed, subscriber-only, or paywalled
  ranking data.
- Do not commit browser profiles, cookies, tokens, screenshots, CSV exports,
  ZIP releases, or environment files.
- Run the release safety gate and unit tests before opening a pull request.

## Product Rules

- Keep the extension read-only with respect to Sleeper draft selections.
- Require an explicit user action for manual-pick entry and destructive reset.
- Persist recoverable draft state locally.
- Add tests for snake order, third-round reversal, reload recovery, and live
  versus manual pick precedence when those paths change.

