import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * A single hook definition describing which event to intercept
 * and which script to run.
 */
export interface HookDefinition {
  /** Claude Code event type: PreToolUse, PostToolUse, etc. */
  event: string;
  /** Tool name matcher (empty string = match all tools for that event). */
  matcher: string;
  /** Absolute path to the hook script in .vela/hooks/. */
  scriptPath: string;
  /** Status message shown in the Claude Code spinner. */
  statusMessage: string;
  /** Identifier used for deduplication (e.g. 'gate-keeper'). */
  hookId: string;
}

/**
 * Shape of a single entry inside the hooks arrays in settings.local.json.
 * Matches the Claude Code hooks API (nested format).
 */
interface ClaudeHookEntry {
  matcher: string;
  hooks: Array<{
    type: string;
    command: string;
    statusMessage?: string;
  }>;
}

/**
 * Shape of the Claude Code settings.local.json (subset we care about).
 */
interface ClaudeSettings {
  hooks?: Record<string, ClaudeHookEntry[]>;
  [key: string]: unknown;
}

/** Vela hook ID prefix for matching during deduplication. */
const HOOK_PREFIX = 'gate-';

/**
 * Returns the directory where bundled hook scripts live inside the
 * installed npm package. Uses import.meta.url to resolve relative
 * to this module.
 */
function getBundledHooksDir(): string {
  // At runtime this module lives at dist/hook-registration.js.
  // Hooks are copied to dist/hooks/ by the postbuild step.
  // In dev (tsx), this module is at src/hook-registration.ts and
  // hooks are at src/hooks/.
  const thisDir = path.dirname(new URL(import.meta.url).pathname);
  const candidate = path.join(thisDir, 'hooks');
  return candidate;
}

/**
 * Returns the hook definitions that vela init should register.
 * For S01 scope: gate-keeper (PreToolUse) and gate-guard (PreToolUse).
 */
export function getHookDefinitions(projectRoot: string): HookDefinition[] {
  const hooksDir = path.join(projectRoot, '.vela', 'hooks');

  return [
    {
      event: 'PreToolUse',
      matcher: '',
      scriptPath: path.join(hooksDir, 'gate-keeper.cjs'),
      statusMessage: '⛵ Checking harbor clearance...',
      hookId: 'gate-keeper',
    },
    {
      event: 'PreToolUse',
      matcher: '',
      scriptPath: path.join(hooksDir, 'gate-guard.cjs'),
      statusMessage: '🌟 Verifying navigation chart...',
      hookId: 'gate-guard',
    },
    {
      event: 'PostToolUse',
      matcher: '',
      scriptPath: path.join(hooksDir, 'tracker.cjs'),
      statusMessage: '🔭 Tracking tool usage...',
      hookId: 'tracker',
    },
  ];
}

/**
 * Copies bundled hook scripts from the npm package into the project's
 * `.vela/hooks/` directory.
 *
 * Files copied:
 * - gate-keeper.cjs
 * - gate-guard.cjs
 * - shared/constants.cjs
 * - shared/pipeline.cjs
 *
 * Creates directories as needed. Overwrites existing files (upgrade path).
 */
export function copyHookScripts(projectRoot: string): string[] {
  const srcDir = getBundledHooksDir();
  const dstDir = path.join(projectRoot, '.vela', 'hooks');
  const sharedDst = path.join(dstDir, 'shared');

  // Ensure destination directories exist
  fs.mkdirSync(dstDir, { recursive: true });
  fs.mkdirSync(sharedDst, { recursive: true });

  const filesToCopy = [
    { src: 'gate-keeper.cjs', dst: 'gate-keeper.cjs' },
    { src: 'gate-guard.cjs', dst: 'gate-guard.cjs' },
    { src: 'tracker.cjs', dst: 'tracker.cjs' },
    { src: path.join('shared', 'constants.cjs'), dst: path.join('shared', 'constants.cjs') },
    { src: path.join('shared', 'pipeline.cjs'), dst: path.join('shared', 'pipeline.cjs') },
  ];

  const copied: string[] = [];
  for (const f of filesToCopy) {
    const srcPath = path.join(srcDir, f.src);
    const dstPath = path.join(dstDir, f.dst);

    if (!fs.existsSync(srcPath)) {
      // Source missing — skip silently (may be running from dev without build)
      continue;
    }

    fs.copyFileSync(srcPath, dstPath);
    copied.push(path.join('.vela', 'hooks', f.dst));
  }

  return copied;
}

/**
 * Reads `.claude/settings.local.json`, creating it if it doesn't exist.
 */
function readSettings(projectRoot: string): ClaudeSettings {
  const settingsPath = path.join(projectRoot, '.claude', 'settings.local.json');
  if (!fs.existsSync(settingsPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as ClaudeSettings;
  } catch {
    return {};
  }
}

/**
 * Writes settings to `.claude/settings.local.json`, creating the
 * `.claude/` directory if needed.
 */
function writeSettings(projectRoot: string, settings: ClaudeSettings): void {
  const claudeDir = path.join(projectRoot, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });

  const settingsPath = path.join(claudeDir, 'settings.local.json');
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

/**
 * Checks whether an existing hook entry is a Vela hook by inspecting
 * the command string for a known hook ID.
 */
function isVelaHookEntry(entry: ClaudeHookEntry, hookId: string): boolean {
  if (!entry.hooks || !Array.isArray(entry.hooks)) return false;
  return entry.hooks.some(
    (h) => h.command && h.command.includes(hookId + '.cjs'),
  );
}

/**
 * Registers Vela hooks into `.claude/settings.local.json`.
 *
 * - Creates the file if it doesn't exist.
 * - Removes any existing Vela hook entries before adding (idempotent).
 * - Uses the Claude Code nested hook format per the hooks API.
 */
export function registerHooks(projectRoot: string): string[] {
  const settings = readSettings(projectRoot);
  const definitions = getHookDefinitions(projectRoot);

  if (!settings.hooks) {
    settings.hooks = {};
  }

  const registered: string[] = [];

  for (const def of definitions) {
    if (!settings.hooks[def.event]) {
      settings.hooks[def.event] = [];
    }

    // Remove any existing entry for this hook (deduplication)
    settings.hooks[def.event] = (settings.hooks[def.event] as ClaudeHookEntry[]).filter(
      (entry) => !isVelaHookEntry(entry, def.hookId),
    );

    // Add the hook entry
    settings.hooks[def.event].push({
      matcher: def.matcher,
      hooks: [
        {
          type: 'command',
          command: `node "${def.scriptPath}"`,
          statusMessage: def.statusMessage,
        },
      ],
    });

    registered.push(def.hookId);
  }

  writeSettings(projectRoot, settings);
  return registered;
}

/**
 * Removes all Vela hook entries from `.claude/settings.local.json`.
 * Does not remove the file itself or non-Vela entries.
 */
export function unregisterHooks(projectRoot: string): number {
  const settings = readSettings(projectRoot);
  if (!settings.hooks) return 0;

  const definitions = getHookDefinitions(projectRoot);
  let removed = 0;

  for (const def of definitions) {
    const entries = settings.hooks[def.event];
    if (!entries) continue;

    const before = entries.length;
    settings.hooks[def.event] = entries.filter(
      (entry) => !isVelaHookEntry(entry as ClaudeHookEntry, def.hookId),
    );
    removed += before - settings.hooks[def.event].length;

    // Clean up empty event arrays
    if (settings.hooks[def.event].length === 0) {
      delete settings.hooks[def.event];
    }
  }

  // Clean up empty hooks object
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  writeSettings(projectRoot, settings);
  return removed;
}
