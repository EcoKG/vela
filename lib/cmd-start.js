/**
 * ⛵ vela start — Start a pipeline
 */
const { BANNER, ok, err, info, highlight, dimText, boldText, box, cyan, reset } = require('./banner');
const { requireVela, runEngine, findActivePipeline } = require('./utils');

module.exports = function cmdStart(projectDir, args) {
  requireVela(projectDir);

  console.log(BANNER);

  // Check active pipeline
  const active = findActivePipeline(projectDir);
  if (active) {
    box([
      `${highlight('⛵ Active Pipeline Exists')}`,
      '',
      `${boldText('Type:')} ${active.pipeline_type}`,
      `${boldText('Step:')} ${active.current_step}`,
      `${boldText('Task:')} ${(active.request || '').substring(0, 50)}`,
      '',
      `Cancel first: ${highlight('vela cancel')}`,
      `Or resume:    ${highlight('/vela')} ${dimText('in Claude Code')}`,
    ]);
    console.log('');
    return;
  }

  // Parse args
  let task = '';
  let scale = '';
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
    console.log(err('Task description required.\n'));
    console.log(`  ${dimText('$')} vela start ${cyan}"Add OAuth authentication"${reset} --scale large\n`);
    console.log(`  ${boldText('Scales:')}`);
    console.log(`    ${cyan}small${reset}   ${dimText('trivial (init → execute → commit → finalize)')}`);
    console.log(`    ${cyan}medium${reset}  ${dimText('quick (init → plan → execute → verify → commit → finalize)')}`);
    console.log(`    ${cyan}large${reset}   ${dimText('standard (full 10-step + research + team review)')}`);
    console.log(`    ${cyan}ralph${reset}   ${dimText('auto-retry until tests pass')}`);
    console.log(`    ${cyan}hotfix${reset}  ${dimText('minimal (init → execute → commit)')}\n`);
    process.exit(1);
  }

  if (!scale) {
    console.log(err('--scale required.\n'));
    console.log(`  ${dimText('$')} vela start "${task}" ${cyan}--scale large${reset}\n`);
    process.exit(1);
  }

  const validScales = ['small', 'medium', 'large', 'ralph', 'hotfix'];
  if (!validScales.includes(scale)) {
    console.log(err(`Invalid scale: ${scale}`));
    console.log(`  Valid: ${validScales.map(s => highlight(s)).join(', ')}\n`);
    process.exit(1);
  }

  // Init pipeline
  const result = runEngine(projectDir, `init "${task}" --scale ${scale} --type ${type}`);

  if (result.ok) {
    const ptype = result.pipeline_type || scale;
    const steps = result.steps || [];

    console.log('');
    box([
      `${highlight('⛵ Pipeline Started!')}`,
      '',
      `${boldText('Type:')}  ${ptype}`,
      `${boldText('Task:')}  ${task.substring(0, 55)}`,
      `${boldText('Steps:')} ${steps.join(' → ')}`,
      '',
      `Continue in Claude Code: ${highlight('/vela')}`,
    ]);
  } else {
    console.log(err(result.error || result.message));
  }
  console.log('');
};
