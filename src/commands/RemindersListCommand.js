import { JsonOutput } from '../output/JsonOutput.js';

export class RemindersListCommand {
  constructor(apiClient, e2eeSession) {
    this.name = 'reminders list';
    this.apiClient = apiClient;
    this.e2eeSession = e2eeSession;
    this.output = new JsonOutput();
    this.allowedOptions = new Set(['bookmarkId', 'limit', 'page', 'fields', 'format']);
  }

  async run(parsed) {
    this.validate(parsed);
    const fields = parsed.options.fields || 'id,bookmark_id,remind_at,status,note_status,created';
    const response = await this.apiClient.post('/cli/reminders-list', {
      bookmark_id: parsed.options.bookmarkId,
      limit: parsed.options.limit,
      page: parsed.options.page,
      fields
    }, { auth: true });
    const arrFields = String(fields).split(',').map(field => field.trim()).filter(Boolean);
    const hasEncryptedNote = Array.isArray(response.items) && response.items.some(item => item.note && Number(item.note_ete_index || 0) > 0);
    const output = arrFields.includes('note') && hasEncryptedNote
      ? await this.e2eeSession.decryptItems(response, arrFields)
      : response;
    this.output.print(output, parsed.options);
  }

  validate(parsed) {
    for (const key of Object.keys(parsed.options)) {
      if (!this.allowedOptions.has(key)) {
        throw new Error('Unknown option for reminders list: --' + this.dashKey(key));
      }
    }
    if (parsed.options.format && !['json', 'jsonl'].includes(parsed.options.format)) {
      throw new Error('--format must be json or jsonl.');
    }
    if (parsed.options.bookmarkId !== undefined && (!/^[0-9]+$/.test(String(parsed.options.bookmarkId)) || Number(parsed.options.bookmarkId) <= 0)) {
      throw new Error('Bookmark id must be a positive integer.');
    }
    for (const key of ['limit', 'page']) {
      if (parsed.options[key] !== undefined && (!/^[0-9]+$/.test(String(parsed.options[key])) || Number(parsed.options[key]) <= 0)) {
        throw new Error('--' + key + ' must be a positive integer.');
      }
    }
  }

  dashKey(key) {
    return key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
  }
}
