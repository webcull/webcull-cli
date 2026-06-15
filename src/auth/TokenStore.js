import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { CredentialStore } from './CredentialStore.js';

export class TokenStore {
  constructor(configPath = process.env.WEBCULL_CONFIG, credentialStore = null) {
    this.configPath = configPath || path.join(os.homedir(), '.config', 'webcull', 'config.json');
    this.tokenPrefix = 'wco_cli_';
    this.credentialStore = credentialStore || new CredentialStore({
      account: this.credentialAccount()
    });
  }

  async read() {
    try {
      await this.ensureSafeConfigFile();
      const config = JSON.parse(await fs.readFile(this.configPath, 'utf8'));
      return this.validateConfig(config);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  async write(config) {
    await this.ensureSafeConfigDir();
    await this.ensureSafeConfigTarget();
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    await fs.chmod(this.configPath, 0o600);
  }

  async saveToken(tokenRecord) {
    if (!this.isCliToken(tokenRecord.token)) {
      throw new Error('WebCull CLI login response did not include a valid CLI token.');
    }
    if (!this.hasFutureExpiry(tokenRecord.expires)) {
      throw new Error('WebCull CLI login response did not include a valid token expiry.');
    }
    this.validateScopes(tokenRecord.scopes || []);
    const config = await this.read();
    await this.ensureSafeConfigDir();
    await this.ensureSafeConfigTarget();
    await this.credentialStore.save(tokenRecord.token);
    delete config.token;
    config.expires = tokenRecord.expires;
    config.scopes = tokenRecord.scopes || [];
    config.user = tokenRecord.user || null;
    await this.write(config);
  }

  async requireToken() {
    const config = await this.read();
    if (!config.token && !config.expires) {
      throw new Error('Run webcull login first.');
    }
    if (!this.hasFutureExpiry(config.expires)) {
      await this.purgeToken(config);
      throw new Error('CLI token expired. Run webcull login again.');
    }
    if (config.token) {
      const token = config.token;
      await this.credentialStore.save(token);
      delete config.token;
      await this.write(config);
      return token;
    }
    const token = await this.credentialStore.read();
    if (!token) {
      await this.purgeToken(config);
      throw new Error('Run webcull login first.');
    }
    if (!this.isCliToken(token)) {
      await this.purgeToken(config);
      throw new Error('Stored WebCull CLI token is invalid. Run webcull login again.');
    }
    return token;
  }

  async purgeToken(config = null) {
    const nextConfig = config || await this.read();
    await this.credentialStore.delete();
    delete nextConfig.token;
    delete nextConfig.expires;
    delete nextConfig.scopes;
    delete nextConfig.user;
    await this.write(nextConfig);
  }

  async ensureSafeConfigFile() {
    const linkStats = await fs.lstat(this.configPath);
    if (linkStats.isSymbolicLink()) {
      throw new Error('WebCull CLI config path must not be a symbolic link.');
    }
    const stats = await fs.stat(this.configPath);
    if (!stats.isFile()) {
      throw new Error('WebCull CLI config path must be a regular file.');
    }
    if ((stats.mode & 0o077) !== 0) {
      await fs.chmod(this.configPath, 0o600);
    }
  }

  async ensureSafeConfigTarget() {
    try {
      const stats = await fs.lstat(this.configPath);
      if (stats.isSymbolicLink()) {
        throw new Error('WebCull CLI config path must not be a symbolic link.');
      }
      if (!stats.isFile()) {
        throw new Error('WebCull CLI config path must be a regular file.');
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }

  async ensureSafeConfigDir() {
    const dir = path.dirname(this.configPath);
    try {
      const stats = await fs.lstat(dir);
      if (stats.isSymbolicLink()) {
        throw new Error('WebCull CLI config directory must not be a symbolic link.');
      }
      if (!stats.isDirectory()) {
        throw new Error('WebCull CLI config directory must be a directory.');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    }
    await fs.chmod(dir, 0o700);
  }

  validateConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('WebCull CLI config must be a JSON object.');
    }
    for (const key of Object.keys(config)) {
      if (/(e2ee|ete).*(password|passphrase|key|secret)/i.test(key)) {
        throw new Error('WebCull CLI config must not store E2EE passphrases or keys.');
      }
    }
    if (config.token !== undefined && !this.isCliToken(config.token)) {
      throw new Error('WebCull CLI config contains an invalid token. Run webcull login again.');
    }
    if (config.scopes !== undefined) {
      this.validateScopes(config.scopes);
    }
    return config;
  }

  validateScopes(scopes) {
    if (!Array.isArray(scopes)) {
      throw new Error('WebCull CLI config scopes must be an array.');
    }
    const allowed = new Set(['bookmarks:read', 'bookmarks:write']);
    for (const scope of scopes) {
      if (!allowed.has(scope)) {
        throw new Error('WebCull CLI config contains an unsupported token scope.');
      }
    }
  }

  isCliToken(token) {
    return typeof token === 'string' &&
      token.startsWith(this.tokenPrefix) &&
      token.length >= 40 &&
      token.length <= 256 &&
      /^[A-Za-z0-9_-]+$/.test(token.slice(this.tokenPrefix.length));
  }

  hasFutureExpiry(expires) {
    return Number.isInteger(Number(expires)) && Number(expires) > Math.floor(Date.now() / 1000);
  }

  credentialAccount() {
    return crypto.createHash('sha256').update(this.configPath).digest('hex').slice(0, 32);
  }
}
