export class CommandParser {
  parse(argv) {
    const args = [];
    const options = {};
    const optionCounts = {};
    for (let i = 0; i < argv.length; i++) {
      const value = argv[i];
      if (value.startsWith('--')) {
        const eq = value.indexOf('=');
        const key = this.normalizeKey(eq === -1 ? value.slice(2) : value.slice(2, eq));
        optionCounts[key] = (optionCounts[key] || 0) + 1;
        if (eq !== -1) {
          options[key] = value.slice(eq + 1);
        } else if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
          options[key] = argv[++i];
        } else {
          options[key] = true;
        }
      } else {
        args.push(value);
      }
    }
    const command = args[0] || '';
    const twoWordNamespaces = new Set(['auth', 'bookmarks', 'graph', 'reminders']);
    const commandPath = twoWordNamespaces.has(command) && args[1] ? command + ' ' + args[1] : command;
    const positionals = commandPath.includes(' ') ? args.slice(2) : args.slice(1);
    return { command, commandPath, positionals, options, optionCounts };
  }

  normalizeKey(key) {
    return key.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase());
  }
}
