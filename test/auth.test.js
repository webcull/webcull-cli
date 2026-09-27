import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { TokenStore } from '../src/auth/TokenStore.js';
import { CredentialStore } from '../src/auth/CredentialStore.js';
import { ApiClient } from '../src/http/ApiClient.js';
import { LogoutCommand } from '../src/commands/LogoutCommand.js';
import { LoginCommand } from '../src/commands/LoginCommand.js';
import { AccountsCommand } from '../src/commands/AccountsCommand.js';
import { AccountPicker } from '../src/auth/AccountPicker.js';
import { CliAuthFlow } from '../src/auth/CliAuthFlow.js';
import { WebCullCli } from '../src/WebCullCli.js';

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
  await assert.rejects(() => store.requireToken(), /Run webcull login first/);
});

test('TokenStore detects a valid stored authorization and clears stale metadata', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcull-cli-auth-'));
  const configPath = path.join(dir, 'config.json');
  const credentials = new MemoryCredentialStore();
  const store = new TokenStore(configPath, credentials);
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
  assert.equal(accounts[0].user.hash, 'account_hash_8');
  assert.equal(accounts[0].active, true);

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

test('LogoutCommand asks a picker to choose among multiple accounts', async () => {
  const calls = [];
  const accounts = [
    { number: 1, active: true, user: user(7, 'account_hash_7') },
    { number: 2, active: false, user: user(8, 'account_hash_8') }
  ];
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
      return { selected: null, accounts };
    },
    async selectPublicAccount(account) {
      calls.push(['select', account.user.hash]);
    },
    async purgeToken() {
      calls.push(['purge']);
    }
  }, {
    log(message) {
      calls.push(['log', message]);
    }
  }, {
    async choose(choices, action) {
      calls.push(['choose', choices.length, action]);
      return choices[1];
    }
  });

  await command.run();

  assert.deepEqual(calls.slice(0, 3), [
    ['choose', 2, 'log out'],
    ['select', 'account_hash_8'],
    ['post', '/cli/auth-logout', {}, { auth: true }]
  ]);
  assert.deepEqual(calls[3], ['purge']);
});

test('AccountPicker returns a structured account list when input is non-interactive', async () => {
  const picker = new AccountPicker({ input: { isTTY: false }, output: { isTTY: false } });
  const accounts = [{ number: 1, user: user(7, 'account_hash_7') }];
  await assert.rejects(() => picker.choose(accounts, 'log out'), error => {
    assert.equal(error.cliResponse.code, 'account_selection_required');
    assert.deepEqual(error.cliResponse.accounts, accounts);
    return true;
  });
});

test('AccountPicker accepts a numbered terminal selection', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = true;
  output.isTTY = true;
  let displayed = '';
  output.on('data', chunk => {
    displayed += chunk.toString('utf8');
  });
  const accounts = [
    { number: 1, active: true, user: user(7, 'account_hash_7') },
    { number: 2, active: false, user: user(8, 'account_hash_8') }
  ];
  const picker = new AccountPicker({ input, output });
  input.end('2\n');

  const selected = await picker.choose(accounts, 'log out');

  assert.equal(selected.user.hash, 'account_hash_8');
  assert.match(displayed, /1\. Account 7/);
  assert.match(displayed, /2\. Account 8/);
  assert.match(displayed, /Choose an account to log out \(1-2, or q to cancel\)/);
});

test('AccountsCommand prints the local account registry', async () => {
  const accounts = [{ number: 1, active: true, user: user(7, 'account_hash_7') }];
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
    active_account: 'account_hash_7',
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
    active_account: null,
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
