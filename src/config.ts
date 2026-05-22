import fs from 'node:fs';
import { CONFIG_DIR, PROFILES_FILE, RUNS_DIR } from './constants.js';

export interface Profile {
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_AUTH_TOKEN: string;
  ANTHROPIC_MODEL: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string;
}

export type Profiles = Record<string, Profile>;

export function ensureConfigDir(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.mkdirSync(RUNS_DIR, { recursive: true });
}

export function loadProfiles(): Profiles {
  ensureConfigDir();
  if (!fs.existsSync(PROFILES_FILE)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf-8'));
    return typeof data === 'object' && data !== null ? data : {};
  } catch {
    return {};
  }
}

export function saveProfiles(profiles: Profiles): void {
  ensureConfigDir();
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2) + '\n', 'utf-8');
}

export function getProfile(name: string): Profile | undefined {
  return loadProfiles()[name];
}

export function profileExists(name: string): boolean {
  return name in loadProfiles();
}

export function addProfile(name: string, profile: Profile): void {
  const profiles = loadProfiles();
  profiles[name] = profile;
  saveProfiles(profiles);
}

export function updateProfile(name: string, profile: Profile): void {
  const profiles = loadProfiles();
  if (!(name in profiles)) throw new Error(`Profile '${name}' not found`);
  profiles[name] = profile;
  saveProfiles(profiles);
}

export function deleteProfile(name: string): void {
  const profiles = loadProfiles();
  if (!(name in profiles)) throw new Error(`Profile '${name}' not found`);
  delete profiles[name];
  saveProfiles(profiles);
}
