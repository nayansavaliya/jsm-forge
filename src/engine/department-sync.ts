/**
 * src/engine/department-sync.ts
 *
 * Validates that every configured department maps to an existing JSM
 * service project, and caches the service desk ID in Forge KV storage
 * for use by subsequent sync steps.
 *
 * This runs FIRST in the sync pipeline — if a department's project key
 * doesn't resolve, the rest of the sync for that department is skipped
 * and an error is recorded rather than crashing the entire sync run.
 */

import { getProject, getServiceDeskByProjectKey, JsmApiError } from '../services/jsm-api';
import { setServiceDeskId, getServiceDeskId } from '../services/sync-state';
import type { LoadedConfig } from '../config-loader/schema';

export interface DeptResolution {
  deptId: string;
  projectKey: string;
  serviceDeskId: string;
  fromCache: boolean;
}

export interface DeptResolutionError {
  deptId: string;
  projectKey: string;
  error: string;
}

export interface DeptResolutionResult {
  resolved: DeptResolution[];
  errors: DeptResolutionError[];
}

/**
 * Validates all departments and resolves their service desk IDs.
 * Uses cached IDs from Forge KV Storage to avoid redundant API calls on
 * subsequent syncs. Refreshes the cache if the desk can't be found by cached ID.
 */
export async function resolveDepartments(
  departments: LoadedConfig['departments'],
  dryRun: boolean,
): Promise<DeptResolutionResult> {
  const resolved: DeptResolution[] = [];
  const errors: DeptResolutionError[] = [];

  for (const dept of departments) {
    try {
      const resolution = await resolveDepartment(dept, dryRun);
      resolved.push(resolution);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({
        deptId: dept.id,
        projectKey: dept.jsmProjectKey,
        error: message,
      });
      console.error(
        `[dept-sync] ❌ Failed to resolve department "${dept.id}" (${dept.jsmProjectKey}): ${message}`,
      );
    }
  }

  return { resolved, errors };
}

async function resolveDepartment(
  dept: LoadedConfig['departments'][0],
  dryRun: boolean,
): Promise<DeptResolution> {
  const projectKey = dept.jsmProjectKey;

  // ── 1. Check KV cache first
  const cachedSdId = await getServiceDeskId(projectKey);
  if (cachedSdId) {
    console.info(
      `[dept-sync] ✅ ${dept.name} (${projectKey}) → service desk ${cachedSdId} (cached)`,
    );
    return { deptId: dept.id, projectKey, serviceDeskId: cachedSdId, fromCache: true };
  }

  // ── 2. Verify project exists in Jira
  try {
    const project = await getProject(projectKey);
    if (project.projectTypeKey !== 'service_desk') {
      throw new Error(
        `Project "${projectKey}" exists but is type "${project.projectTypeKey}", not "service_desk"`,
      );
    }
  } catch (err) {
    if (err instanceof JsmApiError && err.status === 404) {
      throw new Error(
        `Project key "${projectKey}" not found. Create the JSM project first, then set jsmProjectKey in department.yaml.`,
      );
    }
    throw err;
  }

  // ── 3. Resolve service desk ID
  const serviceDesk = await getServiceDeskByProjectKey(projectKey);
  if (!serviceDesk) {
    throw new Error(
      `Project "${projectKey}" exists but has no associated service desk. ` +
        `Ensure it is enabled as a Jira Service Management project.`,
    );
  }

  // ── 4. Cache for future syncs
  if (!dryRun) {
    await setServiceDeskId(projectKey, serviceDesk.id);
  }

  console.info(
    `[dept-sync] ✅ ${dept.name} (${projectKey}) → service desk ${serviceDesk.id} (resolved)`,
  );

  return {
    deptId: dept.id,
    projectKey,
    serviceDeskId: serviceDesk.id,
    fromCache: false,
  };
}
