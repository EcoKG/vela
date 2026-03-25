/**
 * ⛵ vela cancel — Cancel active pipeline
 */
const { BANNER_MINI, ok, warn, highlight, dimText, boldText, box, green, reset } = require('./banner');
const { requireVela, runEngine, findActivePipeline } = require('./utils');

module.exports = function cmdCancel(projectDir) {
  requireVela(projectDir);

  const active = findActivePipeline(projectDir);
  if (!active) {
    console.log(`\n  ${BANNER_MINI} ${dimText('No active pipeline to cancel.')}\n`);
    return;
  }

  const result = runEngine(projectDir, 'cancel');

  if (result.ok) {
    console.log('');
    box([
      `${highlight('⛵ Pipeline Cancelled')}`,
      '',
      `${boldText('Task:')} ${(active.request || '').substring(0, 50)}`,
      `${boldText('Was at:')} ${active.current_step}`,
      '',
      result.recovery_hint || `Changes preserved in git.`,
      `New pipeline: ${highlight('vela start "task" --scale large')}`,
    ]);
  } else {
    console.log(warn(`Cancel failed: ${result.error}`));
  }
  console.log('');
};
