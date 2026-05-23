import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getProfile } from '../config.js';
import { ANTHROPIC_KEYS, SETTINGS_DIR } from '../constants.js';
import { err, info } from '../output.js';
import { writeRun } from '../process.js';

export function whichClaude(): string | null {
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of pathDirs) {
    const full = path.join(dir, 'claude');
    if (fs.existsSync(full) && isExecutable(full)) return full;
  }
  return null;
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function writeSettings(name: string, profile: Record<string, string>): string {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  const settings: { env: Record<string, string> } = { env: {} };
  for (const key of ANTHROPIC_KEYS) {
    if (key in profile) settings.env[key] = profile[key];
  }
  const filePath = path.join(SETTINGS_DIR, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + '\n');
  return filePath;
}

export function cmdLaunch(args: { name: string; extraArgs?: string[] }): void {
  const profile = getProfile(args.name);
  if (!profile) {
    err(`Profile '${args.name}' not found.`);
    process.exit(1);
  }

  if (!whichClaude()) {
    err('claude not found in PATH.');
    info('Install: npm install -g @anthropic-ai/claude-code');
    process.exit(1);
  }

  const settingsPath = writeSettings(args.name, profile);
  writeRun(process.pid, args.name, '');

  info(`Launching claude with profile '${args.name}'...`);
  console.log();

  const child = spawn('claude', ['--settings', settingsPath, ...(args.extraArgs || [])], {
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

export function cmdConfig(args: { name: string }): void {
  const profile = getProfile(args.name);
  if (!profile) {
    err(`Profile '${args.name}' not found.`);
    process.exit(1);
  }
  for (const key of ANTHROPIC_KEYS) {
    if (key in profile) {
      const val = String(profile[key]).replace(/'/g, "'\\''");
      console.log(`export ${key}='${val}'`);
    }
  }
}

export function cmdRegister(args: { name: string; pid: number; tty?: string }): void {
  writeRun(args.pid, args.name, args.tty || '');
}
