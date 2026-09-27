/**
 * src/engine/sync.ts
 *
 * Top-level sync orchestrator. Called by:
 *   - Forge scheduled trigger (daily, heals drift)
 *   - `npx ts-node scripts/sync-dry-run.ts` (CI preview, no mutations)
 *
 * Pipeline per department:
 *   1. resolveDepartments  — verify JSM project exists, cache service desk ID
 *   2. syncRequestTypes    — create/update request types in JSM
 *   3. syncQueues          — create/update queues in JSM
 *   4. writeSyncJournal    — persist outcome to Forge KV for observability
 *
 * Errors in one department do NOT abort the others.
 */

import { getConfig } from '../config-loader';
import { resolveDepartments } from './department-sync';
import { syncRequestTypes, type RequestTypeSyncAction } from './request-type-sync';
import { syncQueues, type QueueSyncAction } from './queue-sync';
import { writeSyncJournal } from '../services/sync-state';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DeptSyncResult {
  deptId: string;
  projectKey: string;
  requestTypeActions: RequestTypeSyncAction[];
  queueActions: QueueSyncAction[];
  errors: string[];
  durationMs: number;
}

export interface SyncResult {
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  departments: DeptSyncResult[];
  globalErrors: string[];
}

// ─── Entry point (Forge scheduled trigger) ────────────────────────────────────

export async function handler(): Promise<void> {
  console.info('[sync] ⚙️  Starting scheduled config → JSM sync...');
  const result = await runSync({ dryRun: false });

  const total = {
    created: countActions(result, 'created'),
    updated: countActions(result, 'updated'),
    skipped: countActions(result, 'skipped'),
    errors:  result.departments.reduce((n, d) => n + d.errors.length, 0)
              + result.globalErrors.length,
  };

  console.info(
    `[sync] ✅ Done in ${result.durationMs}ms — ` +
      `➕${total.created} created, ✏️ ${total.updated} updated, ` +
      `⏭️ ${total.skipped} skipped, ❌${total.errors} errors`,
  );

  if (total.errors > 0) {
    const allErrors = [
      ...result.globalErrors,
      ...result.departments.flatMap((d) => d.errors),
    ];
    console.error('[sync] Errors:\n' + allErrors.map((e) => `  • ${e}`).join('\n'));
  }
}

// ─── Core sync logic ──────────────────────────────────────────────────────────

export async function runSync(options: { dryRun: boolean }): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const config = getConfig();
  const globalErrors: string[] = [];

  // ── Step 1: Resolve all departments (validate project keys, cache desk IDs)
  const { resolved, errors: deptErrors } = await resolveDepartments(
    config.departments,
    options.dryRun,
  );
  globalErrors.push(...deptErrors.map((e) => `[${e.deptId}] ${e.error}`));

  // Build a lookup from deptId → serviceDeskId
  const deskIdMap = new Map(resolved.map((r) => [r.deptId, r]));

  // ── Step 2 & 3: Sync each resolved department
  const deptResults: DeptSyncResult[] = [];

  for (const dept of config.departments) {
    const resolution = deskIdMap.get(dept.id);
    if (!resolution) {
      // Was already recorded as a global error above — skip
      continue;
    }

    const deptT0 = Date.now();
    const deptErrors: string[] = [];
    let requestTypeActions: RequestTypeSyncAction[] = [];
    let queueActions: QueueSyncAction[] = [];

    console.info(`\n[sync] ── Department: ${dept.name} (${dept.jsmProjectKey})`);

    // Request types
    try {
      requestTypeActions = await syncRequestTypes({
        serviceDeskId: resolution.serviceDeskId,
        requestTypes: dept.requestTypes,
        dryRun: options.dryRun,
      });
      requestTypeActions
        .filter((a) => a.kind === 'error')
        .forEach((a) => deptErrors.push(`RT "${a.name}": ${(a as { error: string }).error}`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deptErrors.push(`Request type sync failed: ${msg}`);
      console.error(`[sync] ❌ Request type sync failed for ${dept.id}: ${msg}`);
    }

    // Queues
    try {
      queueActions = await syncQueues({
        serviceDeskId: resolution.serviceDeskId,
        projectKey: resolution.projectKey,
        queues: dept.queues,
        dryRun: options.dryRun,
      });
      queueActions
        .filter((a) => a.kind === 'error')
        .forEach((a) => deptErrors.push(`Queue "${a.name}": ${(a as { error: string }).error}`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deptErrors.push(`Queue sync failed: ${msg}`);
      console.error(`[sync] ❌ Queue sync failed for ${dept.id}: ${msg}`);
    }

    const durationMs = Date.now() - deptT0;

    // Write journal entry (skip in dry-run — no mutations allowed)
    if (!options.dryRun) {
      await writeSyncJournal({
        deptId: dept.id,
        lastSyncAt: new Date().toISOString(),
        requestTypesCreated: requestTypeActions.filter((a) => a.kind === 'created').length,
        requestTypesUpdated: requestTypeActions.filter((a) => a.kind === 'updated').length,
        queuesCreated: queueActions.filter((a) => a.kind === 'created').length,
        queuesUpdated: queueActions.filter((a) => a.kind === 'updated').length,
        errors: deptErrors,
      });
    }

    deptResults.push({
      deptId: dept.id,
      projectKey: dept.jsmProjectKey,
      requestTypeActions,
      queueActions,
      errors: deptErrors,
      durationMs,
    });
  }

  return {
    dryRun: options.dryRun,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    departments: deptResults,
    globalErrors,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countActions(result: SyncResult, kind: string): number {
  return result.departments.reduce(
    (total, dept) =>
      total +
      dept.requestTypeActions.filter((a) => a.kind === kind).length +
      dept.queueActions.filter((a) => a.kind === kind).length,
    0,
  );
}
