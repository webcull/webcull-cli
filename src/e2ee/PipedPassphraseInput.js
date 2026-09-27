import { stdin as defaultInput } from 'node:process';

const MAX_PASSPHRASE_BYTES = 65536;

export class PipedPassphraseInput {
  constructor({ input = defaultInput } = {}) {
    this.input = input;
  }

  async read({ enabled = false } = {}) {
    if (!enabled) {
      throw new Error('E2EE key required. Pipe it from a user-managed keystore and add --e2ee-passphrase-stdin.');
    }
    if (this.input.isTTY) {
      throw new Error('--e2ee-passphrase-stdin requires piped stdin from a user-managed keystore.');
    }
    let value = '';
    for await (const chunk of this.input) {
      value += String(chunk);
      if (Buffer.byteLength(value, 'utf8') > MAX_PASSPHRASE_BYTES) {
        throw new Error('Piped E2EE passphrase exceeds the maximum supported size.');
      }
    }
    value = value.replace(/\r?\n$/, '');
    if (!value) {
      throw new Error('User-managed keystore returned an empty E2EE passphrase.');
    }
    if (/[\r\n\0]/.test(value)) {
      throw new Error('Piped E2EE passphrase must contain exactly one value.');
    }
    return value;
  }
}
