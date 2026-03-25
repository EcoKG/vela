#!/usr/bin/env node
/**
 * ⛵ Vela CLI — Sandbox Development System for Claude Code
 *
 * Human-facing CLI tool. Run from terminal to manage Vela pipelines.
 */

const path = require('path');
const { BANNER, BANNER_MINI, info, dimText, bold, reset, cyan } = require('../lib/banner');

const args = process.argv.slice(2);
const command = args[0] || 'help';
const VELA_SRC = path.resolve(__dirname, '..');
const PROJECT_DIR = process.cwd();

const commands = {
  init:      () => require('../lib/cmd-init')(PROJECT_DIR, VELA_SRC, args.slice(1)),
  start:     () => require('../lib/cmd-start')(PROJECT_DIR, args.slice(1)),
  status:    () => require('../lib/cmd-status')(PROJECT_DIR),
  upgrade:   () => require('../lib/cmd-upgrade')(PROJECT_DIR, VELA_SRC),
  history:   () => require('../lib/cmd-history')(PROJECT_DIR),
  cancel:    () => require('../lib/cmd-cancel')(PROJECT_DIR),
  report:    () => require('../lib/cmd-report')(PROJECT_DIR, args.slice(1)),
  help:      showHelp,
  '--help':  showHelp,
  '-h':      showHelp,
  version:   showVersion,
  '--version': showVersion,
  '-v':      showVersion,
};

if (commands[command]) {
  try {
    commands[command]();
  } catch (e) {
    console.error(`\n  ${'\x1b[31m'}✗${reset} ${e.message}\n`);
    process.exit(1);
  }
} else {
  console.error(`\n  ${'\x1b[31m'}✗${reset} Unknown command: ${command}`);
  console.error(`  Run ${cyan}vela help${reset} for usage.\n`);
  process.exit(1);
}

function showHelp() {
  console.log(BANNER);
  const pkg = require('../package.json');
  console.log(`  ${dimText(`v${pkg.version}`)}\n`);
  console.log(`  ${bold}Usage:${reset} vela <command> [options]\n`);
  console.log(`  ${bold}Commands:${reset}`);
  console.log(`    ${cyan}init${reset} [dir]                Install Vela into a project`);
  console.log(`    ${cyan}start${reset} "task" [--scale]    Start a pipeline`);
  console.log(`    ${cyan}status${reset}                    Show current pipeline status`);
  console.log(`    ${cyan}upgrade${reset}                   Update Vela to latest version`);
  console.log(`    ${cyan}history${reset}                   Show pipeline execution history`);
  console.log(`    ${cyan}cancel${reset}                    Cancel active pipeline`);
  console.log(`    ${cyan}report${reset} [--html file]      Generate pipeline report`);
  console.log(`    ${cyan}help${reset}                      Show this help`);
  console.log(`    ${cyan}version${reset}                   Show version\n`);
  console.log(`  ${bold}Scales:${reset} small | medium | large | ralph | hotfix\n`);
  console.log(`  ${bold}Examples:${reset}`);
  console.log(`    ${dimText('$')} vela init`);
  console.log(`    ${dimText('$')} vela start "Add OAuth authentication" --scale large`);
  console.log(`    ${dimText('$')} vela status`);
  console.log(`    ${dimText('$')} vela history\n`);
}

function showVersion() {
  const pkg = require('../package.json');
  console.log(`${BANNER_MINI} ${dimText(`v${pkg.version}`)}`);
}
