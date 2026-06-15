import crypto from 'node:crypto';

const IV_LENGTH = 12;
const ITERATIONS = 1000000;
const ENCRYPTED_TEXT_FIELDS = new Set([
  'description',
  'email',
  'keywords',
  'links',
  'note',
  'nickname',
  'notes',
  'phone',
  'tags',
  'title',
  'url',
  'value',
  'wordcloud'
]);

export class E2eeCrypto {
  encryptedTextFields() {
    return ENCRYPTED_TEXT_FIELDS;
  }

  isEncryptedField(field) {
    return ENCRYPTED_TEXT_FIELDS.has(field);
  }

  parseCheckString(checkString) {
    if (!checkString || typeof checkString !== 'string' || checkString.length <= 32) {
      throw new Error('E2EE metadata missing.');
    }
    return {
      salt: this.hexToBytes(checkString.slice(0, 32)),
      hashPayload: checkString.slice(32)
    };
  }

  async deriveKey(passphrase, salt) {
    const keyMaterial = await crypto.webcrypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    return crypto.webcrypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: ITERATIONS,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async validatePassphrase(passphrase, metadata) {
    const parsed = this.parseCheckString(metadata.key_check);
    const key = await this.deriveKey(passphrase, parsed.salt);
    const expected = await this.hashPassword(passphrase, metadata.user_hash);
    let actual = '';
    try {
      actual = await this.decryptText(key, parsed.hashPayload);
    } catch (error) {
      throw new Error('Incorrect E2EE key.');
    }
    if (actual !== expected) {
      throw new Error('Incorrect E2EE key.');
    }
    return key;
  }

  async hashPassword(passphrase, userHash) {
    if (!userHash || typeof userHash !== 'string') {
      throw new Error('E2EE metadata missing.');
    }
    const digest = await crypto.webcrypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(passphrase + userHash)
    );
    return Array.from(new Uint8Array(digest))
      .map(value => value.toString(16).padStart(2, '0'))
      .join('');
  }

  async encryptText(key, value) {
    if (value === '') {
      return '';
    }
    const iv = crypto.webcrypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const data = new TextEncoder().encode('T:' + String(value));
    const encrypted = await crypto.webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.byteLength);
    return Buffer.from(combined).toString('base64');
  }

  async decryptText(key, payload) {
    if (payload === '') {
      return '';
    }
    const combined = Buffer.from(String(payload), 'base64');
    if (combined.byteLength <= IV_LENGTH) {
      throw new Error('Could not decrypt row.');
    }
    const iv = combined.subarray(0, IV_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH);
    const decrypted = await crypto.webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
    const text = new TextDecoder().decode(decrypted);
    if (text.startsWith('T:')) {
      return text.slice(2);
    }
    if (text.startsWith('B:')) {
      throw new Error('Could not decrypt row.');
    }
    throw new Error('Could not decrypt row.');
  }

  hexToBytes(hex) {
    if (!/^[0-9a-f]{32}$/i.test(hex)) {
      throw new Error('E2EE metadata missing.');
    }
    return Uint8Array.from(hex.match(/.{2}/g).map(part => parseInt(part, 16)));
  }
}
