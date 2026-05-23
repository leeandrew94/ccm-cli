import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadProfiles } from './config.js';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const HISTORY_FILE = path.join(CLAUDE_DIR, 'history.jsonl');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const TRASH_DIR = path.join(os.homedir(), '.ccm', 'session-trash');
const TRASH_EXPIRE_DAYS = 30;

export interface HistoryEntry {
  sessionId: string;
  display: string;
  timestamp: number;
  project: string;
}

export interface SessionSummary {
  sessionId: string;
  firstQuestion: string;
  timestamp: number;
  project: string;
  projectName: string;
  messageCount: number;
}

export interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  model?: string;
}

export interface TrashMeta {
  sessionId: string;
  deletedAt: number;
  originalProject: string;
  historyEntries: any[];
}

function readJsonl(filePath: string): any[] {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
  const results: any[] = [];
  for (const line of lines) {
    try {
      results.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }
  return results;
}

function atomicWriteJsonl(filePath: string, lines: string[]): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, lines.join('\n'), 'utf-8');
  fs.renameSync(tmp, filePath);
}

export function getHistoryEntries(): HistoryEntry[] {
  const entries = readJsonl(HISTORY_FILE);
  return entries
    .filter((e) => e.sessionId && e.display && !e.display.startsWith('/') && e.display !== 'exit')
    .map((e) => ({
      sessionId: e.sessionId,
      display: e.display,
      timestamp: e.timestamp,
      project: e.project || '',
    }));
}

export function getSessionsList(): SessionSummary[] {
  const entries = getHistoryEntries();
  const grouped = new Map<string, HistoryEntry[]>();

  for (const entry of entries) {
    const list = grouped.get(entry.sessionId) || [];
    list.push(entry);
    grouped.set(entry.sessionId, list);
  }

  const sessions: SessionSummary[] = [];
  for (const [sessionId, group] of grouped) {
    group.sort((a, b) => a.timestamp - b.timestamp);
    const first = group[0];
    const projectPath = first.project;
    const projectName = projectPath.split('/').pop() || projectPath;
    sessions.push({
      sessionId,
      firstQuestion: first.display,
      timestamp: first.timestamp,
      project: projectPath,
      projectName,
      messageCount: group.length,
    });
  }

  sessions.sort((a, b) => b.timestamp - a.timestamp);
  return sessions;
}

function findSessionJsonl(sessionId: string): string | null {
  if (!fs.existsSync(PROJECTS_DIR)) return null;
  const projectDirs = fs.readdirSync(PROJECTS_DIR);
  for (const dir of projectDirs) {
    const filePath = path.join(PROJECTS_DIR, dir, `${sessionId}.jsonl`);
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

export function getSessionMessages(sessionId: string): SessionMessage[] {
  const filePath = findSessionJsonl(sessionId);
  if (!filePath) return [];

  const entries = readJsonl(filePath);
  const messages: SessionMessage[] = [];

  for (const entry of entries) {
    if (entry.type === 'user' && entry.message?.content && typeof entry.message.content === 'string') {
      messages.push({
        role: 'user',
        content: entry.message.content,
        timestamp: entry.timestamp || '',
      });
    } else if (entry.type === 'assistant' && entry.message?.content) {
      const textParts: string[] = [];
      let model: string | undefined;
      if (entry.message.model) model = entry.message.model;

      if (Array.isArray(entry.message.content)) {
        for (const block of entry.message.content) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text);
          }
        }
      }

      if (textParts.length > 0) {
        messages.push({
          role: 'assistant',
          content: textParts.join('\n'),
          timestamp: entry.timestamp || '',
          model,
        });
      }
    }
  }

  return messages;
}

export function getModelForSession(sessionId: string): string | null {
  const filePath = findSessionJsonl(sessionId);
  if (!filePath) return null;

  const entries = readJsonl(filePath);
  for (const entry of entries) {
    if (entry.type === 'assistant' && entry.message?.model) {
      return entry.message.model;
    }
  }
  return null;
}

export function resolveProfileName(model: string): string | null {
  const profiles = loadProfiles();
  for (const [name, profile] of Object.entries(profiles)) {
    if (profile.ANTHROPIC_MODEL === model) return name;
  }
  return null;
}

export function getSessionTitle(sessionId: string): string | null {
  const filePath = findSessionJsonl(sessionId);
  if (!filePath) return null;

  const entries = readJsonl(filePath);
  for (const entry of entries) {
    if (entry.type === 'ai-title' && entry.aiTitle) {
      return entry.aiTitle;
    }
  }
  return null;
}

function ensureTrashDir(): void {
  fs.mkdirSync(TRASH_DIR, { recursive: true });
}

function extractHistoryForSession(sessionId: string): any[] {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  const lines = fs.readFileSync(HISTORY_FILE, 'utf-8').split('\n').filter(Boolean);
  const matched: any[] = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.sessionId === sessionId) matched.push(entry);
    } catch {
      // skip
    }
  }
  return matched;
}

function filterHistoryBySession(sessionId: string): void {
  if (!fs.existsSync(HISTORY_FILE)) return;
  const lines = fs.readFileSync(HISTORY_FILE, 'utf-8').split('\n');
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

export function deleteSession(sessionId: string): void {
  ensureTrashDir();

  // Extract history entries before filtering
  const historyEntries = extractHistoryForSession(sessionId);

  // Move session JSONL to trash
  const filePath = findSessionJsonl(sessionId);
  let originalProject = '';
  if (filePath) {
    originalProject = path.basename(path.dirname(filePath));
    const destJsonl = path.join(TRASH_DIR, `${sessionId}.jsonl`);
    fs.copyFileSync(filePath, destJsonl);
    fs.unlinkSync(filePath);

    // Also move session subdirectory if exists
    const sessionDir = path.join(path.dirname(filePath), sessionId);
    if (fs.existsSync(sessionDir)) {
      const destDir = path.join(TRASH_DIR, sessionId);
      fs.cpSync(sessionDir, destDir, { recursive: true });
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  }

  // Save trash metadata
  const meta: TrashMeta = {
    sessionId,
    deletedAt: Date.now(),
    originalProject,
    historyEntries,
  };
  fs.writeFileSync(
    path.join(TRASH_DIR, `${sessionId}.meta.json`),
    JSON.stringify(meta, null, 2),
    'utf-8'
  );

  // Filter history.jsonl (atomic write)
  filterHistoryBySession(sessionId);
}

export function deleteAllSessions(): void {
  ensureTrashDir();
  const sessions = getSessionsList();

  for (const session of sessions) {
    const historyEntries = extractHistoryForSession(session.sessionId);
    const filePath = findSessionJsonl(session.sessionId);

    if (filePath) {
      const destJsonl = path.join(TRASH_DIR, `${session.sessionId}.jsonl`);
      fs.copyFileSync(filePath, destJsonl);
      fs.unlinkSync(filePath);

      const sessionDir = path.join(path.dirname(filePath), session.sessionId);
      if (fs.existsSync(sessionDir)) {
        const destDir = path.join(TRASH_DIR, session.sessionId);
        fs.cpSync(sessionDir, destDir, { recursive: true });
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    }

    const meta: TrashMeta = {
      sessionId: session.sessionId,
      deletedAt: Date.now(),
      originalProject: session.projectName,
      historyEntries,
    };
    fs.writeFileSync(
      path.join(TRASH_DIR, `${session.sessionId}.meta.json`),
      JSON.stringify(meta, null, 2),
      'utf-8'
    );
  }

  // Clear history.jsonl atomically
  if (fs.existsSync(HISTORY_FILE)) {
    atomicWriteJsonl(HISTORY_FILE, []);
  }
}

export function restoreSession(sessionId: string): boolean {
  const metaPath = path.join(TRASH_DIR, `${sessionId}.meta.json`);
  if (!fs.existsSync(metaPath)) return false;

  const meta: TrashMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

  // Find the original project directory
  const destDir = findProjectDirForRestore(meta.originalProject);

  // Restore session JSONL
  const trashJsonl = path.join(TRASH_DIR, `${sessionId}.jsonl`);
  if (fs.existsSync(trashJsonl) && destDir) {
    fs.copyFileSync(trashJsonl, path.join(destDir, `${sessionId}.jsonl`));
    fs.unlinkSync(trashJsonl);
  }

  // Restore session subdirectory
  const trashSessionDir = path.join(TRASH_DIR, sessionId);
  if (fs.existsSync(trashSessionDir) && destDir) {
    const restoredDir = path.join(destDir, sessionId);
    fs.cpSync(trashSessionDir, restoredDir, { recursive: true });
    fs.rmSync(trashSessionDir, { recursive: true, force: true });
  }

  // Append history entries back
  if (meta.historyEntries && meta.historyEntries.length > 0) {
    const newLines = meta.historyEntries.map((e) => JSON.stringify(e));
    if (fs.existsSync(HISTORY_FILE)) {
      const existing = fs.readFileSync(HISTORY_FILE, 'utf-8');
      const combined = existing.trimEnd() + '\n' + newLines.join('\n') + '\n';
      atomicWriteJsonl(HISTORY_FILE, combined.split('\n'));
    } else {
      atomicWriteJsonl(HISTORY_FILE, newLines);
    }
  }

  // Remove trash meta
  fs.unlinkSync(metaPath);

  return true;
}

function findProjectDirForRestore(projectName: string): string | null {
  if (!fs.existsSync(PROJECTS_DIR)) return null;
  const dirs = fs.readdirSync(PROJECTS_DIR);
  // Try to find a matching project directory
  for (const dir of dirs) {
    if (dir.endsWith(projectName) || dir.includes(projectName)) {
      const fullPath = path.join(PROJECTS_DIR, dir);
      if (fs.statSync(fullPath).isDirectory()) return fullPath;
    }
  }
  // Fallback: use first project dir or create one
  if (dirs.length > 0) {
    const first = path.join(PROJECTS_DIR, dirs[0]);
    if (fs.statSync(first).isDirectory()) return first;
  }
  return null;
}

export function getTrashSessions(): TrashMeta[] {
  ensureTrashDir();
  const files = fs.readdirSync(TRASH_DIR);
  const metas: TrashMeta[] = [];
  for (const file of files) {
    if (file.endsWith('.meta.json')) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(TRASH_DIR, file), 'utf-8'));
        metas.push(meta);
      } catch {
        // skip
      }
    }
  }
  metas.sort((a, b) => b.deletedAt - a.deletedAt);
  return metas;
}

export function purgeTrash(): void {
  ensureTrashDir();
  const files = fs.readdirSync(TRASH_DIR);
  for (const file of files) {
    const fullPath = path.join(TRASH_DIR, file);
    if (fs.statSync(fullPath).isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(fullPath);
    }
  }
}

export function cleanupOldTrash(): number {
  ensureTrashDir();
  const cutoff = Date.now() - TRASH_EXPIRE_DAYS * 24 * 60 * 60 * 1000;
  const metas = getTrashSessions();
  let cleaned = 0;

  for (const meta of metas) {
    if (meta.deletedAt < cutoff) {
      // Remove session JSONL
      const jsonlPath = path.join(TRASH_DIR, `${meta.sessionId}.jsonl`);
      if (fs.existsSync(jsonlPath)) fs.unlinkSync(jsonlPath);

      // Remove session subdirectory
      const sessionDir = path.join(TRASH_DIR, meta.sessionId);
      if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });

      // Remove meta
      const metaPath = path.join(TRASH_DIR, `${meta.sessionId}.meta.json`);
      if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);

      cleaned++;
    }
  }

  return cleaned;
}
