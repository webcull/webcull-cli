#!/usr/bin/env node
import { WebCullCli } from './WebCullCli.js';
import { runMcp } from './mcp/main.js';

const cli = new WebCullCli();
const args = process.argv.slice(2);
const run = args[0] === 'mcp' ? runMcp(args.slice(1)) : cli.run(args);
run.catch(error => {
  if (error && error.cliResponse) {
    console.error(JSON.stringify(error.cliResponse, null, 2));
    process.exitCode = 1;
    return;
  }
  const message = error && error.message ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
