import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Readable } from 'node:stream';
import { WebCullCli } from '../src/WebCullCli.js';
import { E2eeSession } from '../src/e2ee/E2eeSession.js';
import { PipedPassphraseInput } from '../src/e2ee/PipedPassphraseInput.js';

function pipedInput(chunks) {
  const input = Readable.from(chunks);
  input.isTTY = false;
  return input;
}

test('PipedPassphraseInput reads one passphrase without trimming spaces', async () => {
  const passphraseInput = new PipedPassphraseInput({
    input: pipedInput(['  passphrase with spaces  \n'])
  });
  assert.equal(
    await passphraseInput.read({ enabled: true }),
    '  passphrase with spaces  '
  );
});

test('PipedPassphraseInput requires explicit mode and rejects terminal, empty, and multiple values', async () => {
  await assert.rejects(
    () => new PipedPassphraseInput({ input: pipedInput(['secret\n']) }).read(),
    /add --e2ee-passphrase-stdin/
  );
  const terminalInput = new PassThrough();
  terminalInput.isTTY = true;
  await assert.rejects(
    () => new PipedPassphraseInput({ input: terminalInput }).read({ enabled: true }),
    /requires piped stdin/
  );
  await assert.rejects(
    () => new PipedPassphraseInput({ input: pipedInput(['\n']) }).read({ enabled: true }),
    /returned an empty/
  );
  await assert.rejects(
    () => new PipedPassphraseInput({ input: pipedInput(['first\nsecond\n']) }).read({ enabled: true }),
    /exactly one value/
  );
  await assert.rejects(
    () => new PipedPassphraseInput({ input: pipedInput(['secret\0value']) }).read({ enabled: true }),
    /exactly one value/
  );
  await assert.rejects(
    () => new PipedPassphraseInput({ input: pipedInput(['x'.repeat(65537)]) }).read({ enabled: true }),
    /exceeds the maximum supported size/
  );
});

test('E2eeSession passes explicit stdin mode to the passphrase input', async () => {
  let inputOptions;
  const session = new E2eeSession({
    async post() {
      return {
        success: 'true',
        e2ee: {
          e2ee_enabled: 'true',
          key_check: 'key-check',
          user_hash: 'account-hash',
          ete_index: 1,
          encrypted_fields: ['title'],
          conversion_in_progress: 'false'
        }
      };
    }
  }, {
    async read(options) {
      inputOptions = options;
      return 'keystore passphrase';
    }
  }, {
    isEncryptedField(field) {
      return field === 'title';
    },
    async validatePassphrase() {
      return { type: 'derived-key' };
    }
  });
  session.setPassphraseStdin(true);
  await session.unlockCurrentForRead(['title']);
  assert.deepEqual(inputOptions, { enabled: true });
});

test('WebCullCli accepts only a valueless stdin flag with an explicit account', () => {
  const cli = new WebCullCli();
  let enabled = false;
  cli.e2eeSession = {
    setPassphraseStdin(value) {
      enabled = value;
    }
  };
  cli.configureE2eePassphraseInput(cli.parser.parse([
    'bookmarks',
    'get',
    '--account',
    'account-hash',
    '--e2ee-passphrase-stdin'
  ]));
  assert.equal(enabled, true);
  assert.throws(
    () => cli.configureE2eePassphraseInput(cli.parser.parse([
      'bookmarks',
      'get',
      '--account',
      'account-hash',
      '--e2ee-passphrase-stdin=secret'
    ])),
    /must not contain a passphrase value/
  );
  assert.throws(
    () => cli.configureE2eePassphraseInput(cli.parser.parse([
      'bookmarks',
      'get',
      '--e2ee-passphrase-stdin'
    ])),
    /requires --account/
  );
});
