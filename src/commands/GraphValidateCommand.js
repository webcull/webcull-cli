import { JsonOutput } from '../output/JsonOutput.js';
import { OutputBudget } from '../output/OutputBudget.js';

export class GraphValidateCommand {
  constructor(apiClient) {
    this.name = 'graph validate';
    this.apiClient = apiClient;
    this.output = new JsonOutput();
  }

  async run(parsed) {
    const stackId = parsed.options.stackId || parsed.positionals[0];
    if (!stackId) {
      throw new Error('Graph validate requires --stack-id.');
    }
    const budget = OutputBudget.defaults(parsed.options, {
      limit: 300,
      maxChars: 16000,
      maxMetadataChars: 500,
      fields: 'id,parent_id,type,title,url,ete_index,modified'
    });
    const response = await this.apiClient.post('/cli/graph-validate', {
      ...budget,
      stack_id: stackId,
      depth: parsed.options.depth || 3
    }, { auth: true });
    this.output.print(response, parsed.options);
  }
}
