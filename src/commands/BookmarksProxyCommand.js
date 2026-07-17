import { JsonOutput } from '../output/JsonOutput.js';
import { WriteCommandValidation } from './WriteCommandValidation.js';
import { resolveProxyFields } from './BookmarkProxyOptions.js';

export class BookmarksProxyCommand {
  constructor(apiClient, e2eeSession) {
    this.name = 'bookmarks proxy';
    this.apiClient = apiClient;
    this.e2eeSession = e2eeSession;
    this.output = new JsonOutput();
    this.validation = new WriteCommandValidation([
      'fields',
      'exclude',
      'format'
    ]);
  }

  async run(parsed) {
    this.validation.validateCommon(parsed);
    const id = this.validation.positiveInteger(parsed.positionals[0], 'Bookmark id');
    const metadata = await this.e2eeSession.loadMetadata();

    if (metadata.e2ee_enabled === 'true' || metadata.e2ee_enabled === true) {
      throw new Error('Proxy refresh is unavailable for E2EE accounts.');
    }

    const fields = resolveProxyFields(parsed.options.fields, parsed.options.exclude);
    const response = await this.apiClient.post('/cli/bookmarks-proxy', {
      id,
      fields: fields.join(',')
    }, { auth: true });

    this.output.print(response, parsed.options);
  }
}
