import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandParser } from '../src/query/CommandParser.js';
import { BookmarksProxyCommand } from '../src/commands/BookmarksProxyCommand.js';
import { BookmarksCreateCommand } from '../src/commands/BookmarksCreateCommand.js';
import { resolveProxyFields, resolveCreateProxyFields } from '../src/commands/BookmarkProxyOptions.js';

async function silenceOutput(fn) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = originalLog;
  }
}

function apiRecorder(responses = []) {
  const calls = [];
  let index = 0;
  return {
    calls,
    api: {
      async post(path, payload, options) {
        calls.push({ path, payload, options });
        return responses[index++] || { success: 'true' };
      }
    }
  };
}

function e2eeSession({ enabled = false } = {}) {
  return {
    async enabled() {
      return enabled;
    },
    async loadMetadata() {
      return {
        e2ee_enabled: enabled ? 'true' : 'false',
        ete_index: enabled ? 2 : 0
      };
    },
    async encryptPatch(patch) {
      return {
        patch,
        isE2ee: enabled,
        metadata: {
          ete_index: enabled ? 2 : 0
        }
      };
    }
  };
}

test('proxy field resolver supports include and exclude selection', () => {
  assert.deepEqual(resolveProxyFields(undefined, undefined), ['title', 'icon', 'description']);
  assert.deepEqual(resolveProxyFields('icon,description', undefined), ['icon', 'description']);
  assert.deepEqual(resolveProxyFields(undefined, 'title'), ['icon', 'description']);
  assert.deepEqual(resolveProxyFields('all', 'description'), ['title', 'icon']);
  assert.deepEqual(resolveCreateProxyFields('icon,description', 'description'), ['icon']);
});

test('proxy field resolver rejects unsupported and empty selections', () => {
  assert.throws(() => resolveProxyFields('icon,bogus'), /Unknown proxy field/);
  assert.throws(() => resolveProxyFields('all,title'), /cannot combine all/);
  assert.throws(() => resolveProxyFields('title', 'title'), /cannot be empty/);
});

test('bookmarks proxy posts selected fields', async () => {
  const recorder = apiRecorder([{ success: 'true', updated: ['icon', 'description'] }]);
  const command = new BookmarksProxyCommand(recorder.api, e2eeSession());
  const parsed = new CommandParser().parse([
    'bookmarks',
    'proxy',
    '123',
    '--fields',
    'icon,description'
  ]);

  await silenceOutput(() => command.run(parsed));

  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0].path, '/cli/bookmarks-proxy');
  assert.deepEqual(recorder.calls[0].payload, {
    id: 123,
    fields: 'icon,description'
  });
  assert.deepEqual(recorder.calls[0].options, { auth: true });
});

test('bookmarks proxy rejects E2EE accounts before calling API', async () => {
  const recorder = apiRecorder();
  const command = new BookmarksProxyCommand(recorder.api, e2eeSession({ enabled: true }));
  const parsed = new CommandParser().parse(['bookmarks', 'proxy', '123']);

  await assert.rejects(() => command.run(parsed), /unavailable for E2EE/);
  assert.equal(recorder.calls.length, 0);
});

test('bookmark create chains proxy refresh and returns combined response', async () => {
  const recorder = apiRecorder([
    { success: 'true', action: 'create', id: 44, type: 'bookmark' },
    { success: 'true', action: 'proxy', id: 44, updated: ['icon'] }
  ]);
  const command = new BookmarksCreateCommand(recorder.api, e2eeSession());
  const parsed = new CommandParser().parse([
    'bookmarks',
    'create',
    '--url',
    'https://example.com',
    '--proxy-fields',
    'icon,description',
    '--proxy-exclude',
    'description'
  ]);

  await silenceOutput(() => command.run(parsed));

  assert.equal(recorder.calls.length, 2);
  assert.equal(recorder.calls[0].path, '/cli/bookmarks-create');
  assert.equal(recorder.calls[1].path, '/cli/bookmarks-proxy');
  assert.deepEqual(recorder.calls[1].payload, {
    id: 44,
    fields: 'icon'
  });
});

test('bookmark create dry-run does not call proxy endpoint', async () => {
  const recorder = apiRecorder([
    { success: 'true', dry_run: 'true', action: 'create' }
  ]);
  const command = new BookmarksCreateCommand(recorder.api, e2eeSession());
  const parsed = new CommandParser().parse([
    'bookmarks',
    'create',
    '--url',
    'https://example.com',
    '--proxy',
    '--dry-run'
  ]);

  await silenceOutput(() => command.run(parsed));

  assert.equal(recorder.calls.length, 1);
  assert.equal(recorder.calls[0].path, '/cli/bookmarks-create');
});

test('bookmark create rejects proxy for folders and E2EE accounts', async () => {
  const parser = new CommandParser();

  await assert.rejects(
    () => new BookmarksCreateCommand(apiRecorder().api, e2eeSession()).run(parser.parse([
      'bookmarks',
      'create',
      '--type',
      'folder',
      '--title',
      'Work',
      '--proxy'
    ])),
    /only for bookmark creation/
  );

  await assert.rejects(
    () => new BookmarksCreateCommand(apiRecorder().api, e2eeSession({ enabled: true })).run(parser.parse([
      'bookmarks',
      'create',
      '--url',
      'https://example.com',
      '--proxy'
    ])),
    /unavailable for E2EE/
  );
});
