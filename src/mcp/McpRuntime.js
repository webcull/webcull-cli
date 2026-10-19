import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CredentialStore } from '../auth/CredentialStore.js';
import { WebCullCli } from '../WebCullCli.js';
import { TokenStore } from '../auth/TokenStore.js';
import { CliAuthFlow } from '../auth/CliAuthFlow.js';
import { ApiClient } from '../http/ApiClient.js';
import { E2eeSession } from '../e2ee/E2eeSession.js';
import { KeystorePassphraseInput } from './KeystorePassphraseInput.js';
import { ToolCatalog } from './ToolCatalog.js';

export class McpRuntime {
  constructor({ configPath = process.env.WEBCULL_MCP_CONFIG, apiUrl = process.env.WEBCULL_API_URL || 'https://api.webcull.com' } = {}) {
    this.configPath = configPath || path.join(os.homedir(), '.config', 'webcull', 'mcp.json');
    this.apiUrl = apiUrl;
    this.catalog = new ToolCatalog();
    this.pendingLogins = new Map();
    this.nextReadAt = 0;
  }

  context(account, signal) {
    const tokenStore = new TokenStore(this.configPath, entry => new CredentialStore({ service: 'webcull-mcp', account: entry, signal }), { client: 'mcp' });
    if (account !== undefined) tokenStore.useAccount(account);
    const apiClient = new ApiClient({ apiUrl: this.apiUrl, tokenStore, client: 'mcp', signal });
    const e2eeSession = account ? new E2eeSession(apiClient, new KeystorePassphraseInput(account, null, signal)) : null;
    return { tokenStore, apiClient, e2eeSession };
  }

  async call(name, args = {}, signal) {
    const tool = this.catalog.validate(name, args);
    const context = this.context(args.account, signal);
    // A fresh command context per request prevents account or derived-key reuse.
    try {
      if (tool.command === 'login') return await this.login(args, context);
      if (tool.command === 'setup') return await this.setup(args, context);
      if (Date.now() < this.nextReadAt) {
        return { success: 'false', code: 'request_busy', retry_after_ms: this.nextReadAt - Date.now(), failure: 'Wait for the indicated delay before requesting more data.' };
      }
      let result;
      const output = { print: value => { result = value; } };
      const logger = { log: message => { result = { success: 'true', message: String(message).replaceAll('WebCull CLI', 'WebCull MCP') }; } };
      const cli = new WebCullCli({ ...context, output, logger });
      cli.rejectForbiddenE2eeInputs([]);
      const options = { ...args };
      delete options.account;
      const positionals = [];
      if (['bookmarks update', 'bookmarks proxy', 'reminders cancel'].includes(tool.command)) {
        positionals.push(String(options.id));
        delete options.id;
      }
      if (options.decrypt !== undefined) options.decrypt = String(options.decrypt);
      if (options.proxy === false) delete options.proxy;
      await cli.execute({ command: tool.command.split(' ')[0], commandPath: tool.command, options, positionals, optionCounts: {} });
      if (tool.command === 'accounts' && result?.login_required) result.next_command = 'webcull mcp login';
      if (['bookmarks tree', 'bookmarks search'].includes(tool.command) || args.page !== undefined) this.nextReadAt = Date.now() + 2000;
      if (!result) throw new Error('WebCull did not return a command result.');
      return result;
    } finally {
      if (context.e2eeSession) {
        context.e2eeSession.currentKey = null;
        context.e2eeSession.metadata = null;
      }
    }
  }

  async login(args, { apiClient, tokenStore }) {
    const now = Date.now();
    for (const [id, entry] of this.pendingLogins) {
      if (entry.expires <= now) this.pendingLogins.delete(id);
    }
    const flow = new CliAuthFlow(apiClient, tokenStore);
    if (args.action === 'start') {
      if (this.pendingLogins.size >= 3) throw new Error('Finish an existing MCP login or wait for it to expire.');
      const entry = await flow.begin();
      this.pendingLogins.set(entry.request, { ...entry, expires: now + 300000, nextPoll: now + 2000 });
      return { success: 'true', pending: true, request: entry.request, approval_url: entry.approvalUrl, expires_in_seconds: 300,
        message: 'Open this URL yourself and approve the account you intend to connect. Then call login with action complete and this request. A WebCull subscription is required; free iOS accounts do not qualify.' };
    }
    const entry = this.pendingLogins.get(args.request);
    if (!entry) throw new Error('MCP login request expired or belongs to another process. Start login again.');
    if (now < entry.nextPoll) return { pending: true, retry_after_ms: entry.nextPoll - now };
    entry.nextPoll = now + 2000;
    try {
      const response = await flow.complete(entry.request, entry.verifier, 'WebCull MCP');
      if (response.pending === 'true') return { pending: true, retry_after_ms: 2000 };
      this.pendingLogins.delete(args.request);
      if (response.success !== 'true') throw apiClient.structuredError(response, 'MCP authorization failed.');
      return { success: 'true', user: response.user, scopes: response.scopes, expires: response.expires };
    } catch (error) {
      this.pendingLogins.delete(args.request);
      throw error;
    }
  }

  async setup(args, context) {
    const result = {
      success: 'true', transport: 'stdio', subscription_required: true,
      instructions: 'Install Node.js 18 or newer and @webcull/cli. Run webcull mcp login, then configure your local AI application to launch webcull with arguments ["mcp"]. CLI and MCP authorizations are independent.',
      keystore: { darwin: 'macOS Keychain', win32: 'Windows Credential Manager', linux: 'Secret Service (secret-tool and an unlocked desktop keyring)' }[process.platform] || 'Unsupported platform',
      e2ee: { service: 'webcull-mcp-e2ee', account: args.account || 'Use the account hash returned by webcull_accounts', required: 'Store the passphrase in this OS keystore entry yourself. Never put it in chat, command arguments, environment variables, or configuration files.' },
      configuration: this.configuration(args.client),
      documentation: 'https://webcull.com/documentation/webcull-mcp'
    };
    if (args.checkE2ee) {
      if (!args.account) throw new Error('Select an explicit account hash before checking E2EE.');
      const metadata = await context.e2eeSession.loadMetadata();
      if (await context.e2eeSession.enabled()) {
        await context.e2eeSession.unlockCurrentForRead(['title']);
        result.e2ee.status = 'verified';
      } else result.e2ee.status = 'not_enabled';
      result.e2ee.conversion_in_progress = context.e2eeSession.conversionInProgress(metadata);
    }
    return result;
  }

  configuration(client = 'claude') {
    const server = {
      command: process.execPath,
      args: [fileURLToPath(new URL('../cli.js', import.meta.url)), 'mcp'],
      env: {
        WEBCULL_MCP_CONFIG: this.configPath,
        WEBCULL_API_URL: this.apiUrl,
        ...(process.env.WEBCULL_APP_URL ? { WEBCULL_APP_URL: process.env.WEBCULL_APP_URL } : {})
      }
    };
    return client === 'vscode' ? { servers: { webcull: { type: 'stdio', ...server } } } : { mcpServers: { webcull: server } };
  }

  close() {
    this.pendingLogins.clear();
  }
}
