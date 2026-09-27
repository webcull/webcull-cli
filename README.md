# WebCull CLI

`@webcull/cli` is the official command line client for WebCull bookmark access.
It is designed for humans, scripts, and coding agents that need conservative
read and focused write access to a subscribed WebCull account.

## Links

- npm: https://www.npmjs.com/package/@webcull/cli
- GitHub: https://github.com/webcull/webcull-cli

## Install

```bash
npm install -g @webcull/cli
```

The package requires Node.js 18 or newer.

## Accounts And Login

```bash
webcull login
```

Login starts a browser approval flow. Approve only requests you initiated from
`webcull login`. Logging in again adds another account instead of replacing
the accounts that are already authorized.

List locally authorized accounts without exposing their tokens:

```bash
webcull accounts
```

Use an account hash or user ID on any account command:

```bash
webcull whoami --account abc123
webcull bookmarks count --account abc123 --path /
```

Without `--account`, ordinary commands use the last successfully accessed
account. Agents should always provide the intended account hash.

To revoke one CLI authorization on the server and remove it from this device:

```bash
webcull logout
```

When multiple accounts are authorized, an interactive terminal shows a
numbered account picker. A non-interactive command must provide
`--account <hash|id>` and receives a structured account list if it does not.

Logout must confirm server revocation before it removes the token from local OS
credential storage and clears local authorization metadata. If WebCull cannot
be reached, the local credential is preserved so the command cannot claim a
server logout that did not happen.

For an offline or lost-server recovery where local removal is still required:

```bash
webcull logout --local-only
```

Local-only logout clearly warns that the selected server token may remain
valid.

CLI tokens are separate from browser, extension, Raycast, and app sessions. They
use WebCull's shared API integration auth layer with `client_type = cli`, while
CLI subscription policy remains CLI-specific. Tokens are stored in OS credential
storage when available. The local config file may store non-secret metadata
only.

## Common Commands

```bash
webcull whoami
webcull accounts
webcull limits
webcull bookmarks count
webcull bookmarks tree --depth 2 --limit 50
webcull bookmarks search "design systems" --limit 20
webcull bookmarks get 123 --fields id,title,value,tags
webcull bookmarks proxy 123 --fields title,icon,description
webcull reminders list --limit 20
webcull graph around --stack-id 123
webcull graph schema
```

Run commands with `--format json` when the output is being consumed by a script
or agent.

`webcull bookmarks proxy <id>` refreshes selected title, icon, and description
metadata for a bookmark in a non-E2EE account. Bookmark creation can request the
same follow-up with `--proxy`, `--proxy-fields`, and `--proxy-exclude`.

Retryable failures preserve structured `request_busy`,
`request_lock_unavailable`, or `throttled` codes and their retry timing. Respect
that timing and narrow the next request after throttling.

## E2EE Safety

The CLI performs end-to-end encryption work locally. It must never send an E2EE
passphrase, passphrase hash, derived key, or decrypted check value to WebCull.

Keep your E2EE passphrase in your own keystore. When encrypted fields are
needed, pipe one passphrase directly from that keystore and add
`--e2ee-passphrase-stdin`. This mode requires an explicit
`--account <hash|id>` so agent commands cannot unlock the wrong account. The CLI
rejects passphrases in command arguments, environment variables, and config.

macOS Keychain:

```bash
security find-generic-password -a "$USER" -s webcull-e2ee -w |
  webcull bookmarks get --account <account-hash> --ids 2302 --fields id,title,notes --e2ee-passphrase-stdin
```

Windows PowerShell with Microsoft.PowerShell.SecretManagement:

```powershell
Get-Secret -Name webcull-e2ee -AsPlainText |
  webcull bookmarks get --account <account-hash> --ids 2302 --fields id,title,notes --e2ee-passphrase-stdin
```

Linux Secret Service:

```bash
secret-tool lookup service webcull-e2ee account "$USER" |
  webcull bookmarks get --account <account-hash> --ids 2302 --fields id,title,notes --e2ee-passphrase-stdin
```

The credential names above are examples. You choose and configure the keystore
entry. The keystore process writes the passphrase directly to the CLI pipe, so
the secret does not appear in the agent request, process arguments, environment,
WebCull config, or command output. The CLI derives the key locally for that
process and does not remember the passphrase or derived key.

## WebCull Account Access

The CLI connects to your WebCull account through the WebCull API. Commands use
the same account permissions and subscription status as the WebCull service.

If your account needs a subscription or account update, complete that in the
WebCull app, then run the CLI command again.

## Subscriber Use

Use of this CLI requires an active WebCull subscription. The source is available
so subscribers can inspect it, fork it, and adapt it for their own WebCull
workflows under the license terms in `LICENSE.md`.

## Development

```bash
npm test
npm run check
npm pack --dry-run
```

Before publishing, inspect `npm pack --dry-run` and confirm that the package
contains only the intended release files.
