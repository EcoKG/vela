/**
 * ⛵ vela history — Show pipeline history
 */
const { BANNER_MINI, highlight, dimText, boldText, table, green, red, yellow, cyan, reset } = require('./banner');
const { requireVela, runEngine } = require('./utils');

module.exports = function cmdHistory(projectDir) {
  requireVela(projectDir);

  const result = runEngine(projectDir, 'history');

  if (!result.ok || !result.pipelines || result.pipelines.length === 0) {
    console.log(`\n  ${BANNER_MINI} ${dimText('No pipeline history.')}\n`);
    return;
  }

  console.log(`\n  ${BANNER_MINI} ${dimText(`${result.count} pipelines`)}\n`);

  const rows = result.pipelines.map(p => {
    const status = p.status === 'completed' ? `${green}✓ done${reset}` :
                   p.status === 'cancelled' ? `${red}✗ cancel${reset}` :
                   `${yellow}▸ active${reset}`;
    return [
      p.date,
      p.type || '',
      status,
      `${p.steps_completed}/${p.steps_total}`,
      (p.request || '').substring(0, 35)
    ];
  });

  table(['Date', 'Type', 'Status', 'Steps', 'Task'], rows);
  console.log('');
};
