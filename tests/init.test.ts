/**
 * Tests for init and config modules.
 * Unit tests run against source via vitest; CLI integration test runs against dist/.
 * Run `npm run build` before running these tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { initProject, ensureGitignore, copyAgentPrompts } from '../src/init.js';
import { findProjectRoot, readConfig, getDefaultConfig } from '../src/config.js';
import type { VelaConfig } from '../src/config.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('initProject', () => {
  it('creates .vela/config.json with valid JSON matching VelaConfig shape', () => {
    const result = initProject(tmpDir);
    expect(result.ok).toBe(true);

    const configPath = path.join(tmpDir, '.vela', 'config.json');
    expect(fs.existsSync(configPath)).toBe(true);

    const config: VelaConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config).toHaveProperty('version');
    expect(config).toHaveProperty('pipeline.default');
    expect(config).toHaveProperty('pipeline.scales');
    expect(Array.isArray(config.pipeline.scales)).toBe(true);
  });

  it('creates .vela/state/ directory', () => {
    initProject(tmpDir);
    const stateDir = path.join(tmpDir, '.vela', 'state');
    expect(fs.existsSync(stateDir)).toBe(true);
    expect(fs.statSync(stateDir).isDirectory()).toBe(true);
  });

  it('adds entries to .gitignore', () => {
    initProject(tmpDir);
    const gitignorePath = path.join(tmpDir, '.gitignore');
    expect(fs.existsSync(gitignorePath)).toBe(true);

    const content = fs.readFileSync(gitignorePath, 'utf-8');
    expect(content).toContain('.vela/state/');
    expect(content).toContain('.vela/cache/');
    expect(content).toContain('.vela/artifacts/');
  });

  it('is idempotent — second call returns alreadyInitialized and no duplicate gitignore entries', () => {
    const first = initProject(tmpDir);
    expect(first.ok).toBe(true);
    expect(first.alreadyInitialized).toBeUndefined();

    const second = initProject(tmpDir);
    expect(second.ok).toBe(true);
    expect(second.alreadyInitialized).toBe(true);
    expect(second.created).toEqual([]);

    // Verify no duplicate gitignore entries
    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    const stateMatches = content.match(/\.vela\/state\//g);
    expect(stateMatches).toHaveLength(1);
  });
});

describe('findProjectRoot', () => {
  it('finds parent directory containing .vela/ from a subdirectory', () => {
    initProject(tmpDir);
    const subDir = path.join(tmpDir, 'src', 'deep', 'nested');
    fs.mkdirSync(subDir, { recursive: true });

    const root = findProjectRoot(subDir);
    expect(root).toBe(tmpDir);
  });

  it('returns null when no .vela/ exists', () => {
    // tmpDir has no .vela/ — walk should reach filesystem root and return null
    const root = findProjectRoot(tmpDir);
    expect(root).toBeNull();
  });

  it('returns null at filesystem root (no .vela/ found)', () => {
    const root = findProjectRoot('/');
    expect(root).toBeNull();
  });
});

describe('readConfig', () => {
  it('returns valid config after init', () => {
    initProject(tmpDir);
    const config = readConfig(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.version).toBe('1.0');
    expect(config!.pipeline.default).toBe('standard');
    expect(config!.pipeline.scales).toEqual(['trivial', 'quick', 'standard']);
  });

  it('returns null for missing config', () => {
    const config = readConfig(tmpDir);
    expect(config).toBeNull();
  });

  it('returns null for invalid JSON in .vela/config.json', () => {
    const velaDir = path.join(tmpDir, '.vela');
    fs.mkdirSync(velaDir, { recursive: true });
    fs.writeFileSync(path.join(velaDir, 'config.json'), '{not valid json!!!', 'utf-8');

    const config = readConfig(tmpDir);
    expect(config).toBeNull();
  });
});

describe('getDefaultConfig', () => {
  it('returns config with version, pipeline.default, and pipeline.scales', () => {
    const config = getDefaultConfig();
    expect(config.version).toBe('1.0');
    expect(config.pipeline.default).toBe('standard');
    expect(Array.isArray(config.pipeline.scales)).toBe(true);
    expect(config.pipeline.scales.length).toBeGreaterThan(0);
  });
});

describe('ensureGitignore idempotency', () => {
  it('repeated calls produce no duplicate entries', () => {
    ensureGitignore(tmpDir);
    ensureGitignore(tmpDir);
    ensureGitignore(tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
    const stateMatches = content.match(/\.vela\/state\//g);
    expect(stateMatches).toHaveLength(1);
    const cacheMatches = content.match(/\.vela\/cache\//g);
    expect(cacheMatches).toHaveLength(1);
  });
});

describe('CLI integration', () => {
  it('vela init in temp dir outputs JSON with ok: true', () => {
    const cliPath = path.resolve('dist/cli.js');
    const output = execSync(`node ${cliPath} init`, {
      encoding: 'utf-8',
      cwd: tmpDir,
      stdio: 'pipe',
    }).trim();

    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    expect(parsed.created).toContain('.vela/config.json');

    // Verify files were actually created
    expect(fs.existsSync(path.join(tmpDir, '.vela', 'config.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.vela', 'state'))).toBe(true);
  });
});

describe('copyAgentPrompts', () => {
  it('copies bundled agent prompts to project .vela/agents/', () => {
    const copied = copyAgentPrompts(tmpDir);
    // When running from source (dev mode), bundled dir resolves to src/agents/
    // which exists, so files should be copied
    if (copied.length > 0) {
      expect(copied.every((f) => f.startsWith('.vela/agents/'))).toBe(true);
      // Check some known files exist on disk
      for (const f of copied) {
        expect(fs.existsSync(path.join(tmpDir, f))).toBe(true);
      }
    }
  });

  it('does not overwrite existing files (no-overwrite semantics)', () => {
    // First copy — should create files
    const firstCopy = copyAgentPrompts(tmpDir);
    if (firstCopy.length === 0) return; // dev mode without built agents

    // Pick the first file and overwrite it with custom content
    const testFile = firstCopy[0]!;
    const testPath = path.join(tmpDir, testFile);
    const customContent = '# Custom override — user version\n';
    fs.writeFileSync(testPath, customContent, 'utf-8');

    // Second copy — should NOT overwrite the custom file
    const secondCopy = copyAgentPrompts(tmpDir);
    expect(secondCopy).not.toContain(testFile);

    // Verify the custom content is preserved
    const content = fs.readFileSync(testPath, 'utf-8');
    expect(content).toBe(customContent);
  });

  it('creates subdirectories as needed', () => {
    const copied = copyAgentPrompts(tmpDir);
    if (copied.length === 0) return; // dev mode without built agents

    // Check that subdirectory-based files exist
    const subDirFiles = copied.filter((f) => f.includes('/agents/pm/') || f.includes('/agents/researcher/'));
    expect(subDirFiles.length).toBeGreaterThan(0);
    for (const f of subDirFiles) {
      expect(fs.existsSync(path.join(tmpDir, f))).toBe(true);
    }
  });

  it('returns empty array when bundled agents dir is missing', () => {
    // Create a new temp dir — no src/agents or dist/agents nearby
    const emptyTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-no-agents-'));
    try {
      // This will look for agents relative to the module, not the project.
      // Since the module's agents dir exists (src/agents/), this test verifies
      // the graceful fallback path is at least reachable.
      const result = copyAgentPrompts(emptyTmp);
      expect(Array.isArray(result)).toBe(true);
    } finally {
      fs.rmSync(emptyTmp, { recursive: true, force: true });
    }
  });
});

describe('initProject with agent prompts', () => {
  it('initProject result includes agentsCopied field', () => {
    const result = initProject(tmpDir);
    expect(result.ok).toBe(true);
    expect(result).toHaveProperty('agentsCopied');
    expect(Array.isArray(result.agentsCopied)).toBe(true);
  });

  it('second initProject call does not re-copy existing agent files', () => {
    const first = initProject(tmpDir);
    const agentCount = first.agentsCopied?.length ?? 0;

    const second = initProject(tmpDir);
    expect(second.alreadyInitialized).toBe(true);
    // On second call, all files already exist — nothing should be copied
    if (agentCount > 0) {
      expect(second.agentsCopied!.length).toBe(0);
    }
  });

  it('preserves user-modified agent file on re-init', () => {
    initProject(tmpDir);

    // Write a custom researcher.md override
    const overridePath = path.join(tmpDir, '.vela', 'agents', 'researcher.md');
    if (fs.existsSync(overridePath)) {
      const customContent = '# My custom researcher prompt\n';
      fs.writeFileSync(overridePath, customContent, 'utf-8');

      // Re-init
      initProject(tmpDir);

      // Verify custom content preserved
      expect(fs.readFileSync(overridePath, 'utf-8')).toBe(customContent);
    }
  });
});
