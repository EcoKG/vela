/**
 * ⛵ vela report — Generate pipeline report
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { BANNER_MINI, ok, err, highlight, dimText } = require('./banner');
const { requireVela, velaDir } = require('./utils');

module.exports = function cmdReport(projectDir, args) {
  requireVela(projectDir);

  const reportPath = path.join(velaDir(projectDir), 'cli', 'vela-report.js');
  if (!fs.existsSync(reportPath)) {
    console.log(err('Report tool not found. Run `vela upgrade`.'));
    process.exit(1);
  }

  const hasHtml = args.includes('--html');
  const htmlFile = hasHtml ? args[args.indexOf('--html') + 1] : null;

  console.log(`\n  ${BANNER_MINI} ${dimText('Generating report...')}\n`);

  try {
    const extraArgs = args.join(' ');
    const output = execSync(`node "${reportPath}" ${extraArgs}`, {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log(output);
    if (htmlFile) {
      console.log(ok(`HTML report: ${highlight(htmlFile)}`));
    }
  } catch (e) {
    if (e.stdout) console.log(e.stdout);
    if (e.stderr) console.error(e.stderr);
  }
  console.log('');
};
