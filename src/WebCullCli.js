import { CommandParser } from './query/CommandParser.js';
import { ApiClient } from './http/ApiClient.js';
import { TokenStore } from './auth/TokenStore.js';
import { LoginCommand } from './commands/LoginCommand.js';
import { WhoamiCommand } from './commands/WhoamiCommand.js';
import { LimitsCommand } from './commands/LimitsCommand.js';
import { BookmarksCountCommand } from './commands/BookmarksCountCommand.js';
import { BookmarksTreeCommand } from './commands/BookmarksTreeCommand.js';
import { BookmarksSearchCommand } from './commands/BookmarksSearchCommand.js';
import { BookmarksGetCommand } from './commands/BookmarksGetCommand.js';
import { BookmarksCreateCommand } from './commands/BookmarksCreateCommand.js';
import { BookmarksUpdateCommand } from './commands/BookmarksUpdateCommand.js';
import { GraphAroundCommand } from './commands/GraphAroundCommand.js';
import { GraphBacklinksCommand } from './commands/GraphBacklinksCommand.js';
import { GraphPathCommand } from './commands/GraphPathCommand.js';
import { GraphValidateCommand } from './commands/GraphValidateCommand.js';
import { GraphSchemaCommand } from './commands/GraphSchemaCommand.js';
import { RemindersCreateCommand } from './commands/RemindersCreateCommand.js';
import { RemindersListCommand } from './commands/RemindersListCommand.js';
import { RemindersCancelCommand } from './commands/RemindersCancelCommand.js';
import { E2eeSession } from './e2ee/E2eeSession.js';

export class WebCullCli {
  constructor() {
    this.parser = new CommandParser();
    this.tokenStore = new TokenStore();
    this.apiClient = new ApiClient({
      apiUrl: process.env.WEBCULL_API_URL || 'https://api.webcull.com',
      tokenStore: this.tokenStore
    });
    this.e2eeSession = new E2eeSession(this.apiClient);
    this.commands = new Map();
    this.register(new LoginCommand(this.apiClient, this.tokenStore));
    this.register(new WhoamiCommand(this.apiClient));
    this.register(new LimitsCommand(this.apiClient));
    this.register(new BookmarksCountCommand(this.apiClient));
    this.register(new BookmarksTreeCommand(this.apiClient));
    this.register(new BookmarksSearchCommand(this.apiClient, this.e2eeSession));
    this.register(new BookmarksGetCommand(this.apiClient, this.e2eeSession));
    this.register(new BookmarksCreateCommand(this.apiClient, this.e2eeSession));
    this.register(new BookmarksUpdateCommand(this.apiClient, this.e2eeSession));
    this.register(new GraphAroundCommand(this.apiClient));
    this.register(new GraphBacklinksCommand(this.apiClient));
    this.register(new GraphPathCommand(this.apiClient));
    this.register(new GraphValidateCommand(this.apiClient));
    this.register(new GraphSchemaCommand(this.apiClient));
    this.register(new RemindersCreateCommand(this.apiClient, this.e2eeSession));
    this.register(new RemindersListCommand(this.apiClient, this.e2eeSession));
    this.register(new RemindersCancelCommand(this.apiClient));
  }

  register(command) {
    this.commands.set(command.name, command);
    for (const alias of command.aliases || []) {
      this.commands.set(alias, command);
    }
  }

  async run(argv) {
    this.rejectForbiddenE2eeInputs(argv);
    const parsed = this.parser.parse(argv);
    if (parsed.options.help || parsed.command === 'help' || !parsed.command) {
      this.printHelp();
      return;
    }
    const command = this.commands.get(parsed.commandPath);
    if (!command) {
      throw new Error('Unknown command: ' + parsed.commandPath);
    }
    await command.run(parsed);
  }

  rejectForbiddenE2eeInputs(argv) {
    const forbiddenOptions = new Set([
      '--e2ee-password',
      '--e2ee-passphrase',
      '--e2ee-key',
      '--e2ee-secret',
      '--ete-password',
      '--ete-passphrase'
    ]);
    for (const arg of argv) {
      const key = String(arg).split('=')[0];
      if (forbiddenOptions.has(key)) {
        throw new Error('E2EE passphrases are accepted only through hidden interactive terminal input.');
      }
    }
    for (const key of Object.keys(process.env)) {
      if (/^WEBCULL_.*(E2EE|ETE).*(PASSWORD|PASSPHRASE|KEY|SECRET)$/i.test(key)) {
        throw new Error('E2EE passphrases are not accepted from environment variables.');
      }
    }
  }

  printHelp() {
    console.log([
      'Usage: webcull <command> [options]',
      '',
      'Commands:',
      '  login                     Authorize the CLI in a browser',
      '  whoami                    Show the authorized account',
      '  limits                    Show current CLI usage limits',
      '  bookmarks count           Count children under a path',
      '  bookmarks tree            List a limited bookmark tree',
      '  bookmarks search          Search bookmark metadata',
      '  bookmarks get             Fetch bookmarks by id',
      '  bookmarks create          Create one bookmark or folder',
      '  bookmarks update <id>     Update one bookmark or folder',
      '  graph around              Show relationships around a stack item',
      '  graph backlinks           Show items that point at a stack item',
      '  graph path                Show a bounded path between stack items',
      '  graph validate            Check a bounded graph area',
      '  graph schema              Show graph command schema',
      '  reminders create          Create one bookmark reminder',
      '  reminders list            List pending bookmark reminders',
      '  reminders cancel <id>     Cancel one pending reminder',
      '',
      'Common safety options:',
      '  --limit <n>               Row limit, default depends on command',
      '  --page <n>                Page number, starts at 1',
      '  --max-chars <n>           Maximum response characters',
      '  --fields <list>           Comma separated output fields',
      '  --format json|jsonl       Output format'
    ].join('\n'));
  }
}
