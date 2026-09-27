import { CliAuthFlow } from '../auth/CliAuthFlow.js';

export class LoginCommand {
  constructor(apiClient, tokenStore) {
    this.name = 'login';
    this.flow = new CliAuthFlow(apiClient, tokenStore);
  }

  async run(parsed) {
    await this.flow.run(parsed.options);
  }
}
