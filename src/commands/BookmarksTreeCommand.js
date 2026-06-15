import { JsonOutput } from '../output/JsonOutput.js';
import { OutputBudget } from '../output/OutputBudget.js';

export class BookmarksTreeCommand {
  constructor(apiClient) {
    this.name = 'bookmarks tree';
    this.apiClient = apiClient;
    this.output = new JsonOutput();
  }

  async run(parsed) {
    const budget = OutputBudget.defaults(parsed.options, {
      limit: 50,
      maxChars: 12000,
      maxMetadataChars: 500
    });
    const response = await this.apiClient.post('/cli/bookmarks-tree', {
      ...budget,
      path: parsed.options.path || parsed.positionals[0] || '/',
      max_depth: parsed.options.maxDepth || 2,
      per_parent_limit: parsed.options.perParentLimit || 50
    }, { auth: true });
    this.output.print(response, parsed.options);
  }
}
