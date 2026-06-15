import { JsonOutput } from '../output/JsonOutput.js';
import { OutputBudget } from '../output/OutputBudget.js';

export class GraphBacklinksCommand {
  constructor(apiClient) {
    this.name = 'graph backlinks';
    this.apiClient = apiClient;
    this.output = new JsonOutput();
  }

  async run(parsed) {
    const stackId = parsed.options.stackId || parsed.positionals[0];
    if (!stackId) {
      throw new Error('Graph backlinks requires --stack-id.');
    }
    const budget = OutputBudget.defaults(parsed.options, {
      limit: 100,
      maxChars: 12000,
      maxMetadataChars: 500,
      fields: 'id,parent_id,type,title,url,ete_index,modified'
    });
    const response = await this.apiClient.post('/cli/graph-backlinks', {
      ...budget,
      stack_id: stackId
    }, { auth: true });
    this.output.print(response, parsed.options);
  }
}
