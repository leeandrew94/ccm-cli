import { err, info, ok } from '../output.js';
import { getAllRuns, killAll, killByProfile } from '../process.js';
import { whichClaude } from './launch.js';

export function cmdPs(): void {
  const runs = getAllRuns();
  if (!runs.length) {
    info('No running instances.');
    return;
  }

  console.log(`\n  ${'PID'.padEnd(8)} ${'PROFILE'.padEnd(15)} ${'TTY'.padEnd(20)} ${'UPTIME'}`);
  console.log(`  ${'─'.repeat(8)} ${'─'.repeat(15)} ${'─'.repeat(20)} ${'─'.repeat(10)}`);

  for (const r of runs) {
    console.log(
      `  ${String(r.pid).padEnd(8)} ${r.profile.padEnd(15)} ${(r.tty || '-').padEnd(20)} ${(r.uptime || '-')}`
    );
  }
  console.log();
}

export function cmdKill(args: { name?: string; all?: boolean }): void {
  if (args.all) {
    const [count, total] = killAll();
    if (total === 0) {
      info('No running instances.');
    } else {
      ok(`Killed ${count}/${total} instances.`);
    }
    return;
  }

  if (!args.name) {
    err('Specify a profile name or use --all.');
    process.exit(1);
  }

  const [success, msg] = killByProfile(args.name);
  if (success) {
    ok(msg);
  } else {
    err(msg);
    process.exit(1);
  }
}

export function cmdCheck(): void {
  const claudePath = whichClaude();
  if (claudePath) {
    ok(`claude found at ${claudePath}`);
  } else {
    err('claude not found in PATH.');
    info('Install: npm install -g @anthropic-ai/claude-code');
    process.exit(1);
  }
}
