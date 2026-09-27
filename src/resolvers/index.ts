/**
 * src/resolvers/index.ts
 *
 * Main Forge Resolver — routes all Custom UI bridge calls to
 * the appropriate handler function.
 */

import Resolver from '@forge/resolver';
import { getConfig } from '../config-loader';
import { resolveFieldOptions } from '../services/external-api';

const resolver = new Resolver();

// ─── Config queries ───────────────────────────────────────────────────────────

/** Returns the list of departments for the portal landing page */
resolver.define('getDepartments', () => {
  const config = getConfig();
  return config.departments.map((d) => ({
    id: d.id,
    name: d.name,
    icon: d.icon,
    color: d.color,
    jsmProjectKey: d.jsmProjectKey,
  }));
});

/** Returns request types for a given department */
resolver.define('getRequestTypes', ({ payload }: { payload: { deptId: string } }) => {
  const config = getConfig();
  const dept = config.departments.find((d) => d.id === payload.deptId);
  if (!dept) throw new Error(`Department not found: ${payload.deptId}`);

  return dept.requestTypes.map((rt) => ({
    id: rt.id,
    name: rt.name,
    description: rt.description,
    icon: rt.icon,
    jsmRequestTypeId: rt.jsmRequestTypeId,
  }));
});

/** Returns the full form definition for a given request type */
resolver.define(
  'getFormDefinition',
  ({ payload }: { payload: { deptId: string; requestTypeId: string } }) => {
    const config = getConfig();
    const dept = config.departments.find((d) => d.id === payload.deptId);
    if (!dept) throw new Error(`Department not found: ${payload.deptId}`);

    const rt = dept.requestTypes.find((r) => r.id === payload.requestTypeId);
    if (!rt) throw new Error(`Request type not found: ${payload.requestTypeId}`);

    return rt.form;
  },
);

// ─── Dynamic field options ────────────────────────────────────────────────────

/**
 * Proxies a call to an external API to fetch field options.
 * All auth and caching is handled server-side — credentials never reach the browser.
 */
resolver.define(
  'getFieldOptions',
  async ({
    payload,
  }: {
    payload: {
      apiSourceId: string;
      apiPath: string;
      dependsOnValue?: string;
      valueKey?: string;
      labelKey?: string;
      cacheTtlSeconds?: number;
    };
  }) => {
    return resolveFieldOptions(payload);
  },
);

// ─── Global config (portal branding etc.) ────────────────────────────────────

resolver.define('getGlobalConfig', () => {
  const config = getConfig();
  return config.global;
});

export const handler = resolver.getDefinitions();
