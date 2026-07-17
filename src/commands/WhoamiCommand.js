import { JsonOutput } from '../output/JsonOutput.js';

export class WhoamiCommand {
  constructor(apiClient, tokenStore) {
    this.name = 'whoami';
    this.output = new JsonOutput();
    this.apiClient = apiClient;
    this.tokenStore = tokenStore;
  }

  async run(parsed) {
    const response = await this.apiClient.post('/cli/whoami', {}, { auth: true });
    await this.tokenStore.updateSelectedAccount(response);
    this.output.print(response, parsed.options);
  }
}
