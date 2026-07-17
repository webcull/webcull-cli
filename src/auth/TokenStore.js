import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { CredentialStore } from './CredentialStore.js';

export class TokenStore {
  constructor(configPath = process.env.WEBCULL_CONFIG, credentialStore = null) {
    this.configPath = configPath || path.join(os.homedir(), '.config', 'webcull', 'config.json');
    this.tokenPrefix = 'wco_cli_';
    this.injectedCredentialStore = typeof credentialStore === 'function' ? null : credentialStore;
    this.credentialStoreFactory = typeof credentialStore === 'function' ? credentialStore : null;
    this.requestedAccount = null;
    this.selectedCredentialAccount = null;
  }

  useAccount(selector) {
    if (selector === undefined || selector === null || selector === '') {
      this.requestedAccount = null;
      return;
    }
    const normalized = String(selector).trim();
    if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
      throw new Error('WebCull account must be a user hash or numeric user ID.');
    }
    this.requestedAccount = normalized;
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
    return await this.withConfigLock(async () => {
      await this.writeUnlocked(config);
    });
  }

  async saveToken(tokenRecord) {
    if (!this.isCliToken(tokenRecord.token)) {
      throw new Error('WebCull CLI login response did not include a valid CLI token.');
    }
    if (!this.hasFutureExpiry(tokenRecord.expires)) {
      throw new Error('WebCull CLI login response did not include a valid token expiry.');
    }
    this.validateScopes(tokenRecord.scopes || []);
    const user = tokenRecord.user;
    if (!user || !Number.isInteger(Number(user.id)) || !this.validUserHash(user.hash)) {
      throw new Error('WebCull CLI login response did not include a valid account ID and hash.');
    }

    await this.withConfigLock(async () => {
      const config = await this.registryUnlocked();
      const existing = this.findAccount(config.accounts, user.hash) || this.findAccount(config.accounts, user.id);
      if (existing && this.hasFutureExpiry(existing.expires)) {
        const existingToken = await this.credentialStoreFor(existing.credential_account).read();
        if (this.isCliToken(existingToken)) {
          const error = new Error('That WebCull account is already logged in. Run webcull accounts to see authorized accounts.');
          error.code = 'account_already_logged_in';
          throw error;
        }
      }

      const credentialAccount = this.credentialAccount(user.hash);
      const credentialStore = this.credentialStoreFor(credentialAccount);
      await credentialStore.save(tokenRecord.token);
      const now = Date.now();
      const account = {
        expires: Number(tokenRecord.expires),
        scopes: tokenRecord.scopes || [],
        user,
        last_accessed: now,
        credential_account: credentialAccount
      };
      const previousAccounts = config.accounts;
      config.accounts = previousAccounts.filter(item => item !== existing);
      config.accounts.push(account);
      config.active_account = user.hash;
      try {
        await this.writeUnlocked(config);
      } catch (error) {
        await credentialStore.delete();
        throw error;
      }
      if (existing && existing.credential_account !== credentialAccount) {
        await this.credentialStoreFor(existing.credential_account).delete();
      }
      this.requestedAccount = user.hash;
      this.selectedCredentialAccount = credentialAccount;
    });
  }

  async requireToken() {
    const config = await this.registry({ verifyCredentials: false });
    const account = this.resolveAccount(config.accounts, config.active_account, this.requestedAccount);
    if (!account) {
      if (this.requestedAccount) {
        throw new Error('No logged-in WebCull account matches --account ' + this.requestedAccount + '. Run webcull accounts.');
      }
      throw new Error('Run webcull login first.');
    }
    if (!this.hasFutureExpiry(account.expires)) {
      await this.purgeAccount(account.credential_account);
      throw new Error('CLI token expired for the selected account. Run webcull login again.');
    }
    const token = await this.credentialStoreFor(account.credential_account).read();
    if (!this.isCliToken(token)) {
      await this.purgeAccount(account.credential_account);
      throw new Error('Stored WebCull CLI token is invalid. Run webcull login again.');
    }
    this.requestedAccount = this.accountSelector(account);
    this.selectedCredentialAccount = account.credential_account;
    await this.markAccessed(account.credential_account);
    return token;
  }

  async hasValidToken() {
    return (await this.listAccounts()).length > 0;
  }

  async listAccounts() {
    const config = await this.registry({ verifyCredentials: true });
    const active = this.resolveAccount(config.accounts, config.active_account, null);
    const sorted = [...config.accounts].sort((left, right) => {
      if (left === active) return -1;
      if (right === active) return 1;
      return Number(right.last_accessed || 0) - Number(left.last_accessed || 0);
    });
    return sorted.map((account, index) => ({
      number: index + 1,
      active: account === active,
      user: account.user,
      scopes: account.scopes,
      expires: Number(account.expires),
      last_accessed: Number(account.last_accessed || 0)
    }));
  }

  async accountSelection() {
    const accounts = await this.listAccounts();
    if (accounts.length === 0) {
      throw new Error('Run webcull login first.');
    }
    if (this.requestedAccount) {
      const selected = this.findPublicAccount(accounts, this.requestedAccount);
      if (!selected) {
        throw new Error('No logged-in WebCull account matches --account ' + this.requestedAccount + '. Run webcull accounts.');
      }
      this.useAccount(this.publicAccountSelector(selected));
      return { selected, accounts };
    }
    if (accounts.length === 1) {
      this.useAccount(this.publicAccountSelector(accounts[0]));
      return { selected: accounts[0], accounts };
    }
    return { selected: null, accounts };
  }

  async selectPublicAccount(account) {
    this.useAccount(this.publicAccountSelector(account));
  }

  async updateSelectedAccount(response) {
    if (!response?.user) {
      return;
    }
    await this.withConfigLock(async () => {
      const config = await this.registryUnlocked();
      const account = this.selectedCredentialAccount
        ? config.accounts.find(item => item.credential_account === this.selectedCredentialAccount)
        : this.resolveAccount(config.accounts, config.active_account, this.requestedAccount);
      if (!account) {
        return;
      }
      account.user = response.user;
      if (response.scopes) {
        this.validateScopes(response.scopes);
        account.scopes = response.scopes;
      }
      if (this.hasFutureExpiry(response.expires)) {
        account.expires = Number(response.expires);
      }
      config.active_account = this.accountSelector(account);
      await this.writeUnlocked(config);
      this.requestedAccount = this.accountSelector(account);
    });
  }

  async purgeToken() {
    const config = await this.registry({ verifyCredentials: false });
    const account = this.selectedCredentialAccount
      ? config.accounts.find(item => item.credential_account === this.selectedCredentialAccount)
      : this.resolveAccount(config.accounts, config.active_account, this.requestedAccount);
    if (!account) {
      if (this.requestedAccount) {
        throw new Error('No logged-in WebCull account matches --account ' + this.requestedAccount + '. Run webcull accounts.');
      }
      return;
    }
    await this.purgeAccount(account.credential_account);
  }

  async purgeAccount(credentialAccount) {
    await this.withConfigLock(async () => {
      const config = await this.registryUnlocked();
      const account = config.accounts.find(item => item.credential_account === credentialAccount);
      if (!account) {
        return;
      }
      await this.credentialStoreFor(account.credential_account).delete();
      config.accounts = config.accounts.filter(item => item !== account);
      const nextActive = this.mostRecentAccount(config.accounts);
      if (nextActive) {
        config.active_account = this.accountSelector(nextActive);
      } else {
        delete config.active_account;
      }
      await this.writeUnlocked(config);
      this.selectedCredentialAccount = null;
      this.requestedAccount = null;
    });
  }

  async markAccessed(credentialAccount) {
    await this.withConfigLock(async () => {
      const config = await this.registryUnlocked();
      const account = config.accounts.find(item => item.credential_account === credentialAccount);
      if (!account) {
        return;
      }
      account.last_accessed = Date.now();
      config.active_account = this.accountSelector(account);
      await this.writeUnlocked(config);
    });
  }

  async registry({ verifyCredentials = false } = {}) {
    return await this.withConfigLock(async () => {
      const config = await this.registryUnlocked();
      let changed = false;
      if (verifyCredentials) {
        const valid = [];
        for (const account of config.accounts) {
          const token = this.hasFutureExpiry(account.expires)
            ? await this.credentialStoreFor(account.credential_account).read()
            : null;
          if (this.isCliToken(token)) {
            valid.push(account);
          } else {
            await this.credentialStoreFor(account.credential_account).delete();
            changed = true;
          }
        }
        config.accounts = valid;
      }
      const active = this.findAccount(config.accounts, config.active_account);
      if (!active) {
        const nextActive = this.mostRecentAccount(config.accounts);
        if (nextActive) {
          config.active_account = this.accountSelector(nextActive);
        } else {
          delete config.active_account;
        }
        changed = true;
      }
      if (changed) {
        await this.writeUnlocked(config);
      }
      return config;
    });
  }

  async registryUnlocked() {
    const config = await this.read();
    if (!Array.isArray(config.accounts)) {
      config.accounts = [];
    }
    const hasLegacyAuthorization = config.token !== undefined || config.expires !== undefined || config.user !== undefined;
    if (hasLegacyAuthorization) {
      const legacyCredentialAccount = this.credentialAccount();
      if (config.token !== undefined) {
        if (!this.isCliToken(config.token)) {
          throw new Error('WebCull CLI config contains an invalid token. Run webcull login again.');
        }
        await this.credentialStoreFor(legacyCredentialAccount).save(config.token);
      }
      if (config.expires !== undefined || config.token !== undefined) {
        this.validateScopes(config.scopes || []);
        config.accounts.push({
          expires: Number(config.expires || 0),
          scopes: config.scopes || [],
          user: config.user || {},
          last_accessed: Date.now(),
          credential_account: legacyCredentialAccount
        });
        config.active_account = this.accountSelector(config.accounts[config.accounts.length - 1]);
      }
      delete config.token;
      delete config.expires;
      delete config.scopes;
      delete config.user;
      await this.writeUnlocked(config);
    }
    return config;
  }

  resolveAccount(accounts, activeSelector, requestedSelector) {
    if (requestedSelector) {
      return this.findAccount(accounts, requestedSelector);
    }
    return this.findAccount(accounts, activeSelector) || this.mostRecentAccount(accounts) || null;
  }

  findAccount(accounts, selector) {
    if (selector === undefined || selector === null || selector === '') {
      return null;
    }
    const normalized = String(selector);
    return accounts.find(account =>
      String(account.user?.hash || '') === normalized ||
      String(account.user?.id || '') === normalized ||
      String(account.credential_account) === normalized
    ) || null;
  }

  findPublicAccount(accounts, selector) {
    const normalized = String(selector);
    return accounts.find(account =>
      String(account.user?.hash || '') === normalized || String(account.user?.id || '') === normalized
    ) || null;
  }

  mostRecentAccount(accounts) {
    return [...accounts].sort((left, right) => Number(right.last_accessed || 0) - Number(left.last_accessed || 0))[0] || null;
  }

  accountSelector(account) {
    return account.user?.hash || String(account.user?.id || account.credential_account);
  }

  publicAccountSelector(account) {
    return account.user?.hash || String(account.user?.id || '');
  }

  credentialStoreFor(credentialAccount) {
    if (this.credentialStoreFactory) {
      return this.credentialStoreFactory(credentialAccount);
    }
    if (this.injectedCredentialStore) {
      return this.injectedCredentialStore;
    }
    return new CredentialStore({ account: credentialAccount });
  }

  credentialAccount(userHash = null) {
    const source = userHash ? this.configPath + '\0' + userHash : this.configPath;
    return crypto.createHash('sha256').update(source).digest('hex').slice(0, 32);
  }

  async writeUnlocked(config) {
    this.validateConfig(config);
    await this.ensureSafeConfigDir();
    await this.ensureSafeConfigTarget();
    const tempPath = this.configPath + '.tmp-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
    try {
      await fs.writeFile(tempPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await fs.rename(tempPath, this.configPath);
      await fs.chmod(this.configPath, 0o600);
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          error.cleanupError = cleanupError;
        }
      }
      throw error;
    }
  }

  async withConfigLock(callback) {
    await this.ensureSafeConfigDir();
    const lockPath = this.configPath + '.lock';
    const deadline = Date.now() + 5000;
    let handle;
    while (!handle) {
      try {
        handle = await fs.open(lockPath, 'wx', 0o600);
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error;
        }
        await this.clearStaleLock(lockPath);
        if (Date.now() >= deadline) {
          throw new Error('WebCull CLI account storage is busy. Try again.');
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    try {
      return await callback();
    } finally {
      await handle.close();
      await fs.unlink(lockPath).catch(error => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      });
    }
  }

  async clearStaleLock(lockPath) {
    try {
      const stats = await fs.lstat(lockPath);
      if (stats.isSymbolicLink()) {
        throw new Error('WebCull CLI config lock path must not be a symbolic link.');
      }
      if (Date.now() - stats.mtimeMs > 30000) {
        await fs.unlink(lockPath);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
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
    this.rejectSecretConfigKeys(config);
    if (config.token !== undefined && !this.isCliToken(config.token)) {
      throw new Error('WebCull CLI config contains an invalid token. Run webcull login again.');
    }
    if (config.scopes !== undefined) {
      this.validateScopes(config.scopes);
    }
    if (config.accounts !== undefined) {
      if (!Array.isArray(config.accounts)) {
        throw new Error('WebCull CLI config accounts must be an array.');
      }
      for (const account of config.accounts) {
        if (!account || typeof account !== 'object' || Array.isArray(account)) {
          throw new Error('WebCull CLI config contains an invalid account record.');
        }
        this.validateScopes(account.scopes || []);
        if (!/^[a-f0-9]{32}$/.test(String(account.credential_account || ''))) {
          throw new Error('WebCull CLI config contains an invalid credential account.');
        }
        if (!account.user || typeof account.user !== 'object' || Array.isArray(account.user)) {
          throw new Error('WebCull CLI config contains invalid account metadata.');
        }
      }
    }
    return config;
  }

  rejectSecretConfigKeys(value) {
    if (!value || typeof value !== 'object') {
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (/(e2ee|ete).*(password|passphrase|key|secret)/i.test(key)) {
        throw new Error('WebCull CLI config must not store E2EE passphrases or keys.');
      }
      this.rejectSecretConfigKeys(item);
    }
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

  validUserHash(hash) {
    return typeof hash === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(hash);
  }
}
