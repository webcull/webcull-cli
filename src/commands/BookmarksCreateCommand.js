import { JsonOutput } from '../output/JsonOutput.js';
import { WriteCommandValidation } from './WriteCommandValidation.js';

export class BookmarksCreateCommand {
  constructor(apiClient, e2eeSession) {
    this.name = 'bookmarks create';
    this.apiClient = apiClient;
    this.e2eeSession = e2eeSession;
    this.output = new JsonOutput();
    this.validation = new WriteCommandValidation([
      'url',
      'title',
      'notes',
      'tags',
      'parentId',
      'parentPath',
      'type',
      'dryRun',
      'format'
    ]);
  }

  async run(parsed) {
    this.validation.validateCommon(parsed);
    const type = parsed.options.type || (parsed.options.url ? 'bookmark' : '');
    if (!['bookmark', 'folder'].includes(type)) {
      throw new Error('Create requires --url or --type folder.');
    }
    if (type === 'folder' && parsed.options.url !== undefined) {
      throw new Error('Folder create does not accept --url.');
    }
    if (type === 'bookmark' && !String(parsed.options.url || '').trim()) {
      throw new Error('Bookmark create requires --url.');
    }
    if (type === 'folder' && !String(parsed.options.title || '').trim()) {
      throw new Error('Folder create requires --title.');
    }
    const tags = this.validation.normalizeTags(parsed.options.tags);
    const values = {
      title: parsed.options.title,
      url: parsed.options.url,
      notes: parsed.options.notes,
      tags,
      parentPath: parsed.options.parentPath
    };
    this.validation.validateTextLimits(values);
    const patch = {};
    if (parsed.options.title !== undefined) {
      patch.title = String(parsed.options.title).trim();
    }
    if (parsed.options.url !== undefined) {
      patch.url = String(parsed.options.url).trim();
    }
    if (type === 'bookmark' && patch.title === undefined && await this.e2eeSession.enabled()) {
      patch.title = patch.url;
    }
    if (parsed.options.notes !== undefined) {
      patch.notes = String(parsed.options.notes);
    }
    if (tags !== undefined) {
      patch.tags = tags;
    }
    const encrypted = await this.e2eeSession.encryptPatch(patch);
    const payload = {
      type,
      ...encrypted.patch,
      parent_id: parsed.options.parentId,
      parent_path: parsed.options.parentPath,
      is_ete: encrypted.isE2ee ? 'true' : 'false',
      expected_account_ete_index: encrypted.metadata.ete_index || 0,
      dry_run: parsed.options.dryRun ? '1' : '0'
    };
    const response = await this.apiClient.post('/cli/bookmarks-create', payload, { auth: true });
    this.output.print(response, parsed.options);
  }
}
