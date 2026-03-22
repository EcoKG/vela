#!/usr/bin/env node
/**
 * Vela Hook Installer
 *
 * Registers Vela hooks into the PROJECT-LOCAL .claude/settings.local.json
 * so they only trigger within this Vela-enabled project.
 *
 * Why project-local instead of global (~/.claude/settings.json)?
 * - Vela is a sandbox — hooks should not leak outside the project
 * - No performance overhead on non-Vela projects
 * - Multiple Vela projects can have independent configurations
 * - Deleting the project automatically removes hook registrations
 *
 * Usage:
 *   node install.js                    — Install hooks
 *   node install.js verify             — Verify installation
 *   node install.js uninstall          — Remove all Vela hooks
 *   node install.js status             — Show current hook status
 */

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || process.env.USERPROFILE;
const PROJECT_ROOT = findProjectRoot(process.cwd());
const SETTINGS_PATH = path.join(PROJECT_ROOT, '.claude', 'settings.local.json');
const VELA_HOOKS_DIR = path.join(PROJECT_ROOT, '.vela', 'hooks');

/**
 * Walk up from cwd to find the project root (where .vela/ lives).
 */
function findProjectRoot(startDir) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.vela'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return startDir;
}

const HOOK_PREFIX = 'vela-';

// ─── Permission deny rules ───
// Claude Code's deny rules are absolute — denied at any level = blocked everywhere.
// These rules provide a second layer of defense alongside Gate Keeper/Guard hooks.
const VELA_PERMISSIONS = {
  deny: [
    // Destructive file operations
    'Bash(rm -rf *)',
    'Bash(rm -r *)',
    // Force push — all variants
    'Bash(git push --force *)',
    'Bash(git push -f *)',
    'Bash(git push --force-with-lease *)',
    'Bash(git push origin +*)',
    // Hard reset — destroys uncommitted work
    'Bash(git reset --hard *)',
    // Skip hooks — Vela hooks must never be bypassed
    'Bash(git commit --no-verify *)',
    'Bash(git commit -n *)',
    // Clean untracked files — can delete work
    'Bash(git clean -f *)',
    'Bash(git clean -fd *)',
    // Direct database drops
    'Bash(drop database *)',
    'Bash(DROP DATABASE *)',
  ],
  allow: [
    // Vela CLI tools — always allowed through Bash
    'Bash(node .vela/*)',
    'Bash(python .vela/*)',
    'Bash(python3 .vela/*)',
  ]
};

const VELA_HOOKS = [
  {
    matcher: 'PreToolUse',
    hookId: 'vela-gate-keeper',
    script: 'vela-gate-keeper.js',
    description: 'Vela Gate Keeper: R/W mode enforcement and sandbox control'
  },
  {
    matcher: 'PreToolUse',
    hookId: 'vela-gate-guard',
    script: 'vela-gate-guard.js',
    description: 'Vela Gate Guard: Pipeline compliance enforcement'
  },
  {
    matcher: 'UserPromptSubmit',
    hookId: 'vela-orchestrator',
    script: 'vela-orchestrator.js',
    description: 'Vela Orchestrator: Pipeline state injection per turn'
  },
  {
    matcher: 'PostToolUse',
    hookId: 'vela-tracker',
    script: 'vela-tracker.js',
    description: 'Vela Tracker: Action tracking and cache updates'
  }
];

const command = process.argv[2] || 'install';

switch (command) {
  case 'install': install(); break;
  case 'verify': verify(); break;
  case 'uninstall': uninstall(); break;
  case 'status': status(); break;
  default:
    console.log(JSON.stringify({ ok: false, error: `Unknown command: ${command}` }));
    process.exit(1);
}

function install() {
  const settings = readSettings();

  if (!settings.hooks) {
    settings.hooks = {};
  }

  const installed = [];
  const errors = [];

  for (const hook of VELA_HOOKS) {
    const scriptPath = path.join(VELA_HOOKS_DIR, hook.script);

    // Verify script exists
    if (!fs.existsSync(scriptPath)) {
      errors.push(`Script not found: ${scriptPath}`);
      continue;
    }

    // Initialize event array if needed
    if (!settings.hooks[hook.matcher]) {
      settings.hooks[hook.matcher] = [];
    }

    // Remove existing Vela hook entry with same ID
    settings.hooks[hook.matcher] = settings.hooks[hook.matcher].filter(entry => {
      if (!entry.hooks || !Array.isArray(entry.hooks)) return true;
      return !entry.hooks.some(h => h.command && h.command.includes(hook.hookId));
    });

    // Add the hook in correct Claude Code format:
    // { matcher: "ToolName", hooks: [{ type: "command", command: "..." }] }
    settings.hooks[hook.matcher].push({
      matcher: hook.toolMatcher || '',
      hooks: [{
        type: 'command',
        command: `node "${scriptPath}"`,
        statusMessage: hook.description
      }]
    });

    installed.push(hook.hookId);
  }

  // ─── Register permission rules ───
  if (!settings.permissions) {
    settings.permissions = {};
  }

  // Merge deny rules (deduplicate)
  const existingDeny = new Set(settings.permissions.deny || []);
  for (const rule of VELA_PERMISSIONS.deny) {
    existingDeny.add(rule);
  }
  settings.permissions.deny = [...existingDeny];

  // Merge allow rules (deduplicate)
  const existingAllow = new Set(settings.permissions.allow || []);
  for (const rule of VELA_PERMISSIONS.allow) {
    existingAllow.add(rule);
  }
  settings.permissions.allow = [...existingAllow];

  writeSettings(settings);

  // Create state directory for session tracking (project-local)
  const stateDir = path.join(PROJECT_ROOT, '.vela', 'state');
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  const permissionCount = VELA_PERMISSIONS.deny.length + VELA_PERMISSIONS.allow.length;

  console.log(JSON.stringify({
    ok: errors.length === 0,
    command: 'install',
    installed: installed,
    permissions: {
      deny_rules: VELA_PERMISSIONS.deny.length,
      allow_rules: VELA_PERMISSIONS.allow.length
    },
    errors: errors,
    settings_path: SETTINGS_PATH,
    message: errors.length === 0
      ? `Successfully installed ${installed.length} Vela hooks + ${permissionCount} permission rules.`
      : `Installed ${installed.length} hooks with ${errors.length} errors.`
  }, null, 2));
}

function verify() {
  const settings = readSettings();
  const results = [];

  for (const hook of VELA_HOOKS) {
    const scriptPath = path.join(VELA_HOOKS_DIR, hook.script);
    const scriptExists = fs.existsSync(scriptPath);

    const matcherHooks = settings.hooks?.[hook.matcher] || [];
    const registered = matcherHooks.some(entry =>
      entry.hooks && Array.isArray(entry.hooks) &&
      entry.hooks.some(h => h.command && h.command.includes(hook.hookId))
    );

    results.push({
      id: hook.hookId,
      matcher: hook.matcher,
      script_exists: scriptExists,
      registered: registered,
      status: scriptExists && registered ? 'OK' : 'MISSING'
    });
  }

  const allOk = results.every(r => r.status === 'OK');

  console.log(JSON.stringify({
    ok: allOk,
    command: 'verify',
    hooks: results,
    message: allOk
      ? 'All Vela hooks verified successfully.'
      : 'Some hooks are missing or not registered.'
  }, null, 2));
}

function uninstall() {
  const settings = readSettings();
  let removedHooks = 0;
  let removedPerms = 0;

  // Remove hooks
  if (settings.hooks) {
    for (const matcher of Object.keys(settings.hooks)) {
      const before = settings.hooks[matcher].length;
      settings.hooks[matcher] = settings.hooks[matcher].filter(entry => {
        if (!entry.hooks || !Array.isArray(entry.hooks)) return true;
        return !entry.hooks.some(h => h.command && h.command.includes(HOOK_PREFIX));
      });
      removedHooks += before - settings.hooks[matcher].length;

      if (settings.hooks[matcher].length === 0) {
        delete settings.hooks[matcher];
      }
    }

    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }
  }

  // Remove Vela permission rules
  if (settings.permissions) {
    const velaRules = new Set([...VELA_PERMISSIONS.deny, ...VELA_PERMISSIONS.allow]);

    if (settings.permissions.deny) {
      const before = settings.permissions.deny.length;
      settings.permissions.deny = settings.permissions.deny.filter(r => !velaRules.has(r));
      removedPerms += before - settings.permissions.deny.length;
      if (settings.permissions.deny.length === 0) delete settings.permissions.deny;
    }

    if (settings.permissions.allow) {
      const before = settings.permissions.allow.length;
      settings.permissions.allow = settings.permissions.allow.filter(r => !velaRules.has(r));
      removedPerms += before - settings.permissions.allow.length;
      if (settings.permissions.allow.length === 0) delete settings.permissions.allow;
    }

    if (Object.keys(settings.permissions).length === 0) {
      delete settings.permissions;
    }
  }

  writeSettings(settings);

  console.log(JSON.stringify({
    ok: true,
    command: 'uninstall',
    removed_hooks: removedHooks,
    removed_permissions: removedPerms,
    message: `Removed ${removedHooks} hooks + ${removedPerms} permission rules.`
  }, null, 2));
}

function status() {
  const settings = readSettings();
  const registered = [];

  if (settings.hooks) {
    for (const [event, entries] of Object.entries(settings.hooks)) {
      for (const entry of entries) {
        if (entry.hooks && Array.isArray(entry.hooks)) {
          for (const hook of entry.hooks) {
            if (hook.command && hook.command.includes(HOOK_PREFIX)) {
              registered.push({
                event,
                matcher: entry.matcher || '',
                command: hook.command,
                description: hook.statusMessage || ''
              });
            }
          }
        }
      }
    }
  }

  // Check permissions
  const permissions = {
    deny: (settings.permissions?.deny || []).filter(r => VELA_PERMISSIONS.deny.includes(r)),
    allow: (settings.permissions?.allow || []).filter(r => VELA_PERMISSIONS.allow.includes(r))
  };

  console.log(JSON.stringify({
    ok: true,
    command: 'status',
    vela_hooks: registered,
    hook_count: registered.length,
    vela_permissions: permissions,
    permission_count: permissions.deny.length + permissions.allow.length,
    settings_path: SETTINGS_PATH
  }, null, 2));
}

// ─── Settings I/O ───

function readSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    // Create settings directory if needed
    const dir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch (e) {
    return {};
  }
}

function writeSettings(settings) {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Atomic write
  const tmpPath = SETTINGS_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2));
  fs.renameSync(tmpPath, SETTINGS_PATH);
}
