#!/usr/bin/env node
/**
 * ⛵ Vela CLI — Sandbox Development System for Claude Code
 *
 * Usage:
 *   vela init [project-dir]       — Install Vela into a project
 *   vela start "task" [--scale]   — Start a pipeline
 *   vela status                   — Show current pipeline status
 *   vela upgrade                  — Update all Vela files to latest
 *   vela history                  — Show pipeline history
 *   vela cancel                   — Cancel active pipeline
 *   vela report [--html file]     — Generate pipeline report
 *   vela help                     — Show this help
 *
 * Examples:
 *   npx @ecokg/vela init
 *   npx @ecokg/vela start "Add OAuth authentication" --scale large
 *   npx @ecokg/vela status
 */

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const command = args[0] || 'help';

// Resolve Vela source directory (where this CLI is installed)
const VELA_SRC = path.resolve(__dirname, '..');

// Resolve project directory (cwd or specified)
const PROJECT_DIR = process.cwd();

// ─── Command Router ───
const commands = {
  init: () => require('../lib/cmd-init')(PROJECT_DIR, VELA_SRC, args.slice(1)),
  start: () => require('../lib/cmd-start')(PROJECT_DIR, args.slice(1)),
  status: () => require('../lib/cmd-status')(PROJECT_DIR),
  upgrade: () => require('../lib/cmd-upgrade')(PROJECT_DIR, VELA_SRC),
  history: () => require('../lib/cmd-history')(PROJECT_DIR),
  cancel: () => require('../lib/cmd-cancel')(PROJECT_DIR),
  report: () => require('../lib/cmd-report')(PROJECT_DIR, args.slice(1)),
  help: showHelp,
  '--help': showHelp,
  '-h': showHelp,
  version: showVersion,
  '--version': showVersion,
  '-v': showVersion,
};

if (commands[command]) {
  try {
    commands[command]();
  } catch (e) {
    console.error(`\n⛵ [Vela] Error: ${e.message}\n`);
    process.exit(1);
  }
} else {
  console.error(`\n⛵ [Vela] Unknown command: ${command}`);
  console.error(`Run 'vela help' for usage.\n`);
  process.exit(1);
}

function showHelp() {
  console.log(`
⛵ Vela Engine v3.0 — Sandbox Development System

Usage: vela <command> [options]

Commands:
  init [dir]              Install Vela into a project directory
  start "task" [--scale]  Start a pipeline (scale: small|medium|large|ralph|hotfix)
  status                  Show current pipeline status
  upgrade                 Update all Vela files to latest version
  history                 Show pipeline execution history
  cancel                  Cancel active pipeline
  report [--html file]    Generate pipeline report
  help                    Show this help
  version                 Show version

Examples:
  vela init                                    # Install in current directory
  vela init ./my-project                       # Install in specific directory
  vela start "Add OAuth" --scale large         # Start large pipeline
  vela status                                  # Check pipeline status
  vela upgrade                                 # Update to latest

Install:
  npm install -g @ecokg/vela                   # Global install
  npx @ecokg/vela init                         # One-time use
`);
}

function showVersion() {
  const pkg = require('../package.json');
  console.log(`⛵ Vela Engine v${pkg.version}`);
}
