# Changelog

## 0.1.2

- Add multiple simultaneous account authorizations with separate OS credential
  entries and atomic local account metadata updates.
- Add `webcull accounts` and global `--account <hash|id>` selection.
- Add a numbered interactive account picker for ambiguous logout commands and
  structured `account_selection_required` output for non-interactive callers.
- Add `webcull logout` to revoke the current server token before removing local
  CLI authorization.
- Account actions: `webcull login`, `webcull accounts`, and `webcull logout`.
- Add explicit `webcull logout --local-only` recovery behavior for offline
  local credential removal.
- Add `webcull bookmarks proxy <id>` and optional bookmark-create proxy refresh
  for selected title, icon, and description metadata on non-E2EE accounts.
- Add agent-compatible `--e2ee-passphrase-stdin` input for piping one E2EE
  passphrase directly from a user-managed keystore without persisting E2EE
  passphrases or derived keys after the process exits.

## 0.1.1

- Update repository metadata for the WebCull organization repo.

## 0.1.0

- Initial public WebCull CLI package preparation.
- Includes login, account, bookmark, reminder, graph, E2EE, output budget, and
  OS credential storage support.
