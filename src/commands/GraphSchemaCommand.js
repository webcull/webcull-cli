import { JsonOutput } from '../output/JsonOutput.js';

export class GraphSchemaCommand {
  constructor(apiClient) {
    this.name = 'graph schema';
    this.apiClient = apiClient;
    this.output = new JsonOutput();
  }

  async run(parsed) {
    const response = await this.apiClient.post('/cli/graph-schema', {}, { auth: true });
    this.output.print(response, parsed.options);
  }
}
