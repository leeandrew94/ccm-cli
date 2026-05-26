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
  const child = spawn("claude", ["--settings", settingsPath, ...args.extraArgs || []], {
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

// src/commands/init.ts
import https from "https";
import http from "http";
function httpRequest(url, token, timeout = 8e3) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const req = mod.request(url, {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      timeout
    }, (res) => {
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
    req.on("error", () => resolve({ status: 0, body: {} }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, body: {} });
    });
    req.end();
  });
}
async function fetchModels(baseUrl, token) {
  const url = baseUrl.replace(/\/+$/, "");
  for (const suffix of ["/anthropic", "/v1/chat/completions"]) {
    if (url.endsWith(suffix)) return [];
  }
  const endpoints = [`${url}/models`, `${url}/v1/models`];
  for (const ep of endpoints) {
    const result = await httpRequest(ep, token);
    if (result.status === 200 && result.body) {
      const data = result.body.data || result.body.models;
      if (Array.isArray(data)) {
        return data.map((m) => m.id || m.name).filter(Boolean).sort();
      }
    }
  }
  return [];
}
async function selectModel(models, label) {
  if (models.length === 0) {
    return await ask("Model name");
  }
  console.log(`
  \x1B[1m${label}\x1B[0m (\u2191\u2193 navigate, Enter to select):
`);
  const PAGE = 12;
  let offset = 0;
  let selected = 0;
  function render() {
    process.stdout.write("\x1B[?25l");
    const start = offset;
    const end = Math.min(offset + PAGE, models.length);
    for (let i = start; i < end; i++) {
      process.stdout.write("\x1B[2K");
      if (i === selected) {
        console.log(`  \x1B[36m\u276F\x1B[0m \x1B[1m${models[i]}\x1B[0m`);
      } else {
        console.log(`    \x1B[90m${models[i]}\x1B[0m`);
      }
    }
    process.stdout.write("\x1B[2K");
    if (models.length > PAGE) {
      console.log(`  \x1B[90m${selected + 1}/${models.length} \u2014 \u2191\u2193 scroll, Enter select\x1B[0m`);
    }
    const lines = end - start + (models.length > PAGE ? 1 : 0);
    process.stdout.write(`\x1B[${lines}A`);
  }
  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    render();
    let buf = "";
    process.stdin.on("data", function onData(key) {
      if (key === "\x1B[A") {
        selected = Math.max(0, selected - 1);
        if (selected < offset) offset = selected;
        render();
      } else if (key === "\x1B[B") {
        selected = Math.min(models.length - 1, selected + 1);
        if (selected >= offset + PAGE) offset = selected - PAGE + 1;
        render();
      } else if (key === "\r" || key === "\n") {
        const lines = Math.min(PAGE, models.length - offset) + (models.length > PAGE ? 1 : 0);
        for (let i = 0; i < lines; i++) {
          process.stdout.write("\x1B[2K\n");
        }
        process.stdout.write(`\x1B[${lines}A`);
        for (let i = 0; i < lines; i++) {
          process.stdout.write("\x1B[2K\n");
        }
        process.stdout.write(`\x1B[${lines}A`);
        process.stdout.write(`  \x1B[36m\u276F\x1B[0m \x1B[1m${models[selected]}\x1B[0m
`);
        process.stdout.write("\x1B[?25h");
        process.stdin.setRawMode(false);
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        resolve(models[selected]);
      } else if (key === "") {
        process.stdout.write("\x1B[?25h");
        process.exit(0);
      }
    });
  });
}
async function cmdInit() {
  console.log();
  console.log("  \x1B[1;36m\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\x1B[0m");
  console.log("  \x1B[1;36m\u2502\x1B[0m  ccm - Claude Code Model Manager         \x1B[1;36m\u2502\x1B[0m");
  console.log("  \x1B[1;36m\u2502\x1B[0m  \x1B[90mSet up your model profile\x1B[0m                \x1B[1;36m\u2502\x1B[0m");
  console.log("  \x1B[1;36m\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518\x1B[0m");
  console.log();
  if (!whichClaude()) {
    warn("Claude Code is not installed.");
    info("Install it first: npm install -g @anthropic-ai/claude-code\n");
    const proceed = await ask("Continue anyway? [y/N]");
    if (proceed.toLowerCase() !== "y") return;
  }
  const baseUrl = await ask("API Base URL (*)");
  if (!baseUrl) {
    err("Base URL is required.");
    return;
  }
  const token = await ask("API Key (*)");
  if (!token) {
    err("API Key is required.");
    return;
  }
  console.log();
  info("Validating connection...");
  const isAnthropic = baseUrl.toLowerCase().includes("anthropic");
  let models = [];
  if (!isAnthropic) {
    models = await fetchModels(baseUrl, token);
    if (models.length > 0) {
      ok(`Found \x1B[1m${models.length}\x1B[0m models`);
    } else {
      info("Could not fetch model list (enter manually)");
    }
  }
  let model;
  if (isAnthropic) {
    const anthropicModels = [
      "claude-sonnet-4-20250514",
      "claude-opus-4-20250514",
      "claude-haiku-4-20250501"
    ];
    model = await selectModel(anthropicModels, "Select a model");
  } else if (models.length > 0) {
    model = await selectModel(models, "Select a model");
  } else {
    model = await ask("Model name (*)");
    if (!model) {
      err("Model name is required.");
      return;
    }
  }
  console.log();
  info("Optional: model mappings for Haiku/Sonnet/Opus (Enter to skip)\n");
  const haiku = await ask("Haiku model");
  const sonnet = await ask("Sonnet model");
  const opus = await ask("Opus model");
  console.log();
  const name = await ask("Profile name (*)");
  if (!name) {
    err("Profile name is required.");
    return;
  }
  if (profileExists(name)) {
    warn(`Profile '${name}' already exists.`);
    const overwrite = await ask("Overwrite? [y/N]");
    if (overwrite.toLowerCase() !== "y") {
      info("Cancelled.");
      return;
    }
  }
  const profile = {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: token,
    ANTHROPIC_MODEL: model
  };
  if (haiku) profile.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku;
  if (sonnet) profile.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet;
  if (opus) profile.ANTHROPIC_DEFAULT_OPUS_MODEL = opus;
  addProfile(name, profile);
  console.log();
  ok(`Profile '\x1B[1m${name}\x1B[0m' saved!
`);
  console.log(`  \x1B[36mccm ${name}\x1B[0m          launch with this profile`);
  console.log(`  \x1B[36mccm edit ${name}\x1B[0m      edit configuration`);
  console.log(`  \x1B[36mccm test ${name}\x1B[0m      test connection`);
  console.log(`  \x1B[36mccm balance ${name}\x1B[0m   check credits`);
  console.log();
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
import https2 from "https";
import http2 from "http";
function httpRequest2(url, token, method = "GET", timeout = 1e4, headers = {}) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https2 : http2;
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
    const result = await httpRequest2(`${url}/v1/messages`, token, "POST", 1e4, {
      "anthropic-version": "2023-06-01"
    });
    if (result.status === 200 || result.status === 400) return { ok: true, endpoint: "/v1/messages" };
    if (result.status === 401 || result.status === 403) return { ok: false, error: "Authentication failed (invalid token)" };
    return { ok: false, error: result.error || `HTTP ${result.status}` };
  }
  for (const endpoint of ["/v1/models", "/models"]) {
    const result = await httpRequest2(`${url}${endpoint}`, token);
    if (result.status === 200) return { ok: true, endpoint };
    if (result.status === 401 || result.status === 403) return { ok: false, error: "Authentication failed (invalid token)" };
  }
  try {
    const baseParts = url.split("//");
    const hostUrl = `${baseParts[0]}//${baseParts[1].split("/")[0]}/`;
    const result = await httpRequest2(hostUrl, token);
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
    `${url}/v1/dashboard/billing/usage`,
    `${url}/auth/key`
  ];
  for (const ep of endpoints) {
    const result = await httpRequest2(ep, token);
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
  if ("data" in data && typeof data.data === "object" && data.data !== null && "usage" in data.data && "limit" in data.data) {
    const d = data.data;
    const used = parseFloat(d.usage);
    const limit = parseFloat(d.limit);
    const remaining = limit - used;
    const balanceStr = `\x1B[1;32m${fmtAmount(remaining.toFixed(4))}\x1B[0m`;
    let statusStr;
    if (limit > 0) {
      const ratio = used / limit;
      const pct = ratio * 100;
      const barStr = bar(ratio, 12);
      statusStr = `${barStr} ${pct.toFixed(1)}% used`;
    } else {
      statusStr = d.is_free_tier ? "\x1B[32m\u25CF free tier\x1B[0m" : "\x1B[32m\u25CF active\x1B[0m";
    }
    return [balanceStr, statusStr];
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

// src/session-data.ts
import fs4 from "fs";
import path4 from "path";
import os2 from "os";
var CLAUDE_DIR = path4.join(os2.homedir(), ".claude");
var HISTORY_FILE = path4.join(CLAUDE_DIR, "history.jsonl");
var PROJECTS_DIR = path4.join(CLAUDE_DIR, "projects");
var TRASH_DIR = path4.join(os2.homedir(), ".ccm", "session-trash");
var TRASH_EXPIRE_DAYS = 30;
function readJsonl(filePath) {
  if (!fs4.existsSync(filePath)) return [];
  const lines = fs4.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
  const results = [];
  for (const line of lines) {
    try {
      results.push(JSON.parse(line));
    } catch {
    }
  }
  return results;
}
function atomicWriteJsonl(filePath, lines) {
  const tmp = filePath + ".tmp";
  fs4.writeFileSync(tmp, lines.join("\n"), "utf-8");
  fs4.renameSync(tmp, filePath);
}
function getHistoryEntries() {
  const entries = readJsonl(HISTORY_FILE);
  return entries.filter((e) => e.sessionId && e.display && !e.display.startsWith("/") && e.display !== "exit").map((e) => ({
    sessionId: e.sessionId,
    display: e.display,
    timestamp: e.timestamp,
    project: e.project || ""
  }));
}
function getSessionsList() {
  const entries = getHistoryEntries();
  const grouped = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const list = grouped.get(entry.sessionId) || [];
    list.push(entry);
    grouped.set(entry.sessionId, list);
  }
  const sessions = [];
  for (const [sessionId, group] of grouped) {
    group.sort((a, b) => a.timestamp - b.timestamp);
    const first = group[0];
    const projectPath = first.project;
    const projectName = projectPath.split("/").pop() || projectPath;
    sessions.push({
      sessionId,
      firstQuestion: first.display,
      timestamp: first.timestamp,
      project: projectPath,
      projectName,
      messageCount: group.length
    });
  }
  sessions.sort((a, b) => b.timestamp - a.timestamp);
  return sessions;
}
function findSessionJsonl(sessionId) {
  if (!fs4.existsSync(PROJECTS_DIR)) return null;
  const projectDirs = fs4.readdirSync(PROJECTS_DIR);
  for (const dir of projectDirs) {
    const filePath = path4.join(PROJECTS_DIR, dir, `${sessionId}.jsonl`);
    if (fs4.existsSync(filePath)) return filePath;
  }
  return null;
}
function getSessionMessages(sessionId) {
  const filePath = findSessionJsonl(sessionId);
  if (!filePath) return [];
  const entries = readJsonl(filePath);
  const messages = [];
  for (const entry of entries) {
    if (entry.type === "user" && entry.message?.content && typeof entry.message.content === "string") {
      messages.push({
        role: "user",
        content: entry.message.content,
        timestamp: entry.timestamp || ""
      });
    } else if (entry.type === "assistant" && entry.message?.content) {
      const textParts = [];
      let model;
      if (entry.message.model) model = entry.message.model;
      if (Array.isArray(entry.message.content)) {
        for (const block of entry.message.content) {
          if (block.type === "text" && block.text) {
            textParts.push(block.text);
          }
        }
      }
      if (textParts.length > 0) {
        messages.push({
          role: "assistant",
          content: textParts.join("\n"),
          timestamp: entry.timestamp || "",
          model
        });
      }
    }
  }
  return messages;
}
function getModelForSession(sessionId) {
  const filePath = findSessionJsonl(sessionId);
  if (!filePath) return null;
  const entries = readJsonl(filePath);
  for (const entry of entries) {
    if (entry.type === "assistant" && entry.message?.model) {
      return entry.message.model;
    }
  }
  return null;
}
function resolveProfileName(model) {
  const profiles = loadProfiles();
  for (const [name, profile] of Object.entries(profiles)) {
    if (profile.ANTHROPIC_MODEL === model) return name;
  }
  return null;
}
function getSessionTitle(sessionId) {
  const filePath = findSessionJsonl(sessionId);
  if (!filePath) return null;
  const entries = readJsonl(filePath);
  for (const entry of entries) {
    if (entry.type === "ai-title" && entry.aiTitle) {
      return entry.aiTitle;
    }
  }
  return null;
}
function ensureTrashDir() {
  fs4.mkdirSync(TRASH_DIR, { recursive: true });
}
function extractHistoryForSession(sessionId) {
  if (!fs4.existsSync(HISTORY_FILE)) return [];
  const lines = fs4.readFileSync(HISTORY_FILE, "utf-8").split("\n").filter(Boolean);
  const matched = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.sessionId === sessionId) matched.push(entry);
    } catch {
    }
  }
  return matched;
}
function filterHistoryBySession(sessionId) {
  if (!fs4.existsSync(HISTORY_FILE)) return;
  const lines = fs4.readFileSync(HISTORY_FILE, "utf-8").split("\n");
  const filtered = lines.filter((line) => {
    if (!line.trim()) return false;
    try {
      const entry = JSON.parse(line);
      return entry.sessionId !== sessionId;
    } catch {
      return true;
    }
  });
  atomicWriteJsonl(HISTORY_FILE, filtered);
}
function deleteSession(sessionId) {
  ensureTrashDir();
  const historyEntries = extractHistoryForSession(sessionId);
  const filePath = findSessionJsonl(sessionId);
  let originalProject = "";
  if (filePath) {
    originalProject = path4.basename(path4.dirname(filePath));
    const destJsonl = path4.join(TRASH_DIR, `${sessionId}.jsonl`);
    fs4.copyFileSync(filePath, destJsonl);
    fs4.unlinkSync(filePath);
    const sessionDir = path4.join(path4.dirname(filePath), sessionId);
    if (fs4.existsSync(sessionDir)) {
      const destDir = path4.join(TRASH_DIR, sessionId);
      fs4.cpSync(sessionDir, destDir, { recursive: true });
      fs4.rmSync(sessionDir, { recursive: true, force: true });
    }
  }
  const meta = {
    sessionId,
    deletedAt: Date.now(),
    originalProject,
    historyEntries
  };
  fs4.writeFileSync(
    path4.join(TRASH_DIR, `${sessionId}.meta.json`),
    JSON.stringify(meta, null, 2),
    "utf-8"
  );
  filterHistoryBySession(sessionId);
}
function deleteAllSessions() {
  ensureTrashDir();
  const sessions = getSessionsList();
  for (const session of sessions) {
    const historyEntries = extractHistoryForSession(session.sessionId);
    const filePath = findSessionJsonl(session.sessionId);
    if (filePath) {
      const destJsonl = path4.join(TRASH_DIR, `${session.sessionId}.jsonl`);
      fs4.copyFileSync(filePath, destJsonl);
      fs4.unlinkSync(filePath);
      const sessionDir = path4.join(path4.dirname(filePath), session.sessionId);
      if (fs4.existsSync(sessionDir)) {
        const destDir = path4.join(TRASH_DIR, session.sessionId);
        fs4.cpSync(sessionDir, destDir, { recursive: true });
        fs4.rmSync(sessionDir, { recursive: true, force: true });
      }
    }
    const meta = {
      sessionId: session.sessionId,
      deletedAt: Date.now(),
      originalProject: session.projectName,
      historyEntries
    };
    fs4.writeFileSync(
      path4.join(TRASH_DIR, `${session.sessionId}.meta.json`),
      JSON.stringify(meta, null, 2),
      "utf-8"
    );
  }
  if (fs4.existsSync(HISTORY_FILE)) {
    atomicWriteJsonl(HISTORY_FILE, []);
  }
}
function restoreSession(sessionId) {
  const metaPath = path4.join(TRASH_DIR, `${sessionId}.meta.json`);
  if (!fs4.existsSync(metaPath)) return false;
  const meta = JSON.parse(fs4.readFileSync(metaPath, "utf-8"));
  const destDir = findProjectDirForRestore(meta.originalProject);
  const trashJsonl = path4.join(TRASH_DIR, `${sessionId}.jsonl`);
  if (fs4.existsSync(trashJsonl) && destDir) {
    fs4.copyFileSync(trashJsonl, path4.join(destDir, `${sessionId}.jsonl`));
    fs4.unlinkSync(trashJsonl);
  }
  const trashSessionDir = path4.join(TRASH_DIR, sessionId);
  if (fs4.existsSync(trashSessionDir) && destDir) {
    const restoredDir = path4.join(destDir, sessionId);
    fs4.cpSync(trashSessionDir, restoredDir, { recursive: true });
    fs4.rmSync(trashSessionDir, { recursive: true, force: true });
  }
  if (meta.historyEntries && meta.historyEntries.length > 0) {
    const newLines = meta.historyEntries.map((e) => JSON.stringify(e));
    if (fs4.existsSync(HISTORY_FILE)) {
      const existing = fs4.readFileSync(HISTORY_FILE, "utf-8");
      const combined = existing.trimEnd() + "\n" + newLines.join("\n") + "\n";
      atomicWriteJsonl(HISTORY_FILE, combined.split("\n"));
    } else {
      atomicWriteJsonl(HISTORY_FILE, newLines);
    }
  }
  fs4.unlinkSync(metaPath);
  return true;
}
function findProjectDirForRestore(projectName) {
  if (!fs4.existsSync(PROJECTS_DIR)) return null;
  const dirs = fs4.readdirSync(PROJECTS_DIR);
  for (const dir of dirs) {
    if (dir.endsWith(projectName) || dir.includes(projectName)) {
      const fullPath = path4.join(PROJECTS_DIR, dir);
      if (fs4.statSync(fullPath).isDirectory()) return fullPath;
    }
  }
  if (dirs.length > 0) {
    const first = path4.join(PROJECTS_DIR, dirs[0]);
    if (fs4.statSync(first).isDirectory()) return first;
  }
  return null;
}
function getTrashSessions() {
  ensureTrashDir();
  const files = fs4.readdirSync(TRASH_DIR);
  const metas = [];
  for (const file of files) {
    if (file.endsWith(".meta.json")) {
      try {
        const meta = JSON.parse(fs4.readFileSync(path4.join(TRASH_DIR, file), "utf-8"));
        metas.push(meta);
      } catch {
      }
    }
  }
  metas.sort((a, b) => b.deletedAt - a.deletedAt);
  return metas;
}
function purgeTrash() {
  ensureTrashDir();
  const files = fs4.readdirSync(TRASH_DIR);
  for (const file of files) {
    const fullPath = path4.join(TRASH_DIR, file);
    if (fs4.statSync(fullPath).isDirectory()) {
      fs4.rmSync(fullPath, { recursive: true, force: true });
    } else {
      fs4.unlinkSync(fullPath);
    }
  }
}
function cleanupOldTrash() {
  ensureTrashDir();
  const cutoff = Date.now() - TRASH_EXPIRE_DAYS * 24 * 60 * 60 * 1e3;
  const metas = getTrashSessions();
  let cleaned = 0;
  for (const meta of metas) {
    if (meta.deletedAt < cutoff) {
      const jsonlPath = path4.join(TRASH_DIR, `${meta.sessionId}.jsonl`);
      if (fs4.existsSync(jsonlPath)) fs4.unlinkSync(jsonlPath);
      const sessionDir = path4.join(TRASH_DIR, meta.sessionId);
      if (fs4.existsSync(sessionDir)) fs4.rmSync(sessionDir, { recursive: true, force: true });
      const metaPath = path4.join(TRASH_DIR, `${meta.sessionId}.meta.json`);
      if (fs4.existsSync(metaPath)) fs4.unlinkSync(metaPath);
      cleaned++;
    }
  }
  return cleaned;
}

// src/session-server.ts
import { exec } from "child_process";
import http3 from "http";
function openBrowser(url) {
  const cmd = process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
}
function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
function startSessionServer(port = 13501) {
  return new Promise((resolve) => {
    const server = http3.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${port}`);
      if (req.method === "GET" && (url.pathname === "/" || /^\/session\/[0-9a-f-]+$/.test(url.pathname))) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(getHTML());
        return;
      }
      if (url.pathname === "/api/sessions" && req.method === "GET") {
        const sessions = getSessionsList();
        jsonResponse(res, sessions);
        return;
      }
      const sessionMatch = url.pathname.match(/^\/api\/session\/([0-9a-f-]+)$/);
      if (sessionMatch) {
        const sessionId = sessionMatch[1];
        if (req.method === "GET") {
          const messages = getSessionMessages(sessionId);
          const model = getModelForSession(sessionId);
          const profile = model ? resolveProfileName(model) : null;
          const restoreCmd = profile ? `ccm ${profile} --resume ${sessionId}` : `ccm <model> --resume ${sessionId}`;
          const title = getSessionTitle(sessionId);
          jsonResponse(res, { messages, model, profile, restoreCmd, title });
          return;
        }
        if (req.method === "DELETE") {
          deleteSession(sessionId);
          jsonResponse(res, { ok: true });
          return;
        }
      }
      res.writeHead(404);
      res.end("Not Found");
    });
    server.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(`
  ccm sessions web: ${url}
`);
      openBrowser(url);
      resolve(server);
    });
  });
}
function getHTML() {
  const BT = String.fromCharCode(96);
  const jsCode = `
let sessions = [];
let currentSession = null;

async function loadSessions() {
  const res = await fetch('/api/sessions');
  sessions = await res.json();
  renderSessionList(sessions);
  const match = location.pathname.match(/\\/session\\/([0-9a-f-]+)/);
  if (match) selectSession(match[1], false);
}

window.addEventListener('popstate', function(e) {
  if (e.state && e.state.sessionId) selectSession(e.state.sessionId, false);
});

function renderSessionList(list) {
  const el = document.getElementById('sessionList');
  el.innerHTML = list.map((s, i) => {
    const date = new Date(s.timestamp);
    const time = date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const active = currentSession === s.sessionId ? ' active' : '';
    return '<div class="session-item' + active + '" data-id="' + s.sessionId + '" onclick="selectSession(\\'' + s.sessionId + '\\')">' +
      '<div class="time">' + time + '</div>' +
      '<div class="question">' + escHtml(s.firstQuestion) + '</div>' +
      '</div>';
  }).join('');
}

async function selectSession(sessionId, pushState) {
  currentSession = sessionId;
  if (pushState !== false) history.pushState({ sessionId }, '', '/session/' + sessionId);
  renderSessionList(getFilteredList());
  const res = await fetch('/api/session/' + sessionId);
  const data = await res.json();
  const session = sessions.find(s => s.sessionId === sessionId);
  const date = session ? new Date(session.timestamp) : new Date();
  const dateStr = date.toLocaleString('zh-CN');
  const mainEl = document.getElementById('main');
  const questions = data.messages.filter(m => m.role === 'user');
  let html = '<div class="main-header">' +
    '<h1>' + escHtml(session?.firstQuestion || data.title || '\u65E0\u6807\u9898') + '</h1>' +
    '<div class="meta">' +
    '<span class="meta-date"><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="3" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M4 1.5V3M9 1.5V3M1 6h11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>' + dateStr + '</span>' +
    (data.model ? '<span><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" stroke-width="1.3"/><path d="M6.5 3.5V6.5L8.5 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>' + escHtml(data.model) + '</span>' : '') +
    '</div>' +
    '<div class="restore-bar">' +
    '<code>' + escHtml(data.restoreCmd) + '</code>' +
    '<button class="copy-btn" onclick="copyCmd()">\u590D\u5236</button>' +
    '</div></div>' +
    '<div class="messages" id="messages">';
  data.messages.forEach((m, i) => {
    const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
    if (m.role === 'user') {
      html += '<div class="message user" id="msg-' + i + '"><div class="avatar">U</div><div><div class="bubble">' + renderMarkdown(m.content) + '</div><div class="time">' + time + '</div></div></div>';
    } else {
      html += '<div class="message ai" id="msg-' + i + '"><div class="avatar">AI</div><div>' + (m.model ? '<div class="model-tag">' + escHtml(m.model) + '</div>' : '') + '<div class="bubble">' + renderMarkdown(m.content) + '</div><div class="time">' + time + '</div></div></div>';
    }
  });
  html += '<div class="message-count">\u5171 ' + data.messages.length + ' \u6761\u6D88\u606F</div></div>';
  mainEl.innerHTML = html;
  document.getElementById('indexPanel').style.display = '';
  const indexEl = document.getElementById('indexList');
  let idx = 0;
  indexEl.innerHTML = questions.map((q, i) => {
    const msgIdx = data.messages.indexOf(q);
    const text = q.content.length > 30 ? q.content.slice(0, 30) + '...' : q.content;
    return '<div class="index-item" data-msg="' + msgIdx + '" onclick="scrollToMsg(' + msgIdx + ')"><span class="num">' + (++idx) + '</span><span>' + escHtml(text) + '</span></div>';
  }).join('');
  window._restoreCmd = data.restoreCmd;
  setTimeout(() => {
    const msgsEl = document.getElementById('messages');
    if (!msgsEl) return;
    msgsEl.addEventListener('scroll', function() {
      var bar = document.getElementById('progressBar');
      if (!bar) return;
      var pct = msgsEl.scrollHeight > msgsEl.clientHeight ? (msgsEl.scrollTop / (msgsEl.scrollHeight - msgsEl.clientHeight)) * 100 : 0;
      bar.style.width = pct + '%';
    });
    var observer = new IntersectionObserver(function(entries) {
      for (var j = 0; j < entries.length; j++) {
        if (entries[j].isIntersecting) {
          var id = entries[j].target.id;
          var msgIdx = parseInt(id.replace('msg-', ''));
          document.querySelectorAll('.index-item').forEach(function(el) { el.classList.toggle('active', parseInt(el.dataset.msg) === msgIdx); });
        }
      }
    }, { root: msgsEl, threshold: 0.5 });
    document.querySelectorAll('.message').forEach(function(el) { observer.observe(el); });
  }, 100);
}

function scrollToMsg(idx) {
  var el = document.getElementById('msg-' + idx);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function copyCmd() {
  if (window._restoreCmd) { navigator.clipboard.writeText(window._restoreCmd); showToast('\u5DF2\u590D\u5236: ' + window._restoreCmd); }
}

function showToast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(function() { el.classList.remove('show'); }, 2000);
}

function getFilteredList() {
  var q = document.getElementById('search').value.toLowerCase();
  if (!q) return sessions;
  return sessions.filter(function(s) { return s.firstQuestion.toLowerCase().includes(q) || s.projectName.toLowerCase().includes(q); });
}

document.getElementById('search').addEventListener('input', function() { renderSessionList(getFilteredList()); });

function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderMarkdown(text) {
  if (!text) return '';
  var h = escHtml(text);
  var BT = String.fromCharCode(96);
  h = h.replace(new RegExp(BT + BT + BT + '(\\\\w*)\\\\n([\\\\s\\\\S]*?)' + BT + BT + BT, 'g'), function(m, lang, code) { return '<pre><code>' + highlightCode(code) + '</code></pre>'; });
  h = h.replace(new RegExp(BT + '([^\\\\n]+?)' + BT, 'g'), '<code>$1</code>');
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  h = h.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  h = h.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
  h = h.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
  h = h.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');
  h = h.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  h = h.replace(/^---$/gm, '<hr>');
  h = h.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  h = h.replace(/(<li>.*<\\/li>)/s, '<ul>$1</ul>');
  h = h.replace(/^\\|(.+)\\|$/gm, function(m, content) {
    var cells = content.split('|').map(function(c) { return c.trim(); });
    if (cells.every(function(c) { return /^[-:]+$/.test(c); })) return '';
    return '<tr>' + cells.map(function(c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
  });
  h = h.replace(/(<tr>.*<\\/tr>)/gs, '<table>$1</table>');
  h = h.replace(/\\n\\n/g, '</p><p>');
  h = '<p>' + h + '</p>';
  h = h.replace(/<p><\\/p>/g, '');
  h = h.replace(/<p>(<h[123]>)/g, '$1');
  h = h.replace(/(<\\/h[123]>)<\\/p>/g, '$1');
  h = h.replace(/<p>(<pre>)/g, '$1');
  h = h.replace(/(<\\/pre>)<\\/p>/g, '$1');
  h = h.replace(/<p>(<table>)/g, '$1');
  h = h.replace(/(<\\/table>)<\\/p>/g, '$1');
  h = h.replace(/<p>(<ul>)/g, '$1');
  h = h.replace(/(<\\/ul>)<\\/p>/g, '$1');
  h = h.replace(/<p>(<blockquote>)/g, '$1');
  h = h.replace(/(<\\/blockquote>)<\\/p>/g, '$1');
  h = h.replace(/<p>(<hr>)/g, '$1');
  h = h.replace(/(<hr>)<\\/p>/g, '$1');
  return h;
}

function highlightCode(code) {
  var h = code;
  h = h.replace(/(\\/\\/.*$)/gm, '<span class="cm">$1</span>');
  h = h.replace(/(#.*$)/gm, '<span class="cm">$1</span>');
  h = h.replace(/("(?:[^"\\\\\\\\]|\\\\\\\\.)*"|'(?:[^'\\\\\\\\]|\\\\\\\\.)*')/g, '<span class="str">$1</span>');
  h = h.replace(/\\b(import|export|from|const|let|var|function|return|if|else|for|while|class|extends|new|async|await|try|catch|throw|switch|case|break|default|typeof|instanceof|void|null|undefined|true|false|def|self|print|raise|with|as|in|not|and|or|is|lambda|yield|assert|del|global|nonlocal|pass|elif|except|finally)\\b/g, '<span class="kw">$1</span>');
  h = h.replace(/\\b(\\d+\\.?\\d*)\\b/g, '<span class="num">$1</span>');
  return h;
}

loadSessions();`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ccm sessions</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html { scroll-behavior: smooth; }
:root {
  --td-brand-color: #0052D9;
  --td-brand-color-hover: #266FE8;
  --td-brand-color-light: #ECF2FE;
  --td-success-color: #00A870;
  --td-warning-color: #ED7B2F;
  --td-error-color: #E34D59;
  --td-gray-1: #F3F3F3;
  --td-gray-2: #EEEEEE;
  --td-gray-3: #E7E7E7;
  --td-gray-4: #DCDCDC;
  --td-gray-6: #A6A6A6;
  --td-gray-8: #616161;
  --td-gray-10: #1A1A1A;
  --td-text-primary: #1A1A1A;
  --td-text-secondary: #4A4A4A;
  --td-text-placeholder: #A6A6A6;
  --td-bg-page: #F3F3F3;
  --td-bg-card: #FFFFFF;
  --td-border-level-1: #E7E7E7;
  --td-radius-small: 3px;
  --td-radius-default: 6px;
  --td-radius-large: 9px;
  --td-shadow-1: 0 1px 4px rgba(0,0,0,.08);
  --td-shadow-2: 0 4px 16px rgba(0,0,0,.10);
}
body {
  font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif;
  font-size: 14px; line-height: 1.6;
  color: var(--td-text-primary); background: var(--td-bg-page);
  height: 100vh; overflow: hidden;
}
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--td-gray-4); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--td-gray-6); }

.app { display: grid; grid-template-columns: 280px 1fr 220px; height: 100vh; }

/* \u2500\u2500\u2500 Sidebar \u2500\u2500\u2500 */
.sidebar {
  background: var(--td-bg-card);
  border-right: 1px solid var(--td-border-level-1);
  display: flex; flex-direction: column; overflow: hidden;
}
.sidebar-header {
  padding: 16px; border-bottom: 1px solid var(--td-border-level-1);
}
.sidebar-header h2 {
  font-size: 15px; font-weight: 600; margin-bottom: 10px;
  color: var(--td-text-primary);
}
.sidebar-header input {
  width: 100%; padding: 8px 12px;
  border: 1px solid var(--td-border-level-1);
  border-radius: var(--td-radius-default);
  font-size: 13px; outline: none; color: var(--td-text-primary);
  transition: border-color .15s, box-shadow .15s;
}
.sidebar-header input::placeholder { color: var(--td-text-placeholder); }
.sidebar-header input:focus {
  border-color: var(--td-brand-color);
  box-shadow: 0 0 0 2px rgba(0,82,217,.12);
}
.session-list { flex: 1; overflow-y: auto; padding: 8px 0; }
.session-item {
  padding: 10px 16px; cursor: pointer;
  transition: background .15s;
  border-radius: 0;
  border-left: 3px solid transparent;
}
.session-item:hover { background: var(--td-brand-color-light); }
.session-item.active {
  background: var(--td-brand-color-light);
  border-left-color: var(--td-brand-color);
}
.session-item .time {
  font-size: 12px; font-weight: 700; color: var(--td-brand-color);
  text-transform: uppercase; letter-spacing: .06em;
  font-variant-numeric: tabular-nums;
}
.session-item .question {
  font-size: 13px;
  margin-top: 4px;
  color: var(--td-text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  line-height: 1.5;
}

/* \u2500\u2500\u2500 Progress bar \u2500\u2500\u2500 */
.progress-bar {
  position: fixed; top: 0; left: 0; height: 3px; width: 0;
  background: linear-gradient(90deg, var(--td-brand-color), #66B2FF);
  z-index: 100; transition: width .1s;
}

/* \u2500\u2500\u2500 Main \u2500\u2500\u2500 */
.main { display: flex; flex-direction: column; overflow: hidden; }
.main-header {
  padding: 20px 24px;
  border-bottom: 1px solid var(--td-border-level-1);
  background: var(--td-bg-card);
}
.main-header h1 {
  font-size: 16px; font-weight: 600; margin-bottom: 10px;
  line-height: 1.5; color: var(--td-text-primary);
}
.main-header .meta {
  display: flex; gap: 18px; font-size: 12px;
  color: var(--td-text-placeholder); flex-wrap: wrap;
}
.main-header .meta span {
  display: flex; align-items: center; gap: 5px;
}
.main-header .meta .meta-date {
  text-transform: uppercase; letter-spacing: .06em;
}
.main-header .meta svg { opacity: .7; }
.restore-bar {
  margin-top: 14px; display: flex; align-items: center; gap: 10px;
  background: var(--td-gray-1); padding: 10px 14px;
  border-radius: var(--td-radius-default);
  border: 1px solid var(--td-border-level-1);
  font-family: "JetBrains Mono", "Fira Code", "SF Mono", Monaco, Consolas, monospace;
  font-size: 13px;
}
.restore-bar code { flex: 1; color: var(--td-text-secondary); }
.copy-btn {
  padding: 5px 14px; background: var(--td-brand-color); color: #fff;
  border: none; border-radius: var(--td-radius-small);
  cursor: pointer; font-size: 12px; font-weight: 500; white-space: nowrap;
  transition: background .15s;
}
.copy-btn:hover { background: var(--td-brand-color-hover); }

/* \u2500\u2500\u2500 Messages \u2500\u2500\u2500 */
.messages {
  flex: 1; overflow-y: auto; padding: 24px 16px;
  background: var(--td-bg-card);box-shadow: var(--td-shadow-1);
}
.message { margin-bottom: 20px; display: flex; gap: 10px; width: 100%; }
.message.user { flex-direction: row-reverse; justify-content: flex-start; }
.message.user > div:not(.avatar) { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-end; }
.message.user .bubble { max-width: 85%; }
.message .avatar {
  width: 32px; height: 32px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 600; flex-shrink: 0;
}
.message.user .avatar {
  background: var(--td-brand-color); color: #fff;
}
.message.ai .avatar {
  background: #F6FFF9; color: var(--td-success-color);
  border: 1px solid #A3DFC5;
}
.message .bubble {
  max-width: 85%; padding: 12px 16px;
  border-radius: var(--td-radius-large);
  line-height: 1.7; font-size: 14px;
}
.message.user .bubble { background: var(--td-brand-color-light); color: var(--td-text-primary); }
.message.ai .bubble { background-color: var(--ai-bubble, #f5f7fa);}
.message .time {
  font-size: 11px; color: var(--td-text-placeholder); margin-top: 6px;
  font-variant-numeric: tabular-nums;
}
.message.user .time { text-align: right; }
.message .model-tag {
  font-size: 11px; color: var(--td-brand-color); margin-bottom: 6px;
  font-weight: 500;
}
.message-count {
  text-align: center; color: var(--td-text-placeholder);
  font-size: 12px; padding: 20px;
}

/* \u2500\u2500\u2500 Bubble content \u2500\u2500\u2500 */
.bubble h1, .bubble h2, .bubble h3 { margin: 16px 0 8px; font-weight: 600; color: var(--td-text-primary); }
.bubble h1 { font-size: 17px; }
.bubble h2 { font-size: 15px; }
.bubble h3 { font-size: 14px; }
.bubble p { margin-bottom: 10px; }
.bubble p:last-child { margin-bottom: 0; }
.bubble ul, .bubble ol { margin: 10px 0; padding-left: 22px; }
.bubble li { margin-bottom: 5px; line-height: 1.6; }
.bubble code {
  background: rgba(175,184,193,.25); color: #C7254E;
  padding: 2px 5px; border-radius: 3px;
  font-family: "JetBrains Mono", "Fira Code", Consolas, monospace; font-size: .86em;
}
.bubble pre {
  background: #F6F8FA; border: 1px solid #E1E4E8;
  padding: 16px 18px; border-radius: var(--td-radius-default);
  overflow-x: auto; margin: 12px 0;
  font-size: 13px; line-height: 1.7;
}
.bubble pre code {
  background: none; padding: 0; color: #24292E; font-size: 12.5px;
  border-radius: 0;
}
.bubble blockquote {
  border-left: 4px solid var(--td-brand-color);
  background: var(--td-brand-color-light);
  padding: 12px 16px; margin: 12px 0;
  border-radius: 0 var(--td-radius-default) var(--td-radius-default) 0;
  color: var(--td-text-secondary); font-size: 13.5px;
}
.bubble table { border-collapse: collapse; margin: 12px 0; width: 100%; font-size: 13px; }
.bubble th, .bubble td { border: 1px solid var(--td-border-level-1); padding: 8px 12px; text-align: left; }
.bubble th { background: var(--td-gray-1); font-weight: 600; color: var(--td-text-primary); }
.bubble td { color: var(--td-text-secondary); }
.bubble a { color: var(--td-brand-color); text-decoration: none; }
.bubble a:hover { text-decoration: underline; }
.bubble strong { font-weight: 600; color: var(--td-text-primary); }
.bubble em { font-style: italic; color: var(--td-brand-color); }
.bubble hr { border: none; border-top: 1px solid var(--td-border-level-1); margin: 16px 0; }

/* GitHub Light syntax colors */
.bubble pre .kw { color: #D73A49; font-weight: 600; }
.bubble pre .str { color: #032F62; }
.bubble pre .cm { color: #6A737D; font-style: italic; }
.bubble pre .fn { color: #6F42C1; }
.bubble pre .num { color: #005CC5; }
.bubble pre .keyword { color: #D73A49; font-weight: 600; }
.bubble pre .string { color: #032F62; }
.bubble pre .comment { color: #6A737D; font-style: italic; }
.bubble pre .number { color: #005CC5; }

/* \u2500\u2500\u2500 Index panel \u2500\u2500\u2500 */
.index {
  background: var(--td-bg-card);
  border-left: 1px solid var(--td-border-level-1);
  display: flex; flex-direction: column; overflow: hidden;
}
.index-header {
  padding: 14px 16px; border-bottom: 1px solid var(--td-border-level-1);
  font-size: 16px; font-weight: 700; color: var(--td-text-primary);
}
.index-list { flex: 1; overflow-y: auto; padding: 8px; }
.index-item {
  padding: 8px 10px; font-size: 12px; cursor: pointer;
  border-radius: var(--td-radius-small);
  color: var(--td-text-secondary); line-height: 1.5;
  transition: background .15s, color .15s;
  display: flex; gap: 8px;
}
.index-item:hover { background: var(--td-brand-color-light); color: var(--td-text-primary); }
.index-item.active {
  background: var(--td-brand-color-light);
  color: var(--td-brand-color); font-weight: 500;
}
.index-item .num {
  color: var(--td-text-placeholder); flex-shrink: 0; min-width: 18px;
  font-variant-numeric: tabular-nums;
}

/* \u2500\u2500\u2500 Empty state \u2500\u2500\u2500 */
.empty {
  display: flex; align-items: center; justify-content: center;
  height: 100%; color: var(--td-text-placeholder); font-size: 15px;
}
.welcome { text-align: center; }
.welcome h2 {
  font-size: 20px; margin-bottom: 8px; color: var(--td-text-primary);
  font-weight: 600;
}
.welcome p { font-size: 14px; color: var(--td-text-placeholder); }

/* \u2500\u2500\u2500 Toast \u2500\u2500\u2500 */
.toast {
  position: fixed; bottom: 40px; left: 50%;
  transform: translateX(-50%) translateY(8px);
  background: var(--td-gray-10); color: #fff;
  padding: 10px 24px; border-radius: var(--td-radius-large);
  font-size: 13px; opacity: 0;
  transition: opacity .25s, transform .25s;
  pointer-events: none; z-index: 100;
  box-shadow: var(--td-shadow-2);
}
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
</style>
</head>
<body>
<div class="progress-bar" id="progressBar"></div>
<div class="app">
  <div class="sidebar">
    <div class="sidebar-header">
      <h2>ccm sessions</h2>
      <input type="text" id="search" placeholder="\u641C\u7D22\u4F1A\u8BDD...">
    </div>
    <div class="session-list" id="sessionList"></div>
  </div>
  <div class="main" id="main">
    <div class="empty" id="emptyState">
      <div class="welcome">
        <h2>ccm sessions</h2>
        <p>\u9009\u62E9\u5DE6\u4FA7\u4F1A\u8BDD\u67E5\u770B\u5BF9\u8BDD\u8BB0\u5F55</p>
      </div>
    </div>
  </div>
  <div class="index" id="indexPanel" style="display:none">
    <div class="index-header">\u95EE\u9898\u7D22\u5F15</div>
    <div class="index-list" id="indexList"></div>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>${jsCode}</script>
</body>
</html>`;
}

// src/commands/sessions.ts
var PAGE_SIZE = 10;
function formatTime(ts) {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}
function truncate(str, len) {
  if (str.length <= len) return str;
  return str.slice(0, len) + "...";
}
function printTable(sessions, page, selectedIndex) {
  const start = page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, sessions.length);
  const pageSessions = sessions.slice(start, end);
  console.clear();
  console.log();
  console.log("  \x1B[1mccm sessions\x1B[0m  (\u2191\u2193 \u9009\u62E9 | Enter Web\u67E5\u770B | d \u5220\u9664 | D \u6E05\u7A7A\u5168\u90E8 | q \u9000\u51FA)");
  console.log();
  if (sessions.length === 0) {
    console.log("  \u6682\u65E0\u4F1A\u8BDD\u8BB0\u5F55");
    console.log();
    return;
  }
  const totalW = process.stdout.columns || 80;
  const timeW = 12;
  const gap = 2;
  const prefixW = 4;
  const availW = totalW - prefixW - timeW - gap * 2;
  let maxProjLen = 4;
  for (const s of pageSessions) {
    if (s.projectName.length > maxProjLen) maxProjLen = s.projectName.length;
  }
  const projW = maxProjLen + 2;
  const questionW = Math.max(10, availW - projW);
  console.log(
    " ".repeat(prefixW) + "\x1B[2m" + "\u65F6\u95F4".padEnd(timeW) + " ".repeat(gap) + "\u9879\u76EE".padEnd(projW) + " ".repeat(gap) + "\u9996\u6761\u63D0\u95EE\x1B[0m"
  );
  console.log(" ".repeat(prefixW) + "\x1B[2m" + "\u2500".repeat(Math.min(totalW - prefixW, 80)) + "\x1B[0m");
  for (let i = 0; i < pageSessions.length; i++) {
    const s = pageSessions[i];
    const globalIdx = start + i;
    const isSelected = globalIdx === selectedIndex;
    const prefix = isSelected ? "  \x1B[36m\u25B6 " : "    ";
    const suffix = isSelected ? "\x1B[0m" : "";
    const time = formatTime(s.timestamp);
    const proj = truncate(s.projectName, projW);
    const question = truncate(s.firstQuestion, questionW);
    console.log(
      prefix + time.padEnd(timeW) + " ".repeat(gap) + proj.padEnd(projW) + " ".repeat(gap) + question + suffix
    );
  }
  const totalPages = Math.ceil(sessions.length / PAGE_SIZE);
  if (totalPages > 1) {
    console.log();
    console.log(
      `\x1B[2m  \u7B2C ${page + 1}/${totalPages} \u9875 (\u5171 ${sessions.length} \u4E2A\u4F1A\u8BDD, \u2190 \u2192 \u7FFB\u9875)\x1B[0m`
    );
  }
}
async function confirmPrompt(msg) {
  process.stdout.write(`
  ${msg} (y/N) `);
  return new Promise((resolve) => {
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim().toLowerCase() === "y");
    });
  });
}
async function cmdSessions(args) {
  cleanupOldTrash();
  if (args.purge) {
    const trash = getTrashSessions();
    if (trash.length === 0) {
      console.log("\n  \u56DE\u6536\u7AD9\u4E3A\u7A7A\n");
      return;
    }
    console.log(`
  \u56DE\u6536\u7AD9\u4E2D\u6709 ${trash.length} \u4E2A\u4F1A\u8BDD`);
    const confirmed = await confirmPrompt("\x1B[31m\u786E\u8BA4\u6E05\u7A7A\u56DE\u6536\u7AD9\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\uFF01\x1B[0m");
    if (confirmed) {
      purgeTrash();
      ok("\u56DE\u6536\u7AD9\u5DF2\u6E05\u7A7A");
    }
    console.log();
    return;
  }
  if (args.restore !== void 0) {
    if (args.restore === "") {
      const trash = getTrashSessions();
      if (trash.length === 0) {
        console.log("\n  \u56DE\u6536\u7AD9\u4E3A\u7A7A\n");
        return;
      }
      const latest = trash[0];
      const confirmed = await confirmPrompt(`\u6062\u590D\u4F1A\u8BDD "${latest.sessionId.slice(0, 8)}..."\uFF1F`);
      if (confirmed) {
        restoreSession(latest.sessionId);
        ok("\u4F1A\u8BDD\u5DF2\u6062\u590D");
      }
    } else {
      const success = restoreSession(args.restore);
      if (success) {
        ok("\u4F1A\u8BDD\u5DF2\u6062\u590D");
      } else {
        err(`\u672A\u627E\u5230\u4F1A\u8BDD ${args.restore}`);
      }
    }
    console.log();
    return;
  }
  if (args.web) {
    await startSessionServer();
    return;
  }
  const sessions = getSessionsList();
  if (sessions.length === 0) {
    console.log("\n  \u6682\u65E0\u4F1A\u8BDD\u8BB0\u5F55\n");
    return;
  }
  let selectedIndex = 0;
  let page = 0;
  const totalPages = Math.ceil(sessions.length / PAGE_SIZE);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf-8");
  const cleanup = () => {
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
  };
  printTable(sessions, page, selectedIndex);
  return new Promise((resolve) => {
    process.stdin.on("data", async (key) => {
      if (key === "" || key === "q") {
        cleanup();
        console.log();
        resolve();
        return;
      }
      if (key === "\x1B[A") {
        if (selectedIndex > 0) {
          selectedIndex--;
          if (selectedIndex < page * PAGE_SIZE) {
            page = Math.floor(selectedIndex / PAGE_SIZE);
          }
          printTable(sessions, page, selectedIndex);
        }
        return;
      }
      if (key === "\x1B[B") {
        if (selectedIndex < sessions.length - 1) {
          selectedIndex++;
          if (selectedIndex >= (page + 1) * PAGE_SIZE) {
            page = Math.floor(selectedIndex / PAGE_SIZE);
          }
          printTable(sessions, page, selectedIndex);
        }
        return;
      }
      if (key === "\x1B[D") {
        if (page > 0) {
          page--;
          selectedIndex = page * PAGE_SIZE;
          printTable(sessions, page, selectedIndex);
        }
        return;
      }
      if (key === "\x1B[C") {
        if (page < totalPages - 1) {
          page++;
          selectedIndex = page * PAGE_SIZE;
          printTable(sessions, page, selectedIndex);
        }
        return;
      }
      if (key === "\r" || key === "\n") {
        cleanup();
        const session = sessions[selectedIndex];
        if (session) {
          console.log();
          await startSessionServer();
        }
        resolve();
        return;
      }
      if (key === "d") {
        cleanup();
        const session = sessions[selectedIndex];
        if (session) {
          const confirmed = await confirmPrompt(`\u786E\u8BA4\u5220\u9664 "${truncate(session.firstQuestion, 30)}"\uFF1F(\u79FB\u5165\u56DE\u6536\u7AD9)`);
          if (confirmed) {
            deleteSession(session.sessionId);
            sessions.splice(selectedIndex, 1);
            if (selectedIndex >= sessions.length) selectedIndex = Math.max(0, sessions.length - 1);
            ok("\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9 (ccm sessions --restore \u6062\u590D)");
          }
        }
        process.stdin.setRawMode?.(true);
        process.stdin.resume();
        printTable(sessions, page, selectedIndex);
        return;
      }
      if (key === "D") {
        cleanup();
        const confirmed = await confirmPrompt("\x1B[33m\u786E\u8BA4\u6E05\u7A7A\u5168\u90E8\u4F1A\u8BDD\uFF1F(\u79FB\u5165\u56DE\u6536\u7AD9\uFF0C30\u5929\u540E\u81EA\u52A8\u6E05\u7406)\x1B[0m");
        if (confirmed) {
          deleteAllSessions();
          sessions.length = 0;
          ok("\u5168\u90E8\u4F1A\u8BDD\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9");
        }
        process.stdin.setRawMode?.(true);
        process.stdin.resume();
        printTable(sessions, page, selectedIndex);
        return;
      }
    });
  });
}

// src/cli.ts
var pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
var VERSION = pkg.version;
var KNOWN_COMMANDS = /* @__PURE__ */ new Set([
  "_launch",
  "_register",
  "init",
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
  "completions",
  "sessions"
]);
function printHelp() {
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
function parseArgs(argv) {
  const args = { _: [], extra: [] };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--all") {
      args.all = true;
    } else if (arg.startsWith("-")) {
      args.extra.push(arg);
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
      cmdLaunch({ name: firstArg, extraArgs: rawArgs.slice(1) });
      return;
    }
  }
  const { command, args } = parseArgs(rawArgs);
  switch (command) {
    case "_launch":
      cmdLaunch({ name: args.name, extraArgs: args.extra || [] });
      break;
    case "_register":
      cmdRegister({ name: args.name, pid: args.pid, tty: args.tty });
      break;
    case "init":
      await cmdInit();
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
    case "sessions": {
      const restoreIdx = rawArgs.indexOf("--restore");
      const restoreId = restoreIdx >= 0 ? rawArgs[restoreIdx + 1] || "" : void 0;
      await cmdSessions({
        web: rawArgs.includes("--web"),
        restore: restoreIdx >= 0 ? restoreId : void 0,
        purge: rawArgs.includes("--purge")
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
