/**
 * Tests for auth module — API key resolution and persistence.
 *
 * Uses temp directories to avoid touching real ~/.vela/.
 * Mocks node:os homedir via vi.mock to redirect auth file paths.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmpDir: string;

// Mock node:os to control homedir — vitest hoists this above imports
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    default: {
      ...actual,
      homedir: () => (globalThis as Record<string, unknown>).__velaTestHomeDir as string ?? actual.homedir(),
    },
    homedir: () => (globalThis as Record<string, unknown>).__velaTestHomeDir as string ?? actual.homedir(),
  };
});

// Dynamic import after mock is set up
const {
  getAuthFilePath,
  resolveApiKey,
  saveApiKey,
  addProfile,
  listProfiles,
  useProfile,
  removeProfile,
  getActiveProfile,
  maskApiKey,
} = await import('../src/auth.js');

let originalEnv: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-auth-test-'));
  (globalThis as Record<string, unknown>).__velaTestHomeDir = tmpDir;
  originalEnv = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  if (originalEnv !== undefined) {
    process.env.ANTHROPIC_API_KEY = originalEnv;
  } else {
    delete process.env.ANTHROPIC_API_KEY;
  }
  delete (globalThis as Record<string, unknown>).__velaTestHomeDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Helper: write the auth file into the mocked home dir */
function writeAuthFile(content: string): string {
  const authPath = path.join(tmpDir, '.vela', 'auth.json');
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  fs.writeFileSync(authPath, content, 'utf-8');
  return authPath;
}

// ─── getAuthFilePath ───────────────────────────────────────

describe('getAuthFilePath', () => {
  it('returns path under homedir/.vela/auth.json', () => {
    const result = getAuthFilePath();
    expect(result).toBe(path.join(tmpDir, '.vela', 'auth.json'));
  });
});

// ─── resolveApiKey ─────────────────────────────────────────

describe('resolveApiKey', () => {
  it('returns env var when ANTHROPIC_API_KEY is set', () => {
    writeAuthFile(JSON.stringify({ apiKey: 'file-key-123' }));
    process.env.ANTHROPIC_API_KEY = 'env-key-456';

    expect(resolveApiKey()).toBe('env-key-456');
  });

  it('env var takes priority over file', () => {
    writeAuthFile(JSON.stringify({ apiKey: 'file-key' }));
    process.env.ANTHROPIC_API_KEY = 'env-key';

    expect(resolveApiKey()).toBe('env-key');
  });

  it('falls back to file when env var is not set', () => {
    writeAuthFile(JSON.stringify({ apiKey: 'file-key-789' }));

    expect(resolveApiKey()).toBe('file-key-789');
  });

  it('returns null when neither env var nor file exists', () => {
    expect(resolveApiKey()).toBeNull();
  });

  it('returns null when env var is empty string', () => {
    process.env.ANTHROPIC_API_KEY = '';

    expect(resolveApiKey()).toBeNull();
  });

  // ── Negative tests ──

  it('returns null when auth.json contains invalid JSON', () => {
    writeAuthFile('not valid json {{{');

    expect(resolveApiKey()).toBeNull();
  });

  it('returns null when auth.json exists but is missing apiKey field', () => {
    writeAuthFile(JSON.stringify({ someOtherField: 'value' }));

    expect(resolveApiKey()).toBeNull();
  });

  it('returns null when auth.json apiKey is empty string', () => {
    writeAuthFile(JSON.stringify({ apiKey: '' }));

    expect(resolveApiKey()).toBeNull();
  });

  it('returns null when auth.json apiKey is not a string', () => {
    writeAuthFile(JSON.stringify({ apiKey: 12345 }));

    expect(resolveApiKey()).toBeNull();
  });
});

// ─── saveApiKey ────────────────────────────────────────────

describe('saveApiKey', () => {
  it('creates .vela/ directory and writes auth.json in v2 format', () => {
    saveApiKey('test-key-abc');

    const authPath = getAuthFilePath();
    expect(fs.existsSync(authPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    expect(content.activeProfile).toBe('default');
    expect(content.profiles).toHaveLength(1);
    expect(content.profiles[0].name).toBe('default');
    expect(content.profiles[0].apiKey).toBe('test-key-abc');
    expect(content.profiles[0].createdAt).toBeDefined();
  });

  it('sets file permission to 0o600', () => {
    saveApiKey('secret-key');

    const stat = fs.statSync(getAuthFilePath());
    const perms = stat.mode & 0o777;
    expect(perms).toBe(0o600);
  });

  it('overwrites existing auth.json default profile', () => {
    saveApiKey('first-key');
    saveApiKey('second-key');

    const content = JSON.parse(fs.readFileSync(getAuthFilePath(), 'utf-8'));
    expect(content.profiles).toHaveLength(1);
    expect(content.profiles[0].apiKey).toBe('second-key');
  });

  it('throws when parent directory is not writable', () => {
    // Create a read-only .vela dir so writeFileSync fails
    const velaDir = path.join(tmpDir, '.vela');
    fs.mkdirSync(velaDir, { recursive: true });
    fs.chmodSync(velaDir, 0o444);

    expect(() => saveApiKey('fail-key')).toThrow();

    // Restore permissions for cleanup
    fs.chmodSync(velaDir, 0o755);
  });

  it('saved key is readable by resolveApiKey', () => {
    saveApiKey('roundtrip-key');

    expect(resolveApiKey()).toBe('roundtrip-key');
  });
});

// ─── v1 → v2 migration ────────────────────────────────────

describe('v1 migration', () => {
  it('resolveApiKey reads v1 file as default profile', () => {
    writeAuthFile(JSON.stringify({ apiKey: 'v1-legacy-key' }));

    expect(resolveApiKey()).toBe('v1-legacy-key');
  });

  it('getActiveProfile returns default profile from v1 file', () => {
    writeAuthFile(JSON.stringify({ apiKey: 'v1-key-abc' }));

    const active = getActiveProfile();
    expect(active).not.toBeNull();
    expect(active!.name).toBe('default');
    expect(active!.apiKey).toBe('v1-key-abc');
  });

  it('listProfiles shows v1 file as single default profile', () => {
    writeAuthFile(JSON.stringify({ apiKey: 'v1-key-list' }));

    const profiles = listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.name).toBe('default');
    expect(profiles[0]!.active).toBe(true);
    expect(profiles[0]!.apiKey).toBe('v1-key-list');
  });

  it('saveApiKey on v1 file writes v2 format', () => {
    writeAuthFile(JSON.stringify({ apiKey: 'v1-old' }));
    saveApiKey('v2-new');

    const raw = JSON.parse(fs.readFileSync(getAuthFilePath(), 'utf-8'));
    expect(raw.profiles).toBeDefined();
    expect(Array.isArray(raw.profiles)).toBe(true);
    expect(raw.activeProfile).toBe('default');
    expect(raw.profiles[0].apiKey).toBe('v2-new');
  });

  it('v1 file with empty apiKey returns empty profiles', () => {
    writeAuthFile(JSON.stringify({ apiKey: '' }));

    expect(getActiveProfile()).toBeNull();
    expect(listProfiles()).toHaveLength(0);
  });
});

// ─── addProfile ────────────────────────────────────────────

describe('addProfile', () => {
  it('adds a profile and sets it active if first', () => {
    addProfile('work', 'sk-work-key');

    const profiles = listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.name).toBe('work');
    expect(profiles[0]!.active).toBe(true);
    expect(profiles[0]!.createdAt).toBeDefined();
  });

  it('adds second profile without changing active', () => {
    addProfile('work', 'sk-work-key');
    addProfile('personal', 'sk-personal-key');

    const profiles = listProfiles();
    expect(profiles).toHaveLength(2);
    const active = profiles.find((p) => p.active);
    expect(active!.name).toBe('work');
  });

  it('throws on duplicate profile name', () => {
    addProfile('dupe', 'sk-key-1');

    expect(() => addProfile('dupe', 'sk-key-2')).toThrow('already exists');
  });

  it('throws on empty profile name', () => {
    expect(() => addProfile('', 'sk-key')).toThrow('cannot be empty');
  });

  it('throws on whitespace-only profile name', () => {
    expect(() => addProfile('   ', 'sk-key')).toThrow('cannot be empty');
  });

  it('throws on empty API key', () => {
    expect(() => addProfile('test', '')).toThrow('cannot be empty');
  });

  it('allows profile names with special characters', () => {
    addProfile('my-work_key.v2', 'sk-special');

    const profiles = listProfiles();
    expect(profiles[0]!.name).toBe('my-work_key.v2');
  });

  it('sets chmod 600 on auth file', () => {
    addProfile('secure', 'sk-secret');

    const stat = fs.statSync(getAuthFilePath());
    const perms = stat.mode & 0o777;
    expect(perms).toBe(0o600);
  });
});

// ─── useProfile ────────────────────────────────────────────

describe('useProfile', () => {
  it('switches active profile', () => {
    addProfile('a', 'sk-a');
    addProfile('b', 'sk-b');

    useProfile('b');

    const active = getActiveProfile();
    expect(active!.name).toBe('b');
    expect(active!.apiKey).toBe('sk-b');
  });

  it('throws on nonexistent profile', () => {
    expect(() => useProfile('ghost')).toThrow('not found');
  });

  it('resolveApiKey returns newly active profile key', () => {
    addProfile('x', 'sk-x');
    addProfile('y', 'sk-y');

    useProfile('y');

    expect(resolveApiKey()).toBe('sk-y');
  });
});

// ─── removeProfile ─────────────────────────────────────────

describe('removeProfile', () => {
  it('removes an inactive profile', () => {
    addProfile('keep', 'sk-keep');
    addProfile('drop', 'sk-drop');

    removeProfile('drop');

    const profiles = listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.name).toBe('keep');
  });

  it('throws when removing active profile', () => {
    addProfile('only', 'sk-only');

    expect(() => removeProfile('only')).toThrow('active profile');
  });

  it('throws when removing nonexistent profile', () => {
    expect(() => removeProfile('nope')).toThrow('not found');
  });

  it('zero profiles after removing the only non-active profile', () => {
    addProfile('first', 'sk-first');
    addProfile('second', 'sk-second');

    // first is active, remove second
    removeProfile('second');

    const profiles = listProfiles();
    expect(profiles).toHaveLength(1);
  });
});

// ─── getActiveProfile ──────────────────────────────────────

describe('getActiveProfile', () => {
  it('returns null when no profiles exist', () => {
    expect(getActiveProfile()).toBeNull();
  });

  it('returns null when auth file does not exist', () => {
    expect(getActiveProfile()).toBeNull();
  });

  it('returns active profile after addProfile', () => {
    addProfile('prod', 'sk-prod');

    const active = getActiveProfile();
    expect(active!.name).toBe('prod');
    expect(active!.apiKey).toBe('sk-prod');
  });
});

// ─── maskApiKey ────────────────────────────────────────────

describe('maskApiKey', () => {
  it('masks long key (≥16 chars): first 8 + ... + last 4', () => {
    const key = 'sk-ant-api03-abcdefghij';
    const masked = maskApiKey(key);
    expect(masked).toBe('sk-ant-a...ghij');
  });

  it('masks medium key (6-15 chars): first 4 + ... + last 2', () => {
    const key = 'sk-short-key'; // 12 chars
    const masked = maskApiKey(key);
    expect(masked).toBe('sk-s...ey');
  });

  it('masks very short key (<6 chars) as just ...', () => {
    expect(maskApiKey('abc')).toBe('...');
  });

  it('handles empty string', () => {
    expect(maskApiKey('')).toBe('');
  });

  it('handles exactly 16 chars', () => {
    const key = '1234567890123456'; // 16 chars
    const masked = maskApiKey(key);
    expect(masked).toBe('12345678...3456');
  });

  it('handles exactly 6 chars (short path boundary)', () => {
    const key = '123456';
    const masked = maskApiKey(key);
    expect(masked).toBe('1234...56');
  });
});

// ─── Corrupt / edge-case files ─────────────────────────────

describe('corrupt and edge-case auth files', () => {
  it('treats corrupt JSON as empty profiles', () => {
    writeAuthFile('not valid json {{{');

    expect(getActiveProfile()).toBeNull();
    expect(listProfiles()).toHaveLength(0);
  });

  it('treats empty file as no profiles', () => {
    writeAuthFile('');

    expect(getActiveProfile()).toBeNull();
    expect(listProfiles()).toHaveLength(0);
  });

  it('handles v2 file with missing profile fields gracefully', () => {
    writeAuthFile(JSON.stringify({
      activeProfile: 'a',
      profiles: [
        { name: 'a', apiKey: 'sk-a' },
        { name: 'b' }, // missing apiKey — should be filtered
        { apiKey: 'sk-c' }, // missing name — should be filtered
      ],
    }));

    const profiles = listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.name).toBe('a');
  });
});
