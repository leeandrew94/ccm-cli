import https from 'node:https';
import http from 'node:http';
import { getProfile, loadProfiles } from '../config.js';
import { err, info, ok } from '../output.js';

interface RequestResult {
  status: number;
  body: any;
  error?: string;
}

function httpRequest(url: string, token: string, method = 'GET', timeout = 10000, headers: Record<string, string> = {}): Promise<RequestResult> {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const reqHeaders: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'x-api-key': token,
      'Content-Type': 'application/json',
      ...headers,
    };

    const req = mod.request(url, { method, headers: reqHeaders, timeout }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 0, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode || 0, body });
        }
      });
    });

    req.on('error', (e) => {
      resolve({ status: 0, body: {}, error: e.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, body: {}, error: 'Request timed out' });
    });

    req.end();
  });
}

function isAnthropicCompat(baseUrl: string): boolean {
  const lower = baseUrl.toLowerCase();
  return lower.includes('/anthropic') || lower.includes('anthropic');
}

async function testConnection(baseUrl: string, token: string): Promise<{ ok: boolean; endpoint?: string; error?: string }> {
  const url = baseUrl.replace(/\/+$/, '');

  if (isAnthropicCompat(baseUrl)) {
    const result = await httpRequest(`${url}/v1/messages`, token, 'POST', 10000, {
      'anthropic-version': '2023-06-01',
    });
    if (result.status === 200 || result.status === 400) return { ok: true, endpoint: '/v1/messages' };
    if (result.status === 401 || result.status === 403) return { ok: false, error: 'Authentication failed (invalid token)' };
    return { ok: false, error: result.error || `HTTP ${result.status}` };
  }

  for (const endpoint of ['/v1/models', '/models']) {
    const result = await httpRequest(`${url}${endpoint}`, token);
    if (result.status === 200) return { ok: true, endpoint };
    if (result.status === 401 || result.status === 403) return { ok: false, error: 'Authentication failed (invalid token)' };
  }

  // Fallback: check host reachability
  try {
    const baseParts = url.split('//');
    const hostUrl = `${baseParts[0]}//${baseParts[1].split('/')[0]}/`;
    const result = await httpRequest(hostUrl, token);
    if (result.status > 0) return { ok: true, endpoint: '(host reachable)' };
  } catch { /* ignore */ }

  return { ok: false, error: `HTTP connection failed` };
}

async function queryBalance(baseUrl: string, token: string): Promise<any | null> {
  let url = baseUrl.replace(/\/+$/, '');
  for (const suffix of ['/anthropic', '/v1/chat/completions', '/v1']) {
    if (url.endsWith(suffix)) url = url.slice(0, -suffix.length);
  }

  const endpoints = [
    `${url}/user/balance`,
    `${url}/v1/user/balance`,
    `${url}/dashboard/billing/usage`,
    `${url}/api/user/balance`,
    `${url}/billing/usage`,
    `${url}/v1/dashboard/billing/usage`,
  ];

  for (const ep of endpoints) {
    const result = await httpRequest(ep, token);
    if (result.status === 200) return result.body;
  }
  return null;
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function fmtAmount(value: any, currency = ''): string {
  let formatted: string;
  const num = parseFloat(value);
  if (!isNaN(num)) {
    formatted = Number.isInteger(num) ? num.toLocaleString() : num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else {
    formatted = String(value);
  }
  return currency ? `${formatted} ${currency}` : formatted;
}

function bar(ratio: number, width = 16): string {
  const filled = Math.max(0, Math.min(width, Math.floor(ratio * width)));
  const empty = width - filled;
  let color: string;
  if (ratio > 0.8) color = '\x1b[31m';
  else if (ratio > 0.5) color = '\x1b[33m';
  else color = '\x1b[32m';
  return `${color}${'█'.repeat(filled)}\x1b[90m${'░'.repeat(empty)}\x1b[0m`;
}

function formatBalanceCell(data: any, statusWidth: number): [string, string] {
  const currency = data.currency || '';

  // DeepSeek format
  if ('balance' in data && (typeof data.balance === 'string' || typeof data.balance === 'number')) {
    const bal = fmtAmount(data.balance, currency);
    return [`\x1b[1;32m${bal}\x1b[0m`, '\x1b[32m● active\x1b[0m'];
  }

  // DeepSeek format v2
  if ('balance_infos' in data && Array.isArray(data.balance_infos)) {
    for (const info of data.balance_infos) {
      const cur = info.currency || currency;
      const balance = info.balance || info.total_balance || '';
      const granted = info.total_granted || '';
      const used = info.total_used || '';

      const parts: string[] = [];
      if (balance) parts.push(`\x1b[1;32m${fmtAmount(balance, cur)}\x1b[0m`);
      const balanceStr = parts.length ? parts.join(' ') : '\x1b[90m—\x1b[0m';

      let statusStr: string;
      if (granted && used) {
        try {
          const ratio = parseFloat(used) / parseFloat(granted);
          const pct = ratio * 100;
          const barStr = bar(ratio, 12);
          statusStr = `${barStr} ${pct.toFixed(0)}% used`;
        } catch {
          statusStr = '\x1b[32m● active\x1b[0m';
        }
      } else if (data.is_available) {
        statusStr = '\x1b[32m● active\x1b[0m';
      } else {
        statusStr = '\x1b[31m● inactive\x1b[0m';
      }
      return [balanceStr, statusStr];
    }
    return ['\x1b[90m—\x1b[0m', '\x1b[90mno data\x1b[0m'];
  }

  // OpenAI format
  if ('total_available' in data) {
    const bal = fmtAmount(data.total_available, currency);
    return [`\x1b[1;32m${bal}\x1b[0m`, '\x1b[32m● active\x1b[0m'];
  }

  // Wrapped format
  if ('data' in data && typeof data.data === 'object' && data.data !== null) {
    const d = data.data;
    const granted = d.total_granted;
    const used = d.total_used;
    const available = d.total_available || d.total_remain;

    let balanceStr: string;
    if (available != null) {
      balanceStr = `\x1b[1;32m${fmtAmount(available, currency)}\x1b[0m`;
    } else if (granted != null) {
      balanceStr = `\x1b[1m${fmtAmount(granted, currency)}\x1b[0m`;
    } else {
      balanceStr = '\x1b[90m—\x1b[0m';
    }

    let statusStr: string;
    if (granted != null && used != null) {
      try {
        const ratio = parseFloat(used) / parseFloat(granted);
        const pct = ratio * 100;
        const barStr = bar(ratio, 12);
        statusStr = `${barStr} ${pct.toFixed(0)}% used`;
      } catch {
        statusStr = '\x1b[32m● active\x1b[0m';
      }
    } else {
      statusStr = '\x1b[32m● active\x1b[0m';
    }
    return [balanceStr, statusStr];
  }

  // Unknown format
  let raw = JSON.stringify(data);
  if (raw.length > statusWidth - 6) raw = raw.slice(0, statusWidth - 9) + '...';
  return ['\x1b[90m—\x1b[0m', `\x1b[90m${raw}\x1b[0m`];
}

export async function cmdTest(args: { name?: string }): Promise<void> {
  const names = args.name ? [args.name] : Object.keys(loadProfiles()).sort();
  if (!names.length) {
    info('No profiles configured.');
    return;
  }

  console.log();
  for (const name of names) {
    const profile = getProfile(name);
    if (!profile) {
      err(`Profile '${name}' not found.`);
      continue;
    }

    const baseUrl = profile.ANTHROPIC_BASE_URL || '';
    const token = profile.ANTHROPIC_AUTH_TOKEN || '';
    const model = profile.ANTHROPIC_MODEL || '?';

    console.log(`  \x1b[1m${name}\x1b[0m (${model})`);

    if (!baseUrl || !token) {
      err('  Missing base URL or token');
      console.log();
      continue;
    }

    const result = await testConnection(baseUrl, token);
    if (result.ok) {
      ok(`  Connected via ${result.endpoint}`);
    } else {
      err(`  Failed: ${result.error}`);
    }
    console.log();
  }
}

export async function cmdBalance(args: { name?: string }): Promise<void> {
  const names = args.name ? [args.name] : Object.keys(loadProfiles()).sort();
  if (!names.length) {
    info('No profiles configured.');
    return;
  }

  const W_NAME = 16;
  const W_MODEL = 22;
  const W_BALANCE = 20;
  const W_STATUS = 36;
  const totalW = W_NAME + W_MODEL + W_BALANCE + W_STATUS + 10;
  const line = '─'.repeat(totalW);

  console.log();
  console.log(`  \x1b[1;36m${line}\x1b[0m`);
  console.log(
    `  \x1b[1;36m│\x1b[0m ` +
    `\x1b[1m${'PROFILE'.padStart(Math.floor((W_NAME - 1 + 7) / 2)).padEnd(W_NAME - 1)}\x1b[0m ` +
    `\x1b[1;36m│\x1b[0m ` +
    `\x1b[1m${'MODEL'.padStart(Math.floor((W_MODEL - 1 + 5) / 2)).padEnd(W_MODEL - 1)}\x1b[0m ` +
    `\x1b[1;36m│\x1b[0m ` +
    `\x1b[1m${'BALANCE'.padStart(Math.floor((W_BALANCE - 1 + 7) / 2)).padEnd(W_BALANCE - 1)}\x1b[0m ` +
    `\x1b[1;36m│\x1b[0m ` +
    `\x1b[1m${'STATUS'.padStart(Math.floor((W_STATUS - 1 + 6) / 2)).padEnd(W_STATUS - 1)}\x1b[0m ` +
    `\x1b[1;36m│\x1b[0m`
  );
  console.log(`  \x1b[1;36m${line}\x1b[0m`);

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const profile = getProfile(name);
    if (!profile) {
      err(`  Profile '${name}' not found.`);
      continue;
    }

    const baseUrl = profile.ANTHROPIC_BASE_URL || '';
    const token = profile.ANTHROPIC_AUTH_TOKEN || '';
    let model = profile.ANTHROPIC_MODEL || '?';
    if (model.length > W_MODEL - 4) model = model.slice(0, W_MODEL - 7) + '...';

    let balanceStr: string;
    let statusStr: string;

    if (!baseUrl || !token) {
      balanceStr = '\x1b[31m—\x1b[0m';
      statusStr = '\x1b[31mmissing credentials\x1b[0m';
    } else {
      const balanceData = await queryBalance(baseUrl, token);
      if (balanceData === null) {
        balanceStr = '\x1b[90m—\x1b[0m';
        statusStr = '\x1b[90mapi not available\x1b[0m';
      } else {
        [balanceStr, statusStr] = formatBalanceCell(balanceData, W_STATUS);
      }
    }

    console.log(
      `  \x1b[36m│\x1b[0m ` +
      `\x1b[1m${name.padEnd(W_NAME - 1)}\x1b[0m ` +
      `\x1b[36m│\x1b[0m ` +
      `${model.padEnd(W_MODEL - 1)} ` +
      `\x1b[36m│\x1b[0m ` +
      `${padAnsi(balanceStr, W_BALANCE - 1)} ` +
      `\x1b[36m│\x1b[0m ` +
      `${padAnsi(statusStr, W_STATUS - 1)} ` +
      `\x1b[36m│\x1b[0m`
    );

    if (i < names.length - 1) console.log(`  \x1b[36m${line}\x1b[0m`);
  }

  console.log(`  \x1b[1;36m${line}\x1b[0m\n`);
}

function padAnsi(text: string, width: number): string {
  const visible = stripAnsi(text).length;
  return text + ' '.repeat(Math.max(0, width - visible));
}
