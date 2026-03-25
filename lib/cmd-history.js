/**
 * ⛵ vela history — Show pipeline history
 */
const { requireVela, runEngine } = require('./utils');

module.exports = function cmdHistory(projectDir) {
  requireVela(projectDir);

  const result = runEngine(projectDir, 'history');

  if (!result.ok || !result.pipelines || result.pipelines.length === 0) {
    console.log('\n⛵ No pipeline history.\n');
    return;
  }

  console.log(`\n⛵ Pipeline History (${result.count} total)\n`);
  console.log('  Date       │ Type     │ Status    │ Steps │ Task');
  console.log('  ───────────┼──────────┼───────────┼───────┼─────────────────────────');

  for (const p of result.pipelines) {
    const status = p.status === 'completed' ? '✅ done' :
                   p.status === 'cancelled' ? '❌ cancel' :
                   '🧭 active';
    const steps = `${p.steps_completed}/${p.steps_total}`;
    console.log(`  ${p.date} │ ${(p.type || '').padEnd(8)} │ ${status.padEnd(9)} │ ${steps.padEnd(5)} │ ${(p.request || '').substring(0, 30)}`);
  }
  console.log('');
};
