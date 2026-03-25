/**
 * ⛵ vela init — Install Vela into a project
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { velaDir, isVelaProject, box } = require('./utils');

module.exports = function cmdInit(projectDir, velaSrc, args) {
  const targetDir = args[0] ? path.resolve(args[0]) : projectDir;

  console.log('\n⛵ Vela Engine — Installing...\n');

  if (isVelaProject(targetDir)) {
    console.log('  ⚠ Vela is already installed in this project.');
    console.log('  Use `vela upgrade` to update to the latest version.\n');
    return;
  }

  const vDir = velaDir(targetDir);

  // 1. Create directory structure
  const dirs = [
    'hooks', 'hooks/shared', 'cli', 'cache', 'templates',
    'state', 'artifacts', 'agents', 'references', 'guidelines',
    'agents/pm', 'agents/researcher', 'agents/executor',
    'agents/planner', 'agents/reviewer', 'agents/conflict-manager'
  ];
  for (const d of dirs) {
    const p = path.join(vDir, d);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }

  // 2. Copy files from source
  const copyMap = buildCopyMap();
  let copied = 0;
  for (const { src, dst } of copyMap) {
    const srcPath = path.join(velaSrc, src);
    const dstPath = path.join(vDir, dst);
    if (fs.existsSync(srcPath)) {
      const dstDir = path.dirname(dstPath);
      if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
      copied++;
    }
  }

  // 3. Run install.js to register hooks
  const installPath = path.join(vDir, 'install.js');
  if (fs.existsSync(installPath)) {
    try {
      execSync(`node "${installPath}"`, { cwd: targetDir, stdio: 'pipe' });
    } catch (e) {
      console.log('  ⚠ Hook registration had issues. Run `node .vela/install.js verify` to check.');
    }
  }

  // 4. Report
  box([
    '⛵ Vela Engine — Installation Complete',
    '',
    `✓ ${copied} files deployed to .vela/`,
    `✓ Hooks registered in .claude/settings.local.json`,
    `✓ Agent: vela (PM)`,
    `✓ ${dirs.length} directories created`,
    '',
    '🧭 Next: /vela start "your task"',
  ]);
  console.log('');
};

function buildCopyMap() {
  return [
    // Hooks
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
    // CLI
    { src: 'scripts/cli/vela-engine.js', dst: 'cli/vela-engine.js' },
    { src: 'scripts/cli/vela-read.js', dst: 'cli/vela-read.js' },
    { src: 'scripts/cli/vela-write.js', dst: 'cli/vela-write.js' },
    // Cache + misc
    { src: 'scripts/cache/treenode.js', dst: 'cache/treenode.js' },
    { src: 'scripts/statusline.sh', dst: 'statusline.sh' },
    { src: 'scripts/install.js', dst: 'install.js' },
    // Agents (flat)
    { src: 'scripts/agents/vela.md', dst: 'agents/vela.md' },
    { src: 'scripts/agents/researcher.md', dst: 'agents/researcher.md' },
    { src: 'scripts/agents/planner.md', dst: 'agents/planner.md' },
    { src: 'scripts/agents/executor.md', dst: 'agents/executor.md' },
    { src: 'scripts/agents/reviewer.md', dst: 'agents/reviewer.md' },
    { src: 'scripts/agents/leader.md', dst: 'agents/leader.md' },
    { src: 'scripts/agents/conflict-manager.md', dst: 'agents/conflict-manager.md' },
    // Agents (tree)
    ...treeFiles('scripts/agents/pm', 'agents/pm', ['index.md','prompt-optimizer.md','pipeline-flow.md','team-rules.md','model-strategy.md','block-recovery.md']),
    ...treeFiles('scripts/agents/researcher', 'agents/researcher', ['index.md','hypothesis.md','security.md','architecture.md','quality.md']),
    ...treeFiles('scripts/agents/executor', 'agents/executor', ['index.md','tdd.md','file-ownership.md','worktree.md']),
    ...treeFiles('scripts/agents/planner', 'agents/planner', ['index.md','spec-format.md','crosslayer.md']),
    ...treeFiles('scripts/agents/reviewer', 'agents/reviewer', ['index.md','scoring.md']),
    ...treeFiles('scripts/agents/conflict-manager', 'agents/conflict-manager', ['index.md','merge-procedure.md','interface-watch.md']),
    // Guidelines
    ...treeFiles('scripts/guidelines', 'guidelines', ['index.md','coding-standards.md','error-handling.md','testing-strategy.md']),
    // Templates
    { src: 'templates/pipeline.json', dst: 'templates/pipeline.json' },
    { src: 'templates/config.json', dst: 'templates/config.json' },
    // References
    { src: 'references/interactive-ui.md', dst: 'references/interactive-ui.md' },
    { src: 'references/gates-and-guards.md', dst: 'references/gates-and-guards.md' },
    { src: 'references/cli-reference.md', dst: 'references/cli-reference.md' },
    { src: 'references/messages-en.md', dst: 'references/messages-en.md' },
  ];
}

function treeFiles(srcBase, dstBase, files) {
  return files.map(f => ({ src: `${srcBase}/${f}`, dst: `${dstBase}/${f}` }));
}
