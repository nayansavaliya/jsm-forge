/**
 * src/engine/queue-sync.ts
 *
 * Idempotent sync of queues from config → JSM.
 *
 * Strategy:
 *   1. List all existing queues in the service desk
 *   2. For each config queue:
 *      a. Resolve its JSM ID from KV sync-state
 *      b. If found in JSM: compare name/JQL/columns — update if drifted
 *      c. If NOT found: create it in JSM, store the new ID in KV sync-state
 *   3. Report creates, updates, and skips
 *
 * Like request types, queues are never auto-deleted.
 */

import {
  listQueues,
  createQueue,
  updateQueue,
  type JsmQueue,
} from '../services/jsm-api';
import { getQueueId, setQueueId } from '../services/sync-state';
import type { LoadedConfig } from '../config-loader/schema';

export type QueueSyncAction =
  | { kind: 'created'; configId: string; name: string; jsmId: string }
  | { kind: 'updated'; configId: string; name: string; jsmId: string; changes: string[] }
  | { kind: 'skipped'; configId: string; name: string; jsmId: string; reason: string }
  | { kind: 'error'; configId: string; name: string; error: string };

/**
 * Syncs all queues for one department.
 */
export async function syncQueues(params: {
  serviceDeskId: string;
  projectKey: string;
  queues: LoadedConfig['departments'][0]['queues'];
  dryRun: boolean;
}): Promise<QueueSyncAction[]> {
  const { serviceDeskId, projectKey, queues, dryRun } = params;

  const existing = await listQueues(serviceDeskId);
  const existingById = new Map(existing.map((q) => [q.id, q]));
  const existingByName = new Map(existing.map((q) => [q.name.toLowerCase(), q]));

  const actions: QueueSyncAction[] = [];

  for (const configQueue of queues) {
    try {
      const action = await syncOneQueue({
        configQueue,
        projectKey,
        existingById,
        existingByName,
        dryRun,
      });
      actions.push(action);

      const icon = action.kind === 'created' ? '➕' :
                   action.kind === 'updated' ? '✏️ ' :
                   action.kind === 'skipped' ? '⏭️ ' : '❌';
      console.info(
        `[queue-sync]   ${icon} ${action.name} [${action.kind}]${
          action.kind === 'updated' ? ` — ${action.changes.join(', ')}` : ''
        }`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      actions.push({ kind: 'error', configId: configQueue.id, name: configQueue.name, error: message });
      console.error(`[queue-sync]   ❌ ${configQueue.name}: ${message}`);
    }
  }

  return actions;
}

// ─── Single queue reconciliation ──────────────────────────────────────────────

async function syncOneQueue(params: {
  configQueue: LoadedConfig['departments'][0]['queues'][0];
  projectKey: string;
  existingById: Map<string, JsmQueue>;
  existingByName: Map<string, JsmQueue>;
  dryRun: boolean;
}): Promise<QueueSyncAction> {
  const { configQueue, projectKey, existingById, existingByName, dryRun } = params;

  // ── 1. Resolve stored JSM ID
  const storedJsmId = await getQueueId(configQueue.id);
  let existing: JsmQueue | undefined;

  if (storedJsmId) {
    existing = existingById.get(storedJsmId);
    if (!existing) {
      console.warn(
        `[queue-sync] Queue "${configQueue.name}" had stored JSM ID ${storedJsmId} ` +
          `but it was not found. Will re-create.`,
      );
    }
  }

  // ── 2. Name-based fallback
  if (!existing) {
    existing = existingByName.get(configQueue.name.toLowerCase());
    if (existing && !storedJsmId) {
      console.info(
        `[queue-sync] Matched queue "${configQueue.name}" by name to JSM ID ${existing.id} — adopting.`,
      );
      if (!dryRun) await setQueueId(configQueue.id, existing.id);
    }
  }

  // ── 3. Create if not found
  if (!existing) {
    if (dryRun) {
      return { kind: 'created', configId: configQueue.id, name: configQueue.name, jsmId: '<pending>' };
    }

    const created = await createQueue(projectKey, {
      name: configQueue.name,
      jql: configQueue.jql,
      columns: configQueue.columns,
    });
    await setQueueId(configQueue.id, created.id);

    return { kind: 'created', configId: configQueue.id, name: configQueue.name, jsmId: created.id };
  }

  // ── 4. Detect drift
  const changes: string[] = [];
  if (existing.name !== configQueue.name) changes.push(`name`);

  const normalizeJql = (s: string): string => s.replace(/\s+/g, ' ').trim();
  if (normalizeJql(existing.jql) !== normalizeJql(configQueue.jql)) changes.push(`jql`);

  const existingCols = existing.fields.map((f) => f.fieldId).sort().join(',');
  const configCols = [...configQueue.columns].sort().join(',');
  if (existingCols !== configCols) changes.push(`columns`);

  if (changes.length === 0) {
    return {
      kind: 'skipped',
      configId: configQueue.id,
      name: configQueue.name,
      jsmId: existing.id,
      reason: 'no changes detected',
    };
  }

  if (!dryRun) {
    await updateQueue(projectKey, existing.id, {
      name: configQueue.name,
      jql: configQueue.jql,
      columns: configQueue.columns,
    });
  }

  return {
    kind: 'updated',
    configId: configQueue.id,
    name: configQueue.name,
    jsmId: existing.id,
    changes,
  };
}
