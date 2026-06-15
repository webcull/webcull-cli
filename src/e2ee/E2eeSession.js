import { E2eeCrypto } from './E2eeCrypto.js';
import { HiddenPrompt } from './HiddenPrompt.js';

const EDITABLE_ENCRYPTED_FIELDS = ['title', 'url', 'notes', 'tags', 'note'];

export class E2eeSession {
  constructor(apiClient, prompt = new HiddenPrompt(), crypto = new E2eeCrypto()) {
    this.apiClient = apiClient;
    this.prompt = prompt;
    this.crypto = crypto;
    this.metadata = null;
    this.currentKey = null;
  }

  async loadMetadata() {
    if (!this.metadata) {
      const response = await this.apiClient.post('/cli/metadata', {}, { auth: true });
      if (response.success !== 'true') {
        throw new Error(response.failure || 'Could not load CLI metadata.');
      }
      this.metadata = response.e2ee || {};
    }
    return this.metadata;
  }

  async enabled() {
    const metadata = await this.loadMetadata();
    return metadata.e2ee_enabled === 'true' || metadata.e2ee_enabled === true;
  }

  conversionInProgress(metadata) {
    return metadata.conversion_in_progress === 'true' || metadata.conversion_in_progress === true;
  }

  assertMetadata(metadata) {
    if (
      !metadata
      || !metadata.key_check
      || !metadata.user_hash
      || metadata.ete_index === undefined
      || !Array.isArray(metadata.encrypted_fields)
      || metadata.conversion_in_progress === undefined
    ) {
      throw new Error('E2EE metadata missing.');
    }
  }

  async unlockCurrentForWrite(fields) {
    const metadata = await this.loadMetadata();
    if (!(await this.enabled())) {
      return null;
    }
    this.assertMetadata(metadata);
    if (this.conversionInProgress(metadata)) {
      throw new Error('E2EE conversion in progress.');
    }
    if (!fields.some(field => EDITABLE_ENCRYPTED_FIELDS.includes(field))) {
      return null;
    }
    if (this.currentKey) {
      return this.currentKey;
    }
    let passphrase = await this.prompt.ask('E2EE passphrase: ');
    try {
      this.currentKey = await this.crypto.validatePassphrase(passphrase, metadata);
      return this.currentKey;
    } catch (error) {
      throw new Error('Incorrect E2EE key.');
    } finally {
      passphrase = '';
    }
  }

  async unlockCurrentForRead(fields) {
    const metadata = await this.loadMetadata();
    if (!(await this.enabled())) {
      return null;
    }
    this.assertMetadata(metadata);
    if (!fields.some(field => this.crypto.isEncryptedField(field))) {
      return null;
    }
    if (this.currentKey) {
      return this.currentKey;
    }
    let passphrase = await this.prompt.ask('E2EE passphrase: ');
    try {
      this.currentKey = await this.crypto.validatePassphrase(passphrase, metadata);
      return this.currentKey;
    } catch (error) {
      throw new Error('Incorrect E2EE key.');
    } finally {
      passphrase = '';
    }
  }

  async encryptPatch(patch) {
    const fields = Object.keys(patch);
    const key = await this.unlockCurrentForWrite(fields);
    if (!key) {
      return { patch, isE2ee: false, metadata: await this.loadMetadata() };
    }
    const encrypted = { ...patch };
    for (const field of fields) {
      if (EDITABLE_ENCRYPTED_FIELDS.includes(field)) {
        encrypted[field] = await this.crypto.encryptText(key, patch[field]);
      }
    }
    return { patch: encrypted, isE2ee: true, metadata: await this.loadMetadata() };
  }

  async decryptItems(response, fields) {
    if (!(await this.enabled())) {
      return response;
    }
    const key = await this.unlockCurrentForRead(fields);
    if (!key || !Array.isArray(response.items)) {
      return response;
    }
    const metadata = await this.loadMetadata();
    const currentIndex = Number(metadata.ete_index || 0);
    const output = { ...response, items: [] };
    for (const item of response.items) {
      const copy = { ...item };
      try {
        for (const field of fields) {
          if (copy[field] !== undefined && this.crypto.isEncryptedField(field)) {
            const rowIndex = this.fieldEteIndex(copy, field);
            if (rowIndex === 0) {
              continue;
            }
            if (rowIndex !== currentIndex) {
              copy.decrypted = false;
              copy.e2ee_error = 'old_key_row';
              break;
            }
            copy[field] = await this.crypto.decryptText(key, copy[field]);
          }
        }
        if (!copy.e2ee_error) {
          copy.decrypted = true;
        }
      } catch (error) {
        copy.decrypted = false;
        copy.e2ee_error = 'could_not_decrypt';
      }
      output.items.push(copy);
    }
    return output;
  }

  fieldEteIndex(item, field) {
    if (field === 'note' && item.note_ete_index !== undefined) {
      return Number(item.note_ete_index || 0);
    }
    return Number(item.ete_index || 0);
  }
}
