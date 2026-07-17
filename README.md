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

Login starts a browser approval flow. The terminal shows a pairing code and the
browser approval page shows the same code. Compare the codes before approving.
Logging in again adds another account instead of replacing the accounts that
are already authorized.

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
valid. The `webcull auth logout` alias has the same behavior.

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
webcull reminders list --limit 20
webcull graph around --stack-id 123
webcull graph schema
```

Run commands with `--format json` when the output is being consumed by a script
or agent.

## E2EE Safety

The CLI performs end-to-end encryption work locally. It must never send an E2EE
passphrase, passphrase hash, derived key, or decrypted check value to WebCull.

The CLI rejects passphrase-style command line flags and environment variables.
When encrypted fields are needed, it prompts interactively with hidden terminal
input.

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
