import { JsonOutput } from '../output/JsonOutput.js';
import { OutputBudget } from '../output/OutputBudget.js';

export class GraphAroundCommand {
  constructor(apiClient) {
    this.name = 'graph around';
    this.apiClient = apiClient;
    this.output = new JsonOutput();
  }

  async run(parsed) {
    const stackId = parsed.options.stackId || parsed.positionals[0];
    if (!stackId) {
      throw new Error('Graph around requires --stack-id.');
    }
    const budget = OutputBudget.defaults(parsed.options, {
      limit: 100,
      maxChars: 20000,
      maxMetadataChars: 500,
      fields: 'id,parent_id,type,title,url,ete_index,modified'
    });
    const response = await this.apiClient.post('/cli/graph-around', {
      ...budget,
      stack_id: stackId,
      depth: parsed.options.depth || 1,
      direction: parsed.options.direction || 'both',
      expand_linked_stacks: parsed.options.expandLinkedStacks ? '1' : '0',
      linked_depth: parsed.options.linkedDepth || 0
    }, { auth: true });
    this.output.print(response, parsed.options);
  }
}
