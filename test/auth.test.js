import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TokenStore } from '../src/auth/TokenStore.js';
import { CredentialStore } from '../src/auth/CredentialStore.js';
import { ApiClient } from '../src/http/ApiClient.js';

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

test('TokenStore writes restrictive permissions and purges expired tokens', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcull-cli-auth-'));
  const configPath = path.join(dir, 'config.json');
  const credentials = new MemoryCredentialStore();
  const store = new TokenStore(configPath, credentials);
  await store.saveToken({
    token: validToken(),
    expires: Math.floor(Date.now() / 1000) + 60,
    scopes: ['bookmarks:read', 'bookmarks:write'],
    user: { id: 7 }
  });
  const stats = await fs.stat(configPath);
  assert.equal(stats.mode & 0o077, 0);
  const savedConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(savedConfig.token, undefined);
  assert.equal(await store.requireToken(), validToken());
  await fs.writeFile(configPath, JSON.stringify({
    token: validToken(),
    expires: Math.floor(Date.now() / 1000) - 1,
    scopes: ['bookmarks:read', 'bookmarks:write'],
    user: { id: 7 }
  }));
  await assert.rejects(() => store.requireToken(), /CLI token expired/);
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.token, undefined);
  assert.equal(config.expires, undefined);
  assert.equal(config.scopes, undefined);
  assert.equal(config.user, undefined);
  assert.equal(credentials.token, null);
});

test('TokenStore requires token expiry metadata', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcull-cli-auth-'));
  const configPath = path.join(dir, 'config.json');
  const store = new TokenStore(configPath, new MemoryCredentialStore());
  await assert.rejects(() => store.saveToken({
    token: validToken(),
    scopes: ['bookmarks:read'],
    user: { id: 7 }
  }), /valid token expiry/);
  await fs.writeFile(configPath, JSON.stringify({
    token: validToken(),
    scopes: ['bookmarks:read']
  }));
  await assert.rejects(() => store.requireToken(), /CLI token expired/);
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.token, undefined);
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
    user: { id: 7 }
  }), /symbolic link/);
});

test('TokenStore migrates legacy config tokens into OS credentials', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcull-cli-auth-'));
  const configPath = path.join(dir, 'config.json');
  const credentials = new MemoryCredentialStore();
  await fs.writeFile(configPath, JSON.stringify({
    token: validToken(),
    expires: Math.floor(Date.now() / 1000) + 60,
    scopes: ['bookmarks:read']
  }));
  const store = new TokenStore(configPath, credentials);
  assert.equal(await store.requireToken(), validToken());
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(config.token, undefined);
  assert.equal(credentials.token, validToken());
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
