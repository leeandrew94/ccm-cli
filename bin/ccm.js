#!/usr/bin/env node

// src/cli.ts
import { readFileSync } from "fs";
import updateNotifier from "update-notifier";

// src/config.ts
import fs from "fs";

// src/constants.ts
import path from "path";
import os from "os";
var CONFIG_DIR = path.join(os.homedir(), ".ccm");
var PROFILES_FILE = path.join(CONFIG_DIR, "profiles.json");
var RUNS_DIR = path.join(CONFIG_DIR, "runs");
var SETTINGS_DIR = path.join(CONFIG_DIR, "settings");
var ANTHROPIC_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL"
];

// src/config.ts
function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.mkdirSync(RUNS_DIR, { recursive: true });
}
function loadProfiles() {
  ensureConfigDir();
  if (!fs.existsSync(PROFILES_FILE)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(PROFILES_FILE, "utf-8"));
    return typeof data === "object" && data !== null ? data : {};
  } catch {
    return {};
  }
}
function saveProfiles(profiles) {
  ensureConfigDir();
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2) + "\n", "utf-8");
}
function getProfile(name) {
  return loadProfiles()[name];
}
function profileExists(name) {
  return name in loadProfiles();
}
function addProfile(name, profile) {
  const profiles = loadProfiles();
  profiles[name] = profile;
  saveProfiles(profiles);
}
function updateProfile(name, profile) {
  const profiles = loadProfiles();
  if (!(name in profiles)) throw new Error(`Profile '${name}' not found`);
  profiles[name] = profile;
  saveProfiles(profiles);
}
function deleteProfile(name) {
  const profiles = loadProfiles();
  if (!(name in profiles)) throw new Error(`Profile '${name}' not found`);
  delete profiles[name];
  saveProfiles(profiles);
}

// src/commands/launch.ts
import fs3 from "fs";
import path3 from "path";
import { spawn } from "child_process";

// src/output.ts
import readline from "readline";
function ok(msg) {
  console.log(`\x1B[32m\u2713\x1B[0m ${msg}`);
}
function err(msg) {
  console.error(`\x1B[31m\u2717\x1B[0m ${msg}`);
}
function info(msg) {
  console.log(`\x1B[34m\u2192\x1B[0m ${msg}`);
}
function warn(msg) {
  console.log(`\x1B[33m!\x1B[0m ${msg}`);
}
async function ask(prompt, defaultValue = "") {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(`  ${prompt}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

// src/process.ts
import fs2 from "fs";
import path2 from "path";
function writeRun(pid, profileName, tty = "") {
  fs2.mkdirSync(RUNS_DIR, { recursive: true });
  if (!tty) {
    try {
      tty = fs2.readlinkSync(`/dev/fd/0`);
    } catch {
      tty = "";
    }
  }
  const data = {
    pid,
    profile: profileName,
    started_at: (/* @__PURE__ */ new Date()).toISOString(),
    tty
  };
  fs2.writeFileSync(path2.join(RUNS_DIR, `${pid}.json`), JSON.stringify(data, null, 2) + "\n", "utf-8");
}
function removeRun(pid) {
  const f = path2.join(RUNS_DIR, `${pid}.json`);
  if (fs2.existsSync(f)) fs2.unlinkSync(f);
}
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function cleanupStaleRuns() {
  if (!fs2.existsSync(RUNS_DIR)) return;
  for (const f of fs2.readdirSync(RUNS_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const pid = parseInt(path2.basename(f, ".json"), 10);
      if (!isAlive(pid)) fs2.unlinkSync(path2.join(RUNS_DIR, f));
    } catch {
    }
  }
}
function getAllRuns() {
  cleanupStaleRuns();
  if (!fs2.existsSync(RUNS_DIR)) return [];
  const runs = [];
  for (const f of fs2.readdirSync(RUNS_DIR).sort()) {
    if (!f.endsWith(".json")) continue;
    try {
      const data = JSON.parse(fs2.readFileSync(path2.join(RUNS_DIR, f), "utf-8"));
      data.uptime = calcUptime(data.started_at || "");
      runs.push(data);
    } catch {
    }
  }
  return runs;
}
function getRunningProfiles() {
  return new Set(getAllRuns().map((r) => r.profile));
}
function findRunByProfile(name) {
  return getAllRuns().find((r) => r.profile === name);
}
function sleep(ms) {
  const sab = new SharedArrayBuffer(4);
  const int32 = new Int32Array(sab);
  Atomics.wait(int32, 0, 0, ms);
}
function killProcess(pid) {
  try {
    process.kill(pid, "SIGTERM");
    sleep(500);
    if (isAlive(pid)) {
      process.kill(pid, "SIGKILL");
      sleep(300);
    }
    removeRun(pid);
    return true;
  } catch {
    removeRun(pid);
    return false;
  }
}
function killByProfile(name) {
  const run = findRunByProfile(name);
  if (!run) return [false, `No running instance found for '${name}'`];
  const pid = run.pid;
  if (killProcess(pid)) return [true, `Killed ${name} (PID ${pid})`];
  return [false, `Failed to kill PID ${pid}`];
}
function killAll() {
  const runs = getAllRuns();
  let success = 0;
  for (const r of runs) {
    if (killProcess(r.pid)) success++;
  }
  return [success, runs.length];
}
function calcUptime(startedAt) {
  if (!startedAt) return "-";
  try {
    const delta = Date.now() - new Date(startedAt).getTime();
    const total = Math.floor(delta / 1e3);
    if (total < 60) return `${total}s`;
    const h = Math.floor(total / 3600);
    const m = Math.floor(total % 3600 / 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  } catch {
    return "-";
  }
}

// src/commands/launch.ts
function whichClaude() {
  const pathDirs = (process.env.PATH || "").split(path3.delimiter);
  for (const dir of pathDirs) {
    const full = path3.join(dir, "claude");
    if (fs3.existsSync(full) && isExecutable(full)) return full;
  }
  return null;
}
function isExecutable(filePath) {
  try {
    fs3.accessSync(filePath, fs3.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function writeSettings(name, profile) {
  fs3.mkdirSync(SETTINGS_DIR, { recursive: true });
  const settings = { env: {} };
  for (const key of ANTHROPIC_KEYS) {
    if (key in profile) settings.env[key] = profile[key];
  }
  const filePath = path3.join(SETTINGS_DIR, `${name}.json`);
  fs3.writeFileSync(filePath, JSON.stringify(settings, null, 2) + "\n");
  return filePath;
}
function cmdLaunch(args) {
  const profile = getProfile(args.name);
  if (!profile) {
    err(`Profile '${args.name}' not found.`);
    process.exit(1);
  }
  if (!whichClaude()) {
    err("claude not found in PATH.");
    info("Install: npm install -g @anthropic-ai/claude-code");
    process.exit(1);
  }
  const settingsPath = writeSettings(args.name, profile);
  writeRun(process.pid, args.name, "");
  info(`Launching claude with profile '${args.name}'...`);
  console.log();
  const child = spawn("claude", ["--settings", settingsPath], {
    stdio: "inherit"
  });
  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}
function cmdConfig(args) {
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
function cmdRegister(args) {
  writeRun(args.pid, args.name, args.tty || "");
}

// src/commands/profile.ts
async function cmdAdd(args) {
  const { name } = args;
  if (profileExists(name)) {
    warn(`Profile '${name}' already exists. Use 'ccm edit' to modify.`);
    return;
  }
  info(`Creating profile '${name}'
`);
  const baseUrl = await ask("Base URL");
  if (!baseUrl) {
    err("Base URL is required.");
    process.exit(1);
  }
  const authToken = await ask("Auth Token");
  if (!authToken) {
    err("Auth Token is required.");
    process.exit(1);
  }
  const model = await ask("Model name");
  if (!model) {
    err("Model name is required.");
    process.exit(1);
  }
  const haiku = await ask("Default Haiku model", "(skip)");
  const sonnet = await ask("Default Sonnet model", "(skip)");
  const opus = await ask("Default Opus model", "(skip)");
  const profile = {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: authToken,
    ANTHROPIC_MODEL: model
  };
  if (haiku && haiku !== "(skip)") profile.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku;
  if (sonnet && sonnet !== "(skip)") profile.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet;
  if (opus && opus !== "(skip)") profile.ANTHROPIC_DEFAULT_OPUS_MODEL = opus;
  addProfile(name, profile);
  ok(`Profile '${name}' saved.`);
}
async function cmdEdit(args) {
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
  info(`Editing '${name}' (Enter = keep current)
`);
  const baseUrl = await ask("Base URL", profile.ANTHROPIC_BASE_URL || "");
  const authToken = await ask("Auth Token", profile.ANTHROPIC_AUTH_TOKEN || "");
  const model = await ask("Model name", profile.ANTHROPIC_MODEL || "");
  const haiku = await ask("Default Haiku model", profile.ANTHROPIC_DEFAULT_HAIKU_MODEL || "");
  const sonnet = await ask("Default Sonnet model", profile.ANTHROPIC_DEFAULT_SONNET_MODEL || "");
  const opus = await ask("Default Opus model", profile.ANTHROPIC_DEFAULT_OPUS_MODEL || "");
  const updated = {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: authToken,
    ANTHROPIC_MODEL: model
  };
  if (haiku) updated.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku;
  if (sonnet) updated.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet;
  if (opus) updated.ANTHROPIC_DEFAULT_OPUS_MODEL = opus;
  updateProfile(name, updated);
  ok(`Profile '${name}' updated.`);
}
async function cmdRm(args) {
  const { name } = args;
  if (!profileExists(name)) {
    err(`Profile '${name}' not found.`);
    process.exit(1);
  }
  const running = getRunningProfiles();
  if (running.has(name)) {
    warn(`Profile '${name}' is currently running.`);
    const answer = await ask("Kill and delete? [y/N]");
    if (answer.toLowerCase() !== "y") {
      info("Cancelled.");
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
function maskToken(token) {
  if (!token) return "?";
  if (token.length <= 16) return token.slice(0, 4) + "****" + token.slice(-4);
  return token.slice(0, 8) + "*".repeat(token.length - 12) + token.slice(-4);
}
function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}
function padAnsi(text, width) {
  const visible = stripAnsi(text).length;
  return text + " ".repeat(Math.max(0, width - visible));
}
function cmdList() {
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
  const line = "\u2500".repeat(totalW);
  console.log();
  console.log(`  \x1B[1;36m${line}\x1B[0m`);
  console.log(
    `  \x1B[1;36m\u2502\x1B[0m \x1B[1m${"PROFILE".padStart(Math.floor((W_NAME - 1 + 7) / 2)).padEnd(W_NAME - 1)}\x1B[0m \x1B[1;36m\u2502\x1B[0m \x1B[1m${"MODEL".padStart(Math.floor((W_MODEL - 1 + 5) / 2)).padEnd(W_MODEL - 1)}\x1B[0m \x1B[1;36m\u2502\x1B[0m \x1B[1m${"TOKEN".padStart(Math.floor((W_TOKEN - 1 + 5) / 2)).padEnd(W_TOKEN - 1)}\x1B[0m \x1B[1;36m\u2502\x1B[0m \x1B[1m${"ENDPOINT".padStart(Math.floor((W_URL - 1 + 8) / 2)).padEnd(W_URL - 1)}\x1B[0m \x1B[1;36m\u2502\x1B[0m \x1B[1m${"STATUS".padStart(Math.floor((W_STATUS - 1 + 6) / 2)).padEnd(W_STATUS - 1)}\x1B[0m \x1B[1;36m\u2502\x1B[0m`
  );
  console.log(`  \x1B[1;36m${line}\x1B[0m`);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const p = allP[name];
    const model = p.ANTHROPIC_MODEL || "?";
    const token = maskToken(p.ANTHROPIC_AUTH_TOKEN || "");
    let url = p.ANTHROPIC_BASE_URL || "?";
    if (url.length > W_URL - 4) url = url.slice(0, W_URL - 7) + "...";
    let status;
    let nameDisplay;
    if (running.has(name)) {
      status = "\x1B[32m\u25CF running\x1B[0m";
      nameDisplay = `\x1B[32m${name}\x1B[0m`;
    } else {
      status = "\x1B[90m\u25CB idle\x1B[0m";
      nameDisplay = `\x1B[1m${name}\x1B[0m`;
    }
    console.log(
      `  \x1B[36m\u2502\x1B[0m ${padAnsi(nameDisplay, W_NAME - 1)} \x1B[36m\u2502\x1B[0m ${model.padEnd(W_MODEL - 1)} \x1B[36m\u2502\x1B[0m ${token.padEnd(W_TOKEN - 1)} \x1B[36m\u2502\x1B[0m ${url.padEnd(W_URL - 1)} \x1B[36m\u2502\x1B[0m ${padAnsi(status, W_STATUS - 1)} \x1B[36m\u2502\x1B[0m`
    );
    const aliases = [];
    if (p.ANTHROPIC_DEFAULT_HAIKU_MODEL) aliases.push(`haiku=${p.ANTHROPIC_DEFAULT_HAIKU_MODEL}`);
    if (p.ANTHROPIC_DEFAULT_SONNET_MODEL) aliases.push(`sonnet=${p.ANTHROPIC_DEFAULT_SONNET_MODEL}`);
    if (p.ANTHROPIC_DEFAULT_OPUS_MODEL) aliases.push(`opus=${p.ANTHROPIC_DEFAULT_OPUS_MODEL}`);
    if (aliases.length) {
      let aliasStr = aliases.join(", ");
      if (aliasStr.length > totalW - 8) aliasStr = aliasStr.slice(0, totalW - 11) + "...";
      console.log(
        `  \x1B[36m\u2502\x1B[0m  \x1B[90m${aliasStr.padEnd(totalW - 4)}\x1B[0m \x1B[36m\u2502\x1B[0m`
      );
    }
    if (i < names.length - 1) console.log(`  \x1B[36m${line}\x1B[0m`);
  }
  console.log(`  \x1B[1;36m${line}\x1B[0m`);
  const total = names.length;
  const runCount = running.size;
  console.log(`  \x1B[90m${total} profile${total !== 1 ? "s" : ""} total, ${runCount} running\x1B[0m
`);
}

// src/commands/runtime.ts
function cmdPs() {
  const runs = getAllRuns();
  if (!runs.length) {
    info("No running instances.");
    return;
  }
  console.log(`
  ${"PID".padEnd(8)} ${"PROFILE".padEnd(15)} ${"TTY".padEnd(20)} ${"UPTIME"}`);
  console.log(`  ${"\u2500".repeat(8)} ${"\u2500".repeat(15)} ${"\u2500".repeat(20)} ${"\u2500".repeat(10)}`);
  for (const r of runs) {
    console.log(
      `  ${String(r.pid).padEnd(8)} ${r.profile.padEnd(15)} ${(r.tty || "-").padEnd(20)} ${r.uptime || "-"}`
    );
  }
  console.log();
}
function cmdKill(args) {
  if (args.all) {
    const [count, total] = killAll();
    if (total === 0) {
      info("No running instances.");
    } else {
      ok(`Killed ${count}/${total} instances.`);
    }
    return;
  }
  if (!args.name) {
    err("Specify a profile name or use --all.");
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
function cmdCheck() {
  const claudePath = whichClaude();
  if (claudePath) {
    ok(`claude found at ${claudePath}`);
  } else {
    err("claude not found in PATH.");
    info("Install: npm install -g @anthropic-ai/claude-code");
    process.exit(1);
  }
}

// src/commands/diagnose.ts
import https from "https";
import http from "http";
function httpRequest(url, token, method = "GET", timeout = 1e4, headers = {}) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const reqHeaders = {
      "Authorization": `Bearer ${token}`,
      "x-api-key": token,
      "Content-Type": "application/json",
      ...headers
    };
    const req = mod.request(url, { method, headers: reqHeaders, timeout }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode || 0, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode || 0, body });
        }
      });
    });
    req.on("error", (e) => {
      resolve({ status: 0, body: {}, error: e.message });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, body: {}, error: "Request timed out" });
    });
    req.end();
  });
}
function isAnthropicCompat(baseUrl) {
  const lower = baseUrl.toLowerCase();
  return lower.includes("/anthropic") || lower.includes("anthropic");
}
async function testConnection(baseUrl, token) {
  const url = baseUrl.replace(/\/+$/, "");
  if (isAnthropicCompat(baseUrl)) {
    const result = await httpRequest(`${url}/v1/messages`, token, "POST", 1e4, {
      "anthropic-version": "2023-06-01"
    });
    if (result.status === 200 || result.status === 400) return { ok: true, endpoint: "/v1/messages" };
    if (result.status === 401 || result.status === 403) return { ok: false, error: "Authentication failed (invalid token)" };
    return { ok: false, error: result.error || `HTTP ${result.status}` };
  }
  for (const endpoint of ["/v1/models", "/models"]) {
    const result = await httpRequest(`${url}${endpoint}`, token);
    if (result.status === 200) return { ok: true, endpoint };
    if (result.status === 401 || result.status === 403) return { ok: false, error: "Authentication failed (invalid token)" };
  }
  try {
    const baseParts = url.split("//");
    const hostUrl = `${baseParts[0]}//${baseParts[1].split("/")[0]}/`;
    const result = await httpRequest(hostUrl, token);
    if (result.status > 0) return { ok: true, endpoint: "(host reachable)" };
  } catch {
  }
  return { ok: false, error: `HTTP connection failed` };
}
async function queryBalance(baseUrl, token) {
  let url = baseUrl.replace(/\/+$/, "");
  for (const suffix of ["/anthropic", "/v1/chat/completions", "/v1"]) {
    if (url.endsWith(suffix)) url = url.slice(0, -suffix.length);
  }
  const endpoints = [
    `${url}/user/balance`,
    `${url}/v1/user/balance`,
    `${url}/dashboard/billing/usage`,
    `${url}/api/user/balance`,
    `${url}/billing/usage`,
    `${url}/v1/dashboard/billing/usage`
  ];
  for (const ep of endpoints) {
    const result = await httpRequest(ep, token);
    if (result.status === 200) return result.body;
  }
  return null;
}
function stripAnsi2(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}
function fmtAmount(value, currency = "") {
  let formatted;
  const num = parseFloat(value);
  if (!isNaN(num)) {
    formatted = Number.isInteger(num) ? num.toLocaleString() : num.toLocaleString(void 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else {
    formatted = String(value);
  }
  return currency ? `${formatted} ${currency}` : formatted;
}
function bar(ratio, width = 16) {
  const filled = Math.max(0, Math.min(width, Math.floor(ratio * width)));
  const empty = width - filled;
  let color;
  if (ratio > 0.8) color = "\x1B[31m";
  else if (ratio > 0.5) color = "\x1B[33m";
  else color = "\x1B[32m";
  return `${color}${"\u2588".repeat(filled)}\x1B[90m${"\u2591".repeat(empty)}\x1B[0m`;
}
function formatBalanceCell(data, statusWidth) {
  const currency = data.currency || "";
  if ("balance" in data && (typeof data.balance === "string" || typeof data.balance === "number")) {
    const bal = fmtAmount(data.balance, currency);
    return [`\x1B[1;32m${bal}\x1B[0m`, "\x1B[32m\u25CF active\x1B[0m"];
  }
  if ("balance_infos" in data && Array.isArray(data.balance_infos)) {
    for (const info2 of data.balance_infos) {
      const cur = info2.currency || currency;
      const balance = info2.balance || info2.total_balance || "";
      const granted = info2.total_granted || "";
      const used = info2.total_used || "";
      const parts = [];
      if (balance) parts.push(`\x1B[1;32m${fmtAmount(balance, cur)}\x1B[0m`);
      const balanceStr = parts.length ? parts.join(" ") : "\x1B[90m\u2014\x1B[0m";
      let statusStr;
      if (granted && used) {
        try {
          const ratio = parseFloat(used) / parseFloat(granted);
          const pct = ratio * 100;
          const barStr = bar(ratio, 12);
          statusStr = `${barStr} ${pct.toFixed(0)}% used`;
        } catch {
          statusStr = "\x1B[32m\u25CF active\x1B[0m";
        }
      } else if (data.is_available) {
        statusStr = "\x1B[32m\u25CF active\x1B[0m";
      } else {
        statusStr = "\x1B[31m\u25CF inactive\x1B[0m";
      }
      return [balanceStr, statusStr];
    }
    return ["\x1B[90m\u2014\x1B[0m", "\x1B[90mno data\x1B[0m"];
  }
  if ("total_available" in data) {
    const bal = fmtAmount(data.total_available, currency);
    return [`\x1B[1;32m${bal}\x1B[0m`, "\x1B[32m\u25CF active\x1B[0m"];
  }
  if ("data" in data && typeof data.data === "object" && data.data !== null) {
    const d = data.data;
    const granted = d.total_granted;
    const used = d.total_used;
    const available = d.total_available || d.total_remain;
    let balanceStr;
    if (available != null) {
      balanceStr = `\x1B[1;32m${fmtAmount(available, currency)}\x1B[0m`;
    } else if (granted != null) {
      balanceStr = `\x1B[1m${fmtAmount(granted, currency)}\x1B[0m`;
    } else {
      balanceStr = "\x1B[90m\u2014\x1B[0m";
    }
    let statusStr;
    if (granted != null && used != null) {
      try {
        const ratio = parseFloat(used) / parseFloat(granted);
        const pct = ratio * 100;
        const barStr = bar(ratio, 12);
        statusStr = `${barStr} ${pct.toFixed(0)}% used`;
      } catch {
        statusStr = "\x1B[32m\u25CF active\x1B[0m";
      }
    } else {
      statusStr = "\x1B[32m\u25CF active\x1B[0m";
    }
    return [balanceStr, statusStr];
  }
  let raw = JSON.stringify(data);
  if (raw.length > statusWidth - 6) raw = raw.slice(0, statusWidth - 9) + "...";
  return ["\x1B[90m\u2014\x1B[0m", `\x1B[90m${raw}\x1B[0m`];
}
async function cmdTest(args) {
  const names = args.name ? [args.name] : Object.keys(loadProfiles()).sort();
  if (!names.length) {
    info("No profiles configured.");
    return;
  }
  console.log();
  for (const name of names) {
    const profile = getProfile(name);
    if (!profile) {
      err(`Profile '${name}' not found.`);
      continue;
    }
    const baseUrl = profile.ANTHROPIC_BASE_URL || "";
    const token = profile.ANTHROPIC_AUTH_TOKEN || "";
    const model = profile.ANTHROPIC_MODEL || "?";
    console.log(`  \x1B[1m${name}\x1B[0m (${model})`);
    if (!baseUrl || !token) {
      err("  Missing base URL or token");
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
async function cmdBalance(args) {
  const names = args.name ? [args.name] : Object.keys(loadProfiles()).sort();
  if (!names.length) {
    info("No profiles configured.");
    return;
  }
  const W_NAME = 16;
  const W_MODEL = 22;
  const W_BALANCE = 20;
  const W_STATUS = 36;
  const totalW = W_NAME + W_MODEL + W_BALANCE + W_STATUS + 10;
  const line = "\u2500".repeat(totalW);
  console.log();
  console.log(`  \x1B[1;36m${line}\x1B[0m`);
  console.log(
    `  \x1B[1;36m\u2502\x1B[0m \x1B[1m${"PROFILE".padStart(Math.floor((W_NAME - 1 + 7) / 2)).padEnd(W_NAME - 1)}\x1B[0m \x1B[1;36m\u2502\x1B[0m \x1B[1m${"MODEL".padStart(Math.floor((W_MODEL - 1 + 5) / 2)).padEnd(W_MODEL - 1)}\x1B[0m \x1B[1;36m\u2502\x1B[0m \x1B[1m${"BALANCE".padStart(Math.floor((W_BALANCE - 1 + 7) / 2)).padEnd(W_BALANCE - 1)}\x1B[0m \x1B[1;36m\u2502\x1B[0m \x1B[1m${"STATUS".padStart(Math.floor((W_STATUS - 1 + 6) / 2)).padEnd(W_STATUS - 1)}\x1B[0m \x1B[1;36m\u2502\x1B[0m`
  );
  console.log(`  \x1B[1;36m${line}\x1B[0m`);
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const profile = getProfile(name);
    if (!profile) {
      err(`  Profile '${name}' not found.`);
      continue;
    }
    const baseUrl = profile.ANTHROPIC_BASE_URL || "";
    const token = profile.ANTHROPIC_AUTH_TOKEN || "";
    let model = profile.ANTHROPIC_MODEL || "?";
    if (model.length > W_MODEL - 4) model = model.slice(0, W_MODEL - 7) + "...";
    let balanceStr;
    let statusStr;
    if (!baseUrl || !token) {
      balanceStr = "\x1B[31m\u2014\x1B[0m";
      statusStr = "\x1B[31mmissing credentials\x1B[0m";
    } else {
      const balanceData = await queryBalance(baseUrl, token);
      if (balanceData === null) {
        balanceStr = "\x1B[90m\u2014\x1B[0m";
        statusStr = "\x1B[90mapi not available\x1B[0m";
      } else {
        [balanceStr, statusStr] = formatBalanceCell(balanceData, W_STATUS);
      }
    }
    console.log(
      `  \x1B[36m\u2502\x1B[0m \x1B[1m${name.padEnd(W_NAME - 1)}\x1B[0m \x1B[36m\u2502\x1B[0m ${model.padEnd(W_MODEL - 1)} \x1B[36m\u2502\x1B[0m ${padAnsi2(balanceStr, W_BALANCE - 1)} \x1B[36m\u2502\x1B[0m ${padAnsi2(statusStr, W_STATUS - 1)} \x1B[36m\u2502\x1B[0m`
    );
    if (i < names.length - 1) console.log(`  \x1B[36m${line}\x1B[0m`);
  }
  console.log(`  \x1B[1;36m${line}\x1B[0m
`);
}
function padAnsi2(text, width) {
  const visible = stripAnsi2(text).length;
  return text + " ".repeat(Math.max(0, width - visible));
}

// src/completions.ts
var COMMANDS = ["add", "edit", "rm", "list", "ls", "ps", "kill", "check", "test", "balance", "bal", "config", "completions"];
function cmdCompletions(args) {
  const shell = args.shell || detectShell();
  if (shell === "zsh") {
    console.log(ZSH_COMPLETION);
  } else if (shell === "bash") {
    console.log(BASH_COMPLETION);
  } else {
    console.error(`Unsupported shell: ${shell}. Use 'bash' or 'zsh'.`);
    process.exit(1);
  }
}
function detectShell() {
  const shell = process.env.SHELL || "";
  if (shell.includes("zsh")) return "zsh";
  if (shell.includes("bash")) return "bash";
  return "zsh";
}
var ZSH_COMPLETION = `#compdef ccm

_ccm() {
  local -a commands profiles
  commands=(${COMMANDS.join(" ")})
  profiles=("\${(@f)$(ccm list 2>/dev/null | grep -E '^\\s*\u2502' | grep -v 'PROFILE' | grep -v '\u2500' | awk '{print $2}')}")
  _arguments "1: :(\${commands} \${profiles})" "2: :(\${profiles})"
}

_ccm "$@"`;
var BASH_COMPLETION = `_ccm_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"

  if [ "$COMP_CWORD" -eq 1 ]; then
    local commands="${COMMANDS.join(" ")}"
    local profiles
    profiles=$(ccm list 2>/dev/null | grep -E '^\\s*\u2502' | grep -v 'PROFILE' | grep -v '\u2500' | awk '{print $2}' | tr '\\n' ' ')
    COMPREPLY=($(compgen -W "$commands $profiles" -- "$cur"))
  elif [ "$COMP_CWORD" -eq 2 ]; then
    case "$prev" in
      edit|rm|kill)
        local profiles
        profiles=$(ccm list 2>/dev/null | grep -E '^\\s*\u2502' | grep -v 'PROFILE' | grep -v '\u2500' | awk '{print $2}' | tr '\\n' ' ')
        COMPREPLY=($(compgen -W "$profiles" -- "$cur"))
        ;;
    esac
  fi
}

complete -F _ccm_completions ccm`;

// src/cli.ts
var pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
var VERSION = pkg.version;
var KNOWN_COMMANDS = /* @__PURE__ */ new Set([
  "_launch",
  "_register",
  "add",
  "edit",
  "rm",
  "list",
  "ls",
  "ps",
  "kill",
  "check",
  "test",
  "balance",
  "bal",
  "config",
  "completions"
]);
function printHelp() {
  console.log(`
Usage: ccm <command> [options]

Commands:
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

Options:
  -v, --version     Show version
  -h, --help        Show help

Shortcuts:
  ccm <profile>     Launch claude with the named profile
`);
}
function parseArgs(argv) {
  const args = { _: [] };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--all") {
      args.all = true;
    } else if (arg.startsWith("-")) {
    } else {
      args._.push(arg);
    }
    i++;
  }
  const command = args._[0] || "";
  const positional = args._.slice(1);
  if (positional.length > 0) {
    if (["_launch", "add", "edit", "rm", "config"].includes(command)) {
      args.name = positional[0];
    } else if (command === "_register") {
      args.name = positional[0];
      args.pid = parseInt(positional[1], 10);
    } else if (["test", "balance", "bal", "kill"].includes(command)) {
      args.name = positional[0];
    } else if (command === "completions") {
      args.shell = positional[0];
    }
  }
  return { command, args };
}
async function main() {
  updateNotifier({ pkg }).notify();
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes("-v") || rawArgs.includes("--version")) {
    console.log(`ccm ${VERSION}`);
    return;
  }
  if (rawArgs.includes("-h") || rawArgs.includes("--help") || rawArgs.length === 0) {
    printHelp();
    return;
  }
  const firstArg = rawArgs[0];
  if (firstArg && !KNOWN_COMMANDS.has(firstArg) && !firstArg.startsWith("-")) {
    if (profileExists(firstArg)) {
      cmdLaunch({ name: firstArg });
      return;
    }
  }
  const { command, args } = parseArgs(rawArgs);
  switch (command) {
    case "_launch":
      cmdLaunch({ name: args.name });
      break;
    case "_register":
      cmdRegister({ name: args.name, pid: args.pid, tty: args.tty });
      break;
    case "add":
      await cmdAdd({ name: args.name });
      break;
    case "edit":
      await cmdEdit({ name: args.name });
      break;
    case "rm":
      await cmdRm({ name: args.name });
      break;
    case "list":
    case "ls":
      cmdList();
      break;
    case "ps":
      cmdPs();
      break;
    case "kill":
      cmdKill({ name: args.name, all: args.all });
      break;
    case "check":
      cmdCheck();
      break;
    case "test":
      await cmdTest({ name: args.name });
      break;
    case "balance":
    case "bal":
      await cmdBalance({ name: args.name });
      break;
    case "config":
      cmdConfig({ name: args.name });
      break;
    case "completions":
      cmdCompletions({ shell: args.shell });
      break;
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
