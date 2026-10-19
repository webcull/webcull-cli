import { CredentialStore } from '../auth/CredentialStore.js';

export class KeystorePassphraseInput {
  constructor(account, credentialStore = null, signal) {
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(account || '')) throw new Error('An explicit account hash is required for E2EE.');
    this.account = account;
    this.store = credentialStore || new CredentialStore({ service: 'webcull-mcp-e2ee', account, signal });
  }

  async read() {
    const value = await this.store.read({ preserveWhitespace: true });
    if (!value) throw new Error('E2EE keystore entry unavailable. Create or unlock the webcull-mcp-e2ee entry for this account; see https://webcull.com/documentation/webcull-mcp. No file or chat-secret fallback is supported.');
    if (Buffer.byteLength(value, 'utf8') > 65536 || /[\r\n\0]/.test(value)) throw new Error('The E2EE keystore entry must contain one passphrase value.');
    return value;
  }
}
