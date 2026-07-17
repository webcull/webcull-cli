import readline from 'node:readline/promises';
import { stdin as defaultInput, stdout as defaultOutput } from 'node:process';

export class AccountPicker {
  constructor({ input = defaultInput, output = defaultOutput } = {}) {
    this.input = input;
    this.output = output;
  }

  async choose(accounts, action = 'use') {
    if (!this.input.isTTY || !this.output.isTTY) {
      const failure = 'Multiple WebCull accounts are logged in. Select one with --account <hash>.';
      const error = new Error(failure);
      error.cliResponse = {
        success: 'false',
        code: 'account_selection_required',
        failure,
        accounts
      };
      throw error;
    }

    this.output.write('Multiple WebCull accounts are logged in:\n');
    for (const account of accounts) {
      this.output.write(this.accountLine(account) + '\n');
    }

    const rl = readline.createInterface({ input: this.input, output: this.output });
    try {
      while (true) {
        const answer = String(await rl.question('Choose an account to ' + action + ' (1-' + accounts.length + ', or q to cancel): ')).trim();
        if (answer.toLowerCase() === 'q') {
          throw new Error('Account selection cancelled.');
        }
        const number = Number(answer);
        if (Number.isInteger(number) && number >= 1 && number <= accounts.length) {
          return accounts[number - 1];
        }
        this.output.write('Enter a number from 1 to ' + accounts.length + ', or q to cancel.\n');
      }
    } finally {
      rl.close();
    }
  }

  accountLine(account) {
    const user = account.user || {};
    const identity = user.name || user.email || 'WebCull account';
    const email = user.email && user.email !== identity ? ' <' + user.email + '>' : '';
    const active = account.active ? ' [active]' : '';
    return account.number + '. ' + identity + email + ' | user ID ' + String(user.id || 'unknown') + ' | hash ' + String(user.hash || 'unknown') + active;
  }
}
