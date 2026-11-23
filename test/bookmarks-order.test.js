import test from 'node:test';
import assert from 'node:assert/strict';
import { BookmarksOrderCommand } from '../src/commands/BookmarksOrderCommand.js';
import { CommandParser } from '../src/query/CommandParser.js';
import { WebCullCli } from '../src/WebCullCli.js';
import { McpRuntime } from '../src/mcp/McpRuntime.js';

// Stop at the transport boundary rather than inventing successful API replies.
const boundary = new Error('Request captured before network access');
function capture() {
  const calls = [];
  return { calls, api: { async post(...args) { calls.push(args); throw boundary; } } };
}

test('ordering has identical CLI and MCP request semantics for every placement mode', async () => {
  const cases = [
    [{ id: 4618135, position: 'first' }, { id: 4618135, position: 'first' }],
    [{ id: 4618135, position: 'last' }, { id: 4618135, position: 'last' }],
    [{ id: 4618135, orderId: 2 }, { id: 4618135, order_id: 2 }],
    [{ id: 4618135, beforeId: 4618134 }, { id: 4618135, before_id: 4618134 }],
    [{ id: 4618135, afterId: 4618089 }, { id: 4618135, after_id: 4618089 }],
    [{ parentId: 0, ids: '4618135,4618134,4618089', expectedOrder: '4618134,4618135,4618089', dryRun: true },
      { parent_id: 0, ids: '4618135,4618134,4618089', expected_order: '4618134,4618135,4618089', dry_run: '1' }]
  ];
  for (const [options, expected] of cases) {
    const cliCapture = capture();
    const cli = new WebCullCli({ apiClient: cliCapture.api });
    const argv = ['bookmarks', 'order', '--account', 'userhash123'];
    for (const [key, value] of Object.entries(options)) {
      argv.push('--' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()));
      if (value !== true) argv.push(String(value));
    }
    await assert.rejects(() => cli.run(argv), error => error === boundary);
    const mcpCapture = capture();
    const runtime = new McpRuntime();
    const context = runtime.context.bind(runtime);
    runtime.context = (...args) => ({ ...context(...args), apiClient: mcpCapture.api });
    await assert.rejects(() => runtime.call('webcull_bookmarks_order', { account: 'userhash123', ...options }), error => error === boundary);
    assert.deepEqual(cliCapture.calls, mcpCapture.calls);
    assert.deepEqual(cliCapture.calls, [['/cli/bookmarks-order', { dry_run: '0', ...expected }, { auth: true }]]);
  }
});

test('ordering rejects ambiguous, oversized and unsafe input before transport', async () => {
  const recorder = capture();
  const command = new BookmarksOrderCommand(recorder.api);
  const parser = new CommandParser();
  const invalid = [
    [], ['--id', '4618135'], ['--id', '4618135', '--position', 'first', '--after-id', '4618134'],
    ['--id', '4618135', '--parent-id', '0', '--position', 'first'],
    ['--parent-id', '0', '--ids', '4618135,4618135'], ['--parent-id', '0', '--ids', ''],
    ['--id', '4618135', '--before-id', '4618135'], ['--id', '4618135', '--order-id', '0'],
    ['--id', '4618135', '--order-id', '501'], ['--id', '9007199254740992', '--position', 'last'],
    ['--id', '4618135', '--position', 'first', '--dry-run=false'],
    ['--id', '4618135', '--position', 'first', '--position', 'last'],
    ['--id', '4618135', '--position', 'first', '--expected-order', '4618135,4618135']
  ];
  for (const args of invalid) await assert.rejects(() => command.run(parser.parse(['bookmarks', 'order', ...args])), error => error !== boundary);
  assert.equal(recorder.calls.length, 0);
});

test('every ordering option is exposed by MCP, with only the documented CLI output-format difference', () => {
  const command = new BookmarksOrderCommand(null);
  const runtime = new McpRuntime();
  const tool = runtime.catalog.tools.find(tool => tool.command === command.name);
  assert.deepEqual(Object.keys(tool.inputSchema.properties).filter(key => key !== 'account').sort(),
    [...command.validation.allowedOptions].filter(key => key !== 'format').sort());
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.throws(() => runtime.catalog.validate(tool.name, { id: 4618135, position: 'first' }), /account/);
  assert.throws(() => runtime.catalog.validate(tool.name, { account: 'userhash123', id: 4618135, orderId: 501 }), /range/);
});
