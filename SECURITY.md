# Security Policy

## Reporting Issues

Report security issues privately to WebCull before public disclosure. Include a
short description, affected command or endpoint, reproduction steps, and impact.
Use GitHub private vulnerability reporting if it is enabled for this repository,
or contact WebCull through the support channel listed on `webcull.com`.

Do not include live tokens, passwords, E2EE passphrases, or customer data in a
report.

## CLI Token Safety

The CLI stores tokens in OS credential storage when available. Token values must
not be printed, logged, committed, included in screenshots, or copied into bug
reports.

The local config file may store only non-secret metadata such as expiry,
account display data, and scopes.

## E2EE Safety

The CLI must never accept E2EE passphrases through command line flags,
environment variables, config files, stdin piping, logs, or API payloads.

Encrypted bookmark content is decrypted locally only after an interactive hidden
prompt. The server must not receive passphrases, passphrase hashes, derived
keys, decrypted check values, or decrypted bookmark fields.

## WebCull Account Access

The CLI connects to WebCull through the WebCull API and uses the permissions
granted to the signed-in account. Keep your WebCull account, local machine, and
credential storage protected.

## Release Safety

Before publishing a release:

- Run tests and syntax checks.
- Inspect `npm pack --dry-run`.
- Confirm package contents are limited to public CLI files.
- Confirm no local config, credentials, build output, or unrelated project files
  are included.
- Publish only from a clean trusted checkout with npm two-factor authentication
  enabled.
