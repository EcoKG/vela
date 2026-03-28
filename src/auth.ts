/**
 * Authentication module for Vela CLI.
 *
 * Resolves Anthropic API keys with priority:
 *   1. Environment variable ANTHROPIC_API_KEY
 *   2. Active profile in ~/.vela/auth.json (v2 multi-profile format)
 *   3. null (not configured)
 *
 * Supports named profiles with add/list/use/remove operations.
 * Backward-compatible: v1 files ({ apiKey }) are auto-migrated to v2 on read.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ─── Types ─────────────────────────────────────────────────

/** v1 auth file shape (legacy) */
interface AuthFileV1 {
  apiKey: string;
}

/** A named API key profile */
export interface AuthProfile {
  name: string;
  apiKey: string;
  createdAt: string;
}

/** v2 auth file shape with multi-profile support */
export interface AuthFileV2 {
  activeProfile: string;
  profiles: AuthProfile[];
}

// ─── Internal helpers ──────────────────────────────────────

/**
 * Returns the path to the auth credentials file.
 */
export function getAuthFilePath(): string {
  return path.join(os.homedir(), '.vela', 'auth.json');
}

/**
 * Reads ~/.vela/auth.json and normalizes to v2 format.
 *
 * - v2 file: returned as-is
 * - v1 file ({ apiKey }): migrated to v2 with profile named 'default'
 * - Missing/corrupt file: returns { profiles: [], activeProfile: '' }
 *
 * Never throws.
 */
function readAuthFile(): AuthFileV2 {
  const authPath = getAuthFilePath();
  const empty: AuthFileV2 = { profiles: [], activeProfile: '' };

  try {
    const raw = fs.readFileSync(authPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (!parsed || typeof parsed !== 'object') {
      return empty;
    }

    // Detect v2 format: has 'profiles' array
    if (Array.isArray(parsed.profiles)) {
      return {
        activeProfile: typeof parsed.activeProfile === 'string' ? parsed.activeProfile : '',
        profiles: (parsed.profiles as Array<Record<string, unknown>>)
          .filter(
            (p) =>
              p &&
              typeof p === 'object' &&
              typeof p.name === 'string' &&
              typeof p.apiKey === 'string',
          )
          .map((p) => ({
            name: p.name as string,
            apiKey: p.apiKey as string,
            createdAt: typeof p.createdAt === 'string' ? (p.createdAt as string) : new Date().toISOString(),
          })),
      };
    }

    // Detect v1 format: has 'apiKey' string
    if (
      'apiKey' in parsed &&
      typeof parsed.apiKey === 'string' &&
      parsed.apiKey.length > 0
    ) {
      const v1 = parsed as unknown as AuthFileV1;
      return {
        activeProfile: 'default',
        profiles: [
          {
            name: 'default',
            apiKey: v1.apiKey,
            createdAt: new Date().toISOString(),
          },
        ],
      };
    }

    return empty;
  } catch {
    return empty;
  }
}

/**
 * Writes v2 auth data to ~/.vela/auth.json with chmod 600.
 * Creates ~/.vela/ directory if needed.
 * Throws on I/O failure with the original error.
 */
function writeAuthFile(data: AuthFileV2): void {
  const authPath = getAuthFilePath();
  const dir = path.dirname(authPath);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(authPath, JSON.stringify(data, null, 2), { encoding: 'utf-8' });
  fs.chmodSync(authPath, 0o600);
}

// ─── Public API ────────────────────────────────────────────

/**
 * Resolves an Anthropic API key using the priority chain:
 *   1. process.env.ANTHROPIC_API_KEY (if non-empty)
 *   2. Active profile's apiKey from ~/.vela/auth.json
 *   3. null
 *
 * Never throws — returns null on any I/O or parse failure.
 */
export function resolveApiKey(): string | null {
  // Priority 1: environment variable
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey && envKey.length > 0) {
    return envKey;
  }

  // Priority 2: active profile
  const active = getActiveProfile();
  return active ? active.apiKey : null;
}

/**
 * Persists an API key to ~/.vela/auth.json with restricted permissions (0o600).
 *
 * Writes v2 format: creates or overwrites a profile named 'default'.
 * Backward compatible for existing callers.
 *
 * Creates the ~/.vela/ directory if it doesn't exist.
 * Throws on I/O failure with the original error.
 */
export function saveApiKey(apiKey: string): void {
  const data = readAuthFile();
  const existing = data.profiles.findIndex((p) => p.name === 'default');

  if (existing >= 0) {
    data.profiles[existing]!.apiKey = apiKey;
  } else {
    data.profiles.push({
      name: 'default',
      apiKey,
      createdAt: new Date().toISOString(),
    });
  }

  data.activeProfile = data.activeProfile || 'default';
  writeAuthFile(data);
}

/**
 * Adds a named profile. Sets it as active if it's the first profile.
 * Throws if a profile with the same name already exists.
 */
export function addProfile(name: string, apiKey: string): void {
  if (!name || name.trim().length === 0) {
    throw new Error('Profile name cannot be empty');
  }
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('API key cannot be empty');
  }

  const data = readAuthFile();

  if (data.profiles.some((p) => p.name === name)) {
    throw new Error(`Profile "${name}" already exists`);
  }

  data.profiles.push({
    name,
    apiKey,
    createdAt: new Date().toISOString(),
  });

  // Set as active if first profile
  if (data.profiles.length === 1 || !data.activeProfile) {
    data.activeProfile = name;
  }

  writeAuthFile(data);
}

/**
 * Returns all profiles with active marker.
 */
export function listProfiles(): Array<{
  name: string;
  apiKey: string;
  active: boolean;
  createdAt: string;
}> {
  const data = readAuthFile();
  return data.profiles.map((p) => ({
    name: p.name,
    apiKey: p.apiKey,
    active: p.name === data.activeProfile,
    createdAt: p.createdAt,
  }));
}

/**
 * Sets the active profile. Throws if the profile name is not found.
 */
export function useProfile(name: string): void {
  const data = readAuthFile();

  if (!data.profiles.some((p) => p.name === name)) {
    throw new Error(`Profile "${name}" not found`);
  }

  data.activeProfile = name;
  writeAuthFile(data);
}

/**
 * Removes a profile. Throws if the profile is currently active
 * (user must switch first). Throws if the profile is not found.
 */
export function removeProfile(name: string): void {
  const data = readAuthFile();

  const idx = data.profiles.findIndex((p) => p.name === name);
  if (idx < 0) {
    throw new Error(`Profile "${name}" not found`);
  }

  if (data.activeProfile === name) {
    throw new Error(
      `Cannot remove active profile "${name}". Switch to another profile first with "vela auth use <name>".`,
    );
  }

  data.profiles.splice(idx, 1);
  writeAuthFile(data);
}

/**
 * Returns the active profile, or null if no profiles exist
 * or the active profile reference is stale.
 */
export function getActiveProfile(): { name: string; apiKey: string } | null {
  const data = readAuthFile();
  const active = data.profiles.find((p) => p.name === data.activeProfile);
  if (!active) return null;
  return { name: active.name, apiKey: active.apiKey };
}

/**
 * Masks an API key for display — shows first 8 + last 4 chars with `...` in between.
 * For keys shorter than 16 chars, shows first 4 + `...` + last 2.
 */
export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length < 6) return '...';
  if (key.length < 16) {
    return key.slice(0, 4) + '...' + key.slice(-2);
  }
  return key.slice(0, 8) + '...' + key.slice(-4);
}
