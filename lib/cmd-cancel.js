/**
 * ⛵ vela cancel — Cancel active pipeline
 */
const { requireVela, runEngine, findActivePipeline, box } = require('./utils');

module.exports = function cmdCancel(projectDir) {
  requireVela(projectDir);

  const active = findActivePipeline(projectDir);
  if (!active) {
    console.log('\n⛵ No active pipeline to cancel.\n');
    return;
  }

  const result = runEngine(projectDir, 'cancel');

  if (result.ok) {
    box([
      '⛵ Pipeline Cancelled',
      '',
      `📋 ${(active.request || '').substring(0, 50)}`,
      `🧭 Was at: ${active.current_step}`,
      '',
      result.recovery_hint || 'Changes preserved. Use git to manage.',
    ]);
  } else {
    console.error(`\n⛵ [Vela] Cancel failed: ${result.error}\n`);
  }
  console.log('');
};
