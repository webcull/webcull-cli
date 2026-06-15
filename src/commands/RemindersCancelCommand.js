import { JsonOutput } from '../output/JsonOutput.js';
import { WriteCommandValidation } from './WriteCommandValidation.js';

export class RemindersCancelCommand {
  constructor(apiClient) {
    this.name = 'reminders cancel';
    this.apiClient = apiClient;
    this.output = new JsonOutput();
    this.validation = new WriteCommandValidation(['dryRun', 'format']);
  }

  async run(parsed) {
    this.validation.validateCommon(parsed);
    const id = this.validation.positiveInteger(parsed.positionals[0], 'Reminder id');
    const response = await this.apiClient.post('/cli/reminders-cancel', {
      id,
      dry_run: parsed.options.dryRun ? '1' : '0'
    }, { auth: true });
    this.output.print(response, parsed.options);
  }
}
