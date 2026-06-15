import test from 'node:test';
import assert from 'node:assert/strict';
import { E2eeCrypto } from '../src/e2ee/E2eeCrypto.js';
import { BookmarksCreateCommand } from '../src/commands/BookmarksCreateCommand.js';
import { BookmarksUpdateCommand } from '../src/commands/BookmarksUpdateCommand.js';
import { BookmarksSearchCommand } from '../src/commands/BookmarksSearchCommand.js';
import { RemindersCreateCommand } from '../src/commands/RemindersCreateCommand.js';
import { RemindersListCommand } from '../src/commands/RemindersListCommand.js';
import { RemindersCancelCommand } from '../src/commands/RemindersCancelCommand.js';
import { CommandParser } from '../src/query/CommandParser.js';

async function silenceOutput(fn) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = originalLog;
  }
}

test('E2eeCrypto validates and decrypts app-compatible text payloads', async () => {
  const crypto = new E2eeCrypto();
  const passphrase = 'correct horse battery staple';
  const userHash = 'userhash123';
  const salt = Uint8Array.from(Array.from({ length: 16 }, (value, index) => index));
  const saltHex = Array.from(salt).map(value => value.toString(16).padStart(2, '0')).join('');
  const key = await crypto.deriveKey(passphrase, salt);
  const passwordHash = await crypto.hashPassword(passphrase, userHash);
  const keyCheck = saltHex + await crypto.encryptText(key, passwordHash);
  const validatedKey = await crypto.validatePassphrase(passphrase, {
    key_check: keyCheck,
    user_hash: userHash
  });
  const encrypted = await crypto.encryptText(validatedKey, 'secret title');
  assert.equal(await crypto.decryptText(validatedKey, encrypted), 'secret title');
  await assert.rejects(
    () => crypto.validatePassphrase('wrong passphrase', { key_check: keyCheck, user_hash: userHash }),
    /Incorrect E2EE key/
  );
});

test('create command rejects ambiguous parent selectors and sends dry-run payload', async () => {
  const calls = [];
  const command = new BookmarksCreateCommand({
    async post(path, payload) {
      calls.push({ path, payload });
      return { success: 'true', dry_run: 'true', action: 'create', type: 'bookmark', parent_id: 0 };
    }
  }, {
    async enabled() {
      return false;
    },
    async encryptPatch(patch) {
      return { patch, isE2ee: false, metadata: { ete_index: 0 } };
    }
  });
  const parser = new CommandParser();
  await assert.rejects(
    () => command.run(parser.parse(['bookmarks', 'create', '--url', 'https://example.com', '--parent-id', '1', '--parent-path', '/A'])),
    /Use either --parent-id/
  );
  await silenceOutput(() => command.run(parser.parse(['bookmarks', 'create', '--url', 'https://example.com', '--dry-run'])));
  assert.equal(calls[0].path, '/cli/bookmarks-create');
  assert.equal(calls[0].payload.url, 'https://example.com');
  assert.equal(calls[0].payload.dry_run, '1');
});

test('update command rejects empty patches and sends expected row metadata', async () => {
  const calls = [];
  const command = new BookmarksUpdateCommand({
    async post(path, payload) {
      calls.push({ path, payload });
      if (path === '/cli/bookmarks-get') {
        return { success: 'true', items: [{ id: 9, parent_id: 0, type: 'bookmark', ete_index: 0 }] };
      }
      return { success: 'true', action: 'update', id: 9, type: 'bookmark', parent_id: 0 };
    }
  }, {
    async loadMetadata() {
      return { e2ee_enabled: 'false', ete_index: 0 };
    },
    async encryptPatch(patch) {
      return { patch, isE2ee: false, metadata: { ete_index: 0 } };
    }
  });
  const parser = new CommandParser();
  await assert.rejects(
    () => command.run(parser.parse(['bookmarks', 'update', '9'])),
    /Update requires/
  );
  await silenceOutput(() => command.run(parser.parse(['bookmarks', 'update', '9', '--title', 'Updated'])));
  const writeCall = calls.find(call => call.path === '/cli/bookmarks-update');
  assert.equal(writeCall.payload.id, 9);
  assert.equal(writeCall.payload.expected_type, 'bookmark');
  assert.deepEqual(JSON.parse(writeCall.payload.patch), { title: 'Updated' });
});

test('encrypted account search uses local decrypted search without an explicit flag', async () => {
  const calls = [];
  const command = new BookmarksSearchCommand({
    async post(path, payload) {
      calls.push({ path, payload });
      return {
        success: 'true',
        items: [
          { id: 1, type: 'bookmark', title: 'GitHub API', url: 'https://github.com', notes: '', tags: '', ete_index: 0 }
        ]
      };
    }
  }, {
    async enabled() {
      return true;
    },
    async decryptItems(response) {
      return {
        ...response,
        items: response.items.map(item => ({ ...item, decrypted: true }))
      };
    }
  });
  const parser = new CommandParser();
  await silenceOutput(() => command.run(parser.parse(['bookmarks', 'search', '--query', 'github api', '--limit', '5'])));
  assert.equal(calls[0].path, '/cli/bookmarks-scan');
  assert.equal(calls[0].payload.limit, 100);
});

test('reminder create encrypts notes before sending payload', async () => {
  const calls = [];
  const command = new RemindersCreateCommand({
    async post(path, payload) {
      calls.push({ path, payload });
      return { success: 'true', action: 'create', id: 12, bookmark_id: 9, note_status: 'stored' };
    }
  }, {
    async encryptPatch(patch) {
      assert.deepEqual(patch, { note: 'private reminder note' });
      return { patch: { note: 'encrypted-note-payload' }, isE2ee: true, metadata: { ete_index: 4 } };
    },
    async loadMetadata() {
      return { ete_index: 4 };
    }
  });
  const parser = new CommandParser();
  await silenceOutput(() => command.run(parser.parse(['reminders', 'create', '--bookmark-id', '9', '--in', '3h', '--note', 'private reminder note'])));
  assert.equal(calls[0].path, '/cli/reminders-create');
  assert.equal(calls[0].payload.stack_id, 9);
  assert.equal(calls[0].payload.note, 'encrypted-note-payload');
  assert.equal(calls[0].payload.note_ete_index, 4);
  assert.equal(calls[0].payload.is_ete, 'true');
});

test('reminder list decrypts note only when requested', async () => {
  const calls = [];
  const command = new RemindersListCommand({
    async post(path, payload) {
      calls.push({ path, payload });
      return {
        success: 'true',
        items: [{ id: 12, bookmark_id: 9, note: 'encrypted-note-payload', note_ete_index: 4 }]
      };
    }
  }, {
    async decryptItems(response, fields) {
      assert.deepEqual(fields, ['id', 'bookmark_id', 'note', 'note_ete_index']);
      return { ...response, items: [{ ...response.items[0], note: 'private reminder note', decrypted: true }] };
    }
  });
  const parser = new CommandParser();
  await silenceOutput(() => command.run(parser.parse(['reminders', 'list', '--fields', 'id,bookmark_id,note,note_ete_index'])));
  assert.equal(calls[0].path, '/cli/reminders-list');
});

test('reminder cancel sends id and dry-run payload', async () => {
  const calls = [];
  const command = new RemindersCancelCommand({
    async post(path, payload) {
      calls.push({ path, payload });
      return { success: 'true', action: 'cancel', id: 12, bookmark_id: 9 };
    }
  });
  const parser = new CommandParser();
  await silenceOutput(() => command.run(parser.parse(['reminders', 'cancel', '12', '--dry-run'])));
  assert.equal(calls[0].path, '/cli/reminders-cancel');
  assert.equal(calls[0].payload.id, 12);
  assert.equal(calls[0].payload.dry_run, '1');
});
