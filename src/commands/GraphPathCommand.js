import { JsonOutput } from '../output/JsonOutput.js';
import { OutputBudget } from '../output/OutputBudget.js';

export class GraphPathCommand {
  constructor(apiClient) {
    this.name = 'graph path';
    this.apiClient = apiClient;
    this.output = new JsonOutput();
  }

  async run(parsed) {
    const fromStackId = parsed.options.fromStackId || parsed.positionals[0];
    const toStackId = parsed.options.toStackId || parsed.positionals[1];
    if (!fromStackId || !toStackId) {
      throw new Error('Graph path requires --from-stack-id and --to-stack-id.');
    }
    const budget = OutputBudget.defaults(parsed.options, {
      limit: 200,
      maxChars: 16000,
      maxMetadataChars: 500,
      fields: 'id,parent_id,type,title,url,ete_index,modified'
    });
    const response = await this.apiClient.post('/cli/graph-path', {
      ...budget,
      from_stack_id: fromStackId,
      to_stack_id: toStackId,
      max_depth: parsed.options.maxDepth || parsed.options.depth || 4
    }, { auth: true });
    this.output.print(response, parsed.options);
  }
}
