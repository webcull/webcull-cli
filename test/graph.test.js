import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandParser } from '../src/query/CommandParser.js';
import { GraphAroundCommand } from '../src/commands/GraphAroundCommand.js';
import { GraphBacklinksCommand } from '../src/commands/GraphBacklinksCommand.js';
import { GraphPathCommand } from '../src/commands/GraphPathCommand.js';
import { GraphValidateCommand } from '../src/commands/GraphValidateCommand.js';
import { GraphSchemaCommand } from '../src/commands/GraphSchemaCommand.js';

async function silenceOutput(fn) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = originalLog;
  }
}

function apiRecorder(response = { success: 'true' }) {
  const calls = [];
  return {
    calls,
    api: {
      async post(path, payload, options) {
        calls.push({ path, payload, options });
        return response;
      }
    }
  };
}

test('parser treats graph commands as two-word command paths', () => {
  const parser = new CommandParser();
  const parsed = parser.parse(['graph', 'around', '--stack-id', '123']);
  assert.equal(parsed.commandPath, 'graph around');
  assert.equal(parsed.options.stackId, '123');
});

test('graph around sends bounded read payload', async () => {
  const { api, calls } = apiRecorder();
  const parser = new CommandParser();
  const command = new GraphAroundCommand(api);
  await silenceOutput(() => command.run(parser.parse(['graph', 'around', '--stack-id', '123', '--depth', '2', '--limit', '25'])));
  assert.equal(calls[0].path, '/cli/graph-around');
  assert.equal(calls[0].payload.stack_id, '123');
  assert.equal(calls[0].payload.depth, '2');
  assert.equal(calls[0].payload.limit, '25');
  assert.deepEqual(calls[0].options, { auth: true });
});

test('graph commands require stack identifiers', async () => {
  const parser = new CommandParser();
  await assert.rejects(
    () => new GraphAroundCommand(apiRecorder().api).run(parser.parse(['graph', 'around'])),
    /--stack-id/
  );
  await assert.rejects(
    () => new GraphBacklinksCommand(apiRecorder().api).run(parser.parse(['graph', 'backlinks'])),
    /--stack-id/
  );
  await assert.rejects(
    () => new GraphValidateCommand(apiRecorder().api).run(parser.parse(['graph', 'validate'])),
    /--stack-id/
  );
});

test('graph path and schema call their CLI endpoints', async () => {
  const parser = new CommandParser();
  const pathRecorder = apiRecorder();
  await silenceOutput(() => new GraphPathCommand(pathRecorder.api).run(parser.parse([
    'graph',
    'path',
    '--from-stack-id',
    '123',
    '--to-stack-id',
    '456',
    '--max-depth',
    '4'
  ])));
  assert.equal(pathRecorder.calls[0].path, '/cli/graph-path');
  assert.equal(pathRecorder.calls[0].payload.from_stack_id, '123');
  assert.equal(pathRecorder.calls[0].payload.to_stack_id, '456');
  assert.equal(pathRecorder.calls[0].payload.max_depth, '4');

  const schemaRecorder = apiRecorder();
  await silenceOutput(() => new GraphSchemaCommand(schemaRecorder.api).run(parser.parse(['graph', 'schema'])));
  assert.equal(schemaRecorder.calls[0].path, '/cli/graph-schema');
  assert.deepEqual(schemaRecorder.calls[0].payload, {});
});
