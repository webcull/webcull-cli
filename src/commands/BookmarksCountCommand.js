import { JsonOutput } from '../output/JsonOutput.js';

export class BookmarksCountCommand {
  constructor(apiClient) {
    this.name = 'bookmarks count';
    this.apiClient = apiClient;
    this.output = new JsonOutput();
  }

  async run(parsed) {
    const response = await this.apiClient.post('/cli/bookmarks-count', {
      path: parsed.options.path || parsed.positionals[0] || '/'
    }, { auth: true });
    this.output.print(response, parsed.options);
  }
}
