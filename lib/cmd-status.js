/**
 * ⛵ vela status — Show current pipeline status
 */
const { BANNER_MINI, ok, info, highlight, dimText, boldText, progressBar, box, cyan, green, yellow, reset } = require('./banner');
const { requireVela, findActivePipeline } = require('./utils');

module.exports = function cmdStatus(projectDir) {
  requireVela(projectDir);

  const state = findActivePipeline(projectDir);

  if (!state) {
    console.log('');
    box([
      `${highlight('⛵ Vela — Explore Mode')}`,
      '',
      `${dimText('No active pipeline.')}`,
      '',
      `Start: ${highlight('vela start "task" --scale large')}`,
      `  or:  ${highlight('/vela')} ${dimText('in Claude Code')}`,
    ]);
    console.log('');
    return;
  }

  const completed = state.completed_steps || [];
  const steps = state.steps || [];
  const total = steps.length;
  const current = state.current_step;
  const currentIdx = steps.indexOf(current);
  const pBar = progressBar(completed.length, total, 25);

  console.log('');
  box([
    `${highlight(`⛵ Pipeline — ${state.pipeline_type}`)}`,
    '',
    `${boldText('Task:')} ${(state.request || '').substring(0, 55)}`,
    `${boldText('Step:')} ${highlight(current)} ${dimText(`(${completed.length + 1}/${total})`)}`,
    `${boldText('Progress:')} ${pBar}`,
    '',
    formatSteps(steps, completed, current),
    '',
    state.git && state.git.pipeline_branch
      ? `${boldText('Branch:')} ${green}${state.git.pipeline_branch}${reset}`
      : `${boldText('Branch:')} ${dimText('none')}`,
    `${boldText('Artifact:')} ${dimText(state._dir || '')}`,
  ]);
  console.log('');
};

function formatSteps(steps, completed, current) {
  return steps.map(s => {
    if (completed.includes(s)) return `${green}✓${reset} ${dimText(s)}`;
    if (s === current) return `${yellow}▸${reset} ${cyan}${s}${reset} ${yellow}←${reset}`;
    return `  ${dimText(s)}`;
  }).join('  ');
}
