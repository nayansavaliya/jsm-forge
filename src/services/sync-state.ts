/**
 * src/services/sync-state.ts
 *
 * Forge KV Storage layer for persisting sync state between runs.
 *
 * Tracks two things:
 *   1. ID Mappings  — config id → JSM id (e.g. "rt-it-hardware" → "42")
 *      Stored because config YAML cannot be written back from within Forge.
 *      On each sync, if config has jsmRequestTypeId = null, we check here first.
 *
 *   2. Sync journal — per-department last-sync metadata (timestamp, error count)
 *      Used by the dry-run to show drift age and by dashboards/logging.
 */

// storage is a Forge runtime global — declared in src/types/forge.d.ts

// ─── Key builders ─────────────────────────────────────────────────────────────

const rtKey = (configId: string): string => `rtmap::${configId}`;
const queueKey = (configId: string): string => `queuemap::${configId}`;
const sdKey = (projectKey: string): string => `sdmap::${projectKey}`;
const journalKey = (deptId: string): string => `journal::${deptId}`;

// ─── Service Desk mappings ────────────────────────────────────────────────────

/** Store the JSM service desk numeric ID for a project key */
export async function setServiceDeskId(
  projectKey: string,
  serviceDeskId: string,
): Promise<void> {
  await storage.set(sdKey(projectKey), serviceDeskId);
}

/** Retrieve the cached service desk ID. Returns undefined if not yet synced. */
export async function getServiceDeskId(
  projectKey: string,
): Promise<string | undefined> {
  return storage.get<string>(sdKey(projectKey));
}

// ─── Request Type ID mappings ─────────────────────────────────────────────────

/**
 * Store the JSM request type ID for a config request type.
 * Called after a new request type is created in JSM.
 */
export async function setRequestTypeId(
  configId: string,
  jsmId: string,
): Promise<void> {
  await storage.set(rtKey(configId), jsmId);
}

/**
 * Look up the JSM request type ID for a config request type.
 * Returns undefined if this request type has never been synced.
 */
export async function getRequestTypeId(
  configId: string,
): Promise<string | undefined> {
  return storage.get<string>(rtKey(configId));
}

/** Resolve the effective JSM request type ID:
 *  - If config has a jsmRequestTypeId set, use that (explicit override)
 *  - Else look up from sync state KV storage
 *  - Returns undefined if never created in JSM yet
 */
export async function resolveJsmRequestTypeId(
  configId: string,
  configJsmId: string | null,
): Promise<string | undefined> {
  if (configJsmId) return configJsmId;
  return getRequestTypeId(configId);
}

// ─── Queue ID mappings ────────────────────────────────────────────────────────

export async function setQueueId(configId: string, jsmId: string): Promise<void> {
  await storage.set(queueKey(configId), jsmId);
}

export async function getQueueId(configId: string): Promise<string | undefined> {
  return storage.get<string>(queueKey(configId));
}

// ─── Sync journal ─────────────────────────────────────────────────────────────

export interface SyncJournalEntry {
  deptId: string;
  lastSyncAt: string;       // ISO8601
  requestTypesCreated: number;
  requestTypesUpdated: number;
  queuesCreated: number;
  queuesUpdated: number;
  errors: string[];
}

export async function writeSyncJournal(entry: SyncJournalEntry): Promise<void> {
  await storage.set(journalKey(entry.deptId), entry);
}

export async function readSyncJournal(
  deptId: string,
): Promise<SyncJournalEntry | undefined> {
  return storage.get<SyncJournalEntry>(journalKey(deptId));
}
