import { JsonOutput } from '../output/JsonOutput.js';

export class AccountsCommand {
  constructor(tokenStore) {
    this.name = 'accounts';
    this.aliases = ['auth accounts', 'auth list'];
    this.tokenStore = tokenStore;
    this.output = new JsonOutput();
  }

  async run(parsed) {
    const accounts = await this.tokenStore.listAccounts();
    this.output.print({
      success: 'true',
      active_account: accounts.find(account => account.active)?.user?.hash || null,
      accounts,
      ...(accounts.length === 0 ? {
        login_required: true,
        next_command: 'webcull login'
      } : {})
    }, parsed.options);
  }
}
