import { JsonOutput } from '../output/JsonOutput.js';
import { WriteCommandValidation } from './WriteCommandValidation.js';

export class BookmarksOrderCommand {
  constructor(apiClient) {
    this.name = 'bookmarks order';
    this.apiClient = apiClient;
    this.output = new JsonOutput();
    this.validation = new WriteCommandValidation([
      'id', 'parentId', 'ids', 'position', 'orderId', 'beforeId', 'afterId',
      'expectedOrder', 'dryRun', 'format'
    ]);
  }

  integer(value, name, minimum = 1) {
    if (!/^(0|[1-9]\d*)$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum) {
      throw new Error(name + ' must be a safe integer of at least ' + minimum + '.');
    }
    return Number(value);
  }

  ids(value, name) {
    if (typeof value !== 'string' || value.length > 8500) throw new Error(name + ' must be a bounded comma-separated ID list.');
    const ids = value.split(',').map(id => this.integer(id.trim(), name));
    if (ids.length > 500 || new Set(ids).size !== ids.length) throw new Error(name + ' requires 1-500 unique IDs.');
    return ids.join(',');
  }

  async run(parsed) {
    this.validation.validateCommon(parsed);
    if (parsed.positionals.length) throw new Error('Use --id for one item or --parent-id with --ids for a complete folder order.');
    const options = parsed.options;
    if (options.dryRun !== undefined && typeof options.dryRun !== 'boolean') throw new Error('--dry-run is a flag.');
    const placements = ['position', 'orderId', 'beforeId', 'afterId'].filter(key => options[key] !== undefined);
    const full = options.ids !== undefined;
    if (full ? options.id !== undefined || placements.length || options.parentId === undefined
      : options.id === undefined || options.parentId !== undefined || placements.length !== 1) {
      throw new Error('Use --id with exactly one placement, or --parent-id with the complete --ids list.');
    }
    const payload = { dry_run: options.dryRun ? '1' : '0' };
    if (full) {
      payload.parent_id = this.integer(options.parentId, 'Parent ID', 0);
      payload.ids = this.ids(options.ids, 'IDs');
    } else {
      payload.id = this.integer(options.id, 'Item ID');
      if (options.position !== undefined) {
        if (!['first', 'last'].includes(options.position)) throw new Error('--position must be first or last.');
        payload.position = options.position;
      }
      for (const [option, field] of [['orderId', 'order_id'], ['beforeId', 'before_id'], ['afterId', 'after_id']]) {
        if (options[option] !== undefined) payload[field] = this.integer(options[option], option);
      }
      if (payload.order_id > 500) throw new Error('--order-id exceeds the 500-child ordering limit.');
      if (payload.before_id === payload.id || payload.after_id === payload.id) throw new Error('An item cannot be its own neighbour.');
    }
    if (options.expectedOrder !== undefined) payload.expected_order = this.ids(options.expectedOrder, 'Expected order');
    this.output.print(await this.apiClient.post('/cli/bookmarks-order', payload, { auth: true }), options);
  }
}
