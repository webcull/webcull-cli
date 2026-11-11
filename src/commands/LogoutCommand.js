export class LogoutCommand {
  constructor(apiClient, tokenStore, logger = console) {
    this.name = 'logout';
    this.apiClient = apiClient;
    this.tokenStore = tokenStore;
    this.logger = logger;
  }

  async run(parsed = { options: {} }) {
    await this.tokenStore.accountSelection();
    const localOnly = parsed.options?.localOnly && parsed.options.localOnly !== 'false';
    if (localOnly) {
      await this.tokenStore.purgeToken();
      this.logger.log('Local WebCull CLI authorization removed. The server token may remain valid.');
      return;
    }
    const response = await this.apiClient.post('/cli/auth-logout', {}, { auth: true });
    if (response.success !== 'true') {
      throw this.apiClient.structuredError(response, 'Could not revoke WebCull CLI authorization.');
    }
    await this.tokenStore.purgeToken();
    this.logger.log('WebCull CLI logout complete. Server authorization revoked and local credentials removed.');
  }
}
