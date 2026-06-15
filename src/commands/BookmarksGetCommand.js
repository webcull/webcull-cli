import { JsonOutput } from '../output/JsonOutput.js';
import { OutputBudget } from '../output/OutputBudget.js';

export class BookmarksGetCommand {
  constructor(apiClient, e2eeSession) {
    this.name = 'bookmarks get';
    this.apiClient = apiClient;
    this.e2eeSession = e2eeSession;
    this.output = new JsonOutput();
  }

  async run(parsed) {
    const ids = parsed.options.ids || parsed.options.id || parsed.positionals.join(',');
    if (!ids) {
      throw new Error('Bookmark id required.');
    }
    const budget = OutputBudget.defaults(parsed.options, {
      maxChars: 12000,
      maxMetadataChars: 2000,
      fields: 'id,parent_id,order_id,type,title,url,notes,tags,icon,ete_index,created,modified'
    });
    let response = await this.apiClient.post('/cli/bookmarks-get', {
      ...budget,
      ids
    }, { auth: true });
    if (this.e2eeSession && parsed.options.decrypt !== 'false') {
      const fields = String(budget.fields || '')
        .split(',')
        .map(field => field.trim())
        .filter(Boolean);
      response = await this.e2eeSession.decryptItems(response, fields);
    }
    this.output.print(response, parsed.options);
  }
}
