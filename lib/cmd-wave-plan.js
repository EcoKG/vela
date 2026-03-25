/**
 * ⛵ vela wave-plan — Analyze task dependencies and show wave groups
 */
const { BANNER_MINI, ok, warn, highlight, dimText, boldText, box, table, cyan, green, yellow, reset } = require('./banner');
const { requireVela, runEngine } = require('./utils');

module.exports = function cmdWavePlan(projectDir) {
  requireVela(projectDir);

  const result = runEngine(projectDir, 'wave-plan');

  if (!result.ok) {
    console.log(`\n  ${BANNER_MINI} ${warn(result.error)}\n`);
    return;
  }

  console.log(`\n  ${BANNER_MINI} ${boldText('Wave Execution Plan')}\n`);

  if (!result.waves || result.waves.length === 0) {
    console.log(warn('No waves generated.'));
    console.log('');
    return;
  }

  for (const wave of result.waves) {
    const mode = wave.parallel ? `${green}parallel${reset}` : `${yellow}sequential${reset}`;
    const members = wave.teammates || wave.tasks || [];
    console.log(`  ${cyan}Wave ${wave.wave}${reset} ${dimText('(')}${mode}${dimText(')')}`);
    for (const m of members) {
      console.log(`    ${green}▸${reset} ${m}`);
    }
    if (wave.note) console.log(`    ${dimText(wave.note)}`);
    console.log('');
  }

  console.log(`  ${dimText(result.message)}\n`);
};
