import fs from 'node:fs';
import { WebCullCli } from '../WebCullCli.js';
import { CommandParser } from '../query/CommandParser.js';
import { McpRuntime } from './McpRuntime.js';
import { StdioServer } from './StdioServer.js';

export async function runMcp(args) {
  const runtime = new McpRuntime();
  if (args.length === 0) {
    const version = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
    const server = new StdioServer(runtime, { version }).start();
    process.once('SIGTERM', () => server.close());
    process.once('SIGINT', () => server.close());
    return;
  }
  const parsed = new CommandParser().parse(args);
  if (parsed.options.help || parsed.command === 'help') {
    console.log('webcull mcp: start the local stdio server\nwebcull mcp setup [--account <hash>] [--check-e2ee]\nwebcull mcp login\nwebcull mcp accounts\nwebcull mcp logout --account <hash>\nOther CLI commands also accept the mcp prefix and use independent MCP authorization.');
    return;
  }
  if (parsed.options.e2eePassphraseStdin !== undefined) throw new Error('MCP encryption requires the OS keystore. Piped passphrases are not supported.');
  if (parsed.command === 'setup') {
    const args = { ...parsed.options };
    runtime.catalog.validate('webcull_setup', args);
    console.log(JSON.stringify(await runtime.call('webcull_setup', args), null, 2));
    return;
  }
  if (!['login', 'accounts'].includes(parsed.commandPath) && !parsed.options.account) {
    throw new Error('MCP commands require --account <hash>. Run webcull mcp accounts to choose an account.');
  }
  const context = runtime.context(parsed.options.account);
  const cli = new WebCullCli(context);
  try { await cli.run(args); }
  finally {
    if (context.e2eeSession) {
      context.e2eeSession.currentKey = null;
      context.e2eeSession.metadata = null;
    }
  }
}
