#!/usr/bin/env ts-node
/**
 * scripts/sync-dry-run.ts
 *
 * Preview what the sync engine would change in JSM — no mutations.
 * Requires FORGE_EMAIL + FORGE_API_TOKEN env vars (or forge login).
 *
 * Usage:  npx ts-node scripts/sync-dry-run.ts
 */

import { runSync, type DeptSyncResult } from '../src/engine/sync';

function icon(kind: string): string {
  return { created: '➕', updated: '✏️ ', skipped: '⏭️ ', error: '❌' }[kind] ?? '?';
}

function renderDeptResult(dept: DeptSyncResult): void {
  console.log(`\n  📁 ${dept.deptId} (${dept.projectKey})`);

  const rtActions = dept.requestTypeActions;
  if (rtActions.length) {
    console.log('     Request Types:');
    for (const a of rtActions) {
      const detail = a.kind === 'updated' ? ` [${a.changes.join(', ')}]` :
                     a.kind === 'error'   ? ` — ${a.error}` : '';
      console.log(`       ${icon(a.kind)} ${a.name}${detail}`);
    }
  } else {
    console.log('     Request Types: (none configured)');
  }

  const qActions = dept.queueActions;
  if (qActions.length) {
    console.log('     Queues:');
    for (const a of qActions) {
      const detail = a.kind === 'updated' ? ` [${a.changes.join(', ')}]` :
                     a.kind === 'error'   ? ` — ${a.error}` : '';
      console.log(`       ${icon(a.kind)} ${a.name}${detail}`);
    }
  } else {
    console.log('     Queues: (none configured)');
  }

  if (dept.errors.length) {
    console.log('     ❌ Errors:');
    dept.errors.forEach((e) => console.log(`        • ${e}`));
  }
}

async function main(): Promise<void> {
  console.log('\n🔍 JSM Forge — Sync Dry Run\n' + '─'.repeat(60));
  console.log('No changes will be made to JSM.\n');

  const result = await runSync({ dryRun: true });

  if (result.globalErrors.length) {
    console.error('❌ Global errors (departments could not be resolved):');
    result.globalErrors.forEach((e) => console.error(`   • ${e}`));
  }

  console.log('📋 Sync Plan:');
  result.departments.forEach(renderDeptResult);

  const created = result.departments.reduce(
    (n, d) =>
      n +
      d.requestTypeActions.filter((a) => a.kind === 'created').length +
      d.queueActions.filter((a) => a.kind === 'created').length,
    0,
  );
  const updated = result.departments.reduce(
    (n, d) =>
      n +
      d.requestTypeActions.filter((a) => a.kind === 'updated').length +
      d.queueActions.filter((a) => a.kind === 'updated').length,
    0,
  );
  const skipped = result.departments.reduce(
    (n, d) =>
      n +
      d.requestTypeActions.filter((a) => a.kind === 'skipped').length +
      d.queueActions.filter((a) => a.kind === 'skipped').length,
    0,
  );
  const errors =
    result.globalErrors.length +
    result.departments.reduce((n, d) => n + d.errors.length, 0);

  console.log('\n' + '─'.repeat(60));
  console.log(`✅ Dry run complete (${result.durationMs}ms)`);
  console.log(`   ➕ Would create : ${created}`);
  console.log(`   ✏️  Would update : ${updated}`);
  console.log(`   ⏭️  Would skip   : ${skipped}`);
  console.log(`   ❌ Errors        : ${errors}`);
  console.log();

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\nFatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
