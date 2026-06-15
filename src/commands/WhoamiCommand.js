import { JsonOutput } from '../output/JsonOutput.js';

export class WhoamiCommand {
  constructor(apiClient) {
    this.name = 'whoami';
    this.output = new JsonOutput();
    this.apiClient = apiClient;
  }

  async run(parsed) {
    const response = await this.apiClient.post('/cli/whoami', {}, { auth: true });
    this.output.print(response, parsed.options);
  }
}
