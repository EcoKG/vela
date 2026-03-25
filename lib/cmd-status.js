/**
 * ⛵ vela status — Show current pipeline status
 */
const { requireVela, findActivePipeline, box } = require('./utils');

module.exports = function cmdStatus(projectDir) {
  requireVela(projectDir);

  const state = findActivePipeline(projectDir);

  if (!state) {
    box([
      '⛵ Vela — Explore Mode',
      '',
      'No active pipeline.',
      'Run `vela start "task"` to begin.',
    ]);
    console.log('');
    return;
  }

  const completed = state.completed_steps || [];
  const steps = state.steps || [];
  const total = steps.length;
  const current = state.current_step;
  const progress = total > 0 ? Math.round((completed.length / total) * 100) : 0;
  const bar = progressBar(completed.length, total);

  const lines = [
    `⛵ Vela Pipeline — ${state.pipeline_type}`,
    '',
    `🧭 Step: ${current} (${completed.length + 1}/${total})`,
    `   ${bar} ${progress}%`,
    '',
    `📋 Task: ${(state.request || '').substring(0, 60)}`,
    `📁 Artifact: ${state._dir || ''}`,
  ];

  if (state.git && state.git.pipeline_branch) {
    lines.push(`🌿 Branch: ${state.git.pipeline_branch}`);
  }

  lines.push('');
  lines.push(`✅ Completed: ${completed.join(' → ') || 'none'}`);

  const remaining = steps.filter(s => !completed.includes(s) && s !== current);
  if (remaining.length > 0) {
    lines.push(`⏳ Remaining: ${current} → ${remaining.join(' → ')}`);
  }

  box(lines);
  console.log('');
};

function progressBar(done, total) {
  const width = 20;
  const filled = total > 0 ? Math.round((done / total) * width) : 0;
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}
