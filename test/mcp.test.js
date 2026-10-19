import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebCullCli } from '../src/WebCullCli.js';
import { McpRuntime } from '../src/mcp/McpRuntime.js';
import { StdioServer } from '../src/mcp/StdioServer.js';
import { CredentialStore } from '../src/auth/CredentialStore.js';

// Protocol tests run the actual local server and setup tool without API accounts,
// network calls, keystore writes, or invented backend responses.
function harness() {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages = [];
  output.on('data', chunk => messages.push(...String(chunk).trim().split('\n').map(line => JSON.parse(line))));
  const runtime = new McpRuntime();
  const server = new StdioServer(runtime, { input, output }).start();
  const send = (id, method, params) => input.write(JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params }) + '\n');
  const initialize = () => {
    send(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'webcull-test', version: '1' } });
    send(undefined, 'notifications/initialized');
  };
  return { input, output, messages, runtime, server, send, initialize };
}

test('MCP exposes every registered CLI operation and requires explicit accounts', () => {
  const cli = new WebCullCli();
  const runtime = new McpRuntime();
  assert.deepEqual(runtime.catalog.tools.filter(tool => tool.command !== 'setup').map(tool => tool.command).sort(), [...cli.commands.keys()].sort());
  for (const tool of runtime.catalog.tools) {
    if (['accounts', 'login', 'setup'].includes(tool.command)) continue;
    assert.ok(tool.inputSchema.required.includes('account'));
  }
  assert.throws(() => runtime.catalog.validate('webcull_setup', { passphrase: 'not-a-secret' }), /Secrets belong/);
  assert.throws(() => runtime.catalog.validate('webcull_bookmarks_get', { account: 'userhash123', ids: '1', maxChars: -1 }), /range/);
  assert.throws(() => runtime.catalog.validate('webcull_bookmarks_get', { account: 'userhash123', ids: '1', decrypt: 'false' }), /type/);
  for (const account of ['', ' ', 'bad/hash']) {
    assert.throws(() => runtime.catalog.validate('webcull_whoami', { account }), /format/);
  }
});

test('CLI consumes global account and encryption flags before write validation', async () => {
  const cli = new WebCullCli();
  await assert.rejects(() => cli.run([
    'bookmarks', 'create', '--account', 'userhash123', '--e2ee-passphrase-stdin',
    '--url', 'https://webcull.com', '--parent-id', '1', '--parent-path', '/Research'
  ]), /Use either --parent-id or --parent-path/);
  assert.equal(cli.tokenStore.requestedAccount, 'userhash123');
  assert.equal(cli.e2eeSession.passphraseStdin, true);
  await assert.rejects(() => new WebCullCli().run([
    'reminders', 'create', '--account', 'userhash123', '--in', '30m'
  ]), /Bookmark id must be a positive integer/);
  await assert.rejects(() => new WebCullCli().run([
    'bookmarks', 'create', '--account', 'userhash123', '--typo'
  ]), /Unknown option.*typo/);
});

test('MCP command contexts never share account selection, metadata or keys', () => {
  const runtime = new McpRuntime();
  const a = runtime.context('userhash123');
  const b = runtime.context('userhash456');
  assert.notEqual(a.tokenStore, b.tokenStore);
  assert.notEqual(a.e2eeSession, b.e2eeSession);
  assert.equal(a.tokenStore.requestedAccount, 'userhash123');
  assert.equal(b.tokenStore.requestedAccount, 'userhash456');
  assert.equal(a.tokenStore.credentialStoreFor('entry').service, 'webcull-mcp');
  assert.equal(new WebCullCli().tokenStore.credentialStoreFor('entry').service, 'webcull-cli');
  assert.throws(() => a.tokenStore.validateConfig({ token: 'wco_cli_' + 'a'.repeat(48) }), /keystore/);
});

test('MCP negotiates, lists tools, invokes real setup and rejects secret arguments', async () => {
  const h = harness();
  try {
    h.send(0, 'tools/list');
    assert.equal(h.messages[0].error.code, -32600);
    h.initialize();
    h.send(2, 'tools/list');
    assert.equal(h.messages.find(m => m.id === 2).result.tools.length, 21);
    h.send(3, 'tools/call', { name: 'webcull_setup', arguments: {} });
    await h.server.queue;
    const result = h.messages.find(m => m.id === 3).result;
    assert.equal(result.structuredContent.transport, 'stdio');
    assert.equal(result.structuredContent.subscription_required, true);
    const configuration = result.structuredContent.configuration.mcpServers.webcull;
    assert.equal(configuration.command, process.execPath);
    assert.equal(configuration.args.at(-1), 'mcp');
    assert.equal(configuration.env.WEBCULL_MCP_CONFIG, h.runtime.configPath);
    assert.equal(configuration.env.WEBCULL_API_URL, h.runtime.apiUrl);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    h.send(4, 'tools/call', { name: 'webcull_setup', arguments: { password: 'do-not-echo' } });
    assert.equal(h.messages.find(m => m.id === 4).error.code, -32602);
    assert.ok(!JSON.stringify(h.messages).includes('do-not-echo'));
    h.send(5, 'tools/call', { name: 'webcull_bookmarks_create', arguments: { url: 'https://webcull.com' } });
    assert.match(h.messages.find(m => m.id === 5).error.message, /account/);
  } finally { h.server.close(); }
});

test('MCP frames UTF-8 across chunks, rejects malformed frames and bounds input', () => {
  const h = harness();
  try {
    h.initialize();
    const frame = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'é', method: 'ping' }) + '\n');
    const split = frame.indexOf(Buffer.from('é')) + 1;
    h.input.write(frame.subarray(0, split));
    h.input.write(frame.subarray(split));
    assert.deepEqual(h.messages.find(m => m.id === 'é').result, {});
    h.input.write('not-json\n');
    assert.equal(h.messages.at(-1).error.code, -32700);
    h.send('x'.repeat(1025), 'ping');
    assert.equal(h.messages.at(-1).error.code, -32600);
    h.input.write('x'.repeat(1024 * 1024 + 1));
    assert.equal(h.server.closed, true);
  } finally { h.server.close(); }
});

test('MCP queued cancellation stops execution and drops pending login state on close', async () => {
  const h = harness();
  try {
    h.initialize();
    h.send(2, 'tools/call', { name: 'webcull_setup', arguments: {} });
    h.send(undefined, 'notifications/cancelled', { requestId: 2 });
    await h.server.queue;
    assert.ok(!h.messages.some(m => m.id === 2));
    assert.equal(h.server.active.size, 0);
  } finally { h.server.close(); }
  assert.equal(h.runtime.pendingLogins.size, 0);
});

test('keystore access errors cannot be mistaken for a missing Linux credential', () => {
  const store = new CredentialStore({ platform: 'linux' });
  assert.equal(store.isNotFound({ code: 1, stderr: 'Cannot autolaunch D-Bus' }), false);
});

test('packaged CLI entry launches a real stdio MCP process with clean stdout', { timeout: 5000 }, async () => {
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  const child = spawn(process.execPath, ['src/cli.js', 'mcp'], { cwd: new URL('..', import.meta.url), env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) + '\n');
    const [chunk] = await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('MCP exited before initialization: ' + stderr); })]);
    const response = JSON.parse(String(chunk));
    assert.equal(response.result.serverInfo.name, 'webcull');
    const closed = once(child, 'exit');
    child.stdin.end();
    const [code] = await closed;
    assert.equal(code, 0);
    assert.equal(stderr, '');
  } finally { child.kill(); }
});
