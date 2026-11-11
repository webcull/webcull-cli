import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TokenStore } from '../src/auth/TokenStore.js';
import { CredentialStore } from '../src/auth/CredentialStore.js';
import { ApiClient } from '../src/http/ApiClient.js';
import { LogoutCommand } from '../src/commands/LogoutCommand.js';
import { LoginCommand } from '../src/commands/LoginCommand.js';
import { AccountsCommand } from '../src/commands/AccountsCommand.js';
import { CliAuthFlow } from '../src/auth/CliAuthFlow.js';
import { WebCullCli } from '../src/WebCullCli.js';
import { McpRuntime } from '../src/mcp/McpRuntime.js';

class MemoryCredentialStore {
  constructor() {
    this.token = null;
  }

  async save(token) {
    this.token = token;
  }

  async read() {
    return this.token;
  }

  async delete() {
    this.token = null;
  }
}

function validToken() {
  return 'wco_cli_' + 'a'.repeat(48);
}

function validTokenFor(letter) {
  return 'wco_cli_' + letter.repeat(48);
}

function user(id = 7, hash = 'accounthash0007') {
  return { id, hash, name: 'Account ' + id, email: 'account' + id + '@example.com' };
}

class MemoryCredentialRegistry {
  constructor() {
    this.stores = new Map();
  }

  store(account) {
    if (!this.stores.has(account)) {
      this.stores.set(account, new MemoryCredentialStore());
    }
    return this.stores.get(account);
  }
}

test('TokenStore writes restrictive permissions and purges expired tokens', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcull-cli-auth-'));
  const configPath = path.join(dir, 'config.json');
  const credentials = new MemoryCredentialStore();
  const store = new TokenStore(configPath, credentials);
  store.useAccount(user().hash);
  await store.saveToken({
    token: validToken(),
    expires: Math.floor(Date.now() / 1000) + 60,
    scopes: ['bookmarks:read', 'bookmarks:write'],
    user: user()
  });
  const stats = await fs.stat(configPath);
  assert.equal(stats.mode & 0o077, 0);
  const savedConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(savedConfig.token, undefined);
  assert.equal(savedConfig.accounts.length, 1);
  assert.equal(savedConfig.accounts[0].user.hash, user().hash);
  assert.equal(await store.requireToken(), validToken());
  await fs.writeFile(configPath, JSON.stringify({
    token: validToken(),
    expires: Math.floor(Date.now() / 1000) - 1,
    scopes: ['bookmarks:read', 'bookmarks:write'],
    user: user()
  }));
  await assert.rejects(() => store.requireToken(), /CLI token expired/);
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.token, undefined);
  assert.deepEqual(config.accounts, []);
  assert.equal(credentials.token, null);
});

test('TokenStore requires token expiry metadata', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcull-cli-auth-'));
  const configPath = path.join(dir, 'config.json');
  const store = new TokenStore(configPath, new MemoryCredentialStore());
  store.useAccount(user().hash);
  await assert.rejects(() => store.saveToken({
    token: validToken(),
    scopes: ['bookmarks:read'],
    user: user()
  }), /valid token expiry/);
  await fs.writeFile(configPath, JSON.stringify({
    token: validToken(),
    scopes: ['bookmarks:read'],
    user: user()
  }));
  await assert.rejects(() => store.requireToken(), /CLI token expired/);
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.token, undefined);
  assert.deepEqual(config.accounts, []);
});

test('TokenStore rejects secret-like E2EE config keys and unsupported scopes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcull-cli-auth-'));
  const configPath = path.join(dir, 'config.json');
  await fs.writeFile(configPath, JSON.stringify({
    token: validToken(),
    scopes: ['bookmarks:read'],
    e2eePassphrase: 'do-not-store'
  }));
  const store = new TokenStore(configPath, new MemoryCredentialStore());
  store.useAccount(user().hash);
  await assert.rejects(() => store.read(), /must not store E2EE/);
  await fs.writeFile(configPath, JSON.stringify({
    token: validToken(),
    scopes: ['unsupported:scope']
  }));
  await assert.rejects(() => store.read(), /unsupported token scope/);
});

test('TokenStore refuses symbolic link config paths', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcull-cli-auth-'));
  const targetPath = path.join(dir, 'target.json');
  const linkPath = path.join(dir, 'config.json');
  await fs.writeFile(targetPath, JSON.stringify({ token: validToken(), scopes: ['bookmarks:read'] }));
  await fs.symlink(targetPath, linkPath);
  const store = new TokenStore(linkPath, new MemoryCredentialStore());
  store.useAccount(user().hash);
  await assert.rejects(() => store.read(), /symbolic link/);
  await assert.rejects(() => store.saveToken({
    token: validToken(),
    expires: Math.floor(Date.now() / 1000) + 60,
    scopes: ['bookmarks:read'],
    user: user()
  }), /symbolic link/);
});

test('TokenStore migrates legacy config tokens into OS credentials', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcull-cli-auth-'));
  const configPath = path.join(dir, 'config.json');
  const credentials = new MemoryCredentialStore();
  await fs.writeFile(configPath, JSON.stringify({
    token: validToken(),
    expires: Math.floor(Date.now() / 1000) + 60,
    scopes: ['bookmarks:read'],
    user: user()
  }));
  const store = new TokenStore(configPath, credentials);
  store.useAccount(user().hash);
  assert.equal(await store.requireToken(), validToken());
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.token, undefined);
  assert.equal(credentials.token, validToken());
  assert.equal(config.accounts[0].user.hash, user().hash);
});

test('TokenStore migrates an existing legacy OS credential locator', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcull-cli-auth-'));
  const configPath = path.join(dir, 'config.json');
  const credentials = new MemoryCredentialRegistry();
  const store = new TokenStore(configPath, account => credentials.store(account));
  store.useAccount(user().hash);
  await credentials.store(store.credentialAccount()).save(validToken());
  await fs.writeFile(configPath, JSON.stringify({
    expires: Math.floor(Date.now() / 1000) + 60,
    scopes: ['bookmarks:read'],
    user: user()
  }));

  assert.equal(await store.requireToken(), validToken());
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.accounts[0].credential_account, store.credentialAccount());
});

test('LogoutCommand revokes the current server token before purging local authorization', async () => {
  const calls = [];
  const messages = [];
  const command = new LogoutCommand({
    async post(path, data, options) {
      calls.push(['post', path, data, options]);
      return { success: 'true' };
    },
    structuredError(response, message) {
      return new Error(response.failure || message);
    }
  }, {
    async accountSelection() {
      const selected = { user: user() };
      return { selected, accounts: [selected] };
    },
    async purgeToken() {
      calls.push(['purge']);
    }
  }, {
    log(message) {
      messages.push(message);
    }
  });

  await command.run();

  assert.deepEqual(calls, [
    ['post', '/cli/auth-logout', {}, { auth: true }],
    ['purge']
  ]);
  assert.deepEqual(messages, ['WebCull CLI logout complete. Server authorization revoked and local credentials removed.']);
});

test('WebCullCli exposes one command name for each account action', () => {
  const cli = new WebCullCli();
  assert.equal(cli.commands.has('login'), true);
  assert.equal(cli.commands.has('accounts'), true);
  assert.equal(cli.commands.has('logout'), true);
  assert.equal(cli.commands.has('auth login'), false);
  assert.equal(cli.commands.has('auth accounts'), false);
  assert.equal(cli.commands.has('auth list'), false);
  assert.equal(cli.commands.has('auth logout'), false);
});

test('LogoutCommand preserves local authorization when server revocation fails', async () => {
  const calls = [];
  const messages = [];
  const command = new LogoutCommand({
    async post() {
      return { success: 'false', failure: 'Revocation unavailable.' };
    },
    structuredError(response, message) {
      return new Error(response.failure || message);
    }
  }, {
    async accountSelection() {
      const selected = { user: user() };
      return { selected, accounts: [selected] };
    },
    async purgeToken() {
      calls.push('purge');
    }
  }, {
    log(message) {
      messages.push(message);
    }
  });

  await assert.rejects(() => command.run(), /Revocation unavailable/);
  assert.deepEqual(calls, []);
  assert.deepEqual(messages, []);
});

test('LogoutCommand preserves local authorization after a network failure', async () => {
  const calls = [];
  const command = new LogoutCommand({
    async post() {
      throw new Error('offline');
    }
  }, {
    async accountSelection() {
      const selected = { user: user() };
      return { selected, accounts: [selected] };
    },
    async purgeToken() {
      calls.push('purge');
    }
  });

  await assert.rejects(() => command.run(), /offline/);
  assert.deepEqual(calls, []);
});

test('LogoutCommand local-only mode removes local authorization with an explicit warning', async () => {
  const calls = [];
  const messages = [];
  const command = new LogoutCommand({
    async post() {
      calls.push('post');
    }
  }, {
    async accountSelection() {
      const selected = { user: user() };
      return { selected, accounts: [selected] };
    },
    async purgeToken() {
      calls.push('purge');
    }
  }, {
    log(message) {
      messages.push(message);
    }
  });

  await command.run({ options: { localOnly: true } });
  assert.deepEqual(calls, ['purge']);
  assert.deepEqual(messages, ['Local WebCull CLI authorization removed. The server token may remain valid.']);
});

test('LoginCommand permits adding another authorized account', async () => {
  const calls = [];
  const command = new LoginCommand({}, {});
  command.flow = {
    async run(options) {
      calls.push(options);
    }
  };

  await command.run({ options: { browser: 'false' } });
  assert.deepEqual(calls, [{ browser: 'false' }]);
});

test('CliAuthFlow revokes a newly issued duplicate account token', async () => {
  const calls = [];
  const duplicate = new Error('already logged in');
  duplicate.code = 'account_already_logged_in';
  const flow = new CliAuthFlow({
    async post(path, data, options) {
      calls.push([path, data, options]);
      if (path === '/cli/auth-redeem') {
        return {
          success: 'true',
          token: validTokenFor('b'),
          expires: Math.floor(Date.now() / 1000) + 60,
          scopes: ['bookmarks:read'],
          user: user()
        };
      }
      return { success: 'true' };
    }
  }, {
    async saveToken() {
      throw duplicate;
    }
  });

  await assert.rejects(() => flow.poll('request', 'verifier', 'WebCull CLI'), error => error === duplicate);
  assert.deepEqual(calls[1], [
    '/cli/auth-logout',
    {},
    { authToken: validTokenFor('b') }
  ]);
});

test('CliAuthFlow reports when duplicate account revocation is rejected', async () => {
  const duplicate = new Error('already logged in');
  duplicate.code = 'account_already_logged_in';
  const flow = new CliAuthFlow({
    async post(path) {
      if (path === '/cli/auth-redeem') {
        return {
          success: 'true',
          token: validTokenFor('b'),
          expires: Math.floor(Date.now() / 1000) + 60,
          scopes: ['bookmarks:read'],
          user: user()
        };
      }
      return { success: 'false', failure: 'Revocation unavailable.' };
    }
  }, {
    async saveToken() {
      throw duplicate;
    }
  });

  await assert.rejects(
    () => flow.poll('request', 'verifier', 'WebCull CLI'),
    /duplicate authorization could not be revoked automatically/
  );
});

test('TokenStore logout purge preserves unrelated non-secret config', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcull-cli-auth-'));
  const configPath = path.join(dir, 'config.json');
  const credentials = new MemoryCredentialStore();
  const store = new TokenStore(configPath, credentials);
  store.useAccount(user().hash);
  await store.saveToken({
    token: validToken(),
    expires: Math.floor(Date.now() / 1000) + 60,
    scopes: ['bookmarks:read', 'bookmarks:write'],
    user: user()
  });
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  config.output = 'json';
  await store.write(config);

  await store.purgeToken();

  const loggedOutConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.deepEqual(loggedOutConfig, { accounts: [], output: 'json' });
  assert.equal(credentials.token, null);
  store.useAccount(user().hash);
  await assert.rejects(() => store.requireToken(), /No logged-in WebCull account matches/);
});

test('TokenStore detects a valid stored authorization and clears stale metadata', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcull-cli-auth-'));
  const configPath = path.join(dir, 'config.json');
  const credentials = new MemoryCredentialStore();
  const store = new TokenStore(configPath, credentials);
  store.useAccount(user().hash);
  await store.saveToken({
    token: validToken(),
    expires: Math.floor(Date.now() / 1000) + 60,
    scopes: ['bookmarks:read'],
    user: user()
  });
  assert.equal(await store.hasValidToken(), true);
  credentials.token = null;
  assert.equal(await store.hasValidToken(), false);
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.deepEqual(config.accounts, []);
});

test('TokenStore keeps separate credentials and selects accounts by hash or user ID', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcull-cli-auth-'));
  const configPath = path.join(dir, 'config.json');
  const credentials = new MemoryCredentialRegistry();
  const store = new TokenStore(configPath, account => credentials.store(account));
  store.useAccount(user().hash);
  await store.saveToken({
    token: validTokenFor('a'),
    expires: Math.floor(Date.now() / 1000) + 60,
    scopes: ['bookmarks:read'],
    user: user(7, 'account_hash_7')
  });
  await store.saveToken({
    token: validTokenFor('b'),
    expires: Math.floor(Date.now() / 1000) + 60,
    scopes: ['bookmarks:read', 'bookmarks:write'],
    user: user(8, 'account_hash_8')
  });

  let accounts = await store.listAccounts();
  assert.equal(accounts.length, 2);
  assert.equal(accounts[0].user.hash, 'account_hash_7');
  assert.ok(accounts.every(account => !Object.hasOwn(account, 'active')));

  store.useAccount('account_hash_7');
  assert.equal(await store.requireToken(), validTokenFor('a'));
  accounts = await store.listAccounts();
  assert.equal(accounts[0].user.hash, 'account_hash_7');

  store.useAccount(8);
  assert.equal(await store.requireToken(), validTokenFor('b'));
});

test('TokenStore supports simultaneous account selection without corrupting config', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcull-cli-auth-'));
  const configPath = path.join(dir, 'config.json');
  const credentials = new MemoryCredentialRegistry();
  const setup = new TokenStore(configPath, account => credentials.store(account));
  await setup.saveToken({
    token: validTokenFor('a'),
    expires: Math.floor(Date.now() / 1000) + 60,
    scopes: ['bookmarks:read'],
    user: user(7, 'account_hash_7')
  });
  await setup.saveToken({
    token: validTokenFor('b'),
    expires: Math.floor(Date.now() / 1000) + 60,
    scopes: ['bookmarks:read'],
    user: user(8, 'account_hash_8')
  });
  const first = new TokenStore(configPath, account => credentials.store(account));
  const second = new TokenStore(configPath, account => credentials.store(account));
  first.useAccount('account_hash_7');
  second.useAccount('account_hash_8');

  const tokens = await Promise.all([first.requireToken(), second.requireToken()]);

  assert.deepEqual(tokens.sort(), [validTokenFor('a'), validTokenFor('b')].sort());
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.accounts.length, 2);
});

test('TokenStore preserves an existing account when duplicate login is attempted', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcull-cli-auth-'));
  const configPath = path.join(dir, 'config.json');
  const credentials = new MemoryCredentialRegistry();
  const store = new TokenStore(configPath, account => credentials.store(account));
  store.useAccount(user().hash);
  await store.saveToken({
    token: validTokenFor('a'),
    expires: Math.floor(Date.now() / 1000) + 60,
    scopes: ['bookmarks:read'],
    user: user(7, 'account_hash_7')
  });

  await assert.rejects(() => store.saveToken({
    token: validTokenFor('b'),
    expires: Math.floor(Date.now() / 1000) + 60,
    scopes: ['bookmarks:read'],
    user: user(7, 'account_hash_7')
  }), error => error.code === 'account_already_logged_in');
  store.useAccount('account_hash_7');
  assert.equal(await store.requireToken(), validTokenFor('a'));
});

for (const client of ['cli', 'mcp']) {
  test(client + ' registry never selects or reports a default, including across concurrent accounts', async t => {
    // Reuse the isolated credential-registry fixture; no real OS credentials or API calls.
    await fs.mkdir(new URL('../../tmp/', import.meta.url), { recursive: true });
    const dir = await fs.mkdtemp(new URL('../../tmp/webcull-mcp-auth-', import.meta.url));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const configPath = path.join(dir, 'mcp.json');
    const credentials = new MemoryCredentialRegistry();
    const makeStore = () => new TokenStore(configPath, account => credentials.store(account), { client });
    const setup = makeStore();
    const record = (id, letter) => ({ token: validTokenFor(letter), user: user(id, 'account_hash_' + id),
      expires: Math.floor(Date.now() / 1000) + 600, scopes: ['bookmarks:read', 'bookmarks:write'] });
    const missingAccount = error => error.cliResponse?.code === 'account_selection_required';
    await setup.saveToken(record(7, 'a'));
    await assert.rejects(() => setup.requireToken(), missingAccount);
    const implicit = makeStore();
    // A single authorized account must not make omission acceptable, even for local logout.
    await assert.rejects(() => implicit.requireToken(), missingAccount);
    await assert.rejects(() => implicit.accountSelection(), missingAccount);
    await assert.rejects(() => implicit.purgeToken(), missingAccount);
    await assert.rejects(() => new LogoutCommand({}, implicit).run({ options: { localOnly: true } }), missingAccount);
    assert.throws(() => implicit.resolveAccount([], null), missingAccount);
    assert.equal(Object.hasOwn(await setup.read(), 'active_account'), false);
    await setup.saveToken(record(8, 'b'));

    // Simulate metadata written by the previous version. Only the obsolete selector is removed.
    const legacy = await setup.read();
    legacy.active_account = 'account_hash_8';
    legacy.preference = 'preserve';
    await fs.writeFile(configPath, JSON.stringify(legacy));
    const accounts = await implicit.listAccounts();
    assert.deepEqual(accounts.map(account => account.user.hash), ['account_hash_7', 'account_hash_8']);
    assert.ok(accounts.every(account => !Object.hasOwn(account, 'active')));
    const migrated = await setup.read();
    assert.equal(Object.hasOwn(migrated, 'active_account'), false);
    assert.deepEqual(migrated.accounts, legacy.accounts);
    assert.equal(migrated.preference, 'preserve');

    const first = makeStore();
    const second = makeStore();
    first.useAccount('account_hash_7');
    second.useAccount('account_hash_8');
    assert.deepEqual(await Promise.all([first.requireToken(), second.requireToken()]), [validTokenFor('a'), validTokenFor('b')]);
    await first.updateSelectedAccount({ user: user(7, 'account_hash_7'), scopes: ['bookmarks:read', 'bookmarks:write'] });
    assert.equal(Object.hasOwn(await setup.read(), 'active_account'), false);
    await assert.rejects(() => makeStore().requireToken(), missingAccount);
    const unknown = makeStore();
    unknown.useAccount('unknown_account');
    await assert.rejects(() => unknown.requireToken(), /No logged-in WebCull account matches/);

    // Exercise real command and API auth routing, stopping at the transport boundary.
    // No backend response or network request is needed to verify the selected credential.
    const requests = [];
    const stopped = new Error('Transport intentionally stopped');
    const context = () => {
      const tokenStore = makeStore();
      const apiClient = new ApiClient({ apiUrl: 'https://api.webcull.com', tokenStore, client });
      apiClient.request = async (url, options) => {
        requests.push([url.pathname, options.headers.Authorization]);
        throw stopped;
      };
      return { tokenStore, apiClient };
    };
    const cli = new WebCullCli(context());
    const runtime = new McpRuntime();
    runtime.context = context;
    for (const id of [7, 8]) {
      const operation = client === 'mcp'
        ? () => runtime.call('webcull_whoami', { account: 'account_hash_' + id })
        : () => cli.run(['whoami', '--account', 'account_hash_' + id]);
      await assert.rejects(operation, error => error === stopped);
    }
    assert.deepEqual(requests, [
      ['/' + client + '/whoami', 'Bearer ' + validTokenFor('a')],
      ['/' + client + '/whoami', 'Bearer ' + validTokenFor('b')]
    ]);
    await assert.rejects(() => cli.run(['whoami']), missingAccount);
    assert.equal(requests.length, 2);

    let output;
    const command = new AccountsCommand(implicit);
    command.output = { print: value => { output = value; } };
    await command.run({ options: {} });
    assert.equal(Object.hasOwn(output, 'active_account'), false);
    assert.ok(output.accounts.every(account => !Object.hasOwn(account, 'active')));
    await first.purgeToken();
    assert.equal(await second.requireToken(), validTokenFor('b'));
    assert.equal(Object.hasOwn(await setup.read(), 'active_account'), false);
    await assert.rejects(() => makeStore().requireToken(), missingAccount);
    const expired = await setup.read();
    expired.accounts[0].expires = Math.floor(Date.now() / 1000) - 1;
    await setup.write(expired);
    assert.deepEqual(await implicit.listAccounts(), []);
    await command.run({ options: {} });
    assert.equal(output.login_required, true);
    assert.equal(Object.hasOwn(output, 'active_account'), false);
    assert.equal(Object.hasOwn(await setup.read(), 'active_account'), false);
  });

}

test('CLI requires an account before credentials, API calls or command work, without reusing a prior selection', async () => {
  const store = new TokenStore(undefined, () => assert.fail('Must not access credentials'));
  store.read = async () => assert.fail('Must not access account metadata');
  const cli = new WebCullCli({ tokenStore: store });
  for (const name of cli.commands.keys()) {
    if (['login', 'accounts'].includes(name)) continue;
    store.useAccount('account_hash_7');
    await assert.rejects(() => cli.run(name.split(' ')), error => error.cliResponse?.code === 'account_selection_required');
    assert.equal(store.requestedAccount, null);
  }
  await assert.rejects(() => cli.run(['logout', '--local-only']), error => error.cliResponse?.code === 'account_selection_required');
});

test('AccountsCommand prints the local account registry', async () => {
  const accounts = [{ number: 1, user: user(7, 'account_hash_7') }];
  const printed = [];
  const command = new AccountsCommand({
    async listAccounts() {
      return accounts;
    }
  });
  command.output = {
    print(value, options) {
      printed.push([value, options]);
    }
  };

  await command.run({ options: { format: 'json' } });

  assert.deepEqual(printed, [[{
    success: 'true',
    accounts
  }, { format: 'json' }]]);
});

test('AccountsCommand guides login when no local account is authorized', async () => {
  const printed = [];
  const command = new AccountsCommand({
    async listAccounts() {
      return [];
    }
  });
  command.output = {
    print(value) {
      printed.push(value);
    }
  };

  await command.run({ options: {} });

  assert.deepEqual(printed, [{
    success: 'true',
    accounts: [],
    login_required: true,
    next_command: 'webcull login'
  }]);
});

test('ApiClient redacts CLI tokens from server-provided error messages', () => {
  const client = new ApiClient({ apiUrl: 'https://api.webcull.com', tokenStore: {} });
  const message = client.safeMessage('failed for Bearer ' + validToken() + ' token ' + validToken());
  assert.equal(message.includes(validToken()), false);
  assert.equal(message.includes('[redacted-cli-token]'), true);
  assert.equal(message.includes('Bearer [redacted]'), true);
  const response = client.safeResponse({
    failure: 'token ' + validToken(),
    nested: { error: 'Bearer ' + validToken() },
    token: validToken()
  });
  assert.equal(response.failure.includes(validToken()), false);
  assert.equal(response.nested.error.includes(validToken()), false);
  assert.equal(response.token, validToken());
});

test('ApiClient preserves structured retry guidance for agent-readable failures', () => {
  const client = new ApiClient({ apiUrl: 'https://api.webcull.com', tokenStore: {} });
  const error = client.structuredError({
    success: 'false',
    failure: 'Another request is running.',
    code: 'request_busy',
    retry_after_ms: 1000
  }, 'Request failed.');
  assert.equal(error.message, 'Another request is running.');
  assert.deepEqual(error.cliResponse, {
    success: 'false',
    failure: 'Another request is running.',
    code: 'request_busy',
    retry_after_ms: 1000
  });
});

test('ApiClient classifies request_busy results without discarding the response code', () => {
  const client = new ApiClient({ apiUrl: 'https://api.webcull.com', tokenStore: {} });
  const error = client.responseError({
    success: 'false',
    failure: 'Another request is running.',
    code: 'request_busy',
    retry_after_ms: 1000
  }, 200);
  assert.equal(error.cliResponse.code, 'request_busy');
  assert.equal(error.cliResponse.retry_after_ms, 1000);
});

test('CredentialStore uses platform credential providers', async () => {
  const calls = [];
  const runCommand = async (file, args, options = {}) => {
    calls.push({ file, args, options });
    if (args.includes('find-generic-password') || args.includes('lookup')) {
      return { stdout: validToken(), stderr: '', code: 0 };
    }
    return { stdout: '', stderr: '', code: 0 };
  };
  const mac = new CredentialStore({ platform: 'darwin', account: 'acct', runCommand });
  await mac.save(validToken());
  assert.equal(await mac.read(), validToken());
  await mac.delete();
  const linux = new CredentialStore({ platform: 'linux', account: 'acct', runCommand });
  await linux.save(validToken());
  assert.equal(await linux.read(), validToken());
  await linux.delete();
  const windows = new CredentialStore({ platform: 'win32', account: 'acct', runCommand });
  await windows.save(validToken());
  await windows.read();
  await windows.delete();
  assert.equal(calls.some(call => call.file === '/usr/bin/security'), true);
  assert.equal(calls.some(call => call.file === 'secret-tool'), true);
  assert.equal(calls.some(call => call.file === 'powershell.exe'), true);
  assert.equal(calls.some(call => call.options.input === validToken()), true);
  assert.equal(calls.some(call => call.options.env && call.options.env.WEBCULL_CLI_TOKEN === validToken()), true);
});

test('CredentialStore fails closed on unsupported platforms', async () => {
  const store = new CredentialStore({ platform: 'freebsd', runCommand: async () => ({ stdout: '', stderr: '', code: 0 }) });
  await assert.rejects(() => store.save(validToken()), /not available/);
  await assert.rejects(() => store.read(), /not available/);
});
