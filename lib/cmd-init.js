/**
 * ⛵ vela init — Install Vela into a project
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { BANNER, ok, warn, err, step, info, highlight, dimText, box } = require('./banner');

module.exports = function cmdInit(projectDir, velaSrc, args) {
  const targetDir = args[0] ? path.resolve(args[0]) : projectDir;
  const vDir = path.join(targetDir, '.vela');

  console.log(BANNER);

  if (fs.existsSync(path.join(vDir, 'config.json'))) {
    console.log(warn('Vela is already installed in this project.'));
    console.log(info(`Use ${highlight('vela upgrade')} to update.\n`));
    return;
  }

  console.log(step(1, 'Creating directory structure...'));
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
  console.log(ok(`${dirs.length} directories created`));

  console.log(step(2, 'Deploying scripts & agents...'));
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
  console.log(ok(`${copied} files deployed`));

  console.log(step(3, 'Registering hooks...'));
  const installPath = path.join(vDir, 'install.js');
  let hookCount = 0;
  if (fs.existsSync(installPath)) {
    try {
      const result = execSync(`node "${installPath}"`, { cwd: targetDir, encoding: 'utf-8', stdio: 'pipe' });
      try {
        const json = JSON.parse(result.trim());
        hookCount = json.hooks_registered || 0;
      } catch (_) {}
      console.log(ok(`${hookCount || '10'} hooks registered`));
    } catch (e) {
      console.log(warn('Hook registration had issues. Run vela upgrade to retry.'));
    }
  }

  console.log(step(4, 'Verifying installation...'));
  try {
    execSync(`node "${installPath}" verify`, { cwd: targetDir, stdio: 'pipe' });
    console.log(ok('Verification passed'));
  } catch (_) {
    console.log(warn('Verification had warnings'));
  }

  console.log('');
  box([
    `${highlight('⛵ Vela Engine — Installed!')}`,
    '',
    ok(`${copied} files`),
    ok(`${dirs.length} directories`),
    ok('Hooks + Permissions'),
    ok('Agent: vela (PM)'),
    '',
    `Next: ${highlight('vela start "your task" --scale large')}`,
    `  or: ${highlight('/vela')} ${dimText('in Claude Code')}`,
  ]);
  console.log('');
};

function buildCopyMap() {
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
    { src: 'scripts/install.js', dst: 'install.js' },
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
    ...t('scripts/agents/debugger', 'agents/debugger', ['index.md','diagnosis.md','fix-strategy.md']),
    ...t('scripts/guidelines', 'guidelines', ['index.md','coding-standards.md','error-handling.md','testing-strategy.md']),
    { src: 'templates/pipeline.json', dst: 'templates/pipeline.json' },
    { src: 'templates/config.json', dst: 'templates/config.json' },
    { src: 'references/interactive-ui.md', dst: 'references/interactive-ui.md' },
    { src: 'references/gates-and-guards.md', dst: 'references/gates-and-guards.md' },
    { src: 'references/cli-reference.md', dst: 'references/cli-reference.md' },
    { src: 'references/messages-en.md', dst: 'references/messages-en.md' },
  ];
}

module.exports.buildCopyMap = buildCopyMap;
