/**
 * ⛵ vela start — Start a pipeline
 */
const { requireVela, runEngine, findActivePipeline, box } = require('./utils');

module.exports = function cmdStart(projectDir, args) {
  requireVela(projectDir);

  // Check for active pipeline
  const active = findActivePipeline(projectDir);
  if (active) {
    box([
      '⛵ Vela — Active Pipeline Exists',
      '',
      `🧭 ${active.pipeline_type} │ Step: ${active.current_step}`,
      `📋 ${(active.request || '').substring(0, 50)}`,
      '',
      'Cancel first: `vela cancel`',
      'Or resume in Claude Code: `/vela`',
    ]);
    console.log('');
    return;
  }

  // Parse args
  let task = '';
  let scale = 'medium';
  let type = 'code';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scale' && args[i + 1]) {
      scale = args[++i];
    } else if (args[i] === '--type' && args[i + 1]) {
      type = args[++i];
    } else if (!args[i].startsWith('-')) {
      task = args[i];
    }
  }

  if (!task) {
    console.error('\n⛵ [Vela] Task description required.');
    console.error('Usage: vela start "Add OAuth authentication" --scale large\n');
    console.error('Scales: small | medium | large | ralph | hotfix\n');
    process.exit(1);
  }

  const validScales = ['small', 'medium', 'large', 'ralph', 'hotfix'];
  if (!validScales.includes(scale)) {
    console.error(`\n⛵ [Vela] Invalid scale: ${scale}`);
    console.error(`Valid: ${validScales.join(', ')}\n`);
    process.exit(1);
  }

  // Init pipeline
  const result = runEngine(projectDir, `init "${task}" --scale ${scale} --type ${type}`);

  if (result.ok) {
    const ptype = result.pipeline_type || scale;
    const steps = result.steps || [];

    box([
      `⛵ Pipeline Started — ${ptype}`,
      '',
      `📋 ${task}`,
      `🧭 ${steps.join(' → ')}`,
      `📁 ${result.artifact_dir || ''}`,
      '',
      'Continue in Claude Code: `/vela`',
    ]);
  } else {
    console.error(`\n⛵ [Vela] Failed: ${result.error || result.message}\n`);
    process.exit(1);
  }
  console.log('');
};
