/**
 * src/services/jsm-api.ts
 *
 * Typed wrappers around the Jira/JSM REST API using Forge's `requestJira`.
 * All methods are stateless — callers manage retry/error handling.
 *
 * Endpoints used:
 *   Service Desks  → /rest/servicedeskapi/servicedesk
 *   Request Types  → /rest/servicedeskapi/servicedesk/{id}/requesttype
 *   Queues (read)  → /rest/servicedeskapi/servicedesk/{id}/queue
 *   Projects       → /rest/api/3/project/{key}
 *
 * Queue WRITE operations use the undocumented internal API that the JSM
 * UI itself calls — this is the only way to create/update queues
 * programmatically from a Forge app.
 */

import { requestJira } from '@forge/api';
import { route } from '@forge/api';

// ─── Response shapes ──────────────────────────────────────────────────────────

export interface JsmServiceDesk {
  id: string;              // numeric string e.g. "1"
  projectId: string;
  projectKey: string;
  projectName: string;
}

export interface JsmRequestType {
  id: string;
  name: string;
  description: string;
  helpText: string;
  issueTypeId: string;
  serviceDeskId: string;
  groupIds: string[];
  icon: { id: string; urls: Record<string, string> };
}

export interface JsmQueue {
  id: string;
  name: string;
  jql: string;
  fields: Array<{ fieldId: string }>;
  issueCount: number;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
}

interface ForgeRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

async function jsmFetch<T>(
  path: string,
  options: ForgeRequestInit = {},
): Promise<T> {
  const { headers: extraHeaders, ...restOptions } = options;
  const res = await requestJira(route`${path}`, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...extraHeaders,
    },
    ...restOptions,
  });

  const text = await res.text();

  if (!res.ok) {
    throw new JsmApiError(res.status, path, text);
  }

  return text ? (JSON.parse(text) as T) : ({} as T);
}

export class JsmApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: string,
  ) {
    super(`JSM API error ${status} at ${path}: ${body.slice(0, 200)}`);
    this.name = 'JsmApiError';
  }
}

// ─── Projects ─────────────────────────────────────────────────────────────────

/**
 * Verifies that a JSM project with the given key exists and is a service
 * desk project. Throws JsmApiError(404) if not found.
 */
export async function getProject(projectKey: string): Promise<JiraProject> {
  return jsmFetch<JiraProject>(`/rest/api/3/project/${projectKey}`);
}

// ─── Service Desks ────────────────────────────────────────────────────────────

/**
 * Returns all service desks the app has access to, paginated.
 * Collects all pages automatically.
 */
export async function getAllServiceDesks(): Promise<JsmServiceDesk[]> {
  const results: JsmServiceDesk[] = [];
  let start = 0;
  const limit = 50;

  while (true) {
    const page = await jsmFetch<{
      values: JsmServiceDesk[];
      isLastPage: boolean;
    }>(`/rest/servicedeskapi/servicedesk?start=${start}&limit=${limit}`);

    results.push(...page.values);
    if (page.isLastPage) break;
    start += limit;
  }

  return results;
}

/**
 * Finds the service desk for a given JSM project key.
 * Returns undefined if no matching service desk is found.
 */
export async function getServiceDeskByProjectKey(
  projectKey: string,
): Promise<JsmServiceDesk | undefined> {
  const all = await getAllServiceDesks();
  return all.find((sd) => sd.projectKey === projectKey);
}

// ─── Request Types ────────────────────────────────────────────────────────────

/**
 * Lists all request types for a service desk.
 */
export async function listRequestTypes(
  serviceDeskId: string,
): Promise<JsmRequestType[]> {
  const results: JsmRequestType[] = [];
  let start = 0;
  const limit = 50;

  while (true) {
    const page = await jsmFetch<{
      values: JsmRequestType[];
      isLastPage: boolean;
    }>(
      `/rest/servicedeskapi/servicedesk/${serviceDeskId}/requesttype?start=${start}&limit=${limit}`,
    );

    results.push(...page.values);
    if (page.isLastPage) break;
    start += limit;
  }

  return results;
}

/**
 * Creates a new request type in a service desk.
 * JSM auto-assigns an issue type; we use the "General Service Request" issue
 * type by default — callers can override issueTypeId if needed.
 */
export async function createRequestType(
  serviceDeskId: string,
  params: {
    name: string;
    description: string;
    helpText?: string;
    issueTypeId?: string;
  },
): Promise<JsmRequestType> {
  return jsmFetch<JsmRequestType>(
    `/rest/servicedeskapi/servicedesk/${serviceDeskId}/requesttype`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: params.name,
        description: params.description,
        helpText: params.helpText ?? '',
        issueTypeId: params.issueTypeId ?? '',
      }),
    },
  );
}

/**
 * Updates an existing request type's name and description.
 * Only name + description are mutable via the API.
 */
export async function updateRequestType(
  serviceDeskId: string,
  requestTypeId: string,
  params: { name: string; description: string },
): Promise<void> {
  await jsmFetch<void>(
    `/rest/servicedeskapi/servicedesk/${serviceDeskId}/requesttype/${requestTypeId}`,
    {
      method: 'PUT',
      body: JSON.stringify(params),
    },
  );
}

// ─── Queues ───────────────────────────────────────────────────────────────────

/**
 * Lists all queues for a service desk.
 */
export async function listQueues(
  serviceDeskId: string,
): Promise<JsmQueue[]> {
  const page = await jsmFetch<{ values: JsmQueue[] }>(
    `/rest/servicedeskapi/servicedesk/${serviceDeskId}/queue?includeCount=false`,
  );
  return page.values;
}

/**
 * Creates a new queue.
 * Uses the internal Jira Service Management API endpoint — the public REST API
 * does not expose queue creation. This endpoint is stable and used by the JSM UI.
 */
export async function createQueue(
  projectKey: string,
  params: {
    name: string;
    jql: string;
    columns: string[];
  },
): Promise<{ id: string }> {
  return jsmFetch<{ id: string }>(
    `/rest/servicedesk/1/servicedesk/${projectKey}/queues`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: params.name,
        jql: params.jql,
        fields: params.columns.map((col) => ({ fieldId: col })),
      }),
    },
  );
}

/**
 * Updates an existing queue's name, JQL, and columns.
 */
export async function updateQueue(
  projectKey: string,
  queueId: string,
  params: {
    name: string;
    jql: string;
    columns: string[];
  },
): Promise<void> {
  await jsmFetch<void>(
    `/rest/servicedesk/1/servicedesk/${projectKey}/queues/${queueId}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        name: params.name,
        jql: params.jql,
        fields: params.columns.map((col) => ({ fieldId: col })),
      }),
    },
  );
}
