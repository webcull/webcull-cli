import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export class CliAuthFlow {
  constructor(apiClient, tokenStore) {
    this.apiClient = apiClient;
    this.tokenStore = tokenStore;
    this.appUrl = (process.env.WEBCULL_APP_URL || 'https://app.webcull.com').replace(/\/+$/, '');
  }

  async run(options) {
    const request = this.randomBase64Url(32);
    const verifier = this.randomBase64Url(48);
    const challenge = this.hashBase64Url(verifier);
    const start = await this.apiClient.post('/cli/auth-start', { request, challenge });
    if (start.success !== 'true') {
      throw new Error(start.failure || start.error || 'Could not start CLI login.');
    }
    const code = this.pairingCode(request);
    const approvalUrl = this.appUrl + '/accounts#cli-auth/' + encodeURIComponent(request);
    console.log('Your pairing code is: ' + code);
    console.log('Only approve if the browser shows this exact code.');
    console.log('Approve in your browser: ' + approvalUrl);
    if (options.browser !== 'false') {
      await this.openBrowser(approvalUrl);
    }
    if (options.wait !== 'false') {
      await this.waitForEnter();
    }
    await this.poll(request, verifier, options.name || 'WebCull CLI');
  }

  randomBase64Url(bytes) {
    return crypto.randomBytes(bytes).toString('base64url');
  }

  hashBase64Url(value) {
    return crypto.createHash('sha256').update(value).digest('base64url');
  }

  pairingCode(request) {
    return request.slice(0, 4).toUpperCase() + '-' + request.slice(-4).toUpperCase();
  }

  async waitForEnter() {
    const rl = readline.createInterface({ input, output });
    await rl.question('Press Enter after approving the login in your browser.');
    rl.close();
  }

  async openBrowser(url) {
    const platform = process.platform;
    const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.unref();
  }

  async poll(request, verifier, name) {
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      const response = await this.apiClient.post('/cli/auth-redeem', { request, verifier, name });
      if (response.success === 'true') {
        await this.tokenStore.saveToken(response);
        console.log('WebCull CLI login complete.');
        return;
      }
      if (response.pending !== 'true') {
        throw new Error(response.failure || response.error || 'CLI login was not approved.');
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error('CLI login request expired.');
  }
}
