import fs from 'node:fs';
import path from 'node:path';
import { RUNS_DIR } from './constants.js';

export interface RunEntry {
  pid: number;
  profile: string;
  started_at: string;
  tty: string;
  uptime?: string;
}

export function writeRun(pid: number, profileName: string, tty = ''): void {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  if (!tty) {
    try {
      tty = fs.readlinkSync(`/dev/fd/0`);
    } catch {
      tty = '';
    }
  }
  const data: RunEntry = {
    pid,
    profile: profileName,
    started_at: new Date().toISOString(),
    tty,
  };
  fs.writeFileSync(path.join(RUNS_DIR, `${pid}.json`), JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function removeRun(pid: number): void {
  const f = path.join(RUNS_DIR, `${pid}.json`);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function cleanupStaleRuns(): void {
  if (!fs.existsSync(RUNS_DIR)) return;
  for (const f of fs.readdirSync(RUNS_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const pid = parseInt(path.basename(f, '.json'), 10);
      if (!isAlive(pid)) fs.unlinkSync(path.join(RUNS_DIR, f));
    } catch {
      // skip
    }
  }
}

export function getAllRuns(): RunEntry[] {
  cleanupStaleRuns();
  if (!fs.existsSync(RUNS_DIR)) return [];
  const runs: RunEntry[] = [];
  for (const f of fs.readdirSync(RUNS_DIR).sort()) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf-8'));
      data.uptime = calcUptime(data.started_at || '');
      runs.push(data);
    } catch {
      // skip
    }
  }
  return runs;
}

export function getRunningProfiles(): Set<string> {
  return new Set(getAllRuns().map((r) => r.profile));
}

export function findRunByProfile(name: string): RunEntry | undefined {
  return getAllRuns().find((r) => r.profile === name);
}

function sleep(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  const int32 = new Int32Array(sab);
  Atomics.wait(int32, 0, 0, ms);
}

export function killProcess(pid: number): boolean {
  try {
    process.kill(pid, 'SIGTERM');
    sleep(500);
    if (isAlive(pid)) {
      process.kill(pid, 'SIGKILL');
      sleep(300);
    }
    removeRun(pid);
    return true;
  } catch {
    removeRun(pid);
    return false;
  }
}

export function killByProfile(name: string): [boolean, string] {
  const run = findRunByProfile(name);
  if (!run) return [false, `No running instance found for '${name}'`];
  const pid = run.pid;
  if (killProcess(pid)) return [true, `Killed ${name} (PID ${pid})`];
  return [false, `Failed to kill PID ${pid}`];
}

export function killAll(): [number, number] {
  const runs = getAllRuns();
  let success = 0;
  for (const r of runs) {
    if (killProcess(r.pid)) success++;
  }
  return [success, runs.length];
}

export function calcUptime(startedAt: string): string {
  if (!startedAt) return '-';
  try {
    const delta = Date.now() - new Date(startedAt).getTime();
    const total = Math.floor(delta / 1000);
    if (total < 60) return `${total}s`;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  } catch {
    return '-';
  }
}
