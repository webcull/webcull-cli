import { JsonOutput } from '../output/JsonOutput.js';
import { WriteCommandValidation } from './WriteCommandValidation.js';
import { resolveCreateProxyFields } from './BookmarkProxyOptions.js';

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
      'proxy',
      'proxyFields',
      'proxyExclude',
      'format'
    ]);
  }

  async run(parsed) {
    this.validation.validateCommon(parsed);
    if (parsed.options.proxy !== undefined && parsed.options.proxy !== true) {
      throw new Error('--proxy does not accept a value.');
    }
    const proxyRequested = parsed.options.proxy === true
      || parsed.options.proxyFields !== undefined
      || parsed.options.proxyExclude !== undefined;
    const proxyFields = proxyRequested
      ? resolveCreateProxyFields(parsed.options.proxyFields, parsed.options.proxyExclude)
      : [];
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
    if (proxyRequested && type !== 'bookmark') {
      throw new Error('--proxy is available only for bookmark creation.');
    }
    const e2eeEnabled = await this.e2eeSession.enabled();
    if (proxyRequested && e2eeEnabled) {
      throw new Error('Proxy refresh is unavailable for E2EE accounts.');
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
    if (type === 'bookmark' && patch.title === undefined && e2eeEnabled) {
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
    if (!proxyRequested || parsed.options.dryRun || response.success !== 'true' || !response.id) {
      this.output.print(response, parsed.options);
      return;
    }
    const proxyResponse = await this.apiClient.post('/cli/bookmarks-proxy', {
      id: response.id,
      fields: proxyFields.join(',')
    }, { auth: true });
    this.output.print({
      ...response,
      proxy: proxyResponse
    }, parsed.options);
  }
}
