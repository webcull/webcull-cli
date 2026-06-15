#!/usr/bin/env node
import { WebCullCli } from './WebCullCli.js';

const cli = new WebCullCli();
cli.run(process.argv.slice(2)).catch(error => {
  const message = error && error.message ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
