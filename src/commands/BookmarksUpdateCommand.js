import { JsonOutput } from '../output/JsonOutput.js';
import { WriteCommandValidation } from './WriteCommandValidation.js';

export class BookmarksUpdateCommand {
  constructor(apiClient, e2eeSession) {
    this.name = 'bookmarks update';
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
    const id = this.validation.positiveInteger(parsed.positionals[0], 'Bookmark id');
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
    if (parsed.options.notes !== undefined) {
      patch.notes = String(parsed.options.notes);
    }
    if (tags !== undefined) {
      patch.tags = tags;
    }
    const hasPlacement = parsed.options.parentId !== undefined || parsed.options.parentPath !== undefined;
    if (!Object.keys(patch).length && !hasPlacement) {
      throw new Error('Update requires at least one field or placement option.');
    }
    if (parsed.options.type !== undefined && !['bookmark', 'folder'].includes(parsed.options.type)) {
      throw new Error('--type must be bookmark or folder.');
    }
    const metadata = await this.e2eeSession.loadMetadata();
    const existing = await this.apiClient.post('/cli/bookmarks-get', {
      ids: String(id),
      fields: 'id,parent_id,type,ete_index',
      max_chars: 4000,
      max_metadata_chars: 500
    }, { auth: true });
    const row = existing.items && existing.items[0] ? existing.items[0] : null;
    if (!row) {
      throw new Error('Bookmark not found.');
    }
    if (metadata.e2ee_enabled === 'true' && Number(row.ete_index || 0) !== 0 && Number(row.ete_index || 0) !== Number(metadata.ete_index || 0)) {
      throw new Error('Old E2EE key row cannot be updated by the first CLI write release.');
    }
    const encrypted = await this.e2eeSession.encryptPatch(patch);
    const payload = {
      id,
      patch: JSON.stringify(encrypted.patch),
      parent_id: parsed.options.parentId,
      parent_path: parsed.options.parentPath,
      expected_type: parsed.options.type || row.type,
      expected_row_ete_index: row.ete_index || 0,
      expected_account_ete_index: encrypted.metadata.ete_index || 0,
      is_ete: encrypted.isE2ee ? 'true' : 'false',
      dry_run: parsed.options.dryRun ? '1' : '0'
    };
    const response = await this.apiClient.post('/cli/bookmarks-update', payload, { auth: true });
    this.output.print(response, parsed.options);
  }
}
