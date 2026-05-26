import { readFileSync } from 'fs';
import updateNotifier from 'update-notifier';
import { profileExists } from './config.js';
import { cmdLaunch, cmdConfig, cmdRegister } from './commands/launch.js';
import { cmdAdd, cmdEdit, cmdRm, cmdList } from './commands/profile.js';
import { cmdInit } from './commands/init.js';
import { cmdPs, cmdKill, cmdCheck } from './commands/runtime.js';
import { cmdTest, cmdBalance } from './commands/diagnose.js';
import { cmdCompletions } from './completions.js';
import { cmdSessions } from './commands/sessions.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
const VERSION = pkg.version;

const KNOWN_COMMANDS = new Set([
  '_launch', '_register',
  'init',
  'add', 'edit', 'rm', 'list', 'ls',
  'ps', 'kill', 'check',
  'test', 'balance', 'bal', 'config',
  'completions', 'sessions',
]);

function printHelp(): void {
  console.log(`
Usage: ccm <command> [options]

Commands:
  init              Interactive setup wizard
  add <name>        Add a new model profile
  edit <name>       Edit an existing profile
  rm <name>         Delete a profile
  list, ls          List all profiles
  ps                Show running Claude instances
  kill <name>       Kill a running instance
  kill --all        Kill all running instances
  check             Check if claude is installed
  test [name]       Test API connection for profiles
  balance [name]    Query model balance/credits
  config <name>     Show profile environment variables
  completions       Print shell completion script
  sessions          Browse and manage session history
  sessions --web    Open session viewer in browser
  sessions --restore [id] Restore session from trash
  sessions --purge  Empty the trash permanently

Options:
  -v, --version     Show version
  -h, --help        Show help

Shortcuts:
  ccm <profile>     Launch claude with the named profile
`);
}

function parseArgs(argv: string[]): { command: string; args: Record<string, any> } {
  const args: Record<string, any> = { _: [], extra: [] };
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--all') {
      args.all = true;
    } else if (arg.startsWith('-')) {
      args.extra.push(arg);
    } else {
      args._.push(arg);
    }
    i++;
  }

  const command = args._[0] || '';
  const positional = args._.slice(1);

  // Map positional args based on command
  if (positional.length > 0) {
    if (['_launch', 'add', 'edit', 'rm', 'config'].includes(command)) {
      args.name = positional[0];
    } else if (command === '_register') {
      args.name = positional[0];
      args.pid = parseInt(positional[1], 10);
    } else if (['test', 'balance', 'bal', 'kill'].includes(command)) {
      args.name = positional[0];
    } else if (command === 'completions') {
      args.shell = positional[0];
    }
  }

  return { command, args };
}

async function main(): Promise<void> {
  updateNotifier({ pkg }).notify();

  const rawArgs = process.argv.slice(2);

  // Handle --version / -v
  if (rawArgs.includes('-v') || rawArgs.includes('--version')) {
    console.log(`ccm ${VERSION}`);
    return;
  }

  // Handle --help / -h
  if (rawArgs.includes('-h') || rawArgs.includes('--help') || rawArgs.length === 0) {
    printHelp();
    return;
  }

  // Profile shortcut: if first arg is not a known command and not a flag,
  // and a profile with that name exists, launch directly
  const firstArg = rawArgs[0];
  if (firstArg && !KNOWN_COMMANDS.has(firstArg) && !firstArg.startsWith('-')) {
    if (profileExists(firstArg)) {
      cmdLaunch({ name: firstArg, extraArgs: rawArgs.slice(1) });
      return;
    }
  }

  const { command, args } = parseArgs(rawArgs);

  switch (command) {
    case '_launch':
      cmdLaunch({ name: args.name, extraArgs: args.extra || [] });
      break;
    case '_register':
      cmdRegister({ name: args.name, pid: args.pid, tty: args.tty });
      break;
    case 'init':
      await cmdInit();
      break;
    case 'add':
      await cmdAdd({ name: args.name });
      break;
    case 'edit':
      await cmdEdit({ name: args.name });
      break;
    case 'rm':
      await cmdRm({ name: args.name });
      break;
    case 'list':
    case 'ls':
      cmdList();
      break;
    case 'ps':
      cmdPs();
      break;
    case 'kill':
      cmdKill({ name: args.name, all: args.all });
      break;
    case 'check':
      cmdCheck();
      break;
    case 'test':
      await cmdTest({ name: args.name });
      break;
    case 'balance':
    case 'bal':
      await cmdBalance({ name: args.name });
      break;
    case 'config':
      cmdConfig({ name: args.name });
      break;
    case 'completions':
      cmdCompletions({ shell: args.shell });
      break;
    case 'sessions': {
      const restoreIdx = rawArgs.indexOf('--restore');
      const restoreId = restoreIdx >= 0 ? (rawArgs[restoreIdx + 1] || '') : undefined;
      await cmdSessions({
        web: rawArgs.includes('--web'),
        restore: restoreIdx >= 0 ? restoreId : undefined,
        purge: rawArgs.includes('--purge'),
      });
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
