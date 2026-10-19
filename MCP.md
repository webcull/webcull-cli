# Local MCP

WebCull MCP exposes the CLI's bookmark, folder, graph, reminder and account
operations to AI applications that can launch a local stdio MCP server. It is
included in `@webcull/cli`. A WebCull subscription is required, including an
eligible subscription trial. A free iOS app account does not include CLI or
MCP access.

## Install and connect

Install Node.js 18 or newer, then install the package:

```sh
npm install -g @webcull/cli
webcull mcp login
webcull mcp accounts
webcull mcp setup
```

Approve only the browser request you started. MCP uses a separate authorization
from the CLI. Tokens are stored in your OS keystore; MCP account metadata is
stored in `~/.config/webcull/mcp.json`. No secret is stored in that file.

`webcull mcp setup` prints a configuration object using the installed Node and
WebCull paths and non-secret endpoint and registry settings. Copy its
`configuration` object into your AI application's MCP
configuration, merging with any servers already present. Do not replace your
other settings. Restart the connection after changes.

- Claude Desktop: use the `mcpServers` configuration printed by default. Follow
  [Claude's local server guide](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).
- VS Code: run `webcull mcp setup --client vscode` for the `servers` format.
  Prefer your user profile's MCP configuration for access to a personal account.
  Follow [VS Code's MCP setup guide](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

These are configuration recipes, not a guarantee about every client version.
Your client must support local stdio tools. No remote connector URL is provided.
`webcull mcp` stays running while the AI application uses it; do not start it as
an ordinary interactive command expecting a terminal prompt.

You can also ask the AI to call `webcull_setup`, `webcull_login`, and
`webcull_accounts`. Login has `start` and `complete` actions: open the returned
approval URL yourself, then ask the AI to complete the same request. The request
expires after five minutes and is discarded when the MCP process closes.

## Encrypted accounts: keystore required

Authorization tokens and E2EE passphrases serve different purposes. The token
authorizes API access; your E2EE passphrase unlocks encrypted fields locally.
Set up the E2EE entry yourself in your OS keystore, using your exact account
hash from `webcull mcp accounts`. Do not send the passphrase to an AI.

The E2EE service name is `webcull-mcp-e2ee`, and its account name is your WebCull
account hash. Use a separate entry for each account.

- **macOS:** Open Keychain Access and add a password item to your login
  keychain. Set the item name to `webcull-mcp-e2ee`, Account to the WebCull
  account hash, and Password to your E2EE passphrase. Unlock the keychain and
  approve an OS access prompt only when you initiated a WebCull operation.
- **Windows:** Open Credential Manager, choose Windows Credentials, and add a
  Generic Credential. Use `webcull-mcp-e2ee:<account-hash>` as the address,
  your account hash as the username, and your E2EE passphrase as the password.
- **Linux:** Install a Secret Service provider and `secret-tool` using your
  distribution's packages. Start an unlocked keyring in your desktop session.
  Run the command below yourself and enter the passphrase at its hidden prompt.
  Replace only `<account-hash>`; never append your passphrase to the command.

```sh
secret-tool store --label='WebCull MCP encryption' service webcull-mcp-e2ee account '<account-hash>'
```

Verify access without displaying the secret:

```sh
webcull mcp setup --account <account-hash> --check-e2ee
```

If storage is missing, locked, or inaccessible, WebCull stops the affected
operation. There is no plaintext-file, environment-variable, command-argument,
chat, or piped-passphrase fallback. Headless Linux needs a working Secret Service
session; installing Node alone is insufficient.

The derived encryption key is used for one MCP tool call and then released.
Your encryption passphrase and key are never sent to WebCull or returned to the
AI. Decrypted bookmark content you request through the AI is provided to that
AI application and may reach its provider. After changing your E2EE passphrase,
update the keystore entry yourself. Logging out removes the authorization token,
not the E2EE entry you manage.

## Tools and CLI parity

All 20 CLI commands have MCP tools; setup adds one extra tool. The name is
`webcull_` followed by the command words separated by underscores:

| CLI command group | MCP tool names |
| --- | --- |
| Account and usage | `webcull_login`, `webcull_logout`, `webcull_accounts`, `webcull_whoami`, `webcull_limits` |
| Bookmarks and folders | `webcull_bookmarks_count`, `webcull_bookmarks_tree`, `webcull_bookmarks_search`, `webcull_bookmarks_get`, `webcull_bookmarks_create`, `webcull_bookmarks_update`, `webcull_bookmarks_proxy` |
| Relationships | `webcull_graph_around`, `webcull_graph_backlinks`, `webcull_graph_path`, `webcull_graph_validate`, `webcull_graph_schema` |
| Reminders | `webcull_reminders_create`, `webcull_reminders_list`, `webcull_reminders_cancel` |

Tool discovery describes the accepted arguments. Supply `account` explicitly
for account operations. CLI options become camelCase arguments, such as
`maxChars`, `parentId`, and `dryRun`. Update, proxy and reminder cancellation
use an `id` argument. Get uses comma-separated `ids`. Responses are structured
JSON objects with a matching text representation; terminal JSONL formatting
is unnecessary. E2EE keystore lookup replaces the CLI's explicit stdin flag.

All existing operation restrictions still apply: one-item writes, ownership,
subscription checks, E2EE conversion restrictions, metadata refresh only for
unencrypted accounts, and bounded encrypted search. No bulk deletion or new
graph-write capability is added. CLI and MCP share the account's usage quotas.

## Troubleshooting

- No tools: inspect your client's MCP logs, regenerate configuration with
  `webcull mcp setup`, and restart the connection. Use the generated absolute
  paths, especially when your desktop app cannot find terminal commands.
- No accounts: CLI login does not authorize MCP. Run `webcull mcp login`.
- Access denied: use an account with an eligible WebCull subscription.
- Keystore failure: check the exact account hash, entry name, unlocked keyring,
  and whether the AI application runs as the same OS user as the keystore.
- Incorrect E2EE key: update the entry in your OS keystore. Do not paste it into
  chat. Finish any encryption conversion in WebCull before retrying writes.
- Busy or throttled: respect the returned delay and request less data. Do not
  automatically retry writes. If a write timed out or was cancelled after
  submission, read its state before deciding whether to repeat it.

To disconnect just MCP:

```sh
webcull mcp logout --account <account-hash>
```

For offline local removal, add `--local-only`; the server token may remain valid
until it expires. MCP configuration accepts `WEBCULL_MCP_CONFIG` for its
non-secret account registry and the existing `WEBCULL_API_URL` and
`WEBCULL_APP_URL` endpoint settings. Never use these settings to carry secrets.
