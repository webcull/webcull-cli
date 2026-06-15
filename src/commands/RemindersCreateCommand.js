import { JsonOutput } from '../output/JsonOutput.js';
import { WriteCommandValidation } from './WriteCommandValidation.js';

export class RemindersCreateCommand {
  constructor(apiClient, e2eeSession) {
    this.name = 'reminders create';
    this.apiClient = apiClient;
    this.e2eeSession = e2eeSession;
    this.output = new JsonOutput();
    this.validation = new WriteCommandValidation([
      'bookmarkId',
      'at',
      'in',
      'note',
      'dryRun',
      'format'
    ]);
  }

  async run(parsed) {
    this.validation.validateCommon(parsed);
    const bookmarkId = this.validation.positiveInteger(parsed.options.bookmarkId, 'Bookmark id');
    if (parsed.options.at !== undefined && parsed.options.in !== undefined) {
      throw new Error('Use either --at or --in, not both.');
    }
    if (parsed.options.at === undefined && parsed.options.in === undefined) {
      throw new Error('Reminder create requires --at or --in.');
    }
    const note = parsed.options.note === undefined ? '' : String(parsed.options.note).trim();
    this.validation.rejectControlCharacters(note, 'Note');
    this.validation.requireMax(note, 8000, 'Note');
    const remindAt = parsed.options.in !== undefined
      ? this.remindAtFromDuration(parsed.options.in)
      : String(parsed.options.at).trim();
    if (!remindAt) {
      throw new Error('Reminder time required.');
    }
    const encrypted = note
      ? await this.e2eeSession.encryptPatch({ note })
      : { patch: { note: '' }, isE2ee: false, metadata: await this.e2eeSession.loadMetadata() };
    const payload = {
      stack_id: bookmarkId,
      remind_at: remindAt,
      note: encrypted.patch.note || '',
      note_ete_index: encrypted.isE2ee ? encrypted.metadata.ete_index || 0 : 0,
      is_ete: encrypted.isE2ee ? 'true' : 'false',
      expected_account_ete_index: encrypted.metadata.ete_index || 0,
      dry_run: parsed.options.dryRun ? '1' : '0'
    };
    const response = await this.apiClient.post('/cli/reminders-create', payload, { auth: true });
    this.output.print(response, parsed.options);
  }

  remindAtFromDuration(value) {
    const match = String(value || '').trim().match(/^(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days)$/i);
    if (!match) {
      throw new Error('--in must be a duration like 30m, 3h, or 2d.');
    }
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const date = new Date();
    if (unit.startsWith('m')) {
      date.setMinutes(date.getMinutes() + amount);
    } else if (unit.startsWith('h')) {
      date.setHours(date.getHours() + amount);
    } else {
      date.setDate(date.getDate() + amount);
    }
    return date.toISOString();
  }
}
