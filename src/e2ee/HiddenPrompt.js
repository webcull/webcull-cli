import { execFileSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin as input, stdout as output } from 'node:process';

export class HiddenPrompt {
  async ask(label) {
    if (!input.isTTY || !output.isTTY) {
      throw new Error('E2EE key required. Run this command in an interactive terminal.');
    }
    const mutedOutput = new Writable({
      write(chunk, encoding, callback) {
        if (!this.muted) {
          output.write(chunk, encoding);
        }
        callback();
      }
    });
    let echoDisabled = false;
    const rl = readline.createInterface({ input, output: mutedOutput, terminal: true });
    try {
      this.disableEcho();
      echoDisabled = true;
      mutedOutput.muted = true;
      const value = await rl.question(label);
      output.write('\n');
      return value;
    } finally {
      mutedOutput.muted = false;
      rl.close();
      if (echoDisabled) {
        this.restoreEcho();
      }
    }
  }

  disableEcho() {
    if (process.platform !== 'win32') {
      execFileSync('stty', ['-echo'], { stdio: ['inherit', 'ignore', 'ignore'] });
    }
  }

  restoreEcho() {
    if (process.platform !== 'win32') {
      execFileSync('stty', ['echo'], { stdio: ['inherit', 'ignore', 'ignore'] });
    }
  }
}
