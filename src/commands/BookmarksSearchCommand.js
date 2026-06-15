import { JsonOutput } from '../output/JsonOutput.js';
import { OutputBudget } from '../output/OutputBudget.js';

export class BookmarksSearchCommand {
  constructor(apiClient, e2eeSession = null) {
    this.name = 'bookmarks search';
    this.apiClient = apiClient;
    this.e2eeSession = e2eeSession;
    this.output = new JsonOutput();
  }

  async run(parsed) {
    const query = parsed.options.query || parsed.positionals.join(' ');
    if (!query) {
      throw new Error('Search query required.');
    }
    if (this.e2eeSession && await this.e2eeSession.enabled()) {
      const response = await this.localDecryptedSearch(parsed, query);
      this.output.print(response, parsed.options);
      return;
    }
    const budget = OutputBudget.defaults(parsed.options, {
      limit: 25,
      maxChars: 12000,
      maxMetadataChars: 500
    });
    const response = await this.apiClient.post('/cli/bookmarks-search', {
      ...budget,
      query,
      sort: parsed.options.sort || 'modified_desc'
    }, { auth: true });
    this.output.print(response, parsed.options);
  }

  async localDecryptedSearch(parsed, query) {
    const terms = this.localTerms(query);
    const limit = Number(parsed.options.limit || 25);
    const pageSize = Math.min(Number(parsed.options.pageSize || 100), 200);
    const maxScan = Math.min(Number(parsed.options.maxScanRows || 500), 5000);
    const fields = 'id,parent_id,order_id,type,title,url,notes,tags,ete_index,created,modified';
    const items = [];
    let scanned = 0;
    let page = 1;
    while (scanned < maxScan && items.length < limit) {
      let response = await this.apiClient.post('/cli/bookmarks-scan', {
        limit: pageSize,
        page,
        fields,
        sort: parsed.options.sort || 'modified_desc',
        max_chars: parsed.options.maxChars || 20000,
        max_metadata_chars: parsed.options.maxMetadataChars || 2000
      }, { auth: true });
      response = await this.e2eeSession.decryptItems(response, fields.split(','));
      const rows = response.items || [];
      if (!rows.length) {
        break;
      }
      for (const row of rows) {
        scanned++;
        if (row.decrypted !== false && this.matchesLocalTerms(row, terms)) {
          items.push(row);
          if (items.length >= limit || scanned >= maxScan) {
            break;
          }
        }
      }
      if (rows.length < pageSize) {
        break;
      }
      page++;
    }
    return {
      success: 'true',
      search: 'local_decrypted',
      items,
      returned: items.length,
      scanned
    };
  }

  localTerms(query) {
    if (/[()]/.test(query) || /\bOR\b/i.test(query)) {
      throw new Error('Local decrypted search supports plain terms, field filters, and AND only.');
    }
    return (query.match(/"[^"]+"|\S+/g) || [])
      .map(term => term.trim())
      .filter(term => term && term.toUpperCase() !== 'AND')
      .map(term => {
        const match = term.match(/^([a-z_]+):(.+)$/i);
        if (match) {
          const field = match[1].toLowerCase();
          if (!['title', 'url', 'notes', 'tags', 'type', 'id'].includes(field)) {
            throw new Error('Unknown local decrypted search field: ' + field);
          }
          return { field, value: this.unquote(match[2]).toLowerCase() };
        }
        return { field: '', value: this.unquote(term).toLowerCase() };
      });
  }

  matchesLocalTerms(row, terms) {
    return terms.every(term => {
      if (term.field === 'id') {
        return String(row.id) === term.value;
      }
      if (term.field === 'type') {
        return String(row.type || '').toLowerCase() === term.value;
      }
      if (term.field) {
        return String(row[term.field] || '').toLowerCase().includes(term.value);
      }
      return ['title', 'url', 'notes', 'tags'].some(field => String(row[field] || '').toLowerCase().includes(term.value));
    });
  }

  unquote(value) {
    return String(value).replace(/^"|"$/g, '');
  }
}
