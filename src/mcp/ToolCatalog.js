const text = (description, maxLength = 8000) => ({ type: 'string', description, maxLength });
const integer = (description, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) => ({ type: 'integer', description, minimum, maximum });
const flag = description => ({ type: 'boolean', description });
const account = { ...text('Explicit account hash from webcull_accounts. Never guess an account.', 128), pattern: '^[A-Za-z0-9_-]{6,128}$' };
const fields = text('Comma-separated fields, using the same field names as the CLI.', 1000);
const budget = {
  limit: integer('Maximum rows to return.', 1, 1000),
  page: integer('Page number, starting at 1.'),
  fields,
  maxChars: integer('Maximum response characters requested from WebCull.', 100, 200000),
  maxMetadataChars: integer('Maximum metadata characters per item.', 0, 20000)
};
const dryRun = flag('Validate the requested write without saving it. Still consumes write quota.');
const edits = {
  type: { type: 'string', enum: ['bookmark', 'folder'] },
  title: text('Bookmark or folder title.', 500), url: text('Bookmark URL.', 3500),
  notes: text('Bookmark notes.'), tags: text('Comma-separated tags.', 2000),
  parentId: integer('Destination folder ID; 0 is the root.', 0),
  parentPath: text('Destination folder path. Use either parentId or parentPath.', 1000), dryRun
};
const stackId = integer('Stack item ID.');

// Transport schemas describe the existing command options. All operations run
// through WebCullCli's shared command registry and validators.
const definitions = [
  ['login', 'Start or finish an independent MCP authorization. Start only at the user’s request; show the approval URL, then complete after the user approves. Never ask for a password in chat.', {
    action: { type: 'string', enum: ['start', 'complete'] }, request: text('Request returned by login start.', 160)
  }, ['action'], false],
  ['logout', 'Revoke only MCP authorization for the selected account. CLI authorization is unaffected.', { localOnly: flag('Remove local MCP authorization even when offline. The server token may remain valid.') }, [], false],
  ['accounts', 'List locally authorized MCP accounts without exposing credentials.', {}, [], true],
  ['whoami', 'Show the selected authorized account and its permissions.', {}, [], true],
  ['limits', 'Show remaining usage limits. Call sparingly.', {}, [], true],
  ['bookmarks count', 'Count children under a folder path.', { path: text('Folder path; defaults to /.', 1000) }, [], true],
  ['bookmarks tree', 'Browse a bounded folder tree.', { ...budget, path: text('Folder path; defaults to /.', 1000), maxDepth: integer('Maximum tree depth.', 1, 20), perParentLimit: integer('Maximum children per folder.', 1, 1000) }, [], true],
  ['bookmarks search', 'Search saved bookmarks. Encrypted accounts use bounded local decrypted search, which supports plain terms, field filters and AND.', { ...budget, query: text('Search expression.', 4000), sort: text('CLI sort order.', 80), pageSize: integer('Encrypted search scan page size.', 1, 200), maxScanRows: integer('Encrypted search scan budget.', 1, 5000) }, ['query'], true],
  ['bookmarks get', 'Retrieve selected bookmarks. Encrypted fields require the account’s local E2EE keystore entry.', { ...budget, ids: text('Comma-separated bookmark IDs.', 4000), decrypt: flag('Decrypt encrypted fields locally; defaults to true.') }, ['ids'], true],
  ['bookmarks create', 'Create one bookmark or folder. Perform writes only when the user requests them.', { ...edits, proxy: flag('Refresh metadata after creating an unencrypted bookmark.'), proxyFields: fields, proxyExclude: fields }, [], false],
  ['bookmarks update', 'Update one bookmark or folder, preserving omitted fields.', { ...edits, id: stackId }, ['id'], false],
  ['bookmarks proxy', 'Refresh selected metadata for an unencrypted bookmark. This can replace existing values.', { id: stackId, fields, exclude: fields, dryRun }, ['id'], false],
  ['graph around', 'Inspect nearby relationships around an item.', { ...budget, stackId, depth: integer('Relationship depth.', 1, 20), direction: { type: 'string', enum: ['both', 'inbound', 'outbound'] }, expandLinkedStacks: flag('Expand linked stacks.'), linkedDepth: integer('Linked stack depth.', 0, 20) }, ['stackId'], true],
  ['graph backlinks', 'Find relationships pointing to an item.', { ...budget, stackId }, ['stackId'], true],
  ['graph path', 'Find a bounded relationship path between two items.', { ...budget, fromStackId: stackId, toStackId: stackId, maxDepth: integer('Maximum path depth.', 1, 20) }, ['fromStackId', 'toStackId'], true],
  ['graph validate', 'Validate a bounded area of the relationship graph.', { ...budget, stackId, depth: integer('Maximum validation depth.', 1, 20) }, ['stackId'], true],
  ['graph schema', 'Describe available relationship types and graph semantics.', {}, [], true],
  ['reminders create', 'Create one bookmark reminder. Use either an absolute time or a relative duration.', { bookmarkId: stackId, at: text('ISO 8601 time with timezone.', 100), in: text('Duration such as 30m, 3h or 2d.', 50), note: text('Optional reminder note.'), dryRun }, ['bookmarkId'], false],
  ['reminders list', 'List pending reminders for the account or one bookmark.', { bookmarkId: stackId, limit: budget.limit, page: budget.page, fields }, [], true],
  ['reminders cancel', 'Cancel one pending reminder.', { id: stackId, dryRun }, ['id'], false],
  ['setup', 'Show local setup requirements and optionally verify the selected account’s E2EE keystore entry. Never supply secrets as tool arguments.', { account, client: { type: 'string', enum: ['claude', 'vscode'], description: 'Configuration format to print.' }, checkE2ee: flag('Validate the existing keystore entry locally without returning its value.') }, [], true]
];

export class ToolCatalog {
  constructor() {
    this.tools = definitions.map(([command, description, properties, required, readOnly]) => {
      const needsAccount = !['login', 'accounts', 'setup'].includes(command);
      return {
        command,
        name: 'webcull_' + command.replaceAll(' ', '_'),
        description,
        inputSchema: {
          type: 'object', additionalProperties: false,
          properties: { ...(needsAccount ? { account } : {}), ...properties },
          required: [...(needsAccount ? ['account'] : []), ...required]
        },
        annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: true }
      };
    });
  }

  list() {
    return this.tools.map(({ command, ...tool }) => tool);
  }

  validate(name, args) {
    const tool = this.tools.find(item => item.name === name);
    if (!tool) throw new Error('Unknown WebCull tool.');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
    const schema = tool.inputSchema;
    for (const key of schema.required) {
      if (args[key] === undefined) throw new Error('Missing required argument: ' + key);
    }
    for (const [key, value] of Object.entries(args)) {
      const rule = Object.hasOwn(schema.properties, key) ? schema.properties[key] : null;
      if (!rule) throw new Error('Unsupported tool argument. Secrets belong only in your OS keystore.');
      if (rule.type === 'integer' ? !Number.isSafeInteger(value) : typeof value !== rule.type) throw new Error('Invalid argument type: ' + key);
      if (rule.enum && !rule.enum.includes(value)) throw new Error('Unsupported value for ' + key);
      if (typeof value === 'string' && (value.length > rule.maxLength || value.includes('\0'))) throw new Error('Invalid argument length or content: ' + key);
      if (rule.pattern && !new RegExp(rule.pattern).test(value)) throw new Error('Invalid argument format: ' + key);
      if (typeof value === 'number' && (value < rule.minimum || value > rule.maximum)) throw new Error('Argument outside permitted range: ' + key);
    }
    return tool;
  }
}
