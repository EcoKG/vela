/**
 * ⛵ Vela CLI — Banner & Colors
 */

const cyan = '\x1b[36m';
const blue = '\x1b[34m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const dim = '\x1b[2m';
const bold = '\x1b[1m';
const reset = '\x1b[0m';

const BANNER = `
${cyan}         ⠀⠀⠀⠀⠀⢀⣤⣶⣿⣿⣶⣤⡀
${cyan}         ⠀⠀⠀⠀⣴⣿⣿⣿⣿⣿⣿⣿⣿⣦
${cyan}         ⠀⠀⠀⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷${reset}       ${bold}⛵ VELA ENGINE${reset}
${cyan}         ⠀⠀⣸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣇${reset}      ${dim}Sandbox Development System${reset}
${cyan}         ⠀⢰⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡆${reset}     ${dim}for Claude Code${reset}
${blue}         ⠀⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿
${blue}         ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿
${blue}        ⠘⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠃${reset}
`;

const BANNER_MINI = `${cyan}⛵${reset} ${bold}Vela Engine${reset}`;

function ok(msg) { return `  ${green}✓${reset} ${msg}`; }
function warn(msg) { return `  ${yellow}⚠${reset} ${msg}`; }
function err(msg) { return `  ${red}✗${reset} ${msg}`; }
function info(msg) { return `  ${cyan}⛵${reset} ${msg}`; }
function step(n, msg) { return `  ${cyan}${n}.${reset} ${msg}`; }
function highlight(msg) { return `${cyan}${msg}${reset}`; }
function dimText(msg) { return `${dim}${msg}${reset}`; }
function boldText(msg) { return `${bold}${msg}${reset}`; }

function progressBar(done, total, width = 20) {
  const filled = total > 0 ? Math.round((done / total) * width) : 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return `${green}${'█'.repeat(filled)}${dim}${'░'.repeat(width - filled)}${reset} ${pct}%`;
}

function box(lines) {
  const stripped = lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, ''));
  const maxLen = Math.max(...stripped.map(l => l.length));
  const border = '━'.repeat(maxLen + 2);
  console.log(`  ${dim}┏${border}┓${reset}`);
  for (let i = 0; i < lines.length; i++) {
    const pad = ' '.repeat(maxLen - stripped[i].length);
    console.log(`  ${dim}┃${reset} ${lines[i]}${pad} ${dim}┃${reset}`);
  }
  console.log(`  ${dim}┗${border}┛${reset}`);
}

function table(headers, rows) {
  const cols = headers.length;
  const widths = headers.map((h, i) => {
    const vals = [h, ...rows.map(r => (r[i] || '').replace(/\x1b\[[0-9;]*m/g, ''))];
    return Math.max(...vals.map(v => v.length));
  });

  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join(' │ ');
  const divider = widths.map(w => '─'.repeat(w)).join('─┼─');

  console.log(`  ${dim}${headerLine}${reset}`);
  console.log(`  ${dim}${divider}${reset}`);
  for (const row of rows) {
    const line = row.map((c, i) => {
      const stripped = (c || '').replace(/\x1b\[[0-9;]*m/g, '');
      const pad = ' '.repeat(widths[i] - stripped.length);
      return (c || '') + pad;
    }).join(' │ ');
    console.log(`  ${line}`);
  }
}

module.exports = {
  BANNER, BANNER_MINI,
  ok, warn, err, info, step, highlight, dimText, boldText,
  progressBar, box, table,
  cyan, blue, green, yellow, red, dim, bold, reset
};
