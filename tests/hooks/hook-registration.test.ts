/**
 * Tests for hook registration and bundling.
 * Verifies that vela init copies hook scripts and registers them
 * in .claude/settings.local.json correctly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getHookDefinitions,
  copyHookScripts,
  registerHooks,
  unregisterHooks,
} from '../../src/hook-registration.js';
import { initProject } from '../../src/init.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-hook-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('hook-registration', () => {
  describe('getHookDefinitions', () => {
    it('returns definitions for vela-gate and tracker', () => {
      const defs = getHookDefinitions(tmpDir);
      expect(defs).toHaveLength(2);

      const gate = defs.find((d) => d.hookId === 'vela-gate');
      expect(gate).toBeDefined();
      expect(gate!.event).toBe('PreToolUse');
      expect(gate!.matcher).toBe('');
      expect(gate!.scriptPath).toContain(path.join('.vela', 'hooks', 'vela-gate.cjs'));
      expect(gate!.statusMessage).toBeTruthy();

      const tracker = defs.find((d) => d.hookId === 'tracker');
      expect(tracker).toBeDefined();
      expect(tracker!.event).toBe('PostToolUse');
      expect(tracker!.scriptPath).toContain(path.join('.vela', 'hooks', 'tracker.cjs'));
    });
  });

  describe('copyHookScripts', () => {
    it('copies vela-gate, tracker, and shared modules to .vela/hooks/', () => {
      // Ensure .vela/ exists
      fs.mkdirSync(path.join(tmpDir, '.vela'), { recursive: true });

      const copied = copyHookScripts(tmpDir);

      // Should copy 4 files
      expect(copied.length).toBe(4);
      expect(copied).toContain(path.join('.vela', 'hooks', 'vela-gate.cjs'));
      expect(copied).toContain(path.join('.vela', 'hooks', 'tracker.cjs'));
      expect(copied).toContain(path.join('.vela', 'hooks', 'shared', 'constants.cjs'));
      expect(copied).toContain(path.join('.vela', 'hooks', 'shared', 'pipeline.cjs'));

      // Verify files exist on disk
      expect(fs.existsSync(path.join(tmpDir, '.vela', 'hooks', 'vela-gate.cjs'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.vela', 'hooks', 'tracker.cjs'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.vela', 'hooks', 'shared', 'constants.cjs'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.vela', 'hooks', 'shared', 'pipeline.cjs'))).toBe(true);
    });

    it('creates .vela/hooks/ and shared/ directories if missing', () => {
      fs.mkdirSync(path.join(tmpDir, '.vela'), { recursive: true });
      copyHookScripts(tmpDir);

      expect(fs.statSync(path.join(tmpDir, '.vela', 'hooks')).isDirectory()).toBe(true);
      expect(fs.statSync(path.join(tmpDir, '.vela', 'hooks', 'shared')).isDirectory()).toBe(true);
    });

    it('overwrites existing files (upgrade path)', () => {
      fs.mkdirSync(path.join(tmpDir, '.vela', 'hooks', 'shared'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.vela', 'hooks', 'vela-gate.cjs'), 'old content');

      copyHookScripts(tmpDir);

      const content = fs.readFileSync(path.join(tmpDir, '.vela', 'hooks', 'vela-gate.cjs'), 'utf-8');
      expect(content).not.toBe('old content');
      expect(content).toContain('Vela Gate');
    });
  });

  describe('registerHooks', () => {
    it('creates .claude/settings.local.json with PreToolUse hooks', () => {
      fs.mkdirSync(path.join(tmpDir, '.vela', 'hooks'), { recursive: true });
      registerHooks(tmpDir);

      const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
      expect(fs.existsSync(settingsPath)).toBe(true);

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.PreToolUse).toBeDefined();
      expect(settings.hooks.PreToolUse).toHaveLength(1);
    });

    it('registers hooks with correct Claude Code format', () => {
      fs.mkdirSync(path.join(tmpDir, '.vela', 'hooks'), { recursive: true });
      registerHooks(tmpDir);

      const settings = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.claude', 'settings.local.json'), 'utf-8'),
      );

      const gateEntry = settings.hooks.PreToolUse.find(
        (e: any) => e.hooks && e.hooks[0]?.command?.includes('vela-gate'),
      );
      expect(gateEntry).toBeDefined();
      expect(gateEntry.matcher).toBe('');
      expect(gateEntry.hooks).toHaveLength(1);
      expect(gateEntry.hooks[0].type).toBe('command');
      expect(gateEntry.hooks[0].command).toMatch(/^node ".+vela-gate\.cjs"$/);
      expect(gateEntry.hooks[0].statusMessage).toBeTruthy();
    });

    it('is idempotent — re-running does not create duplicate entries', () => {
      fs.mkdirSync(path.join(tmpDir, '.vela', 'hooks'), { recursive: true });

      registerHooks(tmpDir);
      registerHooks(tmpDir);
      registerHooks(tmpDir);

      const settings = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.claude', 'settings.local.json'), 'utf-8'),
      );

      expect(settings.hooks.PreToolUse).toHaveLength(1);
    });

    it('preserves existing non-Vela hooks', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      // Pre-existing settings with a custom hook
      const existingSettings = {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [{ type: 'command', command: 'node my-custom-hook.js' }],
            },
          ],
        },
      };
      fs.writeFileSync(
        path.join(claudeDir, 'settings.local.json'),
        JSON.stringify(existingSettings, null, 2),
      );

      fs.mkdirSync(path.join(tmpDir, '.vela', 'hooks'), { recursive: true });
      registerHooks(tmpDir);

      const settings = JSON.parse(
        fs.readFileSync(path.join(claudeDir, 'settings.local.json'), 'utf-8'),
      );

      // 1 custom + 1 Vela = 2
      expect(settings.hooks.PreToolUse).toHaveLength(2);
      const customHook = settings.hooks.PreToolUse.find(
        (e: any) => e.hooks?.[0]?.command === 'node my-custom-hook.js',
      );
      expect(customHook).toBeDefined();
    });

    it('preserves existing non-hook settings', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      const existingSettings = {
        agent: 'my-agent',
        permissions: { deny: ['Bash(rm -rf *)'] },
      };
      fs.writeFileSync(
        path.join(claudeDir, 'settings.local.json'),
        JSON.stringify(existingSettings, null, 2),
      );

      fs.mkdirSync(path.join(tmpDir, '.vela', 'hooks'), { recursive: true });
      registerHooks(tmpDir);

      const settings = JSON.parse(
        fs.readFileSync(path.join(claudeDir, 'settings.local.json'), 'utf-8'),
      );

      expect(settings.agent).toBe('my-agent');
      expect(settings.permissions.deny).toContain('Bash(rm -rf *)');
    });
  });

  describe('unregisterHooks', () => {
    it('removes Vela hook entries from settings', () => {
      fs.mkdirSync(path.join(tmpDir, '.vela', 'hooks'), { recursive: true });
      registerHooks(tmpDir);

      const removed = unregisterHooks(tmpDir);
      expect(removed).toBe(2);

      const settings = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.claude', 'settings.local.json'), 'utf-8'),
      );

      // hooks object should be cleaned up entirely
      expect(settings.hooks).toBeUndefined();
    });

    it('preserves non-Vela hooks when unregistering', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      const existingSettings = {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [{ type: 'command', command: 'node my-custom-hook.js' }],
            },
          ],
        },
      };
      fs.writeFileSync(
        path.join(claudeDir, 'settings.local.json'),
        JSON.stringify(existingSettings, null, 2),
      );

      fs.mkdirSync(path.join(tmpDir, '.vela', 'hooks'), { recursive: true });
      registerHooks(tmpDir);
      unregisterHooks(tmpDir);

      const settings = JSON.parse(
        fs.readFileSync(path.join(claudeDir, 'settings.local.json'), 'utf-8'),
      );

      expect(settings.hooks.PreToolUse).toHaveLength(1);
      expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe('node my-custom-hook.js');
    });

    it('returns 0 when no Vela hooks exist', () => {
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, 'settings.local.json'),
        JSON.stringify({}, null, 2),
      );

      fs.mkdirSync(path.join(tmpDir, '.vela', 'hooks'), { recursive: true });
      const removed = unregisterHooks(tmpDir);
      expect(removed).toBe(0);
    });
  });
});

describe('initProject with hooks', () => {
  it('copies hook scripts and registers them during fresh init', () => {
    const result = initProject(tmpDir);
    expect(result.ok).toBe(true);

    // Hooks should be copied
    expect(result.hooksCopied).toBeDefined();
    expect(result.hooksCopied!.length).toBeGreaterThanOrEqual(0);

    // Hooks should be registered
    expect(result.hooksRegistered).toBeDefined();
    expect(result.hooksRegistered).toContain('vela-gate');

    // settings.local.json should exist with hook entries
    const settingsPath = path.join(tmpDir, '.claude', 'settings.local.json');
    expect(fs.existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(settings.hooks?.PreToolUse).toBeDefined();
    expect(settings.hooks.PreToolUse.length).toBe(1);
  });

  it('re-registers hooks on re-init (idempotent)', () => {
    initProject(tmpDir);
    const result = initProject(tmpDir);

    expect(result.ok).toBe(true);
    expect(result.alreadyInitialized).toBe(true);
    expect(result.hooksRegistered).toContain('vela-gate');

    // No duplicate entries
    const settings = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.claude', 'settings.local.json'), 'utf-8'),
    );
    expect(settings.hooks.PreToolUse).toHaveLength(1);
  });
});
