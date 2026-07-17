# Changelog

## Unreleased

- Add multiple simultaneous account authorizations with separate OS credential
  entries and atomic local account metadata updates.
- Add `webcull accounts` and global `--account <hash|id>` selection.
- Add a numbered interactive account picker for ambiguous logout commands and
  structured `account_selection_required` output for non-interactive callers.
- Add `webcull logout` and `webcull auth logout` to revoke the current server
  token before removing local CLI authorization.
- Add explicit `webcull logout --local-only` recovery behavior for offline
  local credential removal.

## 0.1.2

- Preserve structured retry codes for concurrent-request and throttle failures.

## 0.1.1

- Update repository metadata for the WebCull organization repo.

## 0.1.0

- Initial public WebCull CLI package preparation.
- Includes login, account, bookmark, reminder, graph, E2EE, output budget, and
  OS credential storage support.
