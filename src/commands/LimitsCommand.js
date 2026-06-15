import { JsonOutput } from '../output/JsonOutput.js';

export class LimitsCommand {
  constructor(apiClient) {
    this.name = 'limits';
    this.output = new JsonOutput();
    this.apiClient = apiClient;
  }

  async run(parsed) {
    const response = await this.apiClient.post('/cli/limits', {}, { auth: true });
    this.output.print(response, parsed.options);
  }
}
