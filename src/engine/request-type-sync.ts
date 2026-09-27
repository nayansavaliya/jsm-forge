/**
 * src/engine/request-type-sync.ts
 *
 * Idempotent sync of request types from config → JSM.
 *
 * Strategy:
 *   1. List all existing request types in the service desk
 *   2. For each config request type:
 *      a. Resolve its JSM ID (from config YAML or KV sync-state)
 *      b. If found in JSM: compare name/description — update if drifted
 *      c. If NOT found: create it in JSM, store the new ID in KV sync-state
 *   3. Report creates, updates, and skips
 *
 * Note: We intentionally do NOT delete request types that exist in JSM
 * but are absent from config. Deletion is a destructive operation that
 * could lose submitted issues — this must be done manually in the JSM UI.
 */

import {
  listRequestTypes,
  createRequestType,
  updateRequestType,
  type JsmRequestType,
} from '../services/jsm-api';
import {
  resolveJsmRequestTypeId,
  setRequestTypeId,
} from '../services/sync-state';
import type { LoadedConfig } from '../config-loader/schema';

export type RequestTypeSyncAction =
  | { kind: 'created'; configId: string; name: string; jsmId: string }
  | { kind: 'updated'; configId: string; name: string; jsmId: string; changes: string[] }
  | { kind: 'skipped'; configId: string; name: string; jsmId: string; reason: string }
  | { kind: 'error'; configId: string; name: string; error: string };

/**
 * Syncs all request types for one department.
 * Returns a list of actions taken (or planned in dry-run mode).
 */
export async function syncRequestTypes(params: {
  serviceDeskId: string;
  requestTypes: LoadedConfig['departments'][0]['requestTypes'];
  dryRun: boolean;
}): Promise<RequestTypeSyncAction[]> {
  const { serviceDeskId, requestTypes, dryRun } = params;

  // Fetch current state from JSM once, then work against it in memory
  const existing = await listRequestTypes(serviceDeskId);
  const existingById = new Map(existing.map((rt) => [rt.id, rt]));
  const existingByName = new Map(existing.map((rt) => [rt.name.toLowerCase(), rt]));

  const actions: RequestTypeSyncAction[] = [];

  for (const configRt of requestTypes) {
    try {
      const action = await syncOneRequestType({
        configRt,
        serviceDeskId,
        existingById,
        existingByName,
        dryRun,
      });
      actions.push(action);

      const icon = action.kind === 'created' ? '➕' :
                   action.kind === 'updated' ? '✏️ ' :
                   action.kind === 'skipped' ? '⏭️ ' : '❌';
      console.info(
        `[rt-sync]   ${icon} ${action.name} [${action.kind}]${
          action.kind === 'updated' ? ` — ${action.changes.join(', ')}` : ''
        }`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      actions.push({ kind: 'error', configId: configRt.id, name: configRt.name, error: message });
      console.error(`[rt-sync]   ❌ ${configRt.name}: ${message}`);
    }
  }

  return actions;
}

// ─── Single request type reconciliation ──────────────────────────────────────

async function syncOneRequestType(params: {
  configRt: LoadedConfig['departments'][0]['requestTypes'][0];
  serviceDeskId: string;
  existingById: Map<string, JsmRequestType>;
  existingByName: Map<string, JsmRequestType>;
  dryRun: boolean;
}): Promise<RequestTypeSyncAction> {
  const { configRt, serviceDeskId, existingById, existingByName, dryRun } = params;

  // ── 1. Resolve the JSM ID (config YAML takes precedence over KV state)
  const resolvedJsmId = await resolveJsmRequestTypeId(
    configRt.id,
    configRt.jsmRequestTypeId,
  );

  // ── 2. Find in JSM: by resolved ID first, then fall back to name match
  let existing: JsmRequestType | undefined;
  if (resolvedJsmId) {
    existing = existingById.get(resolvedJsmId);
    if (!existing) {
      // Stored ID no longer exists in JSM — may have been deleted manually
      console.warn(
        `[rt-sync] Request type "${configRt.name}" had stored JSM ID ${resolvedJsmId} ` +
          `but it was not found in JSM. Will re-create.`,
      );
    }
  }

  // Name-based fallback (handles manual creation in JSM before first sync)
  if (!existing) {
    existing = existingByName.get(configRt.name.toLowerCase());
    if (existing && !resolvedJsmId) {
      // Found by name — adopt this JSM ID so we don't create a duplicate
      console.info(
        `[rt-sync] Matched "${configRt.name}" by name to JSM ID ${existing.id} — adopting.`,
      );
      if (!dryRun) await setRequestTypeId(configRt.id, existing.id);
    }
  }

  // ── 3. Create if not found
  if (!existing) {
    if (dryRun) {
      return { kind: 'created', configId: configRt.id, name: configRt.name, jsmId: '<pending>' };
    }

    const created = await createRequestType(serviceDeskId, {
      name: configRt.name,
      description: configRt.description,
    });
    await setRequestTypeId(configRt.id, created.id);

    return { kind: 'created', configId: configRt.id, name: configRt.name, jsmId: created.id };
  }

  // ── 4. Detect drift and update if needed
  const changes: string[] = [];
  if (existing.name !== configRt.name) changes.push(`name: "${existing.name}" → "${configRt.name}"`);
  if (existing.description !== configRt.description)
    changes.push(`description changed`);

  if (changes.length === 0) {
    return {
      kind: 'skipped',
      configId: configRt.id,
      name: configRt.name,
      jsmId: existing.id,
      reason: 'no changes detected',
    };
  }

  if (!dryRun) {
    await updateRequestType(serviceDeskId, existing.id, {
      name: configRt.name,
      description: configRt.description,
    });
  }

  return { kind: 'updated', configId: configRt.id, name: configRt.name, jsmId: existing.id, changes };
}
