import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDefaultConfig, readConfig } from './config.js';
import { copyHookScripts, registerHooks } from './hook-registration.js';

export interface InitResult {
  ok: true;
  created: string[];
  alreadyInitialized?: boolean;
  hooksCopied?: string[];
  hooksRegistered?: string[];
  agentsCopied?: string[];
}

const GITIGNORE_ENTRIES = [
  '# Vela (auto-managed)',
  '.vela/state/',
  '.vela/cache/',
  '.vela/artifacts/',
];

/**
 * Returns the directory where bundled agent prompts live inside the
 * installed npm package. Uses import.meta.url to resolve relative
 * to this module (same pattern as getBundledHooksDir in hook-registration.ts).
 */
function getBundledAgentsDir(): string {
  const thisDir = path.dirname(new URL(import.meta.url).pathname);
  return path.join(thisDir, 'agents');
}

/**
 * Recursively walks a directory and returns all file paths relative
 * to the root directory.
 */
function walkDir(dir: string, root: string = dir): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, root));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(path.relative(root, fullPath));
    }
  }
  return results;
}

/**
 * Copies bundled agent prompt files to the project's `.vela/agents/`
 * directory with **no-overwrite** semantics — only copies files that
 * don't already exist, preserving user overrides.
 *
 * Returns the list of relative paths that were actually copied.
 */
export function copyAgentPrompts(projectRoot: string): string[] {
  const srcDir = getBundledAgentsDir();
  const dstDir = path.join(projectRoot, '.vela', 'agents');

  // If bundled agents dir doesn't exist (dev without build), return empty
  if (!fs.existsSync(srcDir)) {
    return [];
  }

  const files = walkDir(srcDir);
  const copied: string[] = [];

  for (const relPath of files) {
    const dstPath = path.join(dstDir, relPath);

    // No-overwrite: skip if destination already exists
    if (fs.existsSync(dstPath)) {
      continue;
    }

    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });

    // Copy the file
    fs.copyFileSync(path.join(srcDir, relPath), dstPath);
    copied.push(path.join('.vela', 'agents', relPath));
  }

  return copied;
}

/**
 * Reads `.gitignore` (or creates it) and appends Vela entries
 * that aren't already present. Idempotent — each entry is checked
 * individually before appending.
 */
export function ensureGitignore(cwd: string): void {
  const gitignorePath = path.join(cwd, '.gitignore');

  let content = '';
  try {
    content = fs.readFileSync(gitignorePath, 'utf-8');
  } catch {
    // File doesn't exist yet — we'll create it.
  }

  const toAdd: string[] = [];
  for (const entry of GITIGNORE_ENTRIES) {
    if (!content.includes(entry)) {
      toAdd.push(entry);
    }
  }

  if (toAdd.length === 0) return;

  // Ensure we start on a new line if file has existing content without trailing newline
  const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  const block = separator + toAdd.join('\n') + '\n';
  fs.appendFileSync(gitignorePath, block, 'utf-8');
}

/**
 * Initialize Vela in the given directory.
 *
 * - If `.vela/config.json` already exists with valid JSON, returns early
 *   with `alreadyInitialized: true`.
 * - Otherwise creates `.vela/`, `.vela/state/`, writes the default
 *   `config.json`, and ensures `.gitignore` has Vela entries.
 */
export function initProject(cwd: string): InitResult {
  // Already initialized?
  const existingConfig = readConfig(cwd);
  if (existingConfig !== null) {
    // Still copy hook scripts and register them (upgrade path)
    const hooksCopied = copyHookScripts(cwd);
    const hooksRegistered = registerHooks(cwd);
    // Copy agent prompts with no-overwrite (preserve user customizations)
    const agentsCopied = copyAgentPrompts(cwd);
    return { ok: true, created: [], alreadyInitialized: true, hooksCopied, hooksRegistered, agentsCopied };
  }

  const created: string[] = [];

  // Create .vela/ directory (recursive handles both .vela/ and .vela/state/)
  const velaDir = path.join(cwd, '.vela');
  const stateDir = path.join(velaDir, 'state');

  fs.mkdirSync(velaDir, { recursive: true });
  created.push('.vela/');

  fs.mkdirSync(stateDir, { recursive: true });
  created.push('.vela/state/');

  // Write default config
  const configPath = path.join(velaDir, 'config.json');
  const config = getDefaultConfig();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  created.push('.vela/config.json');

  // Ensure .gitignore entries
  ensureGitignore(cwd);

  // Copy hook scripts and register them in Claude Code settings
  const hooksCopied = copyHookScripts(cwd);
  const hooksRegistered = registerHooks(cwd);

  // Copy agent prompts with no-overwrite (preserve user customizations)
  const agentsCopied = copyAgentPrompts(cwd);

  return { ok: true, created, hooksCopied, hooksRegistered, agentsCopied };
}
