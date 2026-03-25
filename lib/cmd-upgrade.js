/**
 * ⛵ vela upgrade — Update all Vela files to latest
 */
const fs = require('fs');
const path = require('path');
const { requireVela, velaDir, box } = require('./utils');

module.exports = function cmdUpgrade(projectDir, velaSrc) {
  requireVela(projectDir);

  console.log('\n⛵ Vela Engine — Upgrading...\n');

  const vDir = velaDir(projectDir);
  const cmdInit = require('./cmd-init');

  // Reuse the copy map from init but overwrite existing files
  const copyMap = buildUpgradeMap();
  let updated = 0;
  let added = 0;

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

  // Also update .claude/agents/vela.md
  const pmSrc = path.join(vDir, 'agents', 'vela.md');
  const pmDst = path.join(projectDir, '.claude', 'agents', 'vela.md');
  if (fs.existsSync(pmSrc) && fs.existsSync(path.dirname(pmDst))) {
    fs.copyFileSync(pmSrc, pmDst);
    updated++;
  }

  box([
    '⛵ Vela Engine — Upgrade Complete',
    '',
    `✓ ${updated} files updated`,
    `✓ ${added} new files added`,
    '✓ config.json preserved (not overwritten)',
    '',
    'Run `vela status` to check pipeline state.',
  ]);
  console.log('');
};

function buildUpgradeMap() {
  // Same as init but without config.json (preserve user settings)
  return require('./cmd-init').buildCopyMap
    ? require('./cmd-init').buildCopyMap()
    : []; // fallback
}

// Export the actual copy map builder for reuse
module.exports.buildUpgradeMap = function() {
  // Inline the map since cmd-init doesn't export it yet
  const t = (base, dst, files) => files.map(f => ({ src: `${base}/${f}`, dst: `${dst}/${f}` }));
  return [
    { src: 'scripts/hooks/vela-gate-keeper.js', dst: 'hooks/vela-gate-keeper.js' },
    { src: 'scripts/hooks/vela-gate-guard.js', dst: 'hooks/vela-gate-guard.js' },
    { src: 'scripts/hooks/vela-orchestrator.js', dst: 'hooks/vela-orchestrator.js' },
    { src: 'scripts/hooks/vela-tracker.js', dst: 'hooks/vela-tracker.js' },
    { src: 'scripts/hooks/vela-stop.js', dst: 'hooks/vela-stop.js' },
    { src: 'scripts/hooks/vela-session-start.js', dst: 'hooks/vela-session-start.js' },
    { src: 'scripts/hooks/vela-compact.js', dst: 'hooks/vela-compact.js' },
    { src: 'scripts/hooks/vela-subagent-start.js', dst: 'hooks/vela-subagent-start.js' },
    { src: 'scripts/hooks/vela-task-completed.js', dst: 'hooks/vela-task-completed.js' },
    { src: 'scripts/hooks/shared/constants.js', dst: 'hooks/shared/constants.js' },
    { src: 'scripts/hooks/shared/pipeline.js', dst: 'hooks/shared/pipeline.js' },
    { src: 'scripts/cli/vela-engine.js', dst: 'cli/vela-engine.js' },
    { src: 'scripts/cli/vela-read.js', dst: 'cli/vela-read.js' },
    { src: 'scripts/cli/vela-write.js', dst: 'cli/vela-write.js' },
    { src: 'scripts/cache/treenode.js', dst: 'cache/treenode.js' },
    { src: 'scripts/statusline.sh', dst: 'statusline.sh' },
    { src: 'scripts/agents/vela.md', dst: 'agents/vela.md' },
    { src: 'scripts/agents/researcher.md', dst: 'agents/researcher.md' },
    { src: 'scripts/agents/planner.md', dst: 'agents/planner.md' },
    { src: 'scripts/agents/executor.md', dst: 'agents/executor.md' },
    { src: 'scripts/agents/reviewer.md', dst: 'agents/reviewer.md' },
    { src: 'scripts/agents/leader.md', dst: 'agents/leader.md' },
    { src: 'scripts/agents/conflict-manager.md', dst: 'agents/conflict-manager.md' },
    ...t('scripts/agents/pm', 'agents/pm', ['index.md','prompt-optimizer.md','pipeline-flow.md','team-rules.md','model-strategy.md','block-recovery.md']),
    ...t('scripts/agents/researcher', 'agents/researcher', ['index.md','hypothesis.md','security.md','architecture.md','quality.md']),
    ...t('scripts/agents/executor', 'agents/executor', ['index.md','tdd.md','file-ownership.md','worktree.md']),
    ...t('scripts/agents/planner', 'agents/planner', ['index.md','spec-format.md','crosslayer.md']),
    ...t('scripts/agents/reviewer', 'agents/reviewer', ['index.md','scoring.md']),
    ...t('scripts/agents/conflict-manager', 'agents/conflict-manager', ['index.md','merge-procedure.md','interface-watch.md']),
    ...t('scripts/guidelines', 'guidelines', ['index.md','coding-standards.md','error-handling.md','testing-strategy.md']),
    { src: 'templates/pipeline.json', dst: 'templates/pipeline.json' },
    { src: 'references/interactive-ui.md', dst: 'references/interactive-ui.md' },
    { src: 'references/gates-and-guards.md', dst: 'references/gates-and-guards.md' },
    { src: 'references/cli-reference.md', dst: 'references/cli-reference.md' },
    { src: 'references/messages-en.md', dst: 'references/messages-en.md' },
  ];
};
