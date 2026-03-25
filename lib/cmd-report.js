/**
 * ⛵ vela report — Generate pipeline report
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { requireVela, velaDir } = require('./utils');

module.exports = function cmdReport(projectDir, args) {
  requireVela(projectDir);

  const reportPath = path.join(velaDir(projectDir), 'cli', 'vela-report.js');
  if (!fs.existsSync(reportPath)) {
    console.error('\n⛵ [Vela] Report tool not found.\n');
    process.exit(1);
  }

  const extraArgs = args.join(' ');
  try {
    const output = execSync(`node "${reportPath}" ${extraArgs}`, {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log(output);
  } catch (e) {
    console.log(e.stdout || '');
    if (e.stderr) console.error(e.stderr);
  }
};
