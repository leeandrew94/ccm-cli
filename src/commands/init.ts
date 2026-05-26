import https from 'node:https';
import http from 'node:http';
import readline from 'node:readline';
import { whichClaude } from './launch.js';
import { addProfile, profileExists } from '../config.js';
import { err, info, ok, warn } from '../output.js';
import { ask } from '../output.js';

function httpRequest(url: string, token: string, timeout = 8000): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 0, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode || 0, body }); }
      });
    });
    req.on('error', () => resolve({ status: 0, body: {} }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: {} }); });
    req.end();
  });
}

async function fetchModels(baseUrl: string, token: string): Promise<string[]> {
  const url = baseUrl.replace(/\/+$/, '');
  for (const suffix of ['/anthropic', '/v1/chat/completions']) {
    if (url.endsWith(suffix)) return [];
  }

  const endpoints = [`${url}/models`, `${url}/v1/models`];
  for (const ep of endpoints) {
    const result = await httpRequest(ep, token);
    if (result.status === 200 && result.body) {
      const data = result.body.data || result.body.models;
      if (Array.isArray(data)) {
        return data.map((m: any) => m.id || m.name).filter(Boolean).sort();
      }
    }
  }
  return [];
}

async function selectModel(models: string[], label: string): Promise<string> {
  if (models.length === 0) {
    return await ask('Model name');
  }

  console.log(`\n  \x1b[1m${label}\x1b[0m (↑↓ navigate, Enter to select):\n`);

  const PAGE = 12;
  let offset = 0;
  let selected = 0;

  function render() {
    process.stdout.write('\x1b[?25l'); // hide cursor
    const start = offset;
    const end = Math.min(offset + PAGE, models.length);

    for (let i = start; i < end; i++) {
      process.stdout.write('\x1b[2K'); // clear line
      if (i === selected) {
        console.log(`  \x1b[36m❯\x1b[0m \x1b[1m${models[i]}\x1b[0m`);
      } else {
        console.log(`    \x1b[90m${models[i]}\x1b[0m`);
      }
    }

    // pagination info
    process.stdout.write('\x1b[2K');
    if (models.length > PAGE) {
      console.log(`  \x1b[90m${selected + 1}/${models.length} — ↑↓ scroll, Enter select\x1b[0m`);
    }

    // move cursor back up
    const lines = end - start + (models.length > PAGE ? 1 : 0);
    process.stdout.write(`\x1b[${lines}A`);
  }

  return new Promise((resolve) => {
    process.stdin.setRawMode!(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    render();

    let buf = '';
    process.stdin.on('data', function onData(key: string) {
      if (key === '\x1b[A') { // up
        selected = Math.max(0, selected - 1);
        if (selected < offset) offset = selected;
        render();
      } else if (key === '\x1b[B') { // down
        selected = Math.min(models.length - 1, selected + 1);
        if (selected >= offset + PAGE) offset = selected - PAGE + 1;
        render();
      } else if (key === '\r' || key === '\n') { // enter
        // clear rendered lines
        const lines = Math.min(PAGE, models.length - offset) + (models.length > PAGE ? 1 : 0);
        for (let i = 0; i < lines; i++) {
          process.stdout.write('\x1b[2K\n');
        }
        process.stdout.write(`\x1b[${lines}A`);
        for (let i = 0; i < lines; i++) {
          process.stdout.write('\x1b[2K\n');
        }
        process.stdout.write(`\x1b[${lines}A`);
        process.stdout.write(`  \x1b[36m❯\x1b[0m \x1b[1m${models[selected]}\x1b[0m\n`);
        process.stdout.write('\x1b[?25h'); // show cursor
        process.stdin.setRawMode!(false);
        process.stdin.removeListener('data', onData);
        process.stdin.pause();
        resolve(models[selected]);
      } else if (key === '\x03') { // ctrl-c
        process.stdout.write('\x1b[?25h');
        process.exit(0);
      }
    });
  });
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return url;
  }
}

export async function cmdInit(): Promise<void> {
  console.log();
  console.log('  \x1b[1;36m┌──────────────────────────────────────────┐\x1b[0m');
  console.log('  \x1b[1;36m│\x1b[0m  ccm - Claude Code Model Manager         \x1b[1;36m│\x1b[0m');
  console.log('  \x1b[1;36m│\x1b[0m  \x1b[90mSet up your model profile\x1b[0m                \x1b[1;36m│\x1b[0m');
  console.log('  \x1b[1;36m└──────────────────────────────────────────┘\x1b[0m');
  console.log();

  // Check Claude Code
  if (!whichClaude()) {
    warn('Claude Code is not installed.');
    info('Install it first: npm install -g @anthropic-ai/claude-code\n');
    const proceed = await ask('Continue anyway? [y/N]');
    if (proceed.toLowerCase() !== 'y') return;
  }

  // Step 1: URL
  const baseUrl = await ask('API Base URL (*)');
  if (!baseUrl) { err('Base URL is required.'); return; }

  // Step 2: Key
  const token = await ask('API Key (*)');
  if (!token) { err('API Key is required.'); return; }

  // Step 3: Validate + fetch models
  console.log();
  info('Validating connection...');

  const isAnthropic = baseUrl.toLowerCase().includes('anthropic');

  // For Anthropic, skip model list fetching (no public endpoint)
  let models: string[] = [];
  if (!isAnthropic) {
    models = await fetchModels(baseUrl, token);
    if (models.length > 0) {
      ok(`Found \x1b[1m${models.length}\x1b[0m models`);
    } else {
      info('Could not fetch model list (enter manually)');
    }
  }

  // Step 4: Select model
  let model: string;
  if (isAnthropic) {
    // Anthropic built-in models
    const anthropicModels = [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-haiku-4-20250501',
    ];
    model = await selectModel(anthropicModels, 'Select a model');
  } else if (models.length > 0) {
    model = await selectModel(models, 'Select a model');
  } else {
    model = await ask('Model name (*)');
    if (!model) { err('Model name is required.'); return; }
  }

  // Step 5: Optional model mappings
  console.log();
  info('Optional: model mappings for Haiku/Sonnet/Opus (Enter to skip)\n');
  const haiku = await ask('Haiku model');
  const sonnet = await ask('Sonnet model');
  const opus = await ask('Opus model');

  // Step 6: Profile name
  console.log();
  const name = await ask('Profile name (*)');
  if (!name) { err('Profile name is required.'); return; }

  if (profileExists(name)) {
    warn(`Profile '${name}' already exists.`);
    const overwrite = await ask('Overwrite? [y/N]');
    if (overwrite.toLowerCase() !== 'y') { info('Cancelled.'); return; }
  }

  // Save
  const profile: Record<string, string> = {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: token,
    ANTHROPIC_MODEL: model,
  };
  if (haiku) profile.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku;
  if (sonnet) profile.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet;
  if (opus) profile.ANTHROPIC_DEFAULT_OPUS_MODEL = opus;

  addProfile(name, profile as any);

  console.log();
  ok(`Profile '\x1b[1m${name}\x1b[0m' saved!\n`);
  console.log(`  \x1b[36mccm ${name}\x1b[0m          launch with this profile`);
  console.log(`  \x1b[36mccm edit ${name}\x1b[0m      edit configuration`);
  console.log(`  \x1b[36mccm test ${name}\x1b[0m      test connection`);
  console.log(`  \x1b[36mccm balance ${name}\x1b[0m   check credits`);
  console.log();
}
