/**
 * ⛵ vela upgrade — Update all Vela files to latest
 */
const fs = require('fs');
const path = require('path');
const { BANNER, ok, warn, step, highlight, dimText, box } = require('./banner');
const { requireVela, velaDir } = require('./utils');

module.exports = function cmdUpgrade(projectDir, velaSrc) {
  requireVela(projectDir);

  console.log(BANNER);
  console.log(step(1, 'Scanning files...'));

  const vDir = velaDir(projectDir);
  const copyMap = require('./cmd-init').buildCopyMap();

  let updated = 0;
  let added = 0;

  console.log(step(2, 'Upgrading...'));
  for (const { src, dst } of copyMap) {
    const srcPath = path.join(velaSrc, src);
    const dstPath = path.join(vDir, dst);
    if (!fs.existsSync(srcPath)) continue;

    const dstDir = path.dirname(dstPath);
    if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });

    const isNew = !fs.existsSync(dstPath);
    fs.copyFileSync(srcPath, dstPath);
    if (isNew) added++;
    else updated++;
  }

  // Update .claude/agents/vela.md
  const pmSrc = path.join(vDir, 'agents', 'vela.md');
  const pmDst = path.join(projectDir, '.claude', 'agents', 'vela.md');
  if (fs.existsSync(pmSrc) && fs.existsSync(path.dirname(pmDst))) {
    fs.copyFileSync(pmSrc, pmDst);
    updated++;
  }

  console.log('');
  box([
    `${highlight('⛵ Upgrade Complete')}`,
    '',
    ok(`${updated} files updated`),
    ok(`${added} new files added`),
    ok('config.json preserved'),
    '',
    `Check: ${highlight('vela status')}`,
  ]);
  console.log('');
};
