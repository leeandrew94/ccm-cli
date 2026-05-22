import path from 'node:path';
import os from 'node:os';

export const CONFIG_DIR = path.join(os.homedir(), '.ccm');
export const PROFILES_FILE = path.join(CONFIG_DIR, 'profiles.json');
export const RUNS_DIR = path.join(CONFIG_DIR, 'runs');
export const SETTINGS_DIR = path.join(CONFIG_DIR, 'settings');

export const ANTHROPIC_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
];

export const ANTHROPIC_REQUIRED_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
];
