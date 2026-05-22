import { loadProfiles, addProfile, deleteProfile, getProfile, profileExists, updateProfile } from '../config.js';
import { ask, err, info, ok, warn } from '../output.js';
import { getRunningProfiles, killByProfile } from '../process.js';

export async function cmdAdd(args: { name: string }): Promise<void> {
  const { name } = args;
  if (profileExists(name)) {
    warn(`Profile '${name}' already exists. Use 'ccm edit' to modify.`);
    return;
  }

  info(`Creating profile '${name}'\n`);

  const baseUrl = await ask('Base URL');
  if (!baseUrl) { err('Base URL is required.'); process.exit(1); }

  const authToken = await ask('Auth Token');
  if (!authToken) { err('Auth Token is required.'); process.exit(1); }

  const model = await ask('Model name');
  if (!model) { err('Model name is required.'); process.exit(1); }

  const haiku = await ask('Default Haiku model', '(skip)');
  const sonnet = await ask('Default Sonnet model', '(skip)');
  const opus = await ask('Default Opus model', '(skip)');

  const profile: Record<string, string> = {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: authToken,
    ANTHROPIC_MODEL: model,
  };
  if (haiku && haiku !== '(skip)') profile.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku;
  if (sonnet && sonnet !== '(skip)') profile.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet;
  if (opus && opus !== '(skip)') profile.ANTHROPIC_DEFAULT_OPUS_MODEL = opus;

  addProfile(name, profile as any);
  ok(`Profile '${name}' saved.`);
}

export async function cmdEdit(args: { name: string }): Promise<void> {
  const { name } = args;
  const profile = getProfile(name);
  if (!profile) {
    err(`Profile '${name}' not found.`);
    process.exit(1);
  }

  const running = getRunningProfiles();
  if (running.has(name)) {
    warn(`Profile '${name}' is currently running. Changes apply on next launch.`);
  }

  info(`Editing '${name}' (Enter = keep current)\n`);

  const baseUrl = await ask('Base URL', profile.ANTHROPIC_BASE_URL || '');
  const authToken = await ask('Auth Token', profile.ANTHROPIC_AUTH_TOKEN || '');
  const model = await ask('Model name', profile.ANTHROPIC_MODEL || '');
  const haiku = await ask('Default Haiku model', profile.ANTHROPIC_DEFAULT_HAIKU_MODEL || '');
  const sonnet = await ask('Default Sonnet model', profile.ANTHROPIC_DEFAULT_SONNET_MODEL || '');
  const opus = await ask('Default Opus model', profile.ANTHROPIC_DEFAULT_OPUS_MODEL || '');

  const updated: Record<string, string> = {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: authToken,
    ANTHROPIC_MODEL: model,
  };
  if (haiku) updated.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku;
  if (sonnet) updated.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet;
  if (opus) updated.ANTHROPIC_DEFAULT_OPUS_MODEL = opus;

  updateProfile(name, updated as any);
  ok(`Profile '${name}' updated.`);
}

export async function cmdRm(args: { name: string }): Promise<void> {
  const { name } = args;
  if (!profileExists(name)) {
    err(`Profile '${name}' not found.`);
    process.exit(1);
  }

  const running = getRunningProfiles();
  if (running.has(name)) {
    warn(`Profile '${name}' is currently running.`);
    const answer = await ask('Kill and delete? [y/N]');
    if (answer.toLowerCase() !== 'y') {
      info('Cancelled.');
      return;
    }
    const [success, msg] = killByProfile(name);
    if (success) {
      ok(msg);
    } else {
      err(msg);
      process.exit(1);
    }
  }

  deleteProfile(name);
  ok(`Profile '${name}' deleted.`);
}

function maskToken(token: string): string {
  if (!token) return '?';
  if (token.length <= 16) return token.slice(0, 4) + '****' + token.slice(-4);
  return token.slice(0, 8) + '*'.repeat(token.length - 12) + token.slice(-4);
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function padAnsi(text: string, width: number): string {
  const visible = stripAnsi(text).length;
  return text + ' '.repeat(Math.max(0, width - visible));
}

export function cmdList(): void {
  const names = Object.keys(loadProfiles()).sort();
  if (!names.length) {
    info("No profiles configured. Use 'ccm add <name>' to create one.");
    return;
  }

  const running = getRunningProfiles();
  const allP = loadProfiles();

  const W_NAME = 16;
  const W_MODEL = 26;
  const W_TOKEN = 28;
  const W_URL = 46;
  const W_STATUS = 12;
  const totalW = W_NAME + W_MODEL + W_TOKEN + W_URL + W_STATUS + 10;
  const line = '─'.repeat(totalW);

  console.log();
  console.log(`  \x1b[1;36m${line}\x1b[0m`);
  console.log(
    `  \x1b[1;36m│\x1b[0m ` +
    `\x1b[1m${'PROFILE'.padStart(Math.floor((W_NAME - 1 + 7) / 2)).padEnd(W_NAME - 1)}\x1b[0m ` +
    `\x1b[1;36m│\x1b[0m ` +
    `\x1b[1m${'MODEL'.padStart(Math.floor((W_MODEL - 1 + 5) / 2)).padEnd(W_MODEL - 1)}\x1b[0m ` +
    `\x1b[1;36m│\x1b[0m ` +
    `\x1b[1m${'TOKEN'.padStart(Math.floor((W_TOKEN - 1 + 5) / 2)).padEnd(W_TOKEN - 1)}\x1b[0m ` +
    `\x1b[1;36m│\x1b[0m ` +
    `\x1b[1m${'ENDPOINT'.padStart(Math.floor((W_URL - 1 + 8) / 2)).padEnd(W_URL - 1)}\x1b[0m ` +
    `\x1b[1;36m│\x1b[0m ` +
    `\x1b[1m${'STATUS'.padStart(Math.floor((W_STATUS - 1 + 6) / 2)).padEnd(W_STATUS - 1)}\x1b[0m ` +
    `\x1b[1;36m│\x1b[0m`
  );
  console.log(`  \x1b[1;36m${line}\x1b[0m`);

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const p = allP[name];
    const model = p.ANTHROPIC_MODEL || '?';
    const token = maskToken(p.ANTHROPIC_AUTH_TOKEN || '');
    let url = p.ANTHROPIC_BASE_URL || '?';
    if (url.length > W_URL - 4) url = url.slice(0, W_URL - 7) + '...';

    let status: string;
    let nameDisplay: string;
    if (running.has(name)) {
      status = '\x1b[32m● running\x1b[0m';
      nameDisplay = `\x1b[32m${name}\x1b[0m`;
    } else {
      status = '\x1b[90m○ idle\x1b[0m';
      nameDisplay = `\x1b[1m${name}\x1b[0m`;
    }

    console.log(
      `  \x1b[36m│\x1b[0m ` +
      `${padAnsi(nameDisplay, W_NAME - 1)} ` +
      `\x1b[36m│\x1b[0m ` +
      `${model.padEnd(W_MODEL - 1)} ` +
      `\x1b[36m│\x1b[0m ` +
      `${token.padEnd(W_TOKEN - 1)} ` +
      `\x1b[36m│\x1b[0m ` +
      `${url.padEnd(W_URL - 1)} ` +
      `\x1b[36m│\x1b[0m ` +
      `${padAnsi(status, W_STATUS - 1)} ` +
      `\x1b[36m│\x1b[0m`
    );

    // Model aliases
    const aliases: string[] = [];
    if (p.ANTHROPIC_DEFAULT_HAIKU_MODEL) aliases.push(`haiku=${p.ANTHROPIC_DEFAULT_HAIKU_MODEL}`);
    if (p.ANTHROPIC_DEFAULT_SONNET_MODEL) aliases.push(`sonnet=${p.ANTHROPIC_DEFAULT_SONNET_MODEL}`);
    if (p.ANTHROPIC_DEFAULT_OPUS_MODEL) aliases.push(`opus=${p.ANTHROPIC_DEFAULT_OPUS_MODEL}`);
    if (aliases.length) {
      let aliasStr = aliases.join(', ');
      if (aliasStr.length > totalW - 8) aliasStr = aliasStr.slice(0, totalW - 11) + '...';
      console.log(
        `  \x1b[36m│\x1b[0m  ` +
        `\x1b[90m${aliasStr.padEnd(totalW - 4)}\x1b[0m ` +
        `\x1b[36m│\x1b[0m`
      );
    }

    if (i < names.length - 1) console.log(`  \x1b[36m${line}\x1b[0m`);
  }

  console.log(`  \x1b[1;36m${line}\x1b[0m`);
  const total = names.length;
  const runCount = running.size;
  console.log(`  \x1b[90m${total} profile${total !== 1 ? 's' : ''} total, ${runCount} running\x1b[0m\n`);
}
